-- Human handoff: the bot hands a conversation to a person (keyword, failure, later classifiers), an admin
-- takes it over (explicitly or by sending a message) and only an explicit "return to bot" resumes the bot.
-- Each change adds a system message whose `event` the Inbox translates; system messages have no text.

-- System event payload: {code: handoff | takeover | return_to_bot, reason?, keyword?, detail?}.
-- admin_id says which admin acted.
alter table public.messages add column event jsonb;

-- Sort key for "needs help on top": order=needs_help.desc,last_message_at.desc.
alter table public.conversations add column needs_help boolean generated always as (status = 'needs_human') stored;
create index conversations_needs_help_idx on public.conversations (needs_help desc, last_message_at desc nulls last);

-- Bot side: only a conversation the bot still owns is handed off, so repeats are no-ops.
-- p_reason is a code the UI translates: keyword | send_failed | bot_error | low_confidence | complaint.
-- Returns true when the status changed. Service role only.
create or replace function public.hand_off_conversation(p_conversation_id uuid, p_reason text, p_detail jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations set status = 'needs_human', handoff_reason = p_reason, handoff_at = now()
  where id = p_conversation_id and status = 'bot';
  if not found then
    return false;
  end if;
  insert into public.messages (conversation_id, sender_kind, event)
  values (p_conversation_id, 'system', jsonb_build_object('code', 'handoff', 'reason', p_reason) || coalesce(p_detail, '{}'));
  return true;
end;
$$;

-- Admin side: 'human' pauses the bot, 'bot' resumes it and clears the handoff. Setting the current mode
-- again adds no event. Returns true when the status changed. Service role only; admins call
-- set_conversation_mode below.
create or replace function public.set_conversation_mode_as(p_conversation_id uuid, p_mode text, p_admin_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_mode not in ('human', 'bot') then
    raise exception 'mode must be human or bot';
  end if;
  update public.conversations set
    status = p_mode,
    handoff_reason = case when p_mode = 'bot' then null else handoff_reason end,
    handoff_at = case when p_mode = 'bot' then null else handoff_at end
  where id = p_conversation_id and status <> p_mode;
  if not found then
    return false;
  end if;
  insert into public.messages (conversation_id, sender_kind, admin_id, event)
  values (p_conversation_id, 'system', p_admin_id,
    jsonb_build_object('code', case when p_mode = 'human' then 'takeover' else 'return_to_bot' end));
  return true;
end;
$$;

-- The Inbox's takeover / return-to-bot action, acting as the signed-in admin.
create or replace function public.set_conversation_mode(p_conversation_id uuid, p_mode text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return public.set_conversation_mode_as(p_conversation_id, p_mode, auth.uid());
end;
$$;

revoke execute on function public.hand_off_conversation(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.set_conversation_mode_as(uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.set_conversation_mode(uuid, text) from public, anon;
grant execute on function public.hand_off_conversation(uuid, text, jsonb) to service_role;
grant execute on function public.set_conversation_mode_as(uuid, text, uuid) to service_role;
grant execute on function public.set_conversation_mode(uuid, text) to authenticated, service_role;
