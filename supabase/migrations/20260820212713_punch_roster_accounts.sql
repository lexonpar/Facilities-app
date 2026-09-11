-- Facilities Punch ID accounts are mapped to the external roster without
-- storing Punch IDs or Punch-ID hashes. Facilities profile roles remain the
-- only authorization source; upstream roles and user_metadata are not trusted.

begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- The external identity is the durable key. The canonical On Par lookup is
-- (roster_source = 'shiftflow', company_id = 'on-par', employee_id), and every
-- lookup must include all three values. profile_id is a nullable link so roster
-- sync can stage active employees before their Auth/profile account is created,
-- and so deleting an Auth user does not erase the roster identity.
create table public.staff_roster_accounts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique references public.profiles (id) on delete set null,
  roster_source text not null default 'shiftflow'
    check (roster_source in ('shiftflow', '7shifts')),
  company_id text not null default 'on-par'
    check (
      company_id = trim(company_id)
      and char_length(company_id) between 1 and 80
    ),
  employee_id text not null
    check (employee_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  active boolean not null default true,
  display_name text not null check (char_length(trim(display_name)) >= 1),
  department_names text[] not null default '{}',
  last_seen_at timestamptz not null default now(),
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (roster_source, company_id, employee_id)
);

create index staff_roster_accounts_active_idx
  on public.staff_roster_accounts (active, last_seen_at desc);

create trigger staff_roster_accounts_updated_at
  before update on public.staff_roster_accounts
  for each row execute function public.set_updated_at();

create table public.roster_sync_runs (
  id uuid primary key default gen_random_uuid(),
  roster_source text not null default 'shiftflow'
    check (roster_source in ('shiftflow', '7shifts')),
  company_id text not null default 'on-par'
    check (
      company_id = trim(company_id)
      and char_length(company_id) between 1 and 80
    ),
  status text not null check (status in ('running', 'completed', 'failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  discovered_count integer not null default 0 check (discovered_count >= 0),
  created_count integer not null default 0 check (created_count >= 0),
  mapped_count integer not null default 0 check (mapped_count >= 0),
  deactivated_count integer not null default 0 check (deactivated_count >= 0),
  error_code text
);

alter table public.staff_roster_accounts enable row level security;
alter table public.roster_sync_runs enable row level security;

alter table public.issues
  add column submitted_by_profile_id uuid
    references public.profiles (id) on delete set null;

create index issues_submitted_by_profile_id_idx
  on public.issues (submitted_by_profile_id);

-- These helpers accept no caller-supplied user ID, inspect auth.uid(), and
-- derive authorization exclusively from the active roster mapping plus the
-- Facilities-owned profile role. They are outside the exposed public schema.
create function private.is_active_facilities_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.staff_roster_accounts r on r.profile_id = p.id
    where p.id = (select auth.uid())
      and r.roster_source = 'shiftflow'
      and r.company_id = 'on-par'
      and r.active = true
      and p.role in ('staff', 'manager', 'admin')
  )
$$;

create function private.is_active_facilities_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.staff_roster_accounts r on r.profile_id = p.id
    where p.id = (select auth.uid())
      and r.roster_source = 'shiftflow'
      and r.company_id = 'on-par'
      and r.active = true
      and p.role in ('manager', 'admin')
  )
$$;

create function private.is_active_facilities_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.staff_roster_accounts r on r.profile_id = p.id
    where p.id = (select auth.uid())
      and r.roster_source = 'shiftflow'
      and r.company_id = 'on-par'
      and r.active = true
      and p.role = 'admin'
  )
$$;

alter function private.is_active_facilities_user() owner to postgres;
alter function private.is_active_facilities_manager() owner to postgres;
alter function private.is_active_facilities_admin() owner to postgres;

revoke all on function private.is_active_facilities_user() from public, anon;
revoke all on function private.is_active_facilities_manager() from public, anon;
revoke all on function private.is_active_facilities_admin() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_active_facilities_user() to authenticated;
grant execute on function private.is_active_facilities_manager() to authenticated;
grant execute on function private.is_active_facilities_admin() to authenticated;

-- CUTOVER SEQUENCING (intentional strict enforcement): apply only after the
-- login broker/app code is ready and the issue photos have been copied. This
-- migration removes manager access from every profile that is not already
-- linked to an active roster row. The service_role bypasses RLS and retains
-- explicit write grants below, so immediately after this commit the prepared
-- roster sync must stage all active employees, link the Facilities
-- managers/admins, and verify those mappings before production traffic is
-- moved to this project.

-- Replace the original broad issue policies from 001 and 002.
drop policy if exists "staff_insert_issues" on public.issues;
drop policy if exists "public_select_issues" on public.issues;

create policy "active_staff_insert_issues"
  on public.issues for insert
  to authenticated
  with check (
    (select private.is_active_facilities_user())
    and submitted_by_profile_id = (select auth.uid())
    and status = 'open'
    and workflow_status = 'open'
    and completed_at is null
    and completion_note is null
    and completion_photo_path is null
    and recalled_at is null
  );

create policy "active_managers_select_issues"
  on public.issues for select
  to authenticated
  using ((select private.is_active_facilities_manager()));

create policy "active_managers_update_issues"
  on public.issues for update
  to authenticated
  using ((select private.is_active_facilities_manager()))
  with check ((select private.is_active_facilities_manager()));

-- Replace the original broad maintenance policy from 003.
drop policy if exists "maintenance_select" on public.maintenance_items;

create policy "active_managers_select_maintenance"
  on public.maintenance_items for select
  to authenticated
  using ((select private.is_active_facilities_manager()));

