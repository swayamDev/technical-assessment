# Code review: late fees, gateway webhook, collections action

**Line numbers.** Each file is numbered from its first `import` (or `'use server'`) as line 1. The `// app/...` path comment is not counted. Each finding quotes the code it refers to.

**Files:** **LF** = `app/api/leases/[leaseId]/late-fees/route.ts`, **WH** = `app/api/webhooks/gateway/route.ts`, **CA** = `app/(staff)/dashboard/actions.ts`.

Findings are ordered from most to least severe.

---

## 1. Critical: CA L1, L5, L9. Anyone can read any organization's collections

```ts
'use server'
export async function getCollections(orgId: string, from: string, to: string) {
  ... WHERE org_id = ${orgId}::uuid ...
```

An exported Server Action is a public POST endpoint. Anyone who knows its action id (it is in the client bundle) can call it, logged in or not. The function never authenticates the caller and takes `orgId` from the request.

**Scenario:** Beta's manager, a tenant or an anonymous visitor calls the action with Northwind's `orgId` and reads Northwind's monthly collections. The brief requires that nobody ever sees another organization's data.

**Fix:** Authenticate with `getUser()`. Read the caller's `org_id` and role from `memberships`, and allow only staff and managers. Never accept `orgId` as a parameter.

## 2. Critical: LF L11–L12. The role comes from `user_metadata`, which the user controls

```ts
const { data: { user } } = await supabase.auth.getUser()
if (user?.user_metadata.role !== 'manager') {
```

Any signed-in user can call `supabase.auth.updateUser({ data: { role: 'manager' } })` and set their own `user_metadata`.

**Scenario:** A tenant sets `role: 'manager'` and adds late fees to any lease.

**Fix:** Get the role from the `memberships` table: `role = 'manager'` for the user's `user_id`.

## 3. Critical: LF L17–L21. No organization check on the lease

```ts
const lease = await prisma.lease.findUnique({ where: { id: leaseId }, ... })
if (!lease) return NextResponse.json({ error: 'Not found' }, { status: 404 })
```

`prisma` connects as the database owner, so RLS doesn't apply, and the query filters only by id.

**Scenario:** Beta's manager posts to `/api/leases/<a Northwind lease>/late-fees`. That inserts invoices into Northwind's books, and the 200 response confirms the lease exists.

**Fix:** Query with `where: { id: leaseId, orgId: managerOrgId }` and return 404 when nothing matches.

## 4. Critical: WH L20–L38. Duplicate deliveries create two payments

```ts
const bill = await prisma.gatewayBill.findUnique(...)        // outside the transaction
if (bill.status === 'paid') return NextResponse.json({ ok: true })
await prisma.$transaction(async (tx) => {
  await tx.gatewayBill.update({ ..., data: { status: 'paid' } })
  const payment = await tx.payment.create(...)
```

This is check-then-act: the status is read outside the transaction, and the update isn't conditional on it.

**Scenario:** The gateway delivers the same `paid=true` callback twice, 5 ms apart. Both requests read `pending`, both transactions commit, and the bill produces two approved payments, so the tenant is credited twice. If `payments.gateway_bill_id` happens to be unique, the second request fails with 500 instead, and the gateway keeps retrying.

**Fix:** Inside the transaction, take a lock and re-check, then create the payment only if this request made the change. For example:

```sql
UPDATE gateway_bills SET status = 'paid' WHERE id = $1 AND status <> 'paid' RETURNING ...
```

or use `SELECT ... FOR UPDATE` and re-read the status. Also keep a `UNIQUE (gateway_bill_id)` constraint, and treat a unique violation as "already paid" (200).

## 5. High: WH L15. The callback payload and the valid signature are logged

```ts
console.error('Invalid signature', { fields, expected })
```

The brief forbids logging whole callback payloads. Worse, `expected` is the correct HMAC for the attacker's own payload.

**Scenario:** Someone who can read the logs (log aggregation, support staff, a leaked log file) sends a forged `paid=true` body, reads the correct signature for it from the log, and replays it. The forged body is then accepted.

