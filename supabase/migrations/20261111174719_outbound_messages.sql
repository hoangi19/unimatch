-- Stores messages the Page sends through the Send API (bot replies and admin sends). Service role only.
-- The page echo of our own send can reach meta-webhook before the Send API response is stored; the mapping
-- trigger then has already saved it as an 'admin' message with no admin_id. So the row is upserted on
-- external_id: our call sets who sent it and keeps the echo's Meta timestamp and any delivery status already
-- recorded. In the other order the echo's mid is known and the trigger ignores it.

create or replace function public.record_outbound_message(
  p_conversation_id uuid,
  p_sender_kind text,
  p_admin_id uuid,
  p_text text,
  p_external_id text,
  p_delivery_error text,
  p_trace jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_at timestamptz;
begin
  if p_sender_kind not in ('bot', 'admin') then
    raise exception 'outbound sender_kind must be bot or admin';
  end if;
  if (p_external_id is null) = (p_delivery_error is null) then
    raise exception 'pass either external_id (sent) or delivery_error (failed)';
  end if;

  insert into public.messages as m
    (conversation_id, sender_kind, admin_id, text, external_id, delivery_status, delivery_error, trace)
  values (
    p_conversation_id, p_sender_kind, p_admin_id, p_text, p_external_id,
    case when p_external_id is null then 'failed' else 'sent' end, p_delivery_error, p_trace
  )
  on conflict (external_id) do update set
    sender_kind = excluded.sender_kind,
    admin_id = excluded.admin_id,
    trace = excluded.trace
  returning id, created_at into v_id, v_at;

  -- A failed send never reached the customer, so the thread preview stays as it was.
  if p_external_id is not null then
    update public.conversations c set
      last_message_preview = case
        when c.last_message_at is null or v_at >= c.last_message_at
        then coalesce(left(p_text, 200), '[attachment]') else c.last_message_preview end,
      last_message_at = greatest(c.last_message_at, v_at)
    where c.id = p_conversation_id;
  end if;
  return v_id;
end;
$$;

revoke execute on function public.record_outbound_message(uuid, text, uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_outbound_message(uuid, text, uuid, text, text, text, jsonb) to service_role;
