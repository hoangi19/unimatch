-- Job embeddings for the bot's job search: the embedding model's connection and key, one vector per job
-- chunk (written by scripts/embed-jobs.ts) and match_jobs for the reply engine.
-- Separate from the chat providers and the guardrail model: vectors are only comparable within one model.

-- Single row: id is always true. dims is fixed by the job_chunks column type; a model with another size
-- needs a new migration, and test-embedding reports the mismatch.
create table public.embedding_model (
  id boolean primary key default true check (id),
  provider text not null default 'FPT AI Marketplace' check (provider = 'FPT AI Marketplace'),
  base_url text not null default 'https://mkp-api.fptcloud.com/v1' check (base_url ~ '^https://' and char_length(base_url) <= 500),
  model text not null default 'Vietnamese_Embedding' check (char_length(btrim(model)) between 1 and 200),
  dims int not null default 1024 check (dims = 1024),
  key_secret_id uuid,
  key_hint text,
  key_saved_at timestamptz
);

insert into public.embedding_model default values;

alter table public.embedding_model enable row level security;
create policy "admins read embedding_model" on public.embedding_model for select to authenticated using ((select public.is_admin()));
create policy "admins update embedding_model" on public.embedding_model for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

revoke all on public.embedding_model from anon, authenticated;
grant select on public.embedding_model to authenticated;
-- Key columns change only through the RPCs below.
grant update (base_url, model) on public.embedding_model to authenticated;

-- Same rules as set_provider_key. Errors never include the key.
create function public.set_embedding_key(p_key text)
returns table (key_hint text, key_saved_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := btrim(p_key);
  v_secret_id uuid;
  v_hint text;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if v_key is null or char_length(v_key) not between 8 and 512 or v_key ~ '\s' then
    raise exception 'invalid API key: expected 8-512 characters without spaces' using errcode = '22023';
  end if;

  select e.key_secret_id into v_secret_id from public.embedding_model e for update;
  if v_secret_id is null then
    v_secret_id := vault.create_secret(v_key, 'embedding_model_key', 'API key for the job embedding model');
  else
    perform vault.update_secret(v_secret_id, v_key);
  end if;

  -- Same hint shape as set_provider_key: short vendor prefix plus the last 4 characters.
  v_hint := coalesce(substring(v_key from '^[A-Za-z]{1,4}(?:-[A-Za-z]{1,4})?-'), '') || '…' || right(v_key, 4);

  return query
    update public.embedding_model e
    set key_secret_id = v_secret_id, key_hint = v_hint, key_saved_at = now()
    where e.id
    returning e.key_hint, e.key_saved_at;
end;
$$;

create function public.remove_embedding_key()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  select e.key_secret_id into v_secret_id from public.embedding_model e for update;
  update public.embedding_model e set key_secret_id = null, key_hint = null, key_saved_at = null where e.id;
  delete from vault.secrets where id = v_secret_id;
end;
$$;

-- Edge Functions and scripts (service role) read the full key. No browser role may execute this.
create function public.get_embedding_key()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret
  from public.embedding_model e
  join vault.decrypted_secrets s on s.id = e.key_secret_id
$$;

revoke all on function public.set_embedding_key(text) from public, anon;
revoke all on function public.remove_embedding_key() from public, anon;
revoke all on function public.get_embedding_key() from public, anon, authenticated;
grant execute on function public.set_embedding_key(text) to authenticated;
grant execute on function public.remove_embedding_key() to authenticated;
grant execute on function public.get_embedding_key() to service_role;

-- One row per chunk of a job (header + part of the description). The chunk text is not stored:
-- descriptions can hold phone numbers. content_hash covers model and text, so re-runs skip unchanged chunks.
create table public.job_chunks (
  source text not null,
  external_id text not null,
  chunk_index int not null check (chunk_index >= 0),
  model text not null,
  content_hash text not null,
  embedding extensions.vector(1024) not null,
  created_at timestamptz not null default now(),
  primary key (source, external_id, chunk_index),
  foreign key (source, external_id) references public.jobs (source, external_id) on delete cascade
);

create index job_chunks_embedding on public.job_chunks using hnsw (embedding extensions.vector_cosine_ops);

alter table public.job_chunks enable row level security;
create policy "admins read job_chunks" on public.job_chunks for select to authenticated using ((select public.is_admin()));

revoke all on public.job_chunks from anon, authenticated;
grant select on public.job_chunks to authenticated;

-- Nearest jobs to a query vector, best chunk per job, current model only. Never returns raw or contact data.
create function public.match_jobs(query_embedding extensions.vector(1024), match_count int)
returns table (
  source text,
  external_id text,
  title text,
  company_name text,
  location text,
  salary text,
  employment_type text,
  link text,
  apply_url text,
  similarity double precision
)
language sql
stable
set search_path = ''
as $$
  with nearest as (
    select c.source, c.external_id, c.embedding operator(extensions.<=>) query_embedding as distance
    from public.job_chunks c
    where c.model = (select e.model from public.embedding_model e)
    order by c.embedding operator(extensions.<=>) query_embedding
    -- Room for several chunks of the same job before de-duplicating.
    limit least(greatest(match_count, 1), 50) * 4
  ),
  best as (
    select distinct on (n.source, n.external_id) n.source, n.external_id, n.distance
    from nearest n
    order by n.source, n.external_id, n.distance
  )
  select j.source, j.external_id, j.title, j.company_name, j.location, j.salary, j.employment_type, j.link, j.apply_url,
    1 - b.distance as similarity
  from best b
  join public.jobs j using (source, external_id)
  order by b.distance
  limit least(greatest(match_count, 1), 50)
$$;

revoke all on function public.match_jobs(extensions.vector, int) from public, anon, authenticated;
grant execute on function public.match_jobs(extensions.vector, int) to service_role;

-- The engine now adds the matching jobs under the prompt. Replace the seeded prompt only if admins never edited it.
update public.bot_settings
set system_prompt = $prompt$Bạn là UniMatch, trợ lý tuyển dụng trả lời tin nhắn Facebook Messenger cho {{page_name}}.

Quy tắc:
- Trả lời ngắn gọn, thân thiện, tối đa 120 từ.
- Chỉ giới thiệu việc làm có trong mục "Matching jobs" do hệ thống thêm vào cuối hướng dẫn này. Không bịa tên công ty, vị trí, mức lương hay đường link.
- Giới thiệu tối đa 3 việc: chức danh, công ty, địa điểm, mức lương (nếu có) và link đúng như trong danh sách.
- Nếu danh sách trống hoặc không có việc nào hợp với nhu cầu, nói là hiện chưa có việc phù hợp và hỏi thêm về vị trí, thành phố hoặc kinh nghiệm.
- Nếu người dùng muốn gặp người thật, cho biết chuyên viên tuyển dụng UniMatch có thể hỗ trợ.$prompt$
where system_prompt = $prompt$Bạn là UniMatch, trợ lý tuyển dụng trả lời tin nhắn Facebook Messenger cho {{page_name}}.

Quy tắc:
- Trả lời ngắn gọn, thân thiện, tối đa 120 từ.
- Bạn chưa có danh sách việc làm đang tuyển. Không bịa tên công ty, vị trí, mức lương hay đường link.
- Bạn có thể giúp người dùng làm rõ nhu cầu: vị trí, thành phố, cấp bậc và kinh nghiệm.
- Nếu người dùng hỏi về việc làm hoặc vị trí cụ thể đang tuyển, cho biết chuyên viên tuyển dụng UniMatch có thể hỗ trợ và hỏi họ có muốn được kết nối với người thật không.$prompt$;