**Fix:** Log a fixed message only, with no fields and no signatures.

## 6. High: WH L32. The payment amount is taken from the callback without checking it

```ts
amountSen: BigInt(fields.paid_amount),
```

The brief requires a 422 response, with no effect, when `paid=true` and `paid_amount` differs from the bill's amount.

**Scenario:** A callback for a RM 2,100.50 bill reports `paid_amount=100`. The bill is marked paid and a RM 1.00 payment is created, so the bill is settled for less than its amount. A non-numeric value makes `BigInt` throw (500), and an empty string gives `0n`.

**Fix:** Before changing anything, check that `paid_amount` is all digits and `BigInt(paid_amount) === bill.amountSen`, and return 422 otherwise. Use `bill.amountSen` for the payment.

## 7. High: LF L26–L45. Late fees are not idempotent and not atomic

Nothing records which invoice a fee was charged for, so every call adds the fees again.

**Scenarios:**
- The manager double-clicks, the request is retried, or two managers run it at once. Each run adds another 2% fee for the same overdue invoices.
- The inserts run with `Promise.all` outside a transaction. If one insert fails, some fees stay created and the response is 500.

**Fix:** Run everything in one transaction with a lock on the lease. Store the source invoice on each fee and add a unique constraint, e.g. `(lease_id, kind, source_invoice_id)`, so each overdue invoice is charged at most once.

## 8. High: LF L40, L49–L51. Fee references are duplicated

```ts
fees.push(prisma.invoice.create({ data: { ..., reference: await nextReference(lease.orgId) } }))
...
await Promise.all(fees)
```

Prisma queries are lazy: `prisma.invoice.create(...)` only runs when it is awaited, at L45. So every `nextReference()` call in the loop reads the same "last invoice", because none of the new fees exist yet.

**Scenario:** Three overdue invoices all get `INV-42`. With a unique index on `reference`, the second and third inserts fail and leave a partial result; without one, the references are duplicated. Two concurrent requests in the same organization collide in the same way.

`nextReference` also crashes if the newest invoice has no `reference` (for example rent invoices created at lease creation), because of `last.reference.slice`, and `createdAt` ties make "last" ambiguous.

**Fix:** Generate references from a database sequence, or a per-organization counter row updated in the same transaction.

## 9. High: CA L7, L10. Months are counted in UTC, not Malaysia time

```sql
to_char(date_trunc('month', received_at), 'YYYY-MM') ...
AND received_at >= ${from}::date AND received_at < ${to}::date + interval '1 month'
```

`date_trunc` on a `timestamptz`, and `date` compared with `timestamptz`, both use the session timezone. The server runs in UTC.

**Scenario:** The seeded bank transfer received at 2026-03-01 00:30 Malaysia time is 2026-02-28 16:30 UTC, so it is counted in February. Northwind's report then shows `2026-02: 200000` and `2026-03: 0` instead of the reverse. The range bounds are also 8 hours off.

**Fix:**

```sql
to_char(received_at AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM')
received_at >= (${from}::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur')
```

and use the same conversion for the end bound.

## 10. Medium: WH L18. `paid=false` is ignored

```ts
if (fields.paid !== 'true') return NextResponse.json({ ok: true })
```

This returns before the bill is even looked up.

**Scenario:** A failed payment leaves the bill `pending` forever, but the brief requires it to become `failed`. An unknown bill id with `paid=false` gets 200 instead of 404.

**Fix:** Look up the bill first (404 if unknown). For `paid=false`, change a `pending` bill to `failed` under the same lock, and leave `failed` and `paid` bills unchanged.

## 11. Medium: WH L33. `received_at` is when the webhook arrived, not when the payment was made

```ts
receivedAt: new Date(),
```

The brief requires `received_at = paid_at`.

**Scenario:** A payment made at 2026-03-31 23:59 Malaysia time has its callback retried at 00:05. It is recorded in April and appears in the wrong month of the collections report.

**Fix:** Parse `paid_at` (`YYYY-MM-DD HH:MM:SS +0800`) strictly into an instant and use it.

