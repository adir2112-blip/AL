-- Social publisher: videos sent by the video studio wait for the owner's
-- approval (status "review") before they are scheduled.
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.social_posts'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%scheduled%publishing%'
  loop
    execute format('alter table public.social_posts drop constraint %I', c);
  end loop;
end $$;
alter table public.social_posts add constraint social_posts_status_check
  check (status in ('review', 'scheduled', 'publishing', 'done', 'partial', 'failed', 'canceled'));

alter table public.social_posts
  add column if not exists source text,            -- 'studio' or null (uploaded in the dashboard)
  add column if not exists source_id text,         -- the studio's file name
  add column if not exists title text,
  add column if not exists script text,            -- what is said in the video
  add column if not exists review_note text,       -- e.g. the optimizer failed
  add column if not exists reject_reason text,
  add column if not exists reviewed_at timestamptz;
create index if not exists social_posts_source_idx on public.social_posts (source, source_id);

grant update (platform_times, options, reject_reason, reviewed_at) on public.social_posts to authenticated;
