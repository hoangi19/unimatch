-- Hourly Page token health check: pg_cron calls the token-health Edge Function through pg_net.
-- An invalid token is marked the existing way (token_expires_at <= now()), which the console shows as "reconnect".
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Last time the health check reached Facebook for this Page; null until the first run.
alter table public.pages add column token_checked_at timestamptz;

-- The cron job proves itself to the Edge Function with this value. It is generated here, in the
-- database, so it never appears in the repo.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'token_health_cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'token_health_cron_secret',
      'Header value pg_cron sends to the token-health Edge Function');
  end if;
end $$;

create or replace function public.token_health_secret_ok(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select decrypted_secret = p_secret from vault.decrypted_secrets where name = 'token_health_cron_secret'),
    false
  )
$$;

-- Stores one check result. Disconnected Pages are left alone. A valid token clears an old
-- "invalid" mark, so a stale mark heals on the next run.
create or replace function public.record_token_check(p_page_id text, p_valid boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.pages
  set token_checked_at = now(),
      token_expires_at = case
        when not p_valid then now()
        when token_expires_at <= now() then null
        else token_expires_at
      end
  where id = p_page_id and access_token_secret_id is not null
$$;

revoke execute on function public.token_health_secret_ok(text) from public, anon, authenticated;
revoke execute on function public.record_token_check(text, boolean) from public, anon, authenticated;
grant execute on function public.token_health_secret_ok(text) to service_role;
grant execute on function public.record_token_check(text, boolean) to service_role;

-- Minute 7 of every hour. cron.schedule replaces a job with the same name.
select cron.schedule(
  'page-token-health',
  '7 * * * *',
  $job$
  select net.http_post(
    url := 'https://hsuxhzalvshmbmiuyhwl.supabase.co/functions/v1/token-health',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'token_health_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  )
  $job$
);
