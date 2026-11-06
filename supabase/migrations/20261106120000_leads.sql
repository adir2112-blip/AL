-- Leads from the site: contact form + the form on each demo's final screen.
-- Inserted ONLY by the al-contact-form edge function (service role).
-- Read/updated ONLY by the site owner, logged in to dashboard.html.
create table if not exists public.leads (
  id               bigint generated always as identity primary key,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  name             text not null check (char_length(name) between 1 and 120),
  phone            text not null check (char_length(phone) between 6 and 30),
  email            text check (email is null or char_length(email) <= 200),
  message          text check (message is null or char_length(message) <= 4000),
  source           text not null default 'contact' check (source in ('contact', 'demo')),
  demo_name        text check (demo_name is null or char_length(demo_name) <= 40),
  page_path        text check (page_path is null or char_length(page_path) <= 300),
  marketing_consent boolean not null default false,
  status           text not null default 'new' check (status in ('new', 'contacted', 'meeting', 'won', 'lost')),
  notes            text check (notes is null or char_length(notes) <= 4000),
  contacted_at     timestamptz
);

create index if not exists leads_created_at_idx on public.leads (created_at desc);

create or replace function public.leads_touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists leads_touch_updated_at on public.leads;
create trigger leads_touch_updated_at before update on public.leads
  for each row execute function public.leads_touch_updated_at();

alter table public.leads enable row level security;

revoke all on public.leads from anon;
revoke all on public.leads from authenticated;
grant select, update, delete on public.leads to authenticated;

drop policy if exists "owner reads leads" on public.leads;
create policy "owner reads leads" on public.leads for select to authenticated
  using ((select auth.jwt() ->> 'email') = 'adir2112@gmail.com');

drop policy if exists "owner updates leads" on public.leads;
create policy "owner updates leads" on public.leads for update to authenticated
  using ((select auth.jwt() ->> 'email') = 'adir2112@gmail.com')
  with check ((select auth.jwt() ->> 'email') = 'adir2112@gmail.com');

drop policy if exists "owner deletes leads" on public.leads;
create policy "owner deletes leads" on public.leads for delete to authenticated
  using ((select auth.jwt() ->> 'email') = 'adir2112@gmail.com');
