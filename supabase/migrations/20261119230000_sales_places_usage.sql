-- Google Places searches per month, so the lead import never leaves the free
-- tier (Text Search with phone numbers: 1,000 free requests a month). The
-- sales function stops at 900; Google itself is capped at 30 a day.
create table if not exists public.sales_places_usage (
  month     text primary key check (month ~ '^\d{4}-\d{2}$'),
  requests  int not null default 0
);
alter table public.sales_places_usage enable row level security;
revoke all on public.sales_places_usage from anon, authenticated;
grant select on public.sales_places_usage to authenticated;
drop policy if exists "owner reads places usage" on public.sales_places_usage;
create policy "owner reads places usage" on public.sales_places_usage for select to authenticated
  using ((select auth.jwt() ->> 'email') = 'adir2112@gmail.com');

-- counts one more request this month (Israel time) and returns the total
create or replace function public.sales_places_bump()
returns int language plpgsql security definer set search_path = '' as $$
declare m text := to_char(now() at time zone 'Asia/Jerusalem', 'YYYY-MM'); n int;
begin
  insert into public.sales_places_usage (month, requests) values (m, 1)
    on conflict (month) do update set requests = public.sales_places_usage.requests + 1
    returning requests into n;
  return n;
end $$;
revoke all on function public.sales_places_bump() from public, anon, authenticated;

-- the test import on 19.11.2026 used one request
insert into public.sales_places_usage (month, requests) values ('2026-11', 1) on conflict (month) do nothing;
