-- Social publisher: watch time, video length and per-post options
-- (Instagram cover frame / trial reel / collaborators).
alter table public.social_posts
  add column if not exists duration_sec numeric,
  add column if not exists options jsonb not null default '{}'::jsonb;

alter table public.social_targets
  add column if not exists avg_watch_sec numeric,
  add column if not exists skip_rate numeric;
