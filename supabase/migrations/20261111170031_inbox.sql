-- Inbox schema: connected Pages, Messenger conversations and their messages. Admin-only via RLS.
-- Edge Functions use the service role and bypass RLS.

-- Shared admin check (same body in the bot settings migration, so either can apply first).
create or replace function public.is_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role' = 'admin', false)
$$;

-- The Page access token lives in Vault; only its secret id is stored here.
create table public.pages (
  id text primary key,
  name text not null,
  picture_url text,
  bot_enabled boolean not null default true,
  access_token_secret_id uuid,
  token_expires_at timestamptz,
  connected_at timestamptz not null default now()
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  page_id text not null references public.pages (id) on delete cascade,
  psid text not null,
  customer_name text,
  customer_picture_url text,
  language text,
  status text not null default 'bot' check (status in ('bot', 'needs_human', 'human', 'closed')),
  handoff_reason text,
  handoff_at timestamptz,
  unread_count integer not null default 0 check (unread_count >= 0),
  last_message_at timestamptz,
  last_message_preview text,
  -- Messenger's 24h reply window is measured from this.
  last_customer_message_at timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now(),
  unique (page_id, psid)
);

create index conversations_last_message_idx on public.conversations (last_message_at desc nulls last);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_kind text not null check (sender_kind in ('user', 'bot', 'admin', 'system')),
  text text,
  attachments jsonb,
  -- Meta message id (mid); dedupes webhook retries.
  external_id text unique,
  delivery_status text not null default 'sent' check (delivery_status in ('pending', 'sent', 'delivered', 'read', 'failed')),
  delivery_error text,
  trace jsonb,
  admin_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index messages_conversation_created_idx on public.messages (conversation_id, created_at);

alter table public.pages enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

create policy pages_admin_select on public.pages for select to authenticated using (public.is_admin());
create policy pages_admin_update on public.pages for update to authenticated using (public.is_admin()) with check (public.is_admin());
-- Admins may only toggle the bot; connecting a Page and its token go through Edge Functions.
revoke insert, update, delete, truncate on public.pages from anon, authenticated;
grant update (bot_enabled) on public.pages to authenticated;

create policy conversations_admin_select on public.conversations for select to authenticated using (public.is_admin());
create policy conversations_admin_update on public.conversations for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy messages_admin_select on public.messages for select to authenticated using (public.is_admin());
create policy messages_admin_insert on public.messages for insert to authenticated
  with check (public.is_admin() and sender_kind = 'admin' and admin_id = auth.uid());

create policy webhook_events_admin_select on public.webhook_events for select to authenticated using (public.is_admin());

-- Token RPCs: service role only. Never put the token in an error message.
create or replace function public.set_page_token(p_page_id text, p_token text, p_expires_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
begin
  select access_token_secret_id into v_secret_id from public.pages where id = p_page_id for update;
  if not found then
    raise exception 'page % not found', p_page_id;
  end if;
  if v_secret_id is null then
    v_secret_id := vault.create_secret(p_token, 'page_token:' || p_page_id, 'Messenger Page access token');
  else
    perform vault.update_secret(v_secret_id, p_token);
  end if;
  update public.pages set access_token_secret_id = v_secret_id, token_expires_at = p_expires_at where id = p_page_id;
end;
$$;

create or replace function public.get_page_token(p_page_id text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret
  from public.pages p
  join vault.decrypted_secrets s on s.id = p.access_token_secret_id
  where p.id = p_page_id
$$;

revoke execute on function public.set_page_token(text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.get_page_token(text) from public, anon, authenticated;
grant execute on function public.set_page_token(text, text, timestamptz) to service_role;
grant execute on function public.get_page_token(text) to service_role;

-- Deleting a Page also removes its Vault secret.
create or replace function public.delete_page_token()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets where id = old.access_token_secret_id;
  return old;
end;
$$;

revoke execute on function public.delete_page_token() from public, anon, authenticated;

create trigger pages_delete_token after delete on public.pages
  for each row when (old.access_token_secret_id is not null) execute function public.delete_page_token();

alter publication supabase_realtime add table public.conversations, public.messages;
