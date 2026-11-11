-- Model guardrail (Quyet-1.0-Large on FPT AI Marketplace): one decision before the reply model runs.
-- Connection and key live here; the behaviour toggles live in bot_settings.guardrails next to the keyword rule.
-- Not an ai_providers kind: a new enum value cannot be used in the migration that adds it, and the guardrail
-- must never be selectable as the reply provider.

-- Single row: id is always true. Only Quyet for now.
create table public.guardrail_model (
  id boolean primary key default true check (id),
  provider text not null default 'quyet' check (provider = 'quyet'),
  base_url text not null default 'https://mkp-api.fptcloud.com/v1' check (base_url ~ '^https://'),
  model text not null default 'Quyet-1.0-Large' check (char_length(btrim(model)) between 1 and 200),
  key_secret_id uuid,
  key_hint text,
  key_saved_at timestamptz
);

insert into public.guardrail_model default values;

alter table public.guardrail_model enable row level security;
create policy "admins read guardrail_model" on public.guardrail_model for select to authenticated using ((select public.is_admin()));
create policy "admins update guardrail_model" on public.guardrail_model for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

revoke all on public.guardrail_model from anon, authenticated;
grant select on public.guardrail_model to authenticated;
-- Key columns change only through the RPCs below.
grant update (base_url, model) on public.guardrail_model to authenticated;

-- Same rules as set_provider_key. Errors never include the key.
create function public.set_guardrail_key(p_key text)
returns table (key_hint text, key_saved_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := btrim(p_key);
  v_secret_id uuid;
  v_hint text;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if v_key is null or char_length(v_key) not between 8 and 512 or v_key ~ '\s' then
    raise exception 'invalid API key: expected 8-512 characters without spaces' using errcode = '22023';
  end if;

  select g.key_secret_id into v_secret_id from public.guardrail_model g for update;
  if v_secret_id is null then
    v_secret_id := vault.create_secret(v_key, 'guardrail_model_key', 'API key for the guardrail model');
  else
    perform vault.update_secret(v_secret_id, v_key);
  end if;

  -- Same hint shape as set_provider_key: short vendor prefix plus the last 4 characters.
  v_hint := coalesce(substring(v_key from '^[A-Za-z]{1,4}(?:-[A-Za-z]{1,4})?-'), '') || '…' || right(v_key, 4);

  return query
    update public.guardrail_model g
    set key_secret_id = v_secret_id, key_hint = v_hint, key_saved_at = now()
    where g.id
    returning g.key_hint, g.key_saved_at;
end;
$$;

create function public.remove_guardrail_key()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  select g.key_secret_id into v_secret_id from public.guardrail_model g for update;
  update public.guardrail_model g set key_secret_id = null, key_hint = null, key_saved_at = null where g.id;
  delete from vault.secrets where id = v_secret_id;
end;
$$;

-- Edge Functions (service role) read the full key. No browser role may execute this.
create function public.get_guardrail_key()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret
  from public.guardrail_model g
  join vault.decrypted_secrets s on s.id = g.key_secret_id
$$;

revoke all on function public.set_guardrail_key(text) from public, anon;
revoke all on function public.remove_guardrail_key() from public, anon;
revoke all on function public.get_guardrail_key() from public, anon, authenticated;
grant execute on function public.set_guardrail_key(text) to authenticated;
grant execute on function public.remove_guardrail_key() to authenticated;
grant execute on function public.get_guardrail_key() to service_role;

-- New guardrail toggles, off until an admin enables the model. Existing keys keep their saved values, except
-- handoff_on_complaint: nothing acted on it before, and complaints hand off by default once the model is on.
-- Off-topic stays off: a false positive would silence a real job question.
update public.bot_settings set guardrails = jsonb_build_object(
  'model_enabled', false,
  'handoff_on_human_request', true,
  'refuse_off_topic', false,
  'on_model_error', 'reply',
  'off_topic_message', 'Mình là trợ lý tìm việc của UniMatch nên chỉ hỗ trợ được các câu hỏi về việc làm. Bạn đang tìm vị trí nào, ở thành phố nào?'
) || guardrails || '{"handoff_on_complaint": true}';
