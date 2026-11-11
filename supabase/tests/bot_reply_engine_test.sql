-- Checks for claim_bot_turn and finish_bot_turn. Run with scripts/sql-test.sh; every run is rolled back.

insert into public.pages (id, name) values ('t22-page', 't22 page');
insert into public.conversations (page_id, psid) values ('t22-page', 'u1');
insert into public.messages (conversation_id, sender_kind, text, external_id, created_at)
select id, 'user', 'hi', 't22:m1', to_timestamp(1767225600123 / 1000.0) from public.conversations where page_id = 't22-page';

do $$
declare
  v_conv uuid := (select id from public.conversations where page_id = 't22-page');
  r record;
begin
  -- An older trigger timestamp loses to the newer message's own invocation.
  assert not exists (select 1 from public.claim_bot_turn('t22-page', 'u1', 1767225600000)), 'debounced';

  select * into r from public.claim_bot_turn('t22-page', 'u1', 1767225600123);
  assert r.conversation_id = v_conv and r.reply_up_to = to_timestamp(1767225600123 / 1000.0), 'claimed at exact ms';
  assert not exists (select 1 from public.claim_bot_turn('t22-page', 'u1', null)), 'lease held';

  -- A message during the turn: finish reports more, the re-run claims it.
  insert into public.messages (conversation_id, sender_kind, text, external_id, created_at)
  values (v_conv, 'user', 'and also', 't22:m2', to_timestamp(1767225601000 / 1000.0));
  assert public.finish_bot_turn(v_conv, r.reply_up_to), 'more';
  assert (select bot_lock_until from public.conversations where id = v_conv) is null, 'released';

  select * into r from public.claim_bot_turn('t22-page', 'u1', null);
  assert r.reply_up_to = to_timestamp(1767225601000 / 1000.0), 're-run sees the newest';
  assert not public.finish_bot_turn(v_conv, r.reply_up_to), 'nothing more';

  -- Everything answered: retries and bot messages claim nothing.
  insert into public.messages (conversation_id, sender_kind, text, created_at) values (v_conv, 'bot', 'reply', now());
  assert not exists (select 1 from public.claim_bot_turn('t22-page', 'u1', 1767225601000)), 'already answered';
  assert not exists (select 1 from public.claim_bot_turn('t22-page', 'nobody', null)), 'unknown conversation';

  -- An expired lease from a crashed turn is taken over.
  insert into public.messages (conversation_id, sender_kind, text, external_id, created_at)
  values (v_conv, 'user', 'hello?', 't22:m3', to_timestamp(1767225700000 / 1000.0));
  update public.conversations set bot_lock_until = now() - interval '1 second' where id = v_conv;
  assert exists (select 1 from public.claim_bot_turn('t22-page', 'u1', 1767225700000)), 'expired lease';

  -- finish never moves the watermark back.
  perform public.finish_bot_turn(v_conv, '2000-01-01');
  assert (select bot_replied_up_to from public.conversations where id = v_conv) = to_timestamp(1767225601000 / 1000.0), 'no regress';
end $$;

-- Service role only.
do $$
begin
  assert not has_function_privilege('authenticated', 'public.claim_bot_turn(text, text, bigint)', 'execute'), 'claim private';
  assert not has_function_privilege('anon', 'public.finish_bot_turn(uuid, timestamptz)', 'execute'), 'finish private';
  assert has_function_privilege('service_role', 'public.claim_bot_turn(text, text, bigint)', 'execute'), 'claim service';
end $$;

-- The seeded prompt is replaced when unedited, and keeps the page name placeholder.
do $$
begin
  assert (select system_prompt not like '%search_jobs%' and system_prompt like '%{{page_name}}%' from public.bot_settings), 'prompt';
end $$;
