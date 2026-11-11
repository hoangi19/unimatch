-- Checks for hand_off_conversation and set_conversation_mode. Run with scripts/sql-test.sh; every run is rolled back.

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000023', 't23-admin@unimatch.test');
insert into public.pages (id, name) values ('t23-page', 't23 page');
insert into public.conversations (page_id, psid) values ('t23-page', 'u1');

do $$
declare
  v_conv uuid := (select id from public.conversations where page_id = 't23-page');
  c record;
  e jsonb;
begin
  assert public.hand_off_conversation(v_conv, 'keyword', '{"keyword": "nhan vien"}'), 'handed off';
  select * into c from public.conversations where id = v_conv;
  assert c.status = 'needs_human' and c.handoff_reason = 'keyword' and c.handoff_at is not null and c.needs_help, 'status';
  select event into e from public.messages where conversation_id = v_conv and sender_kind = 'system';
  assert e = '{"code": "handoff", "reason": "keyword", "keyword": "nhan vien"}', 'handoff event';

  -- Only a bot-owned conversation is handed off.
  assert not public.hand_off_conversation(v_conv, 'send_failed', null), 'repeat is a no-op';
  assert (select count(*) from public.messages where conversation_id = v_conv) = 1, 'no second event';
end $$;

-- Admin takeover and return through the RPC, as the signed-in admin.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000023", "role": "authenticated", "app_metadata": {"role": "admin"}}', true);

do $$
declare
  v_conv uuid := (select id from public.conversations where page_id = 't23-page');
  c record;
begin
  assert public.set_conversation_mode(v_conv, 'human'), 'taken over';
  assert not public.set_conversation_mode(v_conv, 'human'), 'already human';
  select * into c from public.conversations where id = v_conv;
  assert c.status = 'human' and c.handoff_reason = 'keyword' and not c.needs_help, 'human keeps the handoff record';

  assert public.set_conversation_mode(v_conv, 'bot'), 'returned';
  select * into c from public.conversations where id = v_conv;
  assert c.status = 'bot' and c.handoff_reason is null and c.handoff_at is null, 'bot clears the handoff';

  assert (select array_agg(event ->> 'code' order by event ->> 'code') from public.messages
    where conversation_id = v_conv and admin_id = '00000000-0000-0000-0000-000000000023') = '{return_to_bot,takeover}', 'admin events';

  begin
    perform public.set_conversation_mode(v_conv, 'closed');
    assert false, 'bad mode accepted';
  exception when raise_exception then null;
  end;
end $$;

-- A signed-in non-admin is refused.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000002", "role": "authenticated", "app_metadata": {}}', true);
do $$
begin
  perform public.set_conversation_mode((select id from public.conversations where page_id = 't23-page'), 'human');
  assert false, 'non-admin allowed';
exception when insufficient_privilege then null;
end $$;
reset role;

-- Send-message's takeover path (service role) records the admin.
do $$
declare
  v_conv uuid := (select id from public.conversations where page_id = 't23-page');
begin
  assert public.set_conversation_mode_as(v_conv, 'human', '00000000-0000-0000-0000-000000000023'), 'send takeover';
  assert (select status from public.conversations where id = v_conv) = 'human', 'human after send';
  -- The engine never hands off a conversation an admin owns.
  assert not public.hand_off_conversation(v_conv, 'keyword', null), 'no handoff while human';
end $$;

do $$
begin
  assert not has_function_privilege('authenticated', 'public.hand_off_conversation(uuid, text, jsonb)', 'execute'), 'handoff private';
  assert not has_function_privilege('authenticated', 'public.set_conversation_mode_as(uuid, text, uuid)', 'execute'), 'mode_as private';
  assert not has_function_privilege('anon', 'public.set_conversation_mode(uuid, text)', 'execute'), 'anon refused';
  assert has_function_privilege('authenticated', 'public.set_conversation_mode(uuid, text)', 'execute'), 'admin RPC';
  assert has_function_privilege('service_role', 'public.hand_off_conversation(uuid, text, jsonb)', 'execute'), 'service';
end $$;
