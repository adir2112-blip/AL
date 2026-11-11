-- Social publisher: upload a video once in dashboard.html -> פרסומים and it is
-- posted to each brand's networks (Callio: Instagram, TikTok, Facebook,
-- LinkedIn; StopZkor: Instagram, TikTok, Facebook), now or at a set time.
-- Edge functions: social-connect (OAuth), social-publish (the queue worker,
-- run by pg_cron every 2 minutes).

-- 1) Connected accounts. Tokens are readable only by the service role: the
--    owner's browser gets every column except "token".
create table if not exists public.social_accounts (
  id bigserial primary key,
  platform text not null check (platform in ('facebook', 'instagram', 'tiktok', 'linkedin')),
  brand text not null default 'other',
  external_id text not null,
  name text,
  username text,
  token text,
  token_expires_at timestamptz,
  parent_id text,
  status text not null default 'ok',
  connected_at timestamptz not null default now(),
  unique (platform, external_id)
);

alter table public.social_accounts enable row level security;
drop policy if exists "owner reads social accounts" on public.social_accounts;
create policy "owner reads social accounts" on public.social_accounts
  for select to authenticated using ((select auth.jwt() ->> 'email') = 'adir2112@gmail.com');
drop policy if exists "owner updates social accounts" on public.social_accounts;
create policy "owner updates social accounts" on public.social_accounts
  for update to authenticated
  using ((select auth.jwt() ->> 'email') = 'adir2112@gmail.com')
  with check ((select auth.jwt() ->> 'email') = 'adir2112@gmail.com');
drop policy if exists "owner deletes social accounts" on public.social_accounts;
create policy "owner deletes social accounts" on public.social_accounts
  for delete to authenticated using ((select auth.jwt() ->> 'email') = 'adir2112@gmail.com');
revoke all on public.social_accounts from anon, authenticated;
grant select (id, platform, brand, external_id, name, username, token_expires_at, parent_id, status, connected_at)
  on public.social_accounts to authenticated;
grant update (brand) on public.social_accounts to authenticated;
grant delete on public.social_accounts to authenticated;

-- 2) Posts (one per uploaded video) and their per-network targets.
create table if not exists public.social_posts (
  id bigserial primary key,
  brand text not null,
  video_path text not null,
  caption text not null default '',
  captions jsonb not null default '{}'::jsonb,
  platforms text[] not null,
  scheduled_at timestamptz not null default now(),
  status text not null default 'scheduled'
    check (status in ('scheduled', 'publishing', 'done', 'partial', 'failed', 'canceled')),
  notified boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists social_posts_due_idx on public.social_posts (status, scheduled_at);

create table if not exists public.social_targets (
  id bigserial primary key,
  post_id bigint not null references public.social_posts (id) on delete cascade,
  platform text not null,
  account_id bigint references public.social_accounts (id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'published', 'failed')),
  container_id text,
  external_id text,
  permalink text,
  error text,
  attempts int not null default 0,
  claim text,
  claimed_at timestamptz,
  next_check_at timestamptz not null default now(),
  started_at timestamptz,
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (post_id, platform)
);
create index if not exists social_targets_work_idx on public.social_targets (status, next_check_at);

alter table public.social_posts enable row level security;
alter table public.social_targets enable row level security;
drop policy if exists "owner manages social posts" on public.social_posts;
create policy "owner manages social posts" on public.social_posts
  for all to authenticated
  using ((select auth.jwt() ->> 'email') = 'adir2112@gmail.com')
  with check ((select auth.jwt() ->> 'email') = 'adir2112@gmail.com');
drop policy if exists "owner manages social targets" on public.social_targets;
create policy "owner manages social targets" on public.social_targets
  for all to authenticated
  using ((select auth.jwt() ->> 'email') = 'adir2112@gmail.com')
  with check ((select auth.jwt() ->> 'email') = 'adir2112@gmail.com');
revoke all on public.social_posts, public.social_targets from anon, authenticated;
grant select, insert, delete on public.social_posts to authenticated;
grant update (status, scheduled_at, caption, captions, notified) on public.social_posts to authenticated;
grant select on public.social_targets to authenticated;
grant update (status, error, attempts, next_check_at, container_id) on public.social_targets to authenticated;
grant usage on sequence public.social_posts_id_seq to authenticated;

-- 3) One-time OAuth "state" values (service role only).
create table if not exists public.social_oauth_states (
  state text primary key,
  platform text not null,
  created_at timestamptz not null default now()
);
alter table public.social_oauth_states enable row level security;
revoke all on public.social_oauth_states from anon, authenticated;

-- 4) Private video bucket. The networks fetch each video through a
--    short-lived signed URL made by social-publish.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('social-videos', 'social-videos', false, 52428800, array['video/mp4', 'video/quicktime'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "owner uploads social videos" on storage.objects;
create policy "owner uploads social videos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'social-videos' and (select auth.jwt() ->> 'email') = 'adir2112@gmail.com');
drop policy if exists "owner reads social videos" on storage.objects;
create policy "owner reads social videos" on storage.objects
  for select to authenticated
  using (bucket_id = 'social-videos' and (select auth.jwt() ->> 'email') = 'adir2112@gmail.com');
drop policy if exists "owner deletes social videos" on storage.objects;
create policy "owner deletes social videos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'social-videos' and (select auth.jwt() ->> 'email') = 'adir2112@gmail.com');

-- 5) Which networks each brand goes to, and the WhatsApp summary switch.
insert into public.site_settings (key, value) values
  ('social_routes', '{"callio": ["instagram", "tiktok", "facebook", "linkedin"], "stopzkor": ["instagram", "tiktok", "facebook"]}'),
  ('wa_social_alerts', 'true')
on conflict (key) do nothing;

-- 6) The queue worker: every 2 minutes. It returns at once when nothing is due.
select cron.unschedule('social-publish') where exists (select 1 from cron.job where jobname = 'social-publish');
select cron.schedule(
  'social-publish',
  '*/2 * * * *',
  $$ select net.http_post(
       url := 'https://iwixjlfbifsbxtyppvqb.supabase.co/functions/v1/social-publish',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{}'::jsonb
     ) $$
);
