-- Funded amount for today's plan. The signed-in user can read their row.
-- rsi-onboard writes it with the service role. No cron and no vault.

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  capital numeric not null check (capital > 0 and capital <= 100000000),
  noted_on date not null,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using (user_id = (select auth.uid()) and public.is_allowlisted());

revoke all on table public.profiles from public, anon, authenticated;
grant select on table public.profiles to authenticated;
grant select, insert, update, delete on table public.profiles to service_role;

-- A later plan replaces unfilled orders. A recommendation that already has a fill stays.
grant delete on table public.recommendations to service_role;