## 12. Medium: CA L11–L13. Months with no collections are missing

`GROUP BY` over payments only returns months that have payments.

**Scenario:** For 2026-01 to 2026-03, the brief expects three entries, including `{ month: '2026-02', collectedSen: 0 }`. This returns two.

**Fix:** Generate the months with `generate_series` and `LEFT JOIN` the payments, using `COALESCE(SUM(...), 0)`.

## 13. Medium: LF L30. A floating-point threshold skips unpaid invoices

```ts
if (Number(paid) / Number(invoice.amountSen) >= 0.995) continue
```

**Scenario:** A RM 1,500.00 rent invoice with RM 7.50 still unpaid is 99.5% paid, so it is treated as paid and gets no fee, although the rule is "still unpaid". This is also floating-point arithmetic on money, which the brief forbids.

**Fix:** `if (paid >= invoice.amountSen) continue`, comparing the bigints exactly.

## 14. Medium: LF L37. `kind: 'late_fee'` breaks the invoice contract

The brief defines `InvoiceKind = 'deposit' | 'rent'`. A third kind:
- would fail a `CHECK (kind IN ('deposit','rent'))` constraint, causing a 500 with partial inserts (see finding 7);
- would otherwise flow into `GET /api/leases/:id`, whose `kind` type does not allow it;
- has no defined place in the allocation order ("deposit before rent").

**Fix:** Add the kind deliberately: a migration, an updated type and response shape, and a defined allocation position.

## 15. Low: LF L10–L14. Wrong status code and no Bearer token support

- A request with no valid login gets 403. The brief requires 401.
- `createClient()` reads only the session cookie, so the brief's `Authorization: Bearer <token>` callers are always rejected.

**Fix:** Return 401 when there is no user, and accept the Bearer header (`supabase.auth.getUser(token)`).

## 16. Low: WH L13–L14. Signature check details

- `expected !== fields.x_signature` is not a constant-time comparison. Use `crypto.timingSafeEqual` on equal-length buffers.
- If `GATEWAY_X_SIGNATURE_KEY` is unset, the `!` hides it and `createHmac` throws a 500 on every callback. Fail clearly at startup or with an explicit error.

## 17. Low: LF L31. Floating-point fee arithmetic and zero-sen fees

`Math.round(Number(unpaid) * 2 / 100)` uses floats on money. When the unpaid amount is under 25 sen, the fee rounds to 0 and a RM 0.00 invoice is still created.

**Fix:** `(unpaid * 2n + 50n) / 100n` (half up), and skip a fee of 0.

## 18. Low: CA L5, L10. No input validation

A malformed `from` or `to` makes the `::date` cast throw, so the caller gets a 500 instead of a 400.

**Fix:** Validate `YYYY-MM`, check `from <= to`, and cap the range.

---

## Looks suspicious but is correct

- **LF L23–L24 and L28 (date handling).** `new Date(Date.now() + 8h).toISOString().slice(0, 10)` is the Malaysia date whatever the server's timezone. `Date.parse('YYYY-MM-DD')` is UTC midnight, which is how Prisma represents a `date` column. So `invoice.dueDate < cutoff` means "due date is more than 7 days before today in Malaysia", which matches "unpaid more than 7 days after its due date". `new Date(todayMyt)` at L38 stores the correct calendar date.
- **CA L6–L12 (SQL).** `$queryRaw` with a tagged template sends `${orgId}`, `${from}` and `${to}` as bind parameters, so this is not SQL injection.
- **CA L13.** `SUM(bigint)` returns `numeric`, which Prisma returns as a `Decimal`, not the declared `bigint`. `Number(decimal)` still gives the right value at these magnitudes, so only the type annotation is wrong.
- **WH L8–L12 (signature source).** Every field except `x_signature` is sorted by key and joined as `key+value` with `|`. This matches the specification, including extra fields the gateway may add later.
- **WH L22.** Continuing when the bill is `failed` and `paid=true` arrives is correct: the brief says a pending *or failed* bill becomes paid.
