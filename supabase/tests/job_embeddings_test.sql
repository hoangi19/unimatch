-- Checks for the job_embeddings migration. Run with scripts/sql-test.sh; every run is rolled back.

-- A 1024-dim vector pointing mostly along axis i, tilted toward axis j by w.
create function pg_temp.v(i int, j int default 1, w real default 0) returns extensions.vector
language sql immutable as $$
  select array_agg(case when g = i then 1 when g = j then w else 0 end order by g)::real[]::extensions.vector
  from generate_series(1, 1024) g
$$;

set local role service_role;
insert into public.jobs (source, external_id, title, company_name, link, apply_url, raw) values
  ('test_source', 'emb-1', 'Bảo vệ Hà Nội', 'A Co', 'https://example.com/1', 'https://apply.example.com/1', '{"contact": "0900000000"}'),
  ('test_source', 'emb-2', 'Kế toán', 'B Co', null, 'https://apply.example.com/2', '{}'),
  ('test_source', 'emb-3', 'Old model job', 'C Co', 'https://example.com/3', null, '{}');
insert into public.job_chunks (source, external_id, chunk_index, model, content_hash, embedding) values
  ('test_source', 'emb-1', 0, 'Vietnamese_Embedding', 'h1', pg_temp.v(1)),
  ('test_source', 'emb-1', 1, 'Vietnamese_Embedding', 'h1b', pg_temp.v(1, 2, 0.5)),
  ('test_source', 'emb-2', 0, 'Vietnamese_Embedding', 'h2', pg_temp.v(2)),
  ('test_source', 'emb-3', 0, 'other-model', 'h3', pg_temp.v(1));

do $$
declare
  r record;
  n int;
begin
  -- Best chunk per job, nearest first, current model only.
  select count(*) into n from public.match_jobs(pg_temp.v(1), 5) where external_id like 'emb-%';
  assert n = 2, 'one row per job, other model excluded';
  select * into r from public.match_jobs(pg_temp.v(1), 5) where external_id like 'emb-%' order by similarity desc limit 1;
  assert r.external_id = 'emb-1' and abs(r.similarity - 1) < 1e-6, 'nearest job first with similarity 1';
  assert r.link = 'https://example.com/1' and r.apply_url = 'https://apply.example.com/1', 'links as stored';
  select * into r from public.match_jobs(pg_temp.v(2), 1);
  assert r.external_id = 'emb-2', 'match_count limits rows';

  -- Deleting a job removes its chunks.
  delete from public.jobs where external_id = 'emb-3';
  assert not exists (select 1 from public.job_chunks where external_id = 'emb-3'), 'chunks cascade with the job';

  -- dims is fixed by the column type.
  begin
    update public.embedding_model set dims = 768;
    assert false, 'dims must stay 1024';
  exception when check_violation then null;
  end;
  begin
    insert into public.job_chunks (source, external_id, chunk_index, model, content_hash, embedding)
    values ('test_source', 'emb-2', 9, 'Vietnamese_Embedding', 'x', '[1,2,3]');
    assert false, 'a vector of another size must be rejected';
  exception when data_exception then null;
  end;

  -- Defaults.
  select * into r from public.embedding_model;
  assert r.provider = 'FPT AI Marketplace' and r.base_url = 'https://mkp-api.fptcloud.com/v1'
    and r.model = 'Vietnamese_Embedding' and r.dims = 1024, 'default embedding config';
end $$;

-- Admin: reads chunks and config, updates base_url and model, saves and removes the key.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated", "app_metadata": {"role": "admin"}}', true);

do $$
declare
  r record;
begin
  assert (select count(*) from public.job_chunks where external_id like 'emb-%') = 3, 'admin reads chunks';
  update public.embedding_model set base_url = 'https://mkp-api.fptcloud.com/v1', model = 'Vietnamese_Embedding';
  begin
    update public.embedding_model set key_hint = 'x';
    assert false, 'admin must not write key columns directly';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.embedding_model set base_url = 'http://insecure.example.com';
    assert false, 'base_url must be https';
  exception when check_violation then null;
  end;
  begin
    insert into public.job_chunks (source, external_id, chunk_index, model, content_hash, embedding)
    values ('test_source', 'emb-2', 5, 'Vietnamese_Embedding', 'x', pg_temp.v(3));
    assert false, 'authenticated must not write chunks';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.match_jobs(pg_temp.v(1), 5);
    assert false, 'authenticated must not call match_jobs';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.get_embedding_key();
    assert false, 'authenticated must not read the key';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_embedding_key('short');
    assert false, 'short key rejected';
  exception when invalid_parameter_value then null;
  end;

  select * into r from public.set_embedding_key('fpt-testkey-AbCd1234');
  assert r.key_hint = 'fpt-…1234', 'hint is prefix plus last 4';
  select * into r from public.set_embedding_key('  fpt-testkey-Replaced9  ');
  assert r.key_hint = 'fpt-…ced9', 'replacing updates the hint';
end $$;

reset role;
set local role service_role;

do $$
begin
  assert public.get_embedding_key() = 'fpt-testkey-Replaced9', 'service role reads the trimmed, replaced key';
end $$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated", "app_metadata": {"role": "admin"}}', true);
select public.remove_embedding_key();

reset role;
set local role service_role;

do $$
begin
  assert public.get_embedding_key() is null, 'removed key is gone';
  assert not exists (select 1 from vault.secrets where name = 'embedding_model_key'), 'vault secret deleted';
  assert (select key_hint from public.embedding_model) is null, 'hint cleared';
end $$;

-- Non-admin authenticated: no rows, no key RPCs.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000002", "role": "authenticated", "app_metadata": {}}', true);

do $$
begin
  assert (select count(*) from public.job_chunks) = 0, 'non-admin sees no chunks';
  assert (select count(*) from public.embedding_model) = 0, 'non-admin sees no config';
  begin
    perform public.set_embedding_key('fpt-testkey-AbCd1234');
    assert false, 'non-admin must not save a key';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Anon: nothing.
reset role;
set local role anon;

do $$
begin
  begin
    perform 1 from public.job_chunks;
    assert false, 'anon must not read chunks';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.embedding_model;
    assert false, 'anon must not read config';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.match_jobs(pg_temp.v(1), 5);
    assert false, 'anon must not call match_jobs';
  exception when insufficient_privilege then null;
  end;
end $$;

-- The unedited seeded prompt was replaced and no longer says there is no job list.
reset role;

do $$
begin
  assert (select system_prompt like '%"Matching jobs"%' from public.bot_settings), 'seeded prompt replaced';
end $$;
