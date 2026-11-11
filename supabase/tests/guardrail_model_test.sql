-- Checks for the guardrail_model migration. Run with scripts/sql-test.sh; every run is rolled back.
-- Each failed assert raises, which aborts the run.

-- Defaults: Quyet on FPT, no key, model guardrail off, off-topic off, complaint and human request on.
do $$
declare
  r record;
  g jsonb := (select guardrails from public.bot_settings);
begin
  select * into r from public.guardrail_model;
  assert r.provider = 'quyet' and r.base_url = 'https://mkp-api.fptcloud.com/v1' and r.model = 'Quyet-1.0-Large', 'defaults';
  assert (g ->> 'model_enabled')::boolean = false, 'model off by default';
  assert (g ->> 'refuse_off_topic')::boolean = false, 'off-topic off by default';
  assert (g ->> 'handoff_on_complaint')::boolean and (g ->> 'handoff_on_human_request')::boolean, 'handoffs on';
  assert g ->> 'on_model_error' = 'reply', 'fail-open by default';
  assert char_length(g ->> 'off_topic_message') > 0, 'off-topic message seeded';
  assert g ? 'refused_topics' and g ? 'handoff_on_keyword', 'existing keys kept';
end $$;

-- Admin: save a key, read back only the hint.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated", "app_metadata": {"role": "admin"}}', true);

do $$
declare
  r record;
begin
  select * into r from public.set_guardrail_key('  fpt-testkey-9Zx1  ');
  assert r.key_hint = 'fpt-…9Zx1', 'hint after save: ' || r.key_hint;
  select * into r from public.set_guardrail_key('fpttestkey-8Yw2');
  assert r.key_hint = '…8Yw2', 'hint after replace: ' || r.key_hint;

  update public.guardrail_model set model = 'Quyet-1.0-Large-test';
  assert (select model from public.guardrail_model) = 'Quyet-1.0-Large-test', 'admin edits model';

  begin
    perform public.get_guardrail_key();
    assert false, 'authenticated must not execute get_guardrail_key';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.guardrail_model set key_hint = 'x';
    assert false, 'authenticated must not write key_hint';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.guardrail_model set base_url = 'http://example.com';
    assert false, 'http base URL accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.set_guardrail_key('has space-secretvalue');
    assert false, 'key with space accepted';
  exception when invalid_parameter_value then
    assert sqlerrm not like '%secretvalue%', 'error echoes key: ' || sqlerrm;
  end;
end $$;

-- Non-admin: sees no row and cannot save a key.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000002", "role": "authenticated", "app_metadata": {}}', true);

do $$
begin
  assert (select count(*) from public.guardrail_model) = 0, 'non-admin sees the row';
  begin
    perform public.set_guardrail_key('fpt-testkey-9Zx1');
    assert false, 'non-admin saved a key';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Service role reads the saved key; remove clears it and the Vault secret.
reset role;
do $$
declare
  v_id uuid := (select key_secret_id from public.guardrail_model);
begin
  assert public.get_guardrail_key() = 'fpttestkey-8Yw2', 'service role reads key';
  perform set_config('request.jwt.claims', '{"role": "authenticated", "app_metadata": {"role": "admin"}}', true);
  perform public.remove_guardrail_key();
  assert public.get_guardrail_key() is null, 'key removed';
  assert (select key_hint from public.guardrail_model) is null, 'hint removed';
  assert not exists (select 1 from vault.secrets where id = v_id), 'vault secret removed';
end $$;

-- Anon: nothing.
set local role anon;
do $$
begin
  begin
    perform 1 from public.guardrail_model;
    assert false, 'anon read guardrail_model';
  exception when insufficient_privilege then null;
  end;
end $$;
