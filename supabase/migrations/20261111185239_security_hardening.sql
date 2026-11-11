-- Security pass: drop the default table grants RLS was the only guard behind, and require https provider URLs.
-- See docs/security.md for the checks behind each statement.

-- Supabase grants every new public table to anon and authenticated. RLS hides the rows, but TRUNCATE
-- ignores RLS, so keep only what the console uses: admins read all three, and write two Inbox columns.
revoke all on public.pages, public.conversations, public.messages, public.webhook_events from anon;
revoke references, trigger on public.pages from authenticated;
revoke all on public.conversations, public.messages, public.webhook_events from authenticated;
grant select on public.conversations, public.messages, public.webhook_events to authenticated;
-- Mode changes go through set_conversation_mode; admin replies go through the send-message function.
grant update (unread_count, notes) on public.conversations to authenticated;
drop policy messages_admin_insert on public.messages;

-- The AI adapter blocks private hosts at call time; the table now refuses plain http too.
alter table public.ai_providers drop constraint ai_providers_base_url_check;
alter table public.ai_providers add constraint ai_providers_base_url_check check (base_url ~ '^https://[^/?#@\s]+');
