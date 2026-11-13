-- Social publisher: the studio learns from what the audience did.
-- Every post sent by the studio carries the episode it is (meta), every
-- target keeps a snapshot of its numbers 48 hours after it went out (so an old
-- episode does not win only because it had more time), and social_lessons
-- keeps the lessons drawn from those numbers, per brand.

alter table public.social_posts
  add column if not exists meta jsonb not null default '{}'::jsonb; -- series_id, series_title, n, episode_title, opening, funny...

alter table public.social_targets
  add column if not exists views_48h int,
  add column if not exists watch_48h numeric,
  add column if not exists skip_48h numeric,
  add column if not exists snap_at timestamptz;

create table if not exists public.social_lessons (
  id bigserial primary key,
  brand text not null,
  lessons jsonb not null default '[]'::jsonb,   -- [{text, evidence}]
  hidden jsonb not null default '[]'::jsonb,    -- indexes the owner removed
  based_on int not null default 0,              -- how many measured videos
  created_at timestamptz not null default now()
);
create index if not exists social_lessons_brand_idx on public.social_lessons (brand, created_at desc);

alter table public.social_lessons enable row level security;
drop policy if exists "owner manages social lessons" on public.social_lessons;
create policy "owner manages social lessons" on public.social_lessons
  for all to authenticated
  using ((select auth.jwt() ->> 'email') = 'adir2112@gmail.com')
  with check ((select auth.jwt() ->> 'email') = 'adir2112@gmail.com');
revoke all on public.social_lessons from anon, authenticated;
grant select on public.social_lessons to authenticated;
grant update (hidden) on public.social_lessons to authenticated;
