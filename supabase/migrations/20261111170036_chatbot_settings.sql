-- Chatbot tab settings and AI provider configs. API keys live in Supabase Vault; tables keep only a hint.

-- Shared admin check. #13 defines the same body; keep both identical.
create or replace function public.is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role' = 'admin', false)
$$;

create type public.ai_provider_kind as enum ('hermes', 'openai', 'anthropic', 'custom');

-- One row per provider, so switching the active provider keeps every other provider's config.
create table public.ai_providers (
  kind public.ai_provider_kind primary key,
  display_name text,
  base_url text check (base_url ~ '^(https://|http://localhost(:[0-9]+)?(/|$))'),
  model text,
  -- Header name -> string value. Visible to admins: never put credentials here.
  extra_headers jsonb not null default '{}' check (
    jsonb_typeof(extra_headers) = 'object'
    and not jsonb_path_exists(extra_headers, '$.keyvalue() ? (!(@.key like_regex "^[A-Za-z0-9-]+$") || @.value.type() != "string")')
  ),
  supports_tools boolean not null default true,
  key_secret_id uuid,
  key_hint text,
  key_saved_at timestamptz
);

insert into public.ai_providers (kind, display_name, base_url, model) values
  ('hermes', 'Hermes', 'https://inference-api.nousresearch.com/v1', 'hermes-4-70b'),
  ('openai', 'ChatGPT', 'https://api.openai.com/v1', 'gpt-5-mini'),
  ('anthropic', 'Claude', 'https://api.anthropic.com/v1', 'claude-sonnet-5-5'),
  ('custom', null, null, null);

-- Single row: id is always true.
create table public.bot_settings (
  id boolean primary key default true check (id),
  active_provider public.ai_provider_kind not null default 'hermes' references public.ai_providers (kind),
  temperature numeric(2, 1) not null default 0.4 check (temperature between 0 and 1.5),
  max_tokens integer not null default 512 check (max_tokens >= 64),
  system_prompt text not null check (char_length(btrim(system_prompt)) > 0 and char_length(system_prompt) <= 6000),
  greeting text not null check (char_length(btrim(greeting)) > 0),
  fallback text not null check (char_length(btrim(fallback)) > 0),
  handoff_message text not null check (char_length(btrim(handoff_message)) > 0),
  language text not null default 'auto' check (language in ('vi', 'en', 'auto')),
  -- {refused_topics: text[], handoff_on_keyword, handoff_on_low_confidence, handoff_on_complaint: boolean}
  guardrails jsonb not null check (jsonb_typeof(guardrails) = 'object'),
  rate_limit_per_hour integer not null default 30 check (rate_limit_per_hour between 1 and 500)
);

insert into public.bot_settings (system_prompt, greeting, fallback, handoff_message, guardrails) values (
  $prompt$Bạn là UniMatch, trợ lý tuyển dụng trả lời tin nhắn Facebook Messenger cho {{page_name}}.

Quy tắc:
- Chỉ giới thiệu việc làm do tool search_jobs trả về. Không bịa tên công ty, mức lương hay đường link.
- Trả lời bằng ngôn ngữ người dùng đang dùng (tiếng Việt hoặc tiếng Anh), tối đa 120 từ.
- Hiển thị tối đa 3 việc làm: chức danh, công ty, địa điểm và link LinkedIn.
- Nếu không có việc phù hợp, hỏi lại một câu về vị trí, thành phố hoặc cấp bậc.
- Nếu người dùng muốn gặp người thật, gọi handoff_to_human kèm lý do ngắn gọn.

Tools: search_jobs(query, location, remote, seniority, top_k), handoff_to_human(reason)$prompt$,
  'Chào bạn! Mình là trợ lý UniMatch. Bạn cho mình biết vị trí và thành phố bạn quan tâm, mình sẽ tìm các việc đang tuyển cho bạn nhé.',
  'Hiện mình chưa tìm thấy việc phù hợp. Bạn đang tìm vị trí nào, ở thành phố nào và cấp bậc ra sao?',
  'Mình đã ghi nhận — chuyên viên tuyển dụng UniMatch sẽ trả lời bạn ngay trong cuộc trò chuyện này trong vòng 1 giờ làm việc.',
  '{"refused_topics": ["Chính trị", "Tôn giáo", "Tư vấn y tế", "Visa & pháp lý"], "handoff_on_keyword": true, "handoff_on_low_confidence": true, "handoff_on_complaint": false}'
);

-- Rows are fixed: admins read and update, nobody inserts or deletes from the browser.
alter table public.ai_providers enable row level security;
alter table public.bot_settings enable row level security;

create policy "admins read ai_providers" on public.ai_providers for select to authenticated using ((select public.is_admin()));
create policy "admins update ai_providers" on public.ai_providers for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins read bot_settings" on public.bot_settings for select to authenticated using ((select public.is_admin()));
create policy "admins update bot_settings" on public.bot_settings for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

revoke all on public.ai_providers, public.bot_settings from anon, authenticated;
grant select on public.ai_providers, public.bot_settings to authenticated;
grant update on public.bot_settings to authenticated;
-- Key columns change only through the RPCs below.
grant update (display_name, base_url, model, extra_headers, supports_tools) on public.ai_providers to authenticated;

-- Saves or replaces a provider's key in Vault. Errors never include the key.
create function public.set_provider_key(p_kind public.ai_provider_kind, p_key text)
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

  select p.key_secret_id into v_secret_id from public.ai_providers p where p.kind = p_kind for update;
  if not found then
    raise exception 'unknown provider' using errcode = '22023';
  end if;

  if v_secret_id is null then
    v_secret_id := vault.create_secret(v_key, 'ai_provider_key:' || p_kind, 'API key for AI provider ' || p_kind);
  else
    perform vault.update_secret(v_secret_id, v_key);
  end if;

  -- Vendor prefix (sk-, sk-ant-, nous-) plus the last 4 characters. Segments capped at 4 letters
  -- so a key with dashes inside its secret part never leaks that part into the hint.
  v_hint := coalesce(substring(v_key from '^[A-Za-z]{1,4}(?:-[A-Za-z]{1,4})?-'), '') || '…' || right(v_key, 4);

  return query
    update public.ai_providers p
    set key_secret_id = v_secret_id, key_hint = v_hint, key_saved_at = now()
    where p.kind = p_kind
    returning p.key_hint, p.key_saved_at;
end;
$$;

create function public.remove_provider_key(p_kind public.ai_provider_kind)
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

  select p.key_secret_id into v_secret_id from public.ai_providers p where p.kind = p_kind for update;

  update public.ai_providers p
  set key_secret_id = null, key_hint = null, key_saved_at = null
  where p.kind = p_kind;

  delete from vault.secrets where id = v_secret_id;
end;
$$;

-- Edge Functions (service role) read the full key. No browser role may execute this.
create function public.get_provider_key(p_kind public.ai_provider_kind)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret
  from public.ai_providers p
  join vault.decrypted_secrets s on s.id = p.key_secret_id
  where p.kind = p_kind
$$;

revoke all on function public.set_provider_key(public.ai_provider_kind, text) from public, anon;
revoke all on function public.remove_provider_key(public.ai_provider_kind) from public, anon;
revoke all on function public.get_provider_key(public.ai_provider_kind) from public, anon, authenticated;
grant execute on function public.set_provider_key(public.ai_provider_kind, text) to authenticated;
grant execute on function public.remove_provider_key(public.ai_provider_kind) to authenticated;
grant execute on function public.get_provider_key(public.ai_provider_kind) to service_role;
