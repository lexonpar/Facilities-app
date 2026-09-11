-- Staff Tools owner access is deliberately separate from the employee roster.
-- A signed, short-lived assertion may create one opaque handoff ticket; the
-- ticket is stored only as a hash and can be consumed exactly once.

begin;

create table public.facilities_owner_accounts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique
    references public.profiles (id) on delete cascade,
  owner_source text not null default 'staff_tools'
    check (owner_source = 'staff_tools'),
  owner_id text not null unique
    check (owner_id = 'emp-alexis-younker'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger facilities_owner_accounts_updated_at
  before update on public.facilities_owner_accounts
  for each row execute function public.set_updated_at();

create table public.facilities_owner_handoffs (
  id uuid primary key default gen_random_uuid(),
  assertion_jti_hash text not null unique
    check (assertion_jti_hash ~ '^[a-f0-9]{64}$'),
  owner_id text not null
    check (owner_id = 'emp-alexis-younker'),
  ticket_hash text not null unique
    check (ticket_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    expires_at > created_at
    and expires_at <= created_at + interval '2 minutes'
  ),
  check (used_at is null or used_at >= created_at)
);

create index facilities_owner_handoffs_expires_at_idx
  on public.facilities_owner_handoffs (expires_at);

alter table public.facilities_owner_accounts enable row level security;
alter table public.facilities_owner_handoffs enable row level security;

-- Authorization continues to use the Facilities-owned profile role. An active
-- employee roster mapping OR an active, separately provisioned owner mapping is
-- required. The owner mapping never participates in roster sync/deactivation.
create or replace function private.is_active_facilities_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role in ('staff', 'manager', 'admin')
      and (
        exists (
          select 1
          from public.staff_roster_accounts r
          where r.profile_id = p.id
            and r.roster_source = 'shiftflow'
            and r.company_id = 'on-par'
            and r.active = true
        )
        or exists (
          select 1
          from public.facilities_owner_accounts o
          where o.profile_id = p.id
            and o.owner_source = 'staff_tools'
            and o.owner_id = 'emp-alexis-younker'
            and o.active = true
        )
      )
  )
$$;

create or replace function private.is_active_facilities_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role in ('manager', 'admin')
      and (
        exists (
          select 1
          from public.staff_roster_accounts r
          where r.profile_id = p.id
            and r.roster_source = 'shiftflow'
            and r.company_id = 'on-par'
            and r.active = true
        )
        or exists (
          select 1
          from public.facilities_owner_accounts o
          where o.profile_id = p.id
            and o.owner_source = 'staff_tools'
            and o.owner_id = 'emp-alexis-younker'
            and o.active = true
        )
      )
  )
$$;

create or replace function private.is_active_facilities_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
      and (
        exists (
          select 1
          from public.staff_roster_accounts r
          where r.profile_id = p.id
            and r.roster_source = 'shiftflow'
            and r.company_id = 'on-par'
            and r.active = true
        )
        or exists (
          select 1
          from public.facilities_owner_accounts o
          where o.profile_id = p.id
            and o.owner_source = 'staff_tools'
            and o.owner_id = 'emp-alexis-younker'
            and o.active = true
        )
      )
  )
$$;

alter function private.is_active_facilities_user() owner to postgres;
alter function private.is_active_facilities_manager() owner to postgres;
alter function private.is_active_facilities_admin() owner to postgres;

revoke all on function private.is_active_facilities_user() from public, anon;
revoke all on function private.is_active_facilities_manager() from public, anon;
revoke all on function private.is_active_facilities_admin() from public, anon;
grant execute on function private.is_active_facilities_user() to authenticated;
grant execute on function private.is_active_facilities_manager() to authenticated;
grant execute on function private.is_active_facilities_admin() to authenticated;

create policy "facilities_owner_accounts_select_own_or_admins"
  on public.facilities_owner_accounts for select
  to authenticated
  using (
    profile_id = (select auth.uid())
    or (select private.is_active_facilities_admin())
  );

-- The owner account is intentionally fixed at Admin. Even another Facilities
-- Admin cannot demote it through the normal profile editor.
drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin"
  on public.profiles for update
  to authenticated
  using ((select private.is_active_facilities_admin()))
  with check (
    (select private.is_active_facilities_admin())
    and (
      not exists (
        select 1
        from public.facilities_owner_accounts o
        where o.profile_id = profiles.id
      )
      or role = 'admin'
    )
  );

-- Owner mappings may be read only by the mapped owner and active Facilities
-- admins. Handoff rows have no client policy at all; only the Edge service role
-- can create, consume, or clean them up.
revoke all on public.facilities_owner_accounts from anon, authenticated;
revoke all on public.facilities_owner_handoffs from anon, authenticated;
grant select on public.facilities_owner_accounts to authenticated;

grant select, insert, update, delete
  on public.facilities_owner_accounts to service_role;
grant select, insert, update, delete
  on public.facilities_owner_handoffs to service_role;

comment on table public.facilities_owner_accounts is
  'Explicit Staff Tools owner identities; separate from the employee Punch roster';
comment on table public.facilities_owner_handoffs is
  'Hashed, short-lived, single-use owner SSO tickets; service-role access only';

commit;
