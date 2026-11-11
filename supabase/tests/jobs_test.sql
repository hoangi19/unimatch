-- Checks for the jobs migration. Run with scripts/sql-test.sh; every run is rolled back.

set local role service_role;
insert into public.jobs (source, external_id, title, benefits, raw)
values ('test_source', 'test-job-1', 'Test job', array['a', 'b'], '{"id": "test-job-1"}');

-- Admin: reads the row.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated", "app_metadata": {"role": "admin"}}', true);

do $$
begin
  assert (select count(*) from public.jobs where external_id = 'test-job-1') = 1, 'admin reads jobs';
  begin
    insert into public.jobs (source, external_id, title, raw) values ('test_source', 'test-job-2', 'x', '{}');
    assert false, 'authenticated must not insert jobs';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.jobs set title = 'x' where external_id = 'test-job-1';
    assert false, 'authenticated must not update jobs';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Non-admin authenticated: sees no rows.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000002", "role": "authenticated"}', true);

do $$
begin
  assert (select count(*) from public.jobs) = 0, 'non-admin sees no jobs';
end $$;

-- Anon: no table access at all.
set local role anon;

do $$
begin
  perform 1 from public.jobs;
  assert false, 'anon must not read jobs';
exception when insufficient_privilege then null;
end $$;

-- Source check rejects values that are not lowercase slugs.
reset role;

do $$
begin
  insert into public.jobs (source, external_id, title, raw) values ('Bad Source', 'x', 'x', '{}');
  assert false, 'source check must reject Bad Source';
exception when check_violation then null;
end $$;