create policy "active_managers_update_maintenance"
  on public.maintenance_items for update
  to authenticated
  using ((select private.is_active_facilities_manager()))
  with check ((select private.is_active_facilities_manager()));

-- Replace the final profile policies from 006 and 008. New profile creation is
-- service-only during the cutover, so profiles_insert_own is not recreated.
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_select_managers" on public.profiles;
drop policy if exists "profiles_update_admin" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;

create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()));

create policy "profiles_select_managers"
  on public.profiles for select
  to authenticated
  using ((select private.is_active_facilities_manager()));

create policy "profiles_update_admin"
  on public.profiles for update
  to authenticated
  using ((select private.is_active_facilities_admin()))
  with check ((select private.is_active_facilities_admin()));

drop policy if exists "signup_allowlist_select_managers"
  on public.signup_allowlist;
create policy "signup_allowlist_select_admins"
  on public.signup_allowlist for select
  to authenticated
  using ((select private.is_active_facilities_admin()));

drop policy if exists "signup_allowed_emails_select_managers"
  on public.signup_allowed_emails;
create policy "signup_allowed_emails_select_admins"
  on public.signup_allowed_emails for select
  to authenticated
  using ((select private.is_active_facilities_admin()));

create policy "staff_roster_select_own"
  on public.staff_roster_accounts for select
  to authenticated
  using (profile_id = (select auth.uid()));

create policy "staff_roster_select_admins"
  on public.staff_roster_accounts for select
  to authenticated
  using ((select private.is_active_facilities_admin()));

create policy "roster_sync_runs_select_admins"
  on public.roster_sync_runs for select
  to authenticated
  using ((select private.is_active_facilities_admin()));

-- Existing images stay publicly readable so migrated public object URLs remain
-- valid. New uploads require an active mapped employee. Upsert remains denied
-- because there are no UPDATE policies for this bucket.
drop policy if exists "issue_photos_insert" on storage.objects;
create policy "active_staff_insert_issue_photos"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'issue-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select private.is_active_facilities_user())
  );

-- Explicit least-privilege Data API grants for a 2026 Supabase project. RLS
-- remains the row-level authorization layer.
grant usage on schema public to authenticated, service_role;
grant usage on type public.issue_priority to authenticated, service_role;
grant usage on type public.issue_status to authenticated, service_role;
grant usage on type public.workflow_status to authenticated, service_role;
grant usage on type public.user_role to authenticated, service_role;

revoke all on public.issues from anon, authenticated;
revoke all on public.maintenance_items from anon, authenticated;
revoke all on public.profiles from anon, authenticated;
revoke all on public.signup_allowlist from anon, authenticated;
revoke all on public.signup_allowed_emails from anon, authenticated;
revoke all on public.staff_roster_accounts from anon, authenticated;
revoke all on public.roster_sync_runs from anon, authenticated;

grant select on public.issues to authenticated;
grant insert (
  department,
  comment,
  submitted_by,
  submitted_by_profile_id,
  photo_path,
  priority,
  status,
  workflow_status
) on public.issues to authenticated;
grant update (
  status,
  workflow_status,
  completed_at,
  completion_note,
  completion_photo_path,
  recalled_at
) on public.issues to authenticated;

grant select on public.maintenance_items to authenticated;
grant update (
  title,
  next_service_date,
  frequency_label,
  last_serviced_date,
  company,
  poc_name,
  poc_phone,
  email,
  monthly_cost,
  account_number,
  notes,
  sort_order
) on public.maintenance_items to authenticated;

grant select on public.profiles to authenticated;
grant update (display_name, role) on public.profiles to authenticated;
grant select on public.signup_allowlist to authenticated;
grant select on public.signup_allowed_emails to authenticated;
grant select on public.staff_roster_accounts to authenticated;
grant select on public.roster_sync_runs to authenticated;

grant select, insert, update, delete on public.issues to service_role;
grant select, insert, update, delete on public.maintenance_items to service_role;
grant select, insert, update, delete on public.profiles to service_role;
grant select, insert, update, delete on public.signup_allowlist to service_role;
grant select, insert, update, delete on public.signup_allowed_emails to service_role;
grant select, insert, update, delete on public.staff_roster_accounts to service_role;
grant select, insert, update, delete on public.roster_sync_runs to service_role;

-- Migration 009 removed the trigger. Remove its remaining privileged helpers
-- and obsolete public role helpers; current server flows use the service role.
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
drop function if exists public.is_profile_manager_or_admin(uuid);
drop function if exists public.is_profile_admin(uuid);
drop function if exists public.is_allowed_onpar_email(text);
drop function if exists public.is_auto_admin_onpar_email(text);

revoke all on public.profiles from supabase_auth_admin;
revoke all on public.signup_allowlist from supabase_auth_admin;
revoke all on function public.set_updated_at()
  from public, anon, authenticated, service_role;

-- Keep the 001-004 publication membership for issues, maintenance_items, and
-- profiles. The server-only roster and sync-audit tables are intentionally not
-- added to supabase_realtime.

comment on table public.staff_roster_accounts is
  'Stable external roster mapping for Facilities accounts; Punch IDs and hashes are never stored';
comment on column public.staff_roster_accounts.profile_id is
  'Nullable Auth/profile link populated only after verified account provisioning';
comment on column public.staff_roster_accounts.employee_id is
  'Stable ShiftFlow directory employee ID; never the entered Punch credential';
comment on table public.roster_sync_runs is
  'Non-sensitive audit counts for Facilities roster synchronization';

commit;
