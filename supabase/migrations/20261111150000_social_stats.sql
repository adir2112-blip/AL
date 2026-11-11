-- Views and engagement per published video, per network (dashboard.html ->
-- פרסומים, and the Sunday WhatsApp report). Filled by social-publish
-- when called with {"stats": true}: pg_cron every 3 hours.
alter table public.social_targets
  add column if not exists views int,
  add column if not exists reach int,
  add column if not exists likes int,
  add column if not exists comments int,
  add column if not exists shares int,
  add column if not exists saves int,
  add column if not exists stats_at timestamptz,
  add column if not exists stats_error text;

select cron.unschedule('social-stats') where exists (select 1 from cron.job where jobname = 'social-stats');
select cron.schedule(
  'social-stats',
  '17 */3 * * *',
  $$ select net.http_post(
       url := 'https://iwixjlfbifsbxtyppvqb.supabase.co/functions/v1/social-publish',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{"stats": true}'::jsonb
     ) $$
);
