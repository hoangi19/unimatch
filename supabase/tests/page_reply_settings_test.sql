-- Checks for the page_reply_settings migration. Run with scripts/sql-test.sh; every run is rolled back.

set local role service_role;
insert into public.pages (id, name) values ('test-reply-page', 'Reply settings test');

do $$
declare r record;
begin
  select * into r from public.pages where id = 'test-reply-page';
  assert r.reply_mode = 'always' and r.reply_hours = '{}'::jsonb and r.handoff_keywords = '{}' and r.reply_delay_ms = 0, 'defaults';
end $$;

-- Admin: may update the reply settings and bot_enabled.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated", "app_metadata": {"role": "admin"}}', true);

do $$
declare n int;
begin
  update public.pages
    set reply_mode = 'hours',
        reply_hours = '{"tz": "Asia/Ho_Chi_Minh", "days": {"mon": [["08:00", "17:30"]], "sun": []}}',
        handoff_keywords = '{"nhân viên","human"}',
        reply_delay_ms = 3000,
        bot_enabled = false
    where id = 'test-reply-page';
  get diagnostics n = row_count;
  assert n = 1, 'admin updates reply settings';
end $$;

do $$
begin
  update public.pages set name = 'renamed' where id = 'test-reply-page';
  assert false, 'admin must not update name';
exception when insufficient_privilege then null;
end $$;

do $$
begin
  update public.pages set token_expires_at = now() where id = 'test-reply-page';
  assert false, 'admin must not update token_expires_at';
exception when insufficient_privilege then null;
end $$;

do $$
begin
  update public.pages set reply_mode = 'never' where id = 'test-reply-page';
  assert false, 'reply_mode is checked';
exception when check_violation then null;
end $$;

do $$
begin
  update public.pages set reply_delay_ms = 10001 where id = 'test-reply-page';
  assert false, 'reply_delay_ms is checked';
exception when check_violation then null;
end $$;

do $$
begin
  update public.pages set reply_hours = '[]' where id = 'test-reply-page';
  assert false, 'reply_hours must be an object';
exception when check_violation then null;
end $$;

-- Non-admin signed-in user: sees and updates nothing.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000002", "role": "authenticated"}', true);

do $$
declare n int;
begin
  update public.pages set reply_delay_ms = 1000 where id = 'test-reply-page';
  get diagnostics n = row_count;
  assert n = 0, 'non-admin updates no rows';
  assert not exists (select 1 from public.pages where id = 'test-reply-page'), 'non-admin sees no rows';
end $$;
