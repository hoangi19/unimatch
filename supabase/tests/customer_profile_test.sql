-- Checks for the customer_profile migration. Run with scripts/sql-test.sh; every run is rolled back.

set local role service_role;

do $$
begin
  insert into public.pages (id, name) values ('test-profile-page', 'Profile test');
  insert into public.conversations (page_id, psid, customer_name, customer_profile_at) values
    ('test-profile-page', 'new', null, null),
    ('test-profile-page', 'fresh', 'An', now() - interval '1 day'),
    ('test-profile-page', 'stale', 'Binh', now() - interval '8 days'),
    ('test-profile-page', 'failed-recent', null, now() - interval '10 minutes'),
    ('test-profile-page', 'failed-old', null, now() - interval '2 hours');

  assert public.claim_customer_profile('test-profile-page', 'new'), 'never tried: due';
  assert not public.claim_customer_profile('test-profile-page', 'new'), 'claimed once: not due again';
  assert not public.claim_customer_profile('test-profile-page', 'fresh'), 'fresh name: not due';
  assert public.claim_customer_profile('test-profile-page', 'stale'), 'older than 7 days: due';
  assert not public.claim_customer_profile('test-profile-page', 'failed-recent'), 'failed under an hour ago: not due';
  assert public.claim_customer_profile('test-profile-page', 'failed-old'), 'failed over an hour ago: due';
  assert not public.claim_customer_profile('test-profile-page', 'unknown'), 'no conversation: not due';
  assert (select customer_profile_at > now() - interval '1 minute' from public.conversations
          where page_id = 'test-profile-page' and psid = 'stale'), 'claim stamps the row';
end $$;

-- Admin: reads the column, cannot claim.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated", "app_metadata": {"role": "admin"}}', true);

do $$
begin
  perform customer_profile_at from public.conversations limit 1;
  begin
    perform public.claim_customer_profile('test-profile-page', 'new');
    assert false, 'authenticated must not claim';
  exception when insufficient_privilege then null;
  end;
end $$;
