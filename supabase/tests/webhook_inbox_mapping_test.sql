-- Checks for the webhook inbox mapping migration. Run with scripts/sql-test.sh; every run is rolled back.
-- Events are inserted the way meta-webhook does (on conflict do nothing), so the trigger maps them.

-- Inserts one raw event like the Edge Function does and returns its stored status.
create function pg_temp.ev(p_page text, p_field text, p_ext text, p_payload jsonb)
returns text language sql as $$
  insert into public.webhook_events (page_id, field, external_id, payload)
  values (p_page, p_field, p_ext, p_payload)
  on conflict (external_id) do nothing;
  select status from public.webhook_events where external_id = p_ext;
$$;

create function pg_temp.msg(p_psid text, p_mid text, p_ts bigint, p_text text)
returns jsonb language sql as $$
  select jsonb_build_object('sender', jsonb_build_object('id', p_psid), 'recipient', jsonb_build_object('id', 't15-page'),
    'timestamp', p_ts, 'message', jsonb_build_object('mid', p_mid, 'text', p_text))
$$;

create function pg_temp.echo(p_psid text, p_mid text, p_ts bigint, p_text text)
returns jsonb language sql as $$
  select jsonb_build_object('sender', jsonb_build_object('id', 't15-page'), 'recipient', jsonb_build_object('id', p_psid),
    'timestamp', p_ts, 'message', jsonb_build_object('mid', p_mid, 'text', p_text, 'is_echo', true, 'app_id', 1))
$$;

-- No Page row yet: raw event kept as no_page, nothing mapped. Replay maps it once the Page exists.
do $$
declare
  c record;
begin
  assert pg_temp.ev('t15-page', 'messages', 't15:m1', pg_temp.msg('u1', 't15:m1', 1767225600000, 'hello')) = 'no_page', 'no_page';
  assert not exists (select 1 from public.conversations where page_id = 't15-page'), 'no conversation without page';

  insert into public.pages (id, name) values ('t15-page', 't15 page');
  assert public.replay_webhook_events('t15-page') = 1, 'replay count';
  assert (select status from public.webhook_events where external_id = 't15:m1') = 'processed', 'replayed status';
  assert public.replay_webhook_events('t15-page') = 0, 'second replay is a no-op';

  select * into c from public.conversations where page_id = 't15-page' and psid = 'u1';
  assert c.status = 'bot' and c.unread_count = 1 and c.last_message_preview = 'hello', 'new conversation';
  assert c.last_customer_message_at = to_timestamp(1767225600), 'last customer at';
  assert c.customer_name is null, 'name left for page connect';
  assert (select sender_kind from public.messages where external_id = 't15:m1') = 'user', 'user message';
end $$;

-- Next message bumps counters; a Meta retry of the same mid changes nothing.
do $$
declare
  c record;
begin
  assert pg_temp.ev('t15-page', 'messages', 't15:m2', pg_temp.msg('u1', 't15:m2', 1767225601000, 'part-time?')) = 'processed', 'm2';
  perform pg_temp.ev('t15-page', 'messages', 't15:m2', pg_temp.msg('u1', 't15:m2', 1767225601000, 'part-time?'));
  select * into c from public.conversations where page_id = 't15-page' and psid = 'u1';
  assert c.unread_count = 2, 'unread after retry: ' || c.unread_count;
  assert c.last_message_preview = 'part-time?', 'preview';
  assert (select count(*) from public.messages where conversation_id = c.id) = 2, 'no duplicate message';

  -- A stray old message keeps the newer preview.
  perform pg_temp.ev('t15-page', 'messages', 't15:m0', pg_temp.msg('u1', 't15:m0', 1767225500000, 'older'));
  select * into c from public.conversations where page_id = 't15-page' and psid = 'u1';
  assert c.last_message_preview = 'part-time?' and c.last_message_at = to_timestamp(1767225601), 'older message keeps latest';
end $$;

-- Status: needs_human and human are kept; closed reopens to bot on a customer message.
do $$
begin
  update public.conversations set status = 'needs_human' where page_id = 't15-page' and psid = 'u1';
  perform pg_temp.ev('t15-page', 'messages', 't15:m3', pg_temp.msg('u1', 't15:m3', 1767225602000, 'agent please'));
  assert (select status from public.conversations where page_id = 't15-page' and psid = 'u1') = 'needs_human', 'needs_human kept';

  update public.conversations set status = 'human' where page_id = 't15-page' and psid = 'u1';
  perform pg_temp.ev('t15-page', 'messages', 't15:m4', pg_temp.msg('u1', 't15:m4', 1767225603000, 'still there?'));
  assert (select status from public.conversations where page_id = 't15-page' and psid = 'u1') = 'human', 'human kept';

  update public.conversations set status = 'closed' where page_id = 't15-page' and psid = 'u1';
  perform pg_temp.ev('t15-page', 'messages', 't15:m5', pg_temp.msg('u1', 't15:m5', 1767225604000, 'one more'));
  assert (select status from public.conversations where page_id = 't15-page' and psid = 'u1') = 'bot', 'closed reopens';
end $$;

-- Echoes: unknown mid becomes an admin message; a mid our app stored is not duplicated.
do $$
declare
  c record;
  m record;
