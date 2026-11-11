-- Checks for the page_token_health migration. Run with scripts/sql-test.sh; every run is rolled back.

-- Migration side effects: cron job and its Vault secret exist.
do $$
begin
  assert exists (select 1 from cron.job where jobname = 'page-token-health' and schedule = '7 * * * *'), 'hourly job scheduled';
  assert exists (select 1 from vault.secrets where name = 'token_health_cron_secret'), 'cron secret stored';
end $$;

set local role service_role;

do $$
declare
  v_secret text;
  r record;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'token_health_cron_secret';
  assert public.token_health_secret_ok(v_secret), 'right secret accepted';
  assert not public.token_health_secret_ok('wrong'), 'wrong secret refused';
  assert not public.token_health_secret_ok(null), 'null secret refused';

  insert into public.pages (id, name) values ('test-health-page', 'Health test'), ('test-health-off', 'Disconnected');
  perform public.set_page_token('test-health-page', 'placeholder-page-token', null);

  -- Invalid: marked expired, checked.
  perform public.record_token_check('test-health-page', false);
  select * into r from public.pages where id = 'test-health-page';
  assert r.token_expires_at <= now() and r.token_checked_at is not null, 'invalid token marked expired';

  -- Valid after a mark: the stale mark is cleared.
  perform public.record_token_check('test-health-page', true);
  select * into r from public.pages where id = 'test-health-page';
  assert r.token_expires_at is null, 'stale mark cleared';

  -- Valid with a future expiry: expiry kept.
  update public.pages set token_expires_at = now() + interval '30 days' where id = 'test-health-page';
  perform public.record_token_check('test-health-page', true);
  select * into r from public.pages where id = 'test-health-page';
  assert r.token_expires_at > now(), 'future expiry kept';

  -- Disconnected Page: untouched.
  perform public.record_token_check('test-health-off', false);
  select * into r from public.pages where id = 'test-health-off';
  assert r.token_expires_at is null and r.token_checked_at is null, 'disconnected Page untouched';
end $$;

-- Admin: cannot call either function.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated", "app_metadata": {"role": "admin"}}', true);

do $$
begin
  perform public.record_token_check('test-health-page', false);
  assert false, 'authenticated must not execute record_token_check';
exception when insufficient_privilege then null;
end $$;

do $$
begin
  perform public.token_health_secret_ok('x');
  assert false, 'authenticated must not execute token_health_secret_ok';
exception when insufficient_privilege then null;
end $$;
