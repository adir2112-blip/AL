-- WhatsApp reminders for Zoom meetings booked in the sales center (owner only):
-- an hour before each meeting, plus a list of the day's meetings at 08:00
-- Israel time. The sales function's "remind" action does the work; it is
-- idempotent: a meeting is reminded once per meeting time.

alter table public.sales_leads add column if not exists meeting_reminded_for timestamptz;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'sales-meeting-reminders') then perform cron.unschedule('sales-meeting-reminders'); end if;
end $$;
select cron.schedule(
  'sales-meeting-reminders',
  '*/5 * * * *',
  $$ select net.http_post(
       url := 'https://iwixjlfbifsbxtyppvqb.supabase.co/functions/v1/sales',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{"action": "remind"}'::jsonb,
       timeout_milliseconds := 30000
     ) $$
);
