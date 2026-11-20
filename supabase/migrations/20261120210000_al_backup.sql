-- Weekly backup of the AL site database, mailed to the owner (function al-backup).
-- The free Supabase plan keeps no backups of its own.

-- the public tables to back up (service role only)
create or replace function public.al_backup_tables()
returns table (table_name text) language sql stable security definer set search_path = '' as $$
  select t.table_name::text from information_schema.tables t
  where t.table_schema = 'public' and t.table_type = 'BASE TABLE' order by 1
$$;
revoke all on function public.al_backup_tables() from public, anon, authenticated;
grant execute on function public.al_backup_tables() to service_role;

-- Sundays 05:00-09:00 UTC, hourly; the function sends once, from 08:00 Israel time
do $$ begin
  if exists (select 1 from cron.job where jobname = 'al-backup') then perform cron.unschedule('al-backup'); end if;
end $$;
select cron.schedule(
  'al-backup',
  '0 5-9 * * 0',
  $$ select net.http_post(
       url := 'https://iwixjlfbifsbxtyppvqb.supabase.co/functions/v1/al-backup',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{}'::jsonb,
       timeout_milliseconds := 60000
     ) $$
);
