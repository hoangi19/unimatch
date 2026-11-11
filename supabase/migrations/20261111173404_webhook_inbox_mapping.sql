-- Maps raw Messenger webhook events into the inbox tables (pages, conversations, messages).
-- An AFTER INSERT trigger on webhook_events runs the mapping in the same transaction as the raw insert,
-- so the meta-webhook Edge Function stays a single upsert. AFTER (not BEFORE) because BEFORE triggers
-- also fire for rows that ON CONFLICT DO NOTHING later drops, which would double-count Meta's retries.
-- webhook_events.status: received -> processed | ignored | no_page | failed. no_page and failed rows are
-- replayed with replay_webhook_events() once the cause is fixed (for example after the Page is connected).

alter table public.webhook_events add column error text;

-- Returns the new status. Raises on malformed payloads; apply_webhook_event turns that into 'failed'.
create or replace function public.process_webhook_event(e public.webhook_events)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  p jsonb := e.payload;
  m jsonb := coalesce(p -> 'message', p -> 'postback');
  v_echo boolean := coalesce((p -> 'message' ->> 'is_echo')::boolean, false);
  v_at timestamptz := to_timestamp((p ->> 'timestamp')::bigint / 1000.0);
  v_psid text;
  v_text text;
  v_conv uuid;
  v_watermark timestamptz;
begin
  if not exists (select 1 from public.pages where id = e.page_id) then
    return 'no_page';
  end if;

  if m is not null then
    if m ->> 'mid' is null then
      raise exception 'message without mid';
    end if;
    -- A known mid is a retry or the echo of a message our app already stored.
    if exists (select 1 from public.messages where external_id = m ->> 'mid') then
      return 'ignored';
    end if;

    -- Echoes are sent by the Page, so the customer is the recipient.
    v_psid := case when v_echo then p -> 'recipient' ->> 'id' else p -> 'sender' ->> 'id' end;
    v_text := coalesce(m ->> 'text', m ->> 'title');

    -- customer_name stays null here; the Page connect flow fills it from the Graph API.
    insert into public.conversations as c
      (page_id, psid, unread_count, last_message_at, last_message_preview, last_customer_message_at)
    values
      (e.page_id, v_psid, case when v_echo then 0 else 1 end, v_at,
       coalesce(left(v_text, 200), '[attachment]'), case when not v_echo then v_at end)
    on conflict (page_id, psid) do update set
      unread_count = c.unread_count + excluded.unread_count,
      last_message_preview = case
        when c.last_message_at is null or excluded.last_message_at >= c.last_message_at
        then excluded.last_message_preview else c.last_message_preview end,
      last_message_at = greatest(c.last_message_at, excluded.last_message_at),
      last_customer_message_at = greatest(c.last_customer_message_at, excluded.last_customer_message_at),
      -- A new customer message reopens a closed thread; needs_human and human are never reset.
      status = case when not v_echo and c.status = 'closed' then 'bot' else c.status end
    returning id into v_conv;

    -- Plain insert: a concurrent duplicate raises unique_violation and rolls back the counter bump too.
    -- An echo with an unknown mid is a human reply from Meta Business Suite.
    insert into public.messages (conversation_id, sender_kind, text, attachments, external_id, created_at)
    values (
      v_conv,
      case when v_echo then 'admin' else 'user' end,
      v_text,
      case when p ? 'postback'
        then jsonb_build_array(jsonb_build_object('type', 'postback', 'payload', m -> 'payload'))
        else m -> 'attachments' end,
      m ->> 'mid',
      v_at
    );
    return 'processed';
  end if;

  if p ? 'delivery' or p ? 'read' then
    v_watermark := to_timestamp((coalesce(p -> 'delivery', p -> 'read') ->> 'watermark')::bigint / 1000.0);
    -- Statuses only move forward: delivery never downgrades read.
    update public.messages msg
    set delivery_status = case when p ? 'read' then 'read' else 'delivered' end
    from public.conversations c
    where c.id = msg.conversation_id
      and c.page_id = e.page_id
      and c.psid = p -> 'sender' ->> 'id'
      and msg.sender_kind in ('bot', 'admin')
      and msg.delivery_status = any (case when p ? 'read'
        then array['pending', 'sent', 'delivered'] else array['pending', 'sent'] end)
      and (msg.created_at <= v_watermark
        or msg.external_id in (select jsonb_array_elements_text(coalesce(p -> 'delivery' -> 'mids', '[]'))));
    return 'processed';
  end if;

  return 'ignored';
end;
$$;

-- Runs the mapping and records its outcome. A mapping error never loses the raw event.
create or replace function public.apply_webhook_event(e public.webhook_events)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_error text;
begin
  begin
    v_status := public.process_webhook_event(e);
  exception when others then
    v_status := 'failed';
    v_error := sqlstate || ': ' || sqlerrm;
  end;
  update public.webhook_events set status = v_status, error = v_error where id = e.id;
  return v_status;
end;
$$;

create or replace function public.webhook_events_apply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.apply_webhook_event(new);
  return null;
end;
$$;

create trigger webhook_events_apply after insert on public.webhook_events
  for each row execute function public.webhook_events_apply();

-- Re-runs a Page's unmapped events oldest first. Returns how many are now processed.
create or replace function public.replay_webhook_events(p_page_id text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.webhook_events;
  n integer := 0;
begin
  for r in
    select * from public.webhook_events
    where page_id = p_page_id and status in ('received', 'no_page', 'failed')
    order by received_at, id
    for update
  loop
    if public.apply_webhook_event(r) = 'processed' then
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

revoke execute on function public.process_webhook_event(public.webhook_events) from public, anon, authenticated;
revoke execute on function public.apply_webhook_event(public.webhook_events) from public, anon, authenticated;
revoke execute on function public.webhook_events_apply() from public, anon, authenticated;
revoke execute on function public.replay_webhook_events(text) from public, anon, authenticated;
grant execute on function public.replay_webhook_events(text) to service_role;
