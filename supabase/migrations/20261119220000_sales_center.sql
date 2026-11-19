-- "מוקד מכירות": sales agents call business owners to book a 15-20 minute
-- Zoom with A.L Systems.
--  * sales_agents   an employee with his own login (auth user) and hourly rate
--  * sales_leads    the pool, by industry; the owner assigns leads to an agent
--  * sales_calls    every call outcome (the owner's statistics come from here)
--  * sales_shifts   the agent's time clock (the monthly payroll report)
--  * sales_scripts  one call script per industry
-- The owner (adir2112@gmail.com) manages everything from dashboard.html.
-- An agent only READS his own leads, calls and shifts; every change he makes
-- goes through the "sales" edge function (service role), which checks him.
create table if not exists public.sales_agents (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  user_id      uuid not null unique references auth.users (id) on delete cascade,
  username     text not null unique check (username ~ '^[a-z0-9._-]{3,30}$'),
  name         text not null check (char_length(name) between 1 and 80),
  phone        text check (phone is null or char_length(phone) <= 30),
  hourly_rate  numeric(8, 2) not null default 50 check (hourly_rate >= 0),
  active       boolean not null default true
);

create table if not exists public.sales_scripts (
  industry   text primary key check (industry ~ '^[a-z_]{2,40}$'),
  label      text not null check (char_length(label) between 1 and 60),
  active     boolean not null default true,
  sort       int not null default 0,
  script     jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.sales_leads (
  id             bigint generated always as identity primary key,
  created_at     timestamptz not null default now(),
  industry       text not null references public.sales_scripts (industry) on update cascade,
  business       text not null check (char_length(business) between 1 and 200),
  contact_name   text check (contact_name is null or char_length(contact_name) <= 120),
  phone          text not null check (char_length(phone) between 6 and 30),
  phone_norm     text not null unique check (phone_norm ~ '^[0-9]{9,13}$'),
  city           text check (city is null or char_length(city) <= 80),
  address        text check (address is null or char_length(address) <= 300),
  website        text check (website is null or char_length(website) <= 500),
  rating         numeric(2, 1),
  reviews        int,
  source         text not null default 'manual' check (source in ('manual', 'google', 'import')),
  place_id       text unique check (place_id is null or char_length(place_id) <= 300),
  agent_id       bigint references public.sales_agents (id) on delete set null,
  assigned_at    timestamptz,
  status         text not null default 'new' check (status in ('new', 'no_answer', 'callback', 'meeting', 'not_interested')),
  callback_at    timestamptz,
  meeting_at     timestamptz,
  notes          text check (notes is null or char_length(notes) <= 4000),
  attempts       int not null default 0,
  last_call_at   timestamptz,
  dnc            boolean not null default false
);
create index if not exists sales_leads_agent_idx on public.sales_leads (agent_id, status);
create index if not exists sales_leads_pool_idx on public.sales_leads (industry, city) where agent_id is null;

create table if not exists public.sales_calls (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  lead_id     bigint not null references public.sales_leads (id) on delete cascade,
  agent_id    bigint references public.sales_agents (id) on delete set null,
  industry    text not null,
  status      text not null check (status in ('no_answer', 'callback', 'meeting', 'not_interested')),
  meeting_at  timestamptz,
  callback_at timestamptz,
  note        text check (note is null or char_length(note) <= 2000)
);
create index if not exists sales_calls_time_idx on public.sales_calls (created_at desc);
create index if not exists sales_calls_agent_idx on public.sales_calls (agent_id, created_at desc);

create table if not exists public.sales_shifts (
  id          bigint generated always as identity primary key,
  agent_id    bigint not null references public.sales_agents (id) on delete cascade,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  check (ended_at is null or ended_at > started_at)
);
create index if not exists sales_shifts_agent_idx on public.sales_shifts (agent_id, started_at desc);
-- one open shift per agent
create unique index if not exists sales_shifts_open_idx on public.sales_shifts (agent_id) where ended_at is null;

-- the agent row of the signed-in user (null for anyone else)
create or replace function public.sales_my_agent()
returns bigint language sql stable security definer set search_path = '' as $$
  select id from public.sales_agents where user_id = (select auth.uid()) and active
$$;
revoke all on function public.sales_my_agent() from public, anon;
grant execute on function public.sales_my_agent() to authenticated;

alter table public.sales_agents enable row level security;
alter table public.sales_scripts enable row level security;
alter table public.sales_leads enable row level security;
alter table public.sales_calls enable row level security;
alter table public.sales_shifts enable row level security;

revoke all on public.sales_agents, public.sales_scripts, public.sales_leads, public.sales_calls, public.sales_shifts from anon, authenticated;
grant select on public.sales_agents, public.sales_scripts, public.sales_leads, public.sales_calls, public.sales_shifts to authenticated;
-- the owner edits from the dashboard; agents only read (RLS below)
grant update (hourly_rate, name, phone, active) on public.sales_agents to authenticated;
grant insert, update, delete on public.sales_scripts to authenticated;
grant insert, update, delete on public.sales_leads to authenticated;
grant update, delete on public.sales_shifts to authenticated;

do $$
declare t text;
begin
  foreach t in array array['sales_agents', 'sales_scripts', 'sales_leads', 'sales_calls', 'sales_shifts'] loop
    execute format('drop policy if exists "owner manages %1$s" on public.%1$I', t);
    execute format('create policy "owner manages %1$s" on public.%1$I for all to authenticated
      using ((select auth.jwt() ->> ''email'') = ''adir2112@gmail.com'')
      with check ((select auth.jwt() ->> ''email'') = ''adir2112@gmail.com'')', t);
  end loop;
end $$;

drop policy if exists "agent reads himself" on public.sales_agents;
create policy "agent reads himself" on public.sales_agents for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "agent reads scripts" on public.sales_scripts;
create policy "agent reads scripts" on public.sales_scripts for select to authenticated
  using (active and (select public.sales_my_agent()) is not null);
drop policy if exists "agent reads his leads" on public.sales_leads;
create policy "agent reads his leads" on public.sales_leads for select to authenticated
  using (agent_id = (select public.sales_my_agent()) and not dnc);
drop policy if exists "agent reads his calls" on public.sales_calls;
create policy "agent reads his calls" on public.sales_calls for select to authenticated
  using (agent_id = (select public.sales_my_agent()));
drop policy if exists "agent reads his shifts" on public.sales_shifts;
create policy "agent reads his shifts" on public.sales_shifts for select to authenticated
  using (agent_id = (select public.sales_my_agent()));
