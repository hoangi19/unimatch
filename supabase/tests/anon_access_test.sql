-- Checks that only admins read app data. Run with scripts/sql-test.sh (no migration needed); every run is rolled back.
-- Each failed assert raises, which aborts the run.

-- Seeded rows exist, so the zero counts below are not trivially true.
do $$
begin
  assert (select count(*) from public.ai_providers) > 0, 'ai_providers has seed rows';
  assert (select count(*) from public.bot_settings) > 0, 'bot_settings has seed rows';
end $$;

create temp table seen (who text, tbl text, n bigint) on commit drop;
grant insert on seen to anon, authenticated;

-- Counts every public table as the current role; a denied select counts as nothing read.
create function pg_temp.count_tables(who text) returns void language plpgsql as $$
declare
  t record;
  n bigint;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    begin
      execute format('select count(*) from public.%I', t.tablename) into n;
    exception when insufficient_privilege then
      n := 0;
    end;
    insert into seen values (who, t.tablename, n);
  end loop;
end $$;

set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select pg_temp.count_tables('anon');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000002", "role": "authenticated", "app_metadata": {}}', true);
select pg_temp.count_tables('non-admin');

reset role;
do $$
declare
  leaked text;
begin
  assert (select count(distinct tbl) from seen) >= 6, 'all app tables were checked';
  select string_agg(who || ':' || tbl || '=' || n, ', ') into leaked from seen where n > 0;
  assert leaked is null, 'rows visible without admin: ' || leaked;
end $$;
