-- Each network can go out at its own time (e.g. TikTok Tuesday 20:30,
-- Facebook Sunday 12:30). The post becomes due at the earliest of them;
-- social-publish then starts each network's target at its own time.
alter table public.social_posts
  add column if not exists platform_times jsonb not null default '{}'::jsonb;
