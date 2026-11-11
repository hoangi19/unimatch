-- Numbers for the stats strip at the top of the Inbox. One row for the window [p_from, p_to), by default
-- today in Asia/Ho_Chi_Minh, optionally for one Page.
--
--   open_conversations       not closed now, with a message in the window.
--   waiting_for_human        status needs_human now, whatever the window: a customer who started waiting
--                            yesterday is still waiting.
--   customer_conversations   conversations with at least one customer (user) message in the window.
--   bot_handled              of those, the ones with a non-failed bot reply in the window and, in the window,
--                            no handoff or takeover event and no admin message. The UI shows
--                            bot_handled / customer_conversations as "% handled by bot".
--   avg_first_response_seconds
--                            per conversation in customer_conversations: from its first customer message in
--                            the window to the first non-failed bot or admin reply after it. Conversations
--                            without a reply yet are left out; null when there are none.
--
-- Security definer so it does not depend on the column grants of the tables it reads; the admin check
-- below is the guard.
create or replace function public.inbox_stats(p_from timestamptz default null, p_to timestamptz default null, p_page_id text default null)
returns table (
  open_conversations integer,
  waiting_for_human integer,
  customer_conversations integer,
  bot_handled integer,
  avg_first_response_seconds numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from timestamptz := coalesce(p_from, date_trunc('day', now() at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh');
  v_to timestamptz := coalesce(p_to, v_from + interval '1 day');
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return query
  with convs as (
    select c.id, c.status, c.last_message_at from public.conversations c
    where p_page_id is null or c.page_id = p_page_id
  ),
  customer as (
    select m.conversation_id as id, min(m.created_at) as first_at
    from public.messages m join convs c on c.id = m.conversation_id
    where m.sender_kind = 'user' and m.created_at >= v_from and m.created_at < v_to
    group by m.conversation_id
  ),
  per_conv as (
    select
      cu.id,
      exists (
        select 1 from public.messages m where m.conversation_id = cu.id and m.created_at >= v_from and m.created_at < v_to
          and m.sender_kind = 'bot' and m.delivery_status <> 'failed'
      ) and not exists (
        select 1 from public.messages m where m.conversation_id = cu.id and m.created_at >= v_from and m.created_at < v_to
          and (m.sender_kind = 'admin' or (m.sender_kind = 'system' and m.event ->> 'code' in ('handoff', 'takeover')))
      ) as by_bot,
      (
        select min(m.created_at) from public.messages m where m.conversation_id = cu.id and m.created_at > cu.first_at
          and m.sender_kind in ('bot', 'admin') and m.delivery_status <> 'failed'
      ) - cu.first_at as first_response
    from customer cu
  )
  select
    (select count(*)::integer from convs where status <> 'closed' and last_message_at >= v_from and last_message_at < v_to),
    (select count(*)::integer from convs where status = 'needs_human'),
    (select count(*)::integer from per_conv),
    (select count(*)::integer from per_conv where by_bot),
    (select round(avg(extract(epoch from first_response)), 1) from per_conv);
end;
$$;

revoke execute on function public.inbox_stats(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.inbox_stats(timestamptz, timestamptz, text) to authenticated, service_role;
