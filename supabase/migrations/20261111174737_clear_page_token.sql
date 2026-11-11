-- Disconnecting a Page keeps its row (conversations cascade on delete) and drops only its token.
-- A Page with access_token_secret_id null is disconnected.
create or replace function public.clear_page_token(p_page_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
begin
  select access_token_secret_id into v_secret_id from public.pages where id = p_page_id for update;
  update public.pages set access_token_secret_id = null, token_expires_at = null where id = p_page_id;
  if v_secret_id is not null then
    delete from vault.secrets where id = v_secret_id;
  end if;
end;
$$;

revoke execute on function public.clear_page_token(text) from public, anon, authenticated;
grant execute on function public.clear_page_token(text) to service_role;
