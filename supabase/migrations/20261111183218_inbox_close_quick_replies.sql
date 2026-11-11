-- Inbox close / reopen and quick replies.

-- Admin side: 'human' pauses the bot, 'bot' resumes it (or reopens a closed thread, as a new customer
-- message does in the webhook) and clears the handoff, 'closed' archives it. Setting the current mode
-- again adds no event. Event code: close | takeover | reopen (closed -> bot) | return_to_bot.
-- Returns true when the status changed. Service role only; admins call set_conversation_mode.
create or replace function public.set_conversation_mode_as(p_conversation_id uuid, p_mode text, p_admin_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
begin
  if p_mode is null or p_mode not in ('human', 'bot', 'closed') then
    raise exception 'mode must be human, bot or closed';
  end if;
  select status into v_old from public.conversations where id = p_conversation_id for update;
  if v_old is null or v_old = p_mode then
    return false;
  end if;
  update public.conversations set
    status = p_mode,
    handoff_reason = case when p_mode = 'bot' then null else handoff_reason end,
    handoff_at = case when p_mode = 'bot' then null else handoff_at end
  where id = p_conversation_id;
  insert into public.messages (conversation_id, sender_kind, admin_id, event)
  values (p_conversation_id, 'system', p_admin_id, jsonb_build_object('code', case
    when p_mode = 'closed' then 'close'
    when p_mode = 'human' then 'takeover'
    when v_old = 'closed' then 'reopen'
    else 'return_to_bot' end));
  return true;
end;
$$;

-- Canned admin replies offered in the Inbox composer. Admin content, so in Vietnamese by default.
alter table public.bot_settings add column quick_replies text[] not null default array[
  'Chào bạn, mình là chuyên viên tuyển dụng UniMatch. Mình có thể giúp gì thêm cho bạn?',
  'Bạn gửi CV giúp mình nhé, mình sẽ tìm việc phù hợp cho bạn.',
  'Mình đã chuyển hồ sơ của bạn cho nhà tuyển dụng, bạn chờ phản hồi trong 2–3 ngày làm việc nhé.',
  'Cảm ơn bạn! Cần thêm thông tin gì cứ nhắn cho mình nhé.'
] check (cardinality(quick_replies) <= 20);
