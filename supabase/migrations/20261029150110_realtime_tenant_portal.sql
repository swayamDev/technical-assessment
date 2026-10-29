-- Realtime for the tenant portal: tell a lease's tenant that its payments or bills changed.
--
-- Uses Broadcast on private channels rather than Postgres Changes. Postgres Changes still
-- notifies subscribers whose role has no SELECT privilege (anon) that a change happened
-- (an empty event marked "401"), and does not check RLS for DELETE events. Here:
--   * a trigger sends a data-free "changed" signal to the private topic lease:<lease_id>;
--     the portal then re-reads its data through the Data API, under RLS;
--   * joining and receiving on a private topic is authorized by RLS on realtime.messages:
--     only the lease's own tenant may read lease:<id>, nobody may send;
--   * no table is added to the supabase_realtime publication.

create function private.notify_lease_change() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object('table', tg_table_name, 'op', tg_op),
    'changed',
    'lease:' || new.lease_id::text,
    true -- private: only subscribers authorized by realtime.messages policies receive it
  );
  return null;
end;
$$;

revoke execute on function private.notify_lease_change() from public, anon, authenticated, service_role;

create trigger payments_notify_lease
after insert or update on public.payments
for each row execute function private.notify_lease_change();

create trigger gateway_bills_notify_lease
after insert or update on public.gateway_bills
for each row execute function private.notify_lease_change();

-- Receiving on lease:<id> (and joining it) is limited to that lease's tenant.
-- There is no insert policy, so no client can broadcast on these topics.
create policy "tenants receive their own lease's change signals"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) in (
      select 'lease:' || lease_id::text from private.tenant_lease_ids() as lease_id
    )
  );
