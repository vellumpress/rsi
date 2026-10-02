-- RSI on project ojntnbaakfowmnrsetbb. This project is RSI-only.
-- Apply this file in the SQL editor. It creates objects in public and does not alter auth data.

create table if not exists public.allowlist (
  email text primary key,
  created_at timestamptz not null default now(),
  constraint allowlist_email_shape check (email = lower(email) and position('@' in email) > 1)
);

comment on table public.allowlist is
  'Emails allowed to use RSI. Clients can read only their own row. Seeded with the owner.';

insert into public.allowlist (email)
values ('miketankh@gmail.com')
on conflict (email) do nothing;

alter table public.allowlist enable row level security;

drop policy if exists allowlist_select_self on public.allowlist;
create policy allowlist_select_self
  on public.allowlist
  for select
  to authenticated
  using (email = lower(coalesce((select auth.jwt() ->> 'email'), '')));

drop policy if exists allowlist_auth_admin_read on public.allowlist;
create policy allowlist_auth_admin_read
  on public.allowlist
  for select
  to supabase_auth_admin
  using (true);

revoke all on table public.allowlist from public, anon;
grant select on table public.allowlist to authenticated;
grant select on table public.allowlist to supabase_auth_admin;
grant select, insert, update, delete on table public.allowlist to service_role;

-- Invoker-only. A user can see their own allowlist row, so this returns true only for them.
create or replace function public.is_allowlisted()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.allowlist
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.is_allowlisted() from public, anon;
grant execute on function public.is_allowlisted() to authenticated;

-- Rejects signup before a user row exists. Enable it in Authentication → Hooks.
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  user_email text := lower(btrim(coalesce(event -> 'user' ->> 'email', '')));
begin
  if exists (select 1 from public.allowlist where email = user_email) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'error', jsonb_build_object(
      'message', 'This RSI desk is private.',
      'http_code', 403
    )
  );
end;
$$;

revoke all on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;

create table if not exists public.grok_calls (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  called_at timestamptz not null default now()
);

create index if not exists grok_calls_user_called_at on public.grok_calls (user_id, called_at desc);

alter table public.grok_calls enable row level security;

drop policy if exists grok_calls_select_own on public.grok_calls;
create policy grok_calls_select_own
  on public.grok_calls
  for select
  to authenticated
  using (user_id = (select auth.uid()) and public.is_allowlisted());

revoke all on table public.grok_calls from public, anon, authenticated;
grant select on table public.grok_calls to authenticated;
grant select, insert on table public.grok_calls to service_role;

-- Feedback the Boss stores. The user can read their own rows. Only the service role writes them.
create table if not exists public.user_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  noted_on date not null,
  tag text not null check (tag in ('exclusion', 'pace', 'voice', 'risk', 'rule-change', 'note')),
  body text not null,
  constraint_patch jsonb,
  created_at timestamptz not null default now()
);

alter table public.user_feedback enable row level security;

drop policy if exists user_feedback_select_own on public.user_feedback;
create policy user_feedback_select_own
  on public.user_feedback
  for select
  to authenticated
  using (user_id = (select auth.uid()) and public.is_allowlisted());

revoke all on table public.user_feedback from public, anon, authenticated;
grant select on table public.user_feedback to authenticated;
grant select, insert on table public.user_feedback to service_role;

create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  noted_on date not null,
  observation text not null,
  evidence text not null,
  affected text not null,
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  created_at timestamptz not null default now()
);

alter table public.lessons enable row level security;

drop policy if exists lessons_select_own on public.lessons;
create policy lessons_select_own
  on public.lessons
  for select
  to authenticated
  using (user_id = (select auth.uid()) and public.is_allowlisted());

revoke all on table public.lessons from public, anon, authenticated;
grant select on table public.lessons to authenticated;
grant select, insert on table public.lessons to service_role;

create table if not exists public.recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  noted_on date not null,
  ticker text not null,
  side text not null check (side in ('buy', 'sell')),
  rule text not null,
  probability numeric,
  expected_outcome text not null,
  inputs jsonb not null,
  reference_price numeric,
  shares integer,
  dollars numeric,
  reason text not null,
  outcome smallint check (outcome is null or outcome in (0, 1)),
  created_at timestamptz not null default now()
);

alter table public.recommendations enable row level security;

drop policy if exists recommendations_select_own on public.recommendations;
create policy recommendations_select_own
  on public.recommendations
  for select
  to authenticated
  using (user_id = (select auth.uid()) and public.is_allowlisted());

revoke all on table public.recommendations from public, anon, authenticated;
grant select on table public.recommendations to authenticated;
grant select, insert on table public.recommendations to service_role;

-- The user records fills. Recommendations are not positions until a fill exists.
create table if not exists public.fills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  ticker text not null,
  side text not null check (side in ('buy', 'sell')),
  shares numeric not null check (shares > 0),
  price numeric not null check (price > 0),
  traded_on date not null,
  recommendation_id uuid,
  created_at timestamptz not null default now(),
  constraint fills_not_benchmark check (upper(ticker) not in ('SPY', 'QQQ'))
);

alter table public.fills enable row level security;

drop policy if exists fills_select_own on public.fills;
create policy fills_select_own
  on public.fills
  for select
  to authenticated
  using (user_id = (select auth.uid()) and public.is_allowlisted());

drop policy if exists fills_insert_own on public.fills;
create policy fills_insert_own
  on public.fills
  for insert
  to authenticated
  with check (user_id = (select auth.uid()) and public.is_allowlisted());

revoke all on table public.fills from public, anon;
grant select, insert on table public.fills to authenticated;
grant select, insert on table public.fills to service_role;
