-- 1) Lead attribution: where each lead first came from (search, social,
--    campaign, direct), landing page, pages and demos seen.
alter table public.leads
  add column if not exists channel text,
  add column if not exists attribution jsonb;

create index if not exists leads_channel_created_idx on public.leads (channel, created_at desc);

-- 2) Owner settings, edited from dashboard.html -> הגדרות.
create table if not exists public.site_settings (
  key text primary key,
  value jsonb,
  updated_at timestamptz not null default now()
);

alter table public.site_settings enable row level security;

drop policy if exists "owner reads settings" on public.site_settings;
create policy "owner reads settings" on public.site_settings
  for select to authenticated
  using ((select auth.jwt() ->> 'email') = 'adir2112@gmail.com');

drop policy if exists "owner updates settings" on public.site_settings;
create policy "owner updates settings" on public.site_settings
  for update to authenticated
  using ((select auth.jwt() ->> 'email') = 'adir2112@gmail.com')
  with check ((select auth.jwt() ->> 'email') = 'adir2112@gmail.com');

revoke all on public.site_settings from anon, authenticated;
grant select, update on public.site_settings to authenticated;

insert into public.site_settings (key, value) values
  ('wa_lead_alerts', 'true'),
  ('wa_weekly_report', 'true'),
  ('weekly_report_last', 'null')
on conflict (key) do nothing;

-- 3) Weekly WhatsApp report: call the function every hour 06:00-10:00 UTC on
--    Sundays. The function itself sends once per week, from 08:00 Israel time,
--    so DST and retries are handled there.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'al-weekly-report',
  '0 6-10 * * 0',
  $$ select net.http_post(
       url := 'https://iwixjlfbifsbxtyppvqb.supabase.co/functions/v1/al-weekly-report',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{}'::jsonb
     ) $$
);
