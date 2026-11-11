-- Checks for the chatbot_settings migration. Run with scripts/sql-test.sh; every run is rolled back.
-- Each failed assert raises, which aborts the run.

-- Admin: save a key, read back only the hint.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated", "app_metadata": {"role": "admin"}}', true);

do $$
declare
  r record;
begin
  select * into r from public.set_provider_key('hermes', '  nous-testkey-7Qe2  ');
  assert r.key_hint = 'nous-…7Qe2', 'hint after save: ' || r.key_hint;
  assert r.key_saved_at is not null, 'saved_at after save';

  select * into r from public.ai_providers where kind = 'hermes';
  assert r.key_hint = 'nous-…7Qe2', 'hint in table';
  assert (select count(*) from public.ai_providers) = 4, 'admin sees all providers';

  select * into r from public.set_provider_key('openai', 'sk-testkey-a3F9');
  assert r.key_hint = 'sk-…a3F9', 'openai hint: ' || r.key_hint;
  select * into r from public.set_provider_key('anthropic', 'sk-ant-testkey-b7Q1');
  assert r.key_hint = 'sk-ant-…b7Q1', 'anthropic hint: ' || r.key_hint;
end $$;

-- Admin: no path returns the full key, and key columns are not writable directly.
do $$
begin
  begin
    perform public.get_provider_key('hermes');
    assert false, 'authenticated must not execute get_provider_key';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from vault.decrypted_secrets;
    assert false, 'authenticated must not read vault';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.ai_providers set key_hint = 'x' where kind = 'hermes';
    assert false, 'authenticated must not write key_hint';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.ai_providers (kind) values ('custom');
    assert false, 'authenticated must not insert providers';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Invalid keys are rejected without echoing the value.
do $$
begin
  begin
    perform public.set_provider_key('hermes', 'has space-secretvalue');
    assert false, 'key with space accepted';
  exception when invalid_parameter_value then
    assert sqlerrm not like '%secretvalue%', 'error echoes key: ' || sqlerrm;
  end;
  begin
    perform public.set_provider_key('hermes', 'short');
    assert false, 'short key accepted';
  exception when invalid_parameter_value then
    assert sqlerrm not like '%short%', 'error echoes key';
  end;
end $$;

-- Switching provider keeps every provider's own config.
do $$
declare
  r record;
begin
  update public.ai_providers set model = 'gpt-4.1', extra_headers = '{"OpenAI-Organization": "org-test"}' where kind = 'openai';
  update public.bot_settings set active_provider = 'openai', temperature = 0.7;
  update public.bot_settings set active_provider = 'anthropic';
  select * into r from public.ai_providers where kind = 'hermes';
  assert r.model = 'hermes-4-70b' and r.key_hint = 'nous-…7Qe2', 'hermes config lost';
  select * into r from public.ai_providers where kind = 'openai';
  assert r.model = 'gpt-4.1' and r.extra_headers ->> 'OpenAI-Organization' = 'org-test' and r.key_hint = 'sk-…a3F9', 'openai config lost';
  assert (select active_provider from public.bot_settings) = 'anthropic', 'active provider';

  begin
    update public.ai_providers set extra_headers = '{"Bad Header": "x"}' where kind = 'custom';
    assert false, 'bad header name accepted';
  exception when check_violation then null;
  end;
  begin
    update public.ai_providers set base_url = 'http://example.com/v1' where kind = 'custom';
    assert false, 'plain http base_url accepted';
  exception when check_violation then null;
  end;
  begin
    update public.ai_providers set base_url = 'http://localhost:8000/v1' where kind = 'custom';
    assert false, 'http://localhost base_url accepted';
  exception when check_violation then null;
  end;
  update public.ai_providers set base_url = 'https://llm.example.com/v1' where kind = 'custom';
  begin
    update public.bot_settings set temperature = 2;
    assert false, 'temperature 2 accepted';
  exception when check_violation then null;
  end;
end $$;

-- Replace keeps the same Vault secret.
select public.set_provider_key('hermes', 'nous-testkey-9Zz1');

-- Service role (Edge Functions) reads the full key.
reset role;
set local role service_role;
do $$
begin
  assert public.get_provider_key('hermes') = 'nous-testkey-9Zz1', 'service role reads replaced key';
  assert public.get_provider_key('custom') is null, 'no key for custom';
end $$;

-- Non-admin user sees nothing and cannot save keys.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000002", "role": "authenticated", "app_metadata": {}}', true);
do $$
begin
  assert (select count(*) from public.ai_providers) = 0, 'non-admin reads providers';
  assert (select count(*) from public.bot_settings) = 0, 'non-admin reads settings';
  begin
    perform public.set_provider_key('hermes', 'nous-testkey-0000');
    assert false, 'non-admin saved a key';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.remove_provider_key('hermes');
    assert false, 'non-admin removed a key';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Anon gets nothing.
reset role;
set local role anon;
do $$
begin
  begin
    perform 1 from public.ai_providers;
    assert false, 'anon reads providers';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_provider_key('hermes', 'nous-testkey-0000');
    assert false, 'anon executes set_provider_key';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Admin removes the key: columns cleared, Vault secret deleted.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated", "app_metadata": {"role": "admin"}}', true);
select public.remove_provider_key('hermes');
reset role;
do $$
declare
  r record;
begin
  select * into r from public.ai_providers where kind = 'hermes';
  assert r.key_secret_id is null and r.key_hint is null and r.key_saved_at is null, 'key columns not cleared';
  assert not exists (select 1 from vault.secrets where name = 'ai_provider_key:hermes'), 'hermes secret not deleted';
  assert (select count(*) from vault.secrets where name = 'ai_provider_key:openai') = 1, 'openai secret missing';
end $$;
