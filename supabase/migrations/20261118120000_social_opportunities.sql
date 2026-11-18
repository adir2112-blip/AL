-- "הזדמנויות" in dashboard.html: public posts (Facebook groups and pages)
-- where one of our brands can genuinely help. A post arrives from the
-- owner's Gmail (Facebook notification emails, sent by the Apps Script in
-- tools/gmail-opportunities.gs) or pasted by hand. Claude judges the fit and
-- drafts a reply; the owner edits it and posts it HIMSELF from his own
-- profile. Nothing here ever posts to Facebook.
-- Rows are written by the social-opportunities edge function (service role);
-- the owner reads, edits the draft and sets the status from the dashboard.
create table if not exists public.social_opportunities (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  source      text not null default 'manual' check (source in ('manual', 'email')),
  dedupe      text not null unique check (char_length(dedupe) <= 100),
  brand       text not null check (brand in ('callio', 'stopzkor', 'al')),
  relevance   int not null check (relevance between 0 and 10),
  why         text check (why is null or char_length(why) <= 600),
  place       text check (place is null or char_length(place) <= 200),
  author      text check (author is null or char_length(author) <= 120),
  post_text   text not null check (char_length(post_text) between 1 and 6000),
  post_url    text check (post_url is null or (post_url ~ '^https://' and char_length(post_url) <= 2000)),
  draft       text not null check (char_length(draft) between 1 and 3000),
  status      text not null default 'new' check (status in ('new', 'done', 'skipped'))
);

create index if not exists social_opportunities_status_idx
  on public.social_opportunities (status, created_at desc);

create or replace function public.social_opportunities_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists social_opportunities_touch on public.social_opportunities;
create trigger social_opportunities_touch before update on public.social_opportunities
  for each row execute function public.social_opportunities_touch();

alter table public.social_opportunities enable row level security;

revoke all on public.social_opportunities from anon;
revoke all on public.social_opportunities from authenticated;
grant select, update, delete on public.social_opportunities to authenticated;

drop policy if exists "owner manages social opportunities" on public.social_opportunities;
create policy "owner manages social opportunities" on public.social_opportunities
  for all to authenticated
  using ((select auth.jwt() ->> 'email') = 'adir2112@gmail.com')
  with check ((select auth.jwt() ->> 'email') = 'adir2112@gmail.com');
