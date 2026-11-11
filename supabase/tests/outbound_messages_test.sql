-- Checks for record_outbound_message. Run with scripts/sql-test.sh; every run is rolled back.

insert into public.pages (id, name) values ('t16-page', 't16 page');
insert into public.conversations (page_id, psid, last_message_at, last_message_preview, last_customer_message_at)
values ('t16-page', 'u1', '2026-01-01 00:00:00+00', 'hello', '2026-01-01 00:00:00+00');

-- Echo first: the mapping trigger stores it as an admin message; our send turns it into the bot message.
do $$
declare
  v_conv uuid := (select id from public.conversations where page_id = 't16-page');
  v_id uuid;
  m record;
begin
  insert into public.webhook_events (page_id, field, external_id, payload)
  values ('t16-page', 'messages', 't16:m1', jsonb_build_object(
    'sender', jsonb_build_object('id', 't16-page'), 'recipient', jsonb_build_object('id', 'u1'),
    'timestamp', 1767225605000, 'message', jsonb_build_object('mid', 't16:m1', 'text', 'bot reply', 'is_echo', true)));
  assert (select sender_kind from public.messages where external_id = 't16:m1') = 'admin', 'echo stored as admin';
  update public.messages set delivery_status = 'delivered' where external_id = 't16:m1';

  v_id := public.record_outbound_message(v_conv, 'bot', null, 'bot reply', 't16:m1', null, '{"model":"x"}');
  select * into m from public.messages where external_id = 't16:m1';
  assert m.id = v_id and m.sender_kind = 'bot' and m.admin_id is null and m.trace = '{"model":"x"}', 'became bot';
  assert m.created_at = to_timestamp(1767225605), 'keeps the echo timestamp';
  assert m.delivery_status = 'delivered', 'keeps the delivery status';
  assert (select count(*) from public.messages where conversation_id = v_conv) = 1, 'one row';
end $$;

-- Send stored first: a new row bumps the preview, and the later echo is ignored.
do $$
declare
  v_conv uuid := (select id from public.conversations where page_id = 't16-page');
  c record;
begin
  perform public.record_outbound_message(v_conv, 'admin', null, 'admin reply', 't16:m2', null, null);
  select * into c from public.conversations where id = v_conv;
  assert c.last_message_preview = 'admin reply' and c.last_message_at > '2026-01-01 00:00:06+00', 'preview bumped';
  assert (select delivery_status from public.messages where external_id = 't16:m2') = 'sent', 'sent';

  insert into public.webhook_events (page_id, field, external_id, payload)
  values ('t16-page', 'messages', 't16:m2', jsonb_build_object(
    'sender', jsonb_build_object('id', 't16-page'), 'recipient', jsonb_build_object('id', 'u1'),
    'timestamp', 1767225610000, 'message', jsonb_build_object('mid', 't16:m2', 'text', 'admin reply', 'is_echo', true)));
  assert (select status from public.webhook_events where external_id = 't16:m2') = 'ignored', 'echo ignored';
  assert (select sender_kind from public.messages where external_id = 't16:m2') = 'admin', 'still admin';
end $$;

-- Failed send: stored as failed, preview untouched; bad arguments raise.
do $$
declare
  v_conv uuid := (select id from public.conversations where page_id = 't16-page');
  v_before text := (select last_message_preview from public.conversations where id = v_conv);
  v_id uuid;
  m record;
  v_raised boolean;
begin
  v_id := public.record_outbound_message(v_conv, 'bot', null, 'lost', null, 'Messenger rate limit reached', null);
  select * into m from public.messages where id = v_id;
  assert m.delivery_status = 'failed' and m.delivery_error = 'Messenger rate limit reached' and m.external_id is null, 'failed row';
  assert (select last_message_preview from public.conversations where id = v_conv) = v_before, 'preview untouched';

  begin
    perform public.record_outbound_message(v_conv, 'user', null, 'x', 't16:m3', null, null);
    v_raised := false;
  exception when others then v_raised := true;
  end;
  assert v_raised, 'user sender rejected';
  begin
    perform public.record_outbound_message(v_conv, 'bot', null, 'x', 't16:m3', 'both', null);
    v_raised := false;
  exception when others then v_raised := true;
  end;
  assert v_raised, 'mid and error together rejected';
end $$;

do $$
begin
  assert not has_function_privilege('anon', 'public.record_outbound_message(uuid, text, uuid, text, text, text, jsonb)', 'execute'), 'anon';
  assert not has_function_privilege('authenticated', 'public.record_outbound_message(uuid, text, uuid, text, text, text, jsonb)', 'execute'), 'authenticated';
  assert has_function_privilege('service_role', 'public.record_outbound_message(uuid, text, uuid, text, text, text, jsonb)', 'execute'), 'service_role';
end $$;
