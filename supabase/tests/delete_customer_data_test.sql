-- Checks for delete_customer_data. Run with scripts/sql-test.sh; every run is rolled back.

insert into public.pages (id, name) values ('t32-page', 't32 page');
insert into public.conversations (page_id, psid, notes) values ('t32-page', 't32-gone', 'note'), ('t32-page', 't32-kept', '');
insert into public.messages (conversation_id, sender_kind, text)
select id, 'user', 'hello' from public.conversations where page_id = 't32-page';
insert into public.messages (conversation_id, sender_kind, text)
select id, 'bot', 'hi' from public.conversations where psid = 't32-gone';
insert into public.webhook_events (page_id, field, payload) values
  ('t32-page', 'messages', '{"sender": {"id": "t32-gone"}, "recipient": {"id": "t32-page"}}'),
  ('t32-page', 'messages', '{"sender": {"id": "t32-page"}, "recipient": {"id": "t32-gone"}, "message": {"is_echo": true}}'),
  ('t32-page', 'messages', '{"sender": {"id": "t32-kept"}, "recipient": {"id": "t32-page"}}');

-- Service role: one customer goes, the other stays.
set local role service_role;
do $$
declare
  r jsonb := public.delete_customer_data('t32-gone');
begin
  assert r = '{"conversations": 1, "messages": 2, "webhook_events": 2}', 'counts: ' || r;
  assert not exists (select 1 from public.conversations where psid = 't32-gone'), 'conversation deleted';
  assert not exists (select 1 from public.webhook_events where payload::text like '%t32-gone%'), 'events deleted';
  assert (select count(*) from public.messages m join public.conversations c on c.id = m.conversation_id where c.psid = 't32-kept') = 1, 'other messages kept';
  assert (select count(*) from public.webhook_events where page_id = 't32-page') = 1, 'other event kept';

  assert public.delete_customer_data('t32-gone') = '{"conversations": 0, "messages": 0, "webhook_events": 0}', 'repeat is a no-op';
  begin
    perform public.delete_customer_data(' ');
    assert false, 'blank psid accepted';
  exception when raise_exception then null;
  end;
end $$;

-- A signed-in admin and anon cannot call it.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated", "app_metadata": {"role": "admin"}}', true);
do $$
begin
  perform public.delete_customer_data('t32-kept');
  assert false, 'authenticated must not execute delete_customer_data';
exception when insufficient_privilege then null;
end $$;

set local role anon;
do $$
begin
  perform public.delete_customer_data('t32-kept');
  assert false, 'anon must not execute delete_customer_data';
exception when insufficient_privilege then null;
end $$;
reset role;
