-- Raw Messenger webhook deliveries. Written only by the meta-webhook Edge Function (service role).
create table public.webhook_events (
  id bigint generated always as identity primary key,
  page_id text not null,
  field text not null,
  external_id text unique,
  payload jsonb not null,
  status text not null default 'received',
  received_at timestamptz not null default now()
);

create index webhook_events_page_received_idx on public.webhook_events (page_id, received_at desc);

-- No policies: anon/authenticated get nothing until the admin read policy lands with auth.
alter table public.webhook_events enable row level security;
