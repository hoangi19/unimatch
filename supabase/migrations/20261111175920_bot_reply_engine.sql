-- Reply engine support: a per-conversation lease so bot replies never overlap, and a watermark of the
-- newest customer message already answered. meta-webhook calls claim_bot_turn after a debounce sleep;
-- only the invocation for the newest customer message (or a re-run after a turn) can claim, so messages
-- that arrive close together get one reply that sees all of them. Service role only.

alter table public.conversations
  add column bot_lock_until timestamptz,
  add column bot_replied_up_to timestamptz;

-- Takes the 90s lease when it is free, nothing newer than p_after_ms (Meta ms timestamp, same conversion as
-- the mapping trigger) has arrived, and some customer message is still unanswered. null p_after_ms skips the
-- newest-message check (re-run after a turn). Returns no row when there is nothing to do.
create or replace function public.claim_bot_turn(p_page_id text, p_psid text, p_after_ms bigint)
returns table (conversation_id uuid, reply_up_to timestamptz)
language sql
security definer
set search_path = ''
as $$
  with latest as (
    select max(m.created_at) as at
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where c.page_id = p_page_id and c.psid = p_psid and m.sender_kind = 'user'
  )
  update public.conversations c
  set bot_lock_until = now() + interval '90 seconds'
  from latest
  where c.page_id = p_page_id and c.psid = p_psid
    -- Re-checked after a concurrent claim commits, so only one caller gets the lease.
    and (c.bot_lock_until is null or c.bot_lock_until < now())
    and (p_after_ms is null or latest.at <= to_timestamp(p_after_ms / 1000.0))
    and latest.at > coalesce(c.bot_replied_up_to, '-infinity')
  returning c.id, latest.at
$$;

-- Records the answered watermark and releases the lease. Returns true when a customer message arrived
-- during the turn, so the caller runs another one.
create or replace function public.finish_bot_turn(p_conversation_id uuid, p_up_to timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations
  set bot_replied_up_to = greatest(bot_replied_up_to, p_up_to), bot_lock_until = null
  where id = p_conversation_id;
  return exists (
    select 1 from public.messages
    where conversation_id = p_conversation_id and sender_kind = 'user' and created_at > p_up_to
  );
end;
$$;

revoke execute on function public.claim_bot_turn(text, text, bigint) from public, anon, authenticated;
revoke execute on function public.finish_bot_turn(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_bot_turn(text, text, bigint) to service_role;
grant execute on function public.finish_bot_turn(uuid, timestamptz) to service_role;

-- The seeded prompt promised search_jobs results that do not exist yet. Replace it only if admins never edited it.
update public.bot_settings
set system_prompt = $prompt$Bạn là UniMatch, trợ lý tuyển dụng trả lời tin nhắn Facebook Messenger cho {{page_name}}.

Quy tắc:
- Trả lời ngắn gọn, thân thiện, tối đa 120 từ.
- Bạn chưa có danh sách việc làm đang tuyển. Không bịa tên công ty, vị trí, mức lương hay đường link.
- Bạn có thể giúp người dùng làm rõ nhu cầu: vị trí, thành phố, cấp bậc và kinh nghiệm.
- Nếu người dùng hỏi về việc làm hoặc vị trí cụ thể đang tuyển, cho biết chuyên viên tuyển dụng UniMatch có thể hỗ trợ và hỏi họ có muốn được kết nối với người thật không.$prompt$
where system_prompt = $prompt$Bạn là UniMatch, trợ lý tuyển dụng trả lời tin nhắn Facebook Messenger cho {{page_name}}.

Quy tắc:
- Chỉ giới thiệu việc làm do tool search_jobs trả về. Không bịa tên công ty, mức lương hay đường link.
- Trả lời bằng ngôn ngữ người dùng đang dùng (tiếng Việt hoặc tiếng Anh), tối đa 120 từ.
- Hiển thị tối đa 3 việc làm: chức danh, công ty, địa điểm và link LinkedIn.
- Nếu không có việc phù hợp, hỏi lại một câu về vị trí, thành phố hoặc cấp bậc.
- Nếu người dùng muốn gặp người thật, gọi handoff_to_human kèm lý do ngắn gọn.

Tools: search_jobs(query, location, remote, seniority, top_k), handoff_to_human(reason)$prompt$;
