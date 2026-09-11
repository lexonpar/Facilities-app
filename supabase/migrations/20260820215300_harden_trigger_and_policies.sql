begin;

-- Trigger functions execute with table writes, so pin their object lookup to
-- the system catalog even though direct client execution is revoked.
alter function public.set_updated_at()
  set search_path = pg_catalog;

-- Combine equivalent permissive SELECT policies so each table evaluates one
-- expression per row while keeping the same owner/manager visibility.
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_select_managers" on public.profiles;
create policy "profiles_select_own_or_managers"
  on public.profiles for select
  to authenticated
  using (
    id = (select auth.uid())
    or (select private.is_active_facilities_manager())
  );

drop policy if exists "staff_roster_select_own"
  on public.staff_roster_accounts;
drop policy if exists "staff_roster_select_admins"
  on public.staff_roster_accounts;
create policy "staff_roster_select_own_or_admins"
  on public.staff_roster_accounts for select
  to authenticated
  using (
    profile_id = (select auth.uid())
    or (select private.is_active_facilities_admin())
  );

commit;
