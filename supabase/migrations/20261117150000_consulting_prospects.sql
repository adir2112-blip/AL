-- "ייעוץ עסקי": businesses the owner plans to visit in the field.
-- One row per business: where it is, what to offer, and what happened.
-- Read and written ONLY by the site owner, logged in to dashboard.html.
create table if not exists public.consulting_prospects (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  area        text not null default 'כללי' check (char_length(area) between 1 and 60),
  visit_date  date,
  slot        text check (slot is null or char_length(slot) <= 20),
  sort_order  int not null default 0,
  is_backup   boolean not null default false,
  name        text not null check (char_length(name) between 1 and 160),
  category    text check (category is null or char_length(category) <= 40),
  address     text not null check (char_length(address) between 1 and 200),
  city        text not null check (char_length(city) between 1 and 60),
  phone       text check (phone is null or char_length(phone) <= 30),
  pitch       text check (pitch is null or char_length(pitch) <= 2000),
  status      text not null default 'planned'
              check (status in ('planned', 'visited', 'followup', 'client', 'not_relevant')),
  notes       text check (notes is null or char_length(notes) <= 4000),
  lat         double precision check (lat is null or lat between -90 and 90),
  lng         double precision check (lng is null or lng between -180 and 180),
  pin_exact   boolean not null default false
);

create index if not exists consulting_prospects_area_idx
  on public.consulting_prospects (area, sort_order);

create or replace function public.consulting_touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists consulting_touch_updated_at on public.consulting_prospects;
create trigger consulting_touch_updated_at before update on public.consulting_prospects
  for each row execute function public.consulting_touch_updated_at();

alter table public.consulting_prospects enable row level security;

revoke all on public.consulting_prospects from anon;
revoke all on public.consulting_prospects from authenticated;
grant select, insert, update, delete on public.consulting_prospects to authenticated;

drop policy if exists "owner manages consulting prospects" on public.consulting_prospects;
create policy "owner manages consulting prospects" on public.consulting_prospects
  for all to authenticated
  using ((select auth.jwt() ->> 'email') = 'adir2112@gmail.com')
  with check ((select auth.jwt() ->> 'email') = 'adir2112@gmail.com');
