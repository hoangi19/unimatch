-- Checks close / reopen through set_conversation_mode and the quick_replies default. Run with scripts/sql-test.sh; every run is rolled back.

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000027', 't27-admin@unimatch.test');
insert into public.pages (id, name) values ('t27-page', 't27 page');
insert into public.conversations (page_id, psid, status, handoff_reason, handoff_at) values ('t27-page', 'u1', 'needs_human', 'keyword', now());

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000027", "role": "authenticated", "app_metadata": {"role": "admin"}}', true);

do $$
declare
  v_conv uuid := (select id from public.conversations where page_id = 't27-page');
  c record;
begin
  assert public.set_conversation_mode(v_conv, 'closed'), 'closed';
  assert not public.set_conversation_mode(v_conv, 'closed'), 'already closed';
  select * into c from public.conversations where id = v_conv;
  assert c.status = 'closed' and c.handoff_reason = 'keyword', 'close keeps the handoff record';

  assert public.set_conversation_mode(v_conv, 'bot'), 'reopened';
  select * into c from public.conversations where id = v_conv;
  assert c.status = 'bot' and c.handoff_reason is null, 'reopen goes to the bot and clears the handoff';

  assert public.set_conversation_mode(v_conv, 'closed') and public.set_conversation_mode(v_conv, 'human'), 'closed then taken over';
  assert (select array_agg(event ->> 'code' order by event ->> 'code') from public.messages
    where conversation_id = v_conv and admin_id = '00000000-0000-0000-0000-000000000027') = '{close,close,reopen,takeover}', 'event codes';

  assert not public.set_conversation_mode('00000000-0000-4000-8000-000000000000', 'closed'), 'unknown conversation';
  begin
    perform public.set_conversation_mode(v_conv, null);
    assert false, 'null mode accepted';
  exception when raise_exception then null;
  end;

  assert cardinality((select quick_replies from public.bot_settings)) = 4, 'quick replies default';
end $$;

-- Admins edit quick replies; the list is capped.
update public.bot_settings set quick_replies = array['Xin chào'];
do $$
begin
  assert (select quick_replies from public.bot_settings) = array['Xin chào'], 'admin updates quick replies';
  update public.bot_settings set quick_replies = array_fill('x'::text, array[21]);
  assert false, 'too many quick replies';
exception when check_violation then null;
end $$;

-- A signed-in non-admin is refused.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000002", "role": "authenticated", "app_metadata": {}}', true);
do $$
begin
  perform public.set_conversation_mode((select id from public.conversations where page_id = 't27-page'), 'closed');
  assert false, 'non-admin allowed';
exception when insufficient_privilege then null;
end $$;
reset role;
