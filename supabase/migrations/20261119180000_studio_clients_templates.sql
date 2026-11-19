-- Studio AL, round 2:
--  * studio_clients: saved clients for quotes (name, company number, contact)
--  * studio_templates: a deck saved as a fixed structure for a recurring
--    report (e.g. the monthly FREEFIT deck); every run with it follows the
--    same slides and compares to the previous run (last_result)
--  * studio_settings: one row with the default hourly rate, VAT and the
--    running quote number
--  * studio_jobs: the owner may now save his edits to a result, and a job
--    remembers its template and quote number
create table if not exists public.studio_clients (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  name        text not null check (char_length(name) between 1 and 160),
  company_no  text check (company_no is null or char_length(company_no) <= 40),
  contact     text check (contact is null or char_length(contact) <= 160),
  email       text check (email is null or char_length(email) <= 200),
  phone       text check (phone is null or char_length(phone) <= 40),
  address     text check (address is null or char_length(address) <= 300),
  notes       text check (notes is null or char_length(notes) <= 2000)
);

create table if not exists public.studio_templates (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  name         text not null check (char_length(name) between 1 and 120),
  prompt       text not null default '' check (char_length(prompt) <= 20000),
  structure    jsonb not null,
  last_result  jsonb
);

create table if not exists public.studio_settings (
  id           int primary key default 1 check (id = 1),
  hourly_rate  numeric(10, 2) not null default 300,
  vat_pct      numeric(5, 2) not null default 18,
  quote_prefix text not null default '' check (char_length(quote_prefix) <= 20),
  next_quote   int not null default 1
);
insert into public.studio_settings (id) values (1) on conflict (id) do nothing;

alter table public.studio_jobs add column if not exists template_id bigint references public.studio_templates (id) on delete set null;
alter table public.studio_jobs add column if not exists quote_no text check (quote_no is null or char_length(quote_no) <= 40);
alter table public.studio_jobs add column if not exists client_id bigint references public.studio_clients (id) on delete set null;

-- the next quote number, atomically (called by the studio function)
create or replace function public.studio_next_quote()
returns text language plpgsql security definer set search_path = '' as $$
declare n int; p text;
begin
  update public.studio_settings set next_quote = next_quote + 1 where id = 1
    returning next_quote - 1, quote_prefix into n, p;
  return p || to_char(now() at time zone 'Asia/Jerusalem', 'YYYY') || '-' || lpad(n::text, 3, '0');
end $$;
revoke all on function public.studio_next_quote() from public, anon, authenticated;

create or replace function public.studio_templates_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists studio_templates_touch on public.studio_templates;
create trigger studio_templates_touch before update on public.studio_templates
  for each row execute function public.studio_templates_touch();

alter table public.studio_clients enable row level security;
alter table public.studio_templates enable row level security;
alter table public.studio_settings enable row level security;

revoke all on public.studio_clients, public.studio_templates, public.studio_settings from anon, authenticated;
grant select, insert, update, delete on public.studio_clients to authenticated;
grant select, insert, update, delete on public.studio_templates to authenticated;
grant select, update (hourly_rate, vat_pct, quote_prefix) on public.studio_settings to authenticated;
grant update (result) on public.studio_jobs to authenticated;

drop policy if exists "owner manages studio clients" on public.studio_clients;
create policy "owner manages studio clients" on public.studio_clients
  for all to authenticated
  using ((select auth.jwt() ->> 'email') = 'adir2112@gmail.com')
  with check ((select auth.jwt() ->> 'email') = 'adir2112@gmail.com');

drop policy if exists "owner manages studio templates" on public.studio_templates;
create policy "owner manages studio templates" on public.studio_templates
  for all to authenticated
  using ((select auth.jwt() ->> 'email') = 'adir2112@gmail.com')
  with check ((select auth.jwt() ->> 'email') = 'adir2112@gmail.com');

drop policy if exists "owner manages studio settings" on public.studio_settings;
create policy "owner manages studio settings" on public.studio_settings
  for all to authenticated
  using ((select auth.jwt() ->> 'email') = 'adir2112@gmail.com')
  with check ((select auth.jwt() ->> 'email') = 'adir2112@gmail.com');
