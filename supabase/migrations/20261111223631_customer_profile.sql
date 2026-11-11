-- Customer name and picture come from the Graph API, fetched by meta-webhook when a customer writes.
-- (The webhook_inbox_mapping comment saying the Page connect flow fills them is wrong.)
alter table public.conversations add column customer_profile_at timestamptz;

comment on column public.conversations.customer_name is 'Filled by meta-webhook from the Graph API (GET /{psid}?fields=name,profile_pic).';
comment on column public.conversations.customer_profile_at is 'Last Graph profile lookup attempt, successful or not.';

-- Stamps the conversation and returns true when a profile lookup is due: never tried,
-- older than 7 days (Facebook picture links expire), or still unnamed after an hour (a failed try).
-- One conditional update, so concurrent webhook batches fetch at most once.
create function public.claim_customer_profile(p_page_id text, p_psid text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with claimed as (
    update public.conversations
    set customer_profile_at = now()
    where page_id = p_page_id and psid = p_psid
      and (customer_profile_at is null
        or customer_profile_at < now() - interval '7 days'
        or (customer_name is null and customer_profile_at < now() - interval '1 hour'))
    returning 1
  )
  select exists (select 1 from claimed);
$$;

revoke execute on function public.claim_customer_profile(text, text) from public, anon, authenticated;
grant execute on function public.claim_customer_profile(text, text) to service_role;
