-- Social publisher: YouTube joins (Callio). LinkedIn was already allowed.
-- Replace the platform check (whatever its generated name is).
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.social_accounts'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%platform%'
  loop
    execute format('alter table public.social_accounts drop constraint %I', c);
  end loop;
end $$;

alter table public.social_accounts add constraint social_accounts_platform_check
  check (platform in ('facebook', 'instagram', 'tiktok', 'youtube', 'linkedin'));

update public.site_settings
set value = jsonb_set(value, '{callio}', (value -> 'callio') || '["youtube"]'::jsonb)
where key = 'social_routes' and not ((value -> 'callio') ? 'youtube');
