-- Per-Page reply settings. Read by the reply worker and human handoff; edited in the Pages tab.
alter table public.pages
  add column reply_mode text not null default 'always' check (reply_mode in ('always', 'hours')),
  -- {"tz": "Asia/Ho_Chi_Minh", "days": {"mon": [["08:00", "17:30"]], ..., "sun": []}}; used only when reply_mode = 'hours'.
  add column reply_hours jsonb not null default '{}' check (jsonb_typeof(reply_hours) = 'object'),
  add column handoff_keywords text[] not null default '{}',
  add column reply_delay_ms int not null default 0 check (reply_delay_ms between 0 and 10000);

-- Admins may update the reply settings and the bot switch; nothing else on pages.
grant update (reply_mode, reply_hours, handoff_keywords, reply_delay_ms) on public.pages to authenticated;
