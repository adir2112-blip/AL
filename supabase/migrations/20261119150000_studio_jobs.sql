-- "סטודיו AL" in dashboard.html: the owner asks for a presentation, a
-- document, a file analysis or a research report; the studio edge function
-- has Claude write the content (as JSON) and the dashboard turns it into the
-- finished file in the A.L design (js/studio-render.js).
-- Rows are written by the studio function (service role); the owner reads
-- them, cancels a running job and deletes old ones from the dashboard.
create table if not exists public.studio_jobs (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  kind        text not null check (kind in ('deck_new', 'deck_upgrade', 'deck_editable', 'doc', 'analyze', 'research', 'free')),
  title       text not null check (char_length(title) between 1 and 200),
  prompt      text not null check (char_length(prompt) <= 20000),
  model       text not null check (model in ('opus', 'fable', 'sonnet')),
  web         boolean not null default false,
  file_names  text[] not null default '{}',
  parent_id   bigint references public.studio_jobs (id) on delete set null,
  status      text not null default 'running' check (status in ('running', 'done', 'error', 'cancelled')),
  result      jsonb,
  error       text check (error is null or char_length(error) <= 1000),
  cost_usd    numeric(10, 4) not null default 0,
  duration_s  int
);

create index if not exists studio_jobs_created_idx on public.studio_jobs (created_at desc);

create or replace function public.studio_jobs_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists studio_jobs_touch on public.studio_jobs;
create trigger studio_jobs_touch before update on public.studio_jobs
  for each row execute function public.studio_jobs_touch();

alter table public.studio_jobs enable row level security;

revoke all on public.studio_jobs from anon;
revoke all on public.studio_jobs from authenticated;
grant select, update (status), delete on public.studio_jobs to authenticated;

drop policy if exists "owner manages studio jobs" on public.studio_jobs;
create policy "owner manages studio jobs" on public.studio_jobs
  for all to authenticated
  using ((select auth.jwt() ->> 'email') = 'adir2112@gmail.com')
  with check ((select auth.jwt() ->> 'email') = 'adir2112@gmail.com');
