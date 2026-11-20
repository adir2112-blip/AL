-- Owner corrects an agent's call classification (dashboard -> מוקד מכירות ->
-- click an industry card -> change a call's status).
-- The call row itself is changed, so the success rates follow; the agent's
-- original choice is kept in original_status. If it is the lead's latest
-- call, the lead's current status (and the "do not call" flag that
-- "not interested" sets) follows too.

alter table public.sales_calls
  add column if not exists original_status text,
  add column if not exists edited_at timestamptz;

create or replace function public.sales_fix_call(
  p_call bigint, p_status text, p_meeting_at timestamptz default null, p_callback_at timestamptz default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.sales_calls;
  latest bigint;
begin
  if (select auth.jwt() ->> 'email') is distinct from 'adir2112@gmail.com' then
    raise exception 'not allowed';
  end if;
  if p_status not in ('no_answer', 'callback', 'meeting', 'not_interested') then
    raise exception 'סטטוס לא תקין';
  end if;
  if p_status = 'meeting' and p_meeting_at is null then
    raise exception 'בחר תאריך ושעה לפגישה';
  end if;
  select * into c from public.sales_calls where id = p_call for update;
  if not found then raise exception 'השיחה לא נמצאה'; end if;

  update public.sales_calls set
    status = p_status,
    meeting_at = case when p_status = 'meeting' then p_meeting_at end,
    callback_at = case when p_status = 'callback' then p_callback_at end,
    original_status = coalesce(original_status, c.status),
    edited_at = now()
  where id = p_call;

  select max(id) into latest from public.sales_calls where lead_id = c.lead_id;
  if latest = p_call then
    update public.sales_leads set
      status = p_status,
      meeting_at = case when p_status = 'meeting' then p_meeting_at end,
      callback_at = case when p_status = 'callback' then p_callback_at end,
      dnc = case when p_status = 'not_interested' then true
                 when c.status = 'not_interested' then false
                 else dnc end
    where id = c.lead_id;
  end if;
end $$;

revoke all on function public.sales_fix_call(bigint, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.sales_fix_call(bigint, text, timestamptz, timestamptz) to authenticated;
