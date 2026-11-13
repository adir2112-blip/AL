-- Two streams per brand: "main" (series episodes, manual uploads) and
-- "shorts" (the studio's automatic Callio Shorts, on their own days:
-- site_settings.social_cadence.shorts_days, default Mon/Wed/Fri).
-- Each stream gets its own lessons.
alter table public.social_lessons add column if not exists stream text not null default 'main';
drop index if exists social_lessons_brand_idx;
create index if not exists social_lessons_brand_idx on public.social_lessons (brand, stream, created_at desc);

-- (no social_cadence row exists: the defaults in social-optimize apply)
