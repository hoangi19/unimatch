-- Deletes everything stored about one Messenger customer, for data deletion requests (docs/app-review.md).
-- A PSID is page-scoped, so it matches at most one customer per Page; every Page is covered.
-- Conversations cascade to their messages; notes live on the conversation row. Raw webhook events
-- carry the customer as sender, or as recipient on echoes of Page replies.

create or replace function public.delete_customer_data(p_psid text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_messages bigint;
  v_conversations bigint;
  v_events bigint;
begin
  if coalesce(btrim(p_psid), '') = '' then
    raise exception 'psid is required';
  end if;

  select count(*) into v_messages
  from public.messages m join public.conversations c on c.id = m.conversation_id
  where c.psid = p_psid;

  delete from public.conversations where psid = p_psid;
  get diagnostics v_conversations = row_count;

  delete from public.webhook_events
  where payload -> 'sender' ->> 'id' = p_psid or payload -> 'recipient' ->> 'id' = p_psid;
  get diagnostics v_events = row_count;

  return jsonb_build_object('conversations', v_conversations, 'messages', v_messages, 'webhook_events', v_events);
end;
$$;

-- Owner-only: run from the SQL editor (postgres) or with the service role. No console button.
revoke execute on function public.delete_customer_data(text) from public, anon, authenticated;
grant execute on function public.delete_customer_data(text) to service_role;
