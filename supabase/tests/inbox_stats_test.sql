-- Checks for inbox_stats against hand-written queries on fixture rows. Run with scripts/sql-test.sh; every run is rolled back.

insert into public.pages (id, name) values ('t29-a', 't29 page a'), ('t29-b', 't29 page b');
-- The window under test is 10 Jan 2026 in Asia/Ho_Chi_Minh.
insert into public.conversations (id, page_id, psid, status, last_message_at) values
  ('00000000-0000-0000-0029-000000000001', 't29-a', 'bot', 'bot', '2026-01-10 09:00:02+07'),
  ('00000000-0000-0000-0029-000000000002', 't29-a', 'handoff', 'needs_human', '2026-01-10 10:01+07'),
  ('00000000-0000-0000-0029-000000000003', 't29-a', 'admin', 'human', '2026-01-10 11:00:30+07'),
  ('00000000-0000-0000-0029-000000000004', 't29-a', 'closed', 'closed', '2026-01-10 12:00+07'),
  ('00000000-0000-0000-0029-000000000005', 't29-a', 'yesterday', 'bot', '2026-01-09 12:00:05+07'),
  ('00000000-0000-0000-0029-000000000006', 't29-b', 'other page', 'bot', '2026-01-10 09:00:10+07'),
  ('00000000-0000-0000-0029-000000000007', 't29-a', 'today', 'bot', now());
insert into public.messages (conversation_id, sender_kind, delivery_status, event, created_at) values
  ('00000000-0000-0000-0029-000000000001', 'user', 'sent', null, '2026-01-10 09:00+07'),
  ('00000000-0000-0000-0029-000000000001', 'bot', 'sent', null, '2026-01-10 09:00:02+07'),
  ('00000000-0000-0000-0029-000000000002', 'user', 'sent', null, '2026-01-10 10:00+07'),
  ('00000000-0000-0000-0029-000000000002', 'bot', 'sent', null, '2026-01-10 10:00:04+07'),
  ('00000000-0000-0000-0029-000000000002', 'system', 'sent', '{"code": "handoff", "reason": "keyword"}', '2026-01-10 10:01+07'),
  ('00000000-0000-0000-0029-000000000003', 'user', 'sent', null, '2026-01-10 11:00+07'),
  ('00000000-0000-0000-0029-000000000003', 'bot', 'failed', null, '2026-01-10 11:00:01+07'),
  ('00000000-0000-0000-0029-000000000003', 'admin', 'sent', null, '2026-01-10 11:00:30+07'),
  ('00000000-0000-0000-0029-000000000004', 'user', 'sent', null, '2026-01-10 12:00+07'),
  ('00000000-0000-0000-0029-000000000005', 'user', 'sent', null, '2026-01-09 12:00+07'),
  ('00000000-0000-0000-0029-000000000005', 'bot', 'sent', null, '2026-01-09 12:00:05+07'),
  ('00000000-0000-0000-0029-000000000006', 'user', 'sent', null, '2026-01-10 09:00+07'),
  ('00000000-0000-0000-0029-000000000006', 'bot', 'sent', null, '2026-01-10 09:00:10+07');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000029", "role": "authenticated", "app_metadata": {"role": "admin"}}', true);

do $$
declare
  w_from timestamptz := '2026-01-10 00:00+07';
  w_to timestamptz := '2026-01-11 00:00+07';
  s record;
  e record;
  p text;
begin
  -- Page a by hand: open = bot, handoff, admin; customers = those plus closed; only "bot" is handled by
  -- the bot; replies took 2, 4 and 30 s (the failed bot reply does not count, closed has none).
  select * into s from public.inbox_stats(w_from, w_to, 't29-a');
  assert (s.open_conversations, s.waiting_for_human, s.customer_conversations, s.bot_handled, s.avg_first_response_seconds)
    = (3, 1, 4, 1, 12.0), format('page a: %s', s);

  select * into s from public.inbox_stats(w_from, w_to, 't29-b');
  assert (s.open_conversations, s.waiting_for_human, s.customer_conversations, s.bot_handled, s.avg_first_response_seconds)
    = (1, 0, 1, 1, 10.0), format('page b: %s', s);

  -- Same numbers from plain queries, for each fixture page and for all Pages (hosted rows included).
  foreach p in array array['t29-a', 't29-b', null] loop
    select * into s from public.inbox_stats(w_from, w_to, p);
    with c as (select * from public.conversations where p is null or page_id = p),
    m as (select m.* from public.messages m join c on c.id = m.conversation_id where m.created_at >= w_from and m.created_at < w_to),
    firsts as (select conversation_id, min(created_at) as at from m where sender_kind = 'user' group by conversation_id),
    replies as (
      select f.conversation_id, min(r.created_at) - f.at as took from firsts f
      join public.messages r on r.conversation_id = f.conversation_id and r.created_at > f.at
        and r.sender_kind in ('bot', 'admin') and r.delivery_status <> 'failed'
      group by f.conversation_id, f.at
    )
    select
      (select count(*) from c where status <> 'closed' and last_message_at >= w_from and last_message_at < w_to) as open,
      (select count(*) from c where status = 'needs_human') as waiting,
      (select count(*) from firsts) as customers,
      (select count(*) from firsts f
        where exists (select 1 from m where m.conversation_id = f.conversation_id and sender_kind = 'bot' and delivery_status <> 'failed')
        and not exists (select 1 from m where m.conversation_id = f.conversation_id
          and (sender_kind = 'admin' or event ->> 'code' in ('handoff', 'takeover')))) as by_bot,
      (select round(avg(extract(epoch from took)), 1) from replies) as avg_s
    into e;
    assert (s.open_conversations, s.waiting_for_human, s.customer_conversations, s.bot_handled, s.avg_first_response_seconds)
      is not distinct from (e.open::integer, e.waiting::integer, e.customers::integer, e.by_bot::integer, e.avg_s),
      format('page %s: %s vs %s', coalesce(p, 'all'), s, e);
  end loop;

  -- An empty window has no customers and no response time.
  select * into s from public.inbox_stats('2000-01-01', '2000-01-02', 't29-a');
  assert s.customer_conversations = 0 and s.bot_handled = 0 and s.avg_first_response_seconds is null and s.waiting_for_human = 1, 'empty window';

  -- The default window is today in Asia/Ho_Chi_Minh: today's rows count, the fixture's January ones do not.
  select * into s from public.inbox_stats(p_page_id => 't29-a');
  assert s.open_conversations = 1, format('default window: %s', s);
end $$;

-- A signed-in non-admin is refused.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000002", "role": "authenticated", "app_metadata": {}}', true);
do $$
begin
  perform public.inbox_stats();
  assert false, 'non-admin allowed';
exception when insufficient_privilege then null;
end $$;

-- anon cannot call it at all.
set local role anon;
do $$
begin
  perform public.inbox_stats();
  assert false, 'anon allowed';
exception when insufficient_privilege then null;
end $$;
reset role;