begin
  select * into c from public.conversations where page_id = 't15-page' and psid = 'u1';
  assert pg_temp.ev('t15-page', 'messages', 't15:e1', pg_temp.echo('u1', 't15:e1', 1767225605000, 'reply from MBS')) = 'processed', 'echo';
  select * into m from public.messages where external_id = 't15:e1';
  assert m.sender_kind = 'admin' and m.admin_id is null and m.conversation_id = c.id, 'admin echo';
  assert (select unread_count from public.conversations where id = c.id) = c.unread_count, 'echo not unread';
  assert (select last_message_preview from public.conversations where id = c.id) = 'reply from MBS', 'echo preview';
  assert (select last_customer_message_at from public.conversations where id = c.id) = c.last_customer_message_at, 'echo keeps 24h window';

  insert into public.messages (conversation_id, sender_kind, text, external_id, created_at)
  values (c.id, 'bot', 'bot reply', 't15:b1', to_timestamp(1767225606));
  assert pg_temp.ev('t15-page', 'messages', 't15:b1', pg_temp.echo('u1', 't15:b1', 1767225606000, 'bot reply')) = 'ignored', 'known echo';
  assert (select count(*) from public.messages where external_id = 't15:b1') = 1, 'no duplicate echo';

  -- Echo to a customer with no thread yet starts one with zero unread.
  perform pg_temp.ev('t15-page', 'messages', 't15:e2', pg_temp.echo('u2', 't15:e2', 1767225607000, 'hi first'));
  select * into c from public.conversations where page_id = 't15-page' and psid = 'u2';
  assert c.unread_count = 0 and c.last_customer_message_at is null, 'echo-only thread';
end $$;

-- Delivery and read move statuses forward only, and only for page-side messages of that customer.
do $$
declare
  v_conv uuid := (select id from public.conversations where page_id = 't15-page' and psid = 'u1');
begin
  assert pg_temp.ev('t15-page', 'message_deliveries', 't15:d1', jsonb_build_object(
    'sender', jsonb_build_object('id', 'u1'), 'recipient', jsonb_build_object('id', 't15-page'), 'timestamp', 1767225610000,
    'delivery', jsonb_build_object('mids', jsonb_build_array('t15:b1')))) = 'processed', 'delivery';
  assert (select delivery_status from public.messages where external_id = 't15:b1') = 'delivered', 'delivered by mid';
  assert (select delivery_status from public.messages where external_id = 't15:e1') = 'sent', 'other mid untouched';

  perform pg_temp.ev('t15-page', 'message_reads', 't15:r1', jsonb_build_object(
    'sender', jsonb_build_object('id', 'u1'), 'recipient', jsonb_build_object('id', 't15-page'), 'timestamp', 1767225611000,
    'read', jsonb_build_object('watermark', 1767225606000)));
  assert (select delivery_status from public.messages where external_id = 't15:b1') = 'read', 'read by watermark';
  assert (select delivery_status from public.messages where external_id = 't15:e1') = 'read', 'older admin read';
  assert (select delivery_status from public.messages where external_id = 't15:m1') = 'sent', 'user message untouched';
  assert (select delivery_status from public.messages where external_id = 't15:e2') = 'sent', 'other customer untouched';

  perform pg_temp.ev('t15-page', 'message_deliveries', 't15:d2', jsonb_build_object(
    'sender', jsonb_build_object('id', 'u1'), 'recipient', jsonb_build_object('id', 't15-page'), 'timestamp', 1767225612000,
    'delivery', jsonb_build_object('mids', jsonb_build_array('t15:b1'), 'watermark', 1767225612000)));
  assert (select delivery_status from public.messages where external_id = 't15:b1') = 'read', 'delivery never downgrades read';
end $$;

-- Postback is the customer's tap: stored as a user message with the button title.
do $$
declare
  m record;
begin
  assert pg_temp.ev('t15-page', 'messaging_postbacks', 't15:p1', jsonb_build_object(
    'sender', jsonb_build_object('id', 'u1'), 'recipient', jsonb_build_object('id', 't15-page'), 'timestamp', 1767225620000,
    'postback', jsonb_build_object('mid', 't15:p1', 'title', 'Find jobs', 'payload', 'FIND_JOBS'))) = 'processed', 'postback';
  select * into m from public.messages where external_id = 't15:p1';
  assert m.sender_kind = 'user' and m.text = 'Find jobs' and m.attachments -> 0 ->> 'payload' = 'FIND_JOBS', 'postback message';
end $$;

-- Unsupported events are ignored; malformed ones fail without losing the raw row or partial writes.
do $$
declare
  n bigint := (select count(*) from public.conversations where page_id = 't15-page');
  e record;
begin
  assert pg_temp.ev('t15-page', 'message_reactions', 't15:x1', jsonb_build_object(
    'sender', jsonb_build_object('id', 'u1'), 'timestamp', 1767225630000, 'reaction', jsonb_build_object('emoji', 'x'))) = 'ignored', 'reaction ignored';

  perform pg_temp.ev('t15-page', 'messages', 't15:bad', jsonb_build_object(
    'timestamp', 1767225631000, 'message', jsonb_build_object('mid', 't15:bad', 'text', 'no sender')));
  select * into e from public.webhook_events where external_id = 't15:bad';
  assert e.status = 'failed' and e.error like '23502:%', 'failed with error: ' || coalesce(e.error, 'null');
  assert (select count(*) from public.conversations where page_id = 't15-page') = n, 'no partial conversation';

  perform pg_temp.ev('t15-page', 'messages', 't15:bad2', jsonb_build_object(
    'sender', jsonb_build_object('id', 'u1'), 'timestamp', 'not-a-number', 'message', jsonb_build_object('mid', 't15:bad2')));
  assert (select status from public.webhook_events where external_id = 't15:bad2') = 'failed', 'bad timestamp fails';
end $$;

-- Clients cannot call the mapping functions.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated", "app_metadata": {"role": "admin"}}', true);
do $$
begin
  begin
    perform public.replay_webhook_events('t15-page');
    assert false, 'authenticated must not replay';
  exception when insufficient_privilege then null;
  end;
end $$;
