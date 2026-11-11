-- Checks for the clear_page_token migration. Run with scripts/sql-test.sh; every run is rolled back.

-- Service role: connect a test Page, then clear its token. The row stays, the secret goes.
set local role service_role;

do $$
declare
  v_secret uuid;
  r record;
begin
  insert into public.pages (id, name) values ('test-clear-page', 'Clear token test');
  perform public.set_page_token('test-clear-page', 'placeholder-page-token', null);
  select access_token_secret_id into v_secret from public.pages where id = 'test-clear-page';
  assert v_secret is not null, 'secret stored';

  perform public.clear_page_token('test-clear-page');
  select * into r from public.pages where id = 'test-clear-page';
  assert found, 'row kept';
  assert r.access_token_secret_id is null and r.token_expires_at is null, 'token columns cleared';
  assert public.get_page_token('test-clear-page') is null, 'no token readable';
  assert not exists (select 1 from vault.secrets where id = v_secret), 'vault secret deleted';

  -- Clearing again, or an unknown Page, is a no-op.
  perform public.clear_page_token('test-clear-page');
  perform public.clear_page_token('test-unknown-page');
end $$;

-- Admin: cannot call it.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated", "app_metadata": {"role": "admin"}}', true);

do $$
begin
  perform public.clear_page_token('test-clear-page');
  assert false, 'authenticated must not execute clear_page_token';
exception when insufficient_privilege then null;
end $$;
