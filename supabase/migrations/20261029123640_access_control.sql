-- Access control for the Supabase Data API (PostgREST/GraphQL) and Storage.
--
-- The server uses Prisma as the database owner (bypasses RLS) and enforces
-- authorization in code. Through the Data API, users get read access only,
-- except a tenant updating their own phone number. Everything else fails.

-- ---------------------------------------------------------------------------
-- 1. Start from nothing: no privileges for any API role on anything in public
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated, service_role;
revoke all on all sequences in schema public from anon, authenticated, service_role;
revoke execute on all functions in schema public from public, anon, authenticated, service_role;

-- Objects created later by postgres do not get exposed automatically either.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated, service_role;
alter default privileges for role postgres
  revoke execute on functions from public;

-- The private schema is not exposed by the Data API; RLS policies call its helpers.
revoke all on schema private from public;
revoke execute on all functions in schema private from public, anon, authenticated, service_role;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- 2. RLS helpers (SECURITY DEFINER so policies don't recurse through RLS)
-- ---------------------------------------------------------------------------

-- The organization the caller works for as staff or manager, or null.
create function private.member_org_id() returns uuid
language sql stable security definer set search_path = ''
as $$
  select m.org_id from public.memberships m where m.user_id = auth.uid()
$$;

-- The organization the caller manages, or null.
create function private.manager_org_id() returns uuid
language sql stable security definer set search_path = ''
as $$
  select m.org_id from public.memberships m where m.user_id = auth.uid() and m.role = 'manager'
$$;

-- The caller's tenant records.
create function private.tenant_ids() returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select t.id from public.tenants t where t.user_id = auth.uid()
$$;

-- The organizations the caller rents from.
create function private.tenant_org_ids() returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select t.org_id from public.tenants t where t.user_id = auth.uid()
$$;

-- The caller's own leases, as a tenant.
create function private.tenant_lease_ids() returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select l.id from public.leases l join public.tenants t on t.id = l.tenant_id where t.user_id = auth.uid()
$$;

-- The units of the caller's own leases, as a tenant.
create function private.tenant_unit_ids() returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select l.unit_id from public.leases l join public.tenants t on t.id = l.tenant_id where t.user_id = auth.uid()
$$;

revoke execute on all functions in schema private from public, anon, authenticated, service_role;
grant execute on function
  private.member_org_id(),
  private.manager_org_id(),
  private.tenant_ids(),
  private.tenant_org_ids(),
  private.tenant_lease_ids(),
  private.tenant_unit_ids()
to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Row Level Security: read policies only (plus the tenant phone update)
-- ---------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.units enable row level security;
alter table public.tenants enable row level security;
alter table public.leases enable row level security;
alter table public.invoices enable row level security;
alter table public.payments enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.gateway_bills enable row level security;
alter table public.audit_log enable row level security;

create policy "read own organization" on public.organizations
  for select to authenticated
  using (id = (select private.member_org_id()) or id in (select private.tenant_org_ids()));

create policy "staff and managers read own organization's memberships" on public.memberships
  for select to authenticated
  using (org_id = (select private.member_org_id()));

create policy "read units of own organization or own leases" on public.units
  for select to authenticated
  using (org_id = (select private.member_org_id()) or id in (select private.tenant_unit_ids()));

create policy "read own organization's tenants or own tenant row" on public.tenants
  for select to authenticated
  using (org_id = (select private.member_org_id()) or user_id = (select auth.uid()));

create policy "tenants update their own row" on public.tenants
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "read own organization's or own leases" on public.leases
  for select to authenticated
  using (org_id = (select private.member_org_id()) or id in (select private.tenant_lease_ids()));

create policy "read own organization's or own leases' invoices" on public.invoices
  for select to authenticated
  using (org_id = (select private.member_org_id()) or lease_id in (select private.tenant_lease_ids()));

create policy "read own organization's or own leases' payments" on public.payments
  for select to authenticated
  using (org_id = (select private.member_org_id()) or lease_id in (select private.tenant_lease_ids()));

create policy "read own organization's or own leases' allocations" on public.payment_allocations
  for select to authenticated
  using (org_id = (select private.member_org_id()) or lease_id in (select private.tenant_lease_ids()));

create policy "read own organization's or own leases' gateway bills" on public.gateway_bills
  for select to authenticated
  using (org_id = (select private.member_org_id()) or lease_id in (select private.tenant_lease_ids()));

create policy "managers read own organization's audit log" on public.audit_log
  for select to authenticated
  using (org_id = (select private.manager_org_id()));

-- Table privileges: anon gets nothing. Authenticated users can only read
-- (RLS narrows the rows) and update the phone column of tenants.
grant select on
  public.organizations,
  public.memberships,
  public.units,
  public.tenants,
  public.leases,
  public.invoices,
  public.payments,
  public.payment_allocations,
  public.gateway_bills,
  public.audit_log
to authenticated;
grant update (phone) on public.tenants to authenticated;

-- audit_log is append-only even for the owner (triggers) and the service role (no privilege).
revoke update, delete, truncate on public.audit_log from postgres;

-- ---------------------------------------------------------------------------
-- 4. Storage: private payment-slips bucket, <org_id>/... per organization
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-slips', 'payment-slips', false, 5242880, array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Staff and managers upload into their own organization's folder only.
create policy "payment slips: staff and managers upload to own organization"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'payment-slips'
    and (storage.foldername(name))[1] = (select private.member_org_id())::text
  );

-- Reading (and creating signed URLs) is limited to the same folder.
create policy "payment slips: staff and managers read own organization"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'payment-slips'
    and (storage.foldername(name))[1] = (select private.member_org_id())::text
  );

-- No update or delete policies: slips cannot be overwritten or removed through
-- the API. The server cleans up orphaned uploads with the secret key.
