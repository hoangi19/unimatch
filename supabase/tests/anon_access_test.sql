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

-- Grants, not just RLS: TRUNCATE ignores RLS, and a DEFINER function runs with its owner's rights.
do $$
declare
  bad text;
begin
  select string_agg(r.rol || ':' || c.relname || ':' || p.priv, ', ') into bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('anon'), ('authenticated')) r(rol)
  cross join (values ('insert'), ('delete'), ('truncate'), ('references'), ('trigger')) p(priv)
  where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p') and has_table_privilege(r.rol, c.oid, p.priv);
  assert bad is null, 'write grants on public tables: ' || bad;

  select string_agg(c.relname, ', ') into bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p') and has_table_privilege('anon', c.oid, 'select');
  assert bad is null, 'anon can select: ' || bad;

  select string_agg(c.relname, ', ') into bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  assert bad is null, 'RLS off: ' || bad;

  -- Event-trigger functions (the platform's rls_auto_enable) cannot be called over RPC.
  select string_agg(p.proname, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
    and p.prorettype <> 'event_trigger'::regtype;
  assert bad is null, 'anon can run DEFINER functions: ' || bad;

  -- Every DEFINER function a signed-in user may call must check is_admin() itself.
  select string_agg(p.proname, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and has_function_privilege('authenticated', p.oid, 'execute')
    and p.prorettype <> 'event_trigger'::regtype and p.prosrc not like '%public.is_admin()%';
  assert bad is null, 'authenticated DEFINER functions without an admin check: ' || bad;
end $$;

-- A signed-in non-admin is refused by each admin RPC.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000002", "role": "authenticated", "app_metadata": {}}', true);
do $$
declare
  call text;
begin
  foreach call in array array[
    $q$select public.set_provider_key('custom', 'abcdefgh12345678')$q$,
    $q$select public.remove_provider_key('custom')$q$,
    $q$select public.set_conversation_mode(gen_random_uuid(), 'human')$q$
  ] loop
    begin
      execute call;
      assert false, 'non-admin ran: ' || call;
    exception when insufficient_privilege then
      null;
    end;
  end loop;
end $$;

-- An admin reads the app tables and may only write the Inbox's two columns directly.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated", "app_metadata": {"role": "admin"}}', true);
do $$
begin
  assert (select count(*) from public.ai_providers) > 0, 'admin reads ai_providers';
  assert (select count(*) from public.bot_settings) > 0, 'admin reads bot_settings';
  begin
    update public.conversations set status = 'closed' where false;
    assert false, 'admin updated conversations.status directly';
  exception when insufficient_privilege then
    null;
  end;
  begin
    insert into public.messages (conversation_id, sender_kind, text) values (gen_random_uuid(), 'admin', 'x');
    assert false, 'admin inserted a message directly';
  exception when insufficient_privilege then
    null;
  end;
  update public.conversations set notes = notes, unread_count = unread_count where false;
end $$;
reset role;

-- Provider URLs must be https.
do $$
begin
  begin
    update public.ai_providers set base_url = 'http://localhost:8080/v1' where kind = 'custom';
    assert false, 'http base_url accepted';
  exception when check_violation then
    null;
  end;
end $$;
