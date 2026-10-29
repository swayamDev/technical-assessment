# Decisions

Line numbers refer to the files at the commit that adds this document.

## 1. The same `paid=true` callback arrives twice, 5 ms apart

Both requests pass the constant-time signature check (`src/server/gateway.ts:83`), find the bill (`:120`) and match `paid_amount` (`:129`). Each then enters `settlePaidBill`, whose transaction first locks the lease row with `SELECT … FOR UPDATE` (`gateway.ts:162` → `src/server/ledger.ts:22`).

The first request holds the lock. It re-reads the bill (`gateway.ts:163`), sees `pending`, marks it paid, creates the payment (`:173`), allocates it (`:185`) and commits. The second request was blocked on that lock. Once it gets the lock it re-reads the bill, sees `paid` (`:166`), and returns 200 without changing anything.

The database is the backstop: `payments.gateway_bill_id` is `UNIQUE` (`supabase/migrations/20261029123557_init_schema.sql:133`). If a second insert ever got that far, it would fail and roll back, and the request would still get 200 (`gateway.ts:144-146`). `scripts/e2e-check.mjs` sends 6 concurrent deliveries and checks that exactly one payment is created.

## 2. Two staff record RM 800 and RM 700 at once with RM 1,000 remaining

Both requests go through `recordPayment`. Each transaction first locks the lease row (`src/server/payments.ts:104` → `ledger.ts:22`), so the two run one after the other.

- The first computes cap = remaining balance (invoices minus allocations) minus pending payments (`payments.ts:121-124`). That is 1,000 − 0 = 1,000, so its payment is inserted as `pending_verification`.
- The second waits for the lock, then recomputes with the first payment now pending: 1,000 − 800 = 200 (or 1,000 − 700 = 300 if the RM 700 request won). Its amount is over the cap, so it gets 422 and nothing is written.

Exactly one is accepted. Approval re-checks the remaining balance under the same lock (`payments.ts:230-239`). The e2e script runs this exact case.

## 3. Where code works out "today" or converts between dates and instants

- **"Today"** is `malaysiaDate` (`src/lib/billing.ts:171-174`): floor((ms + 8h) / day). It is used by `invoiceStatus` (`:184`), the bill amount (`gateway.ts:30`), the dashboard months (`src/app/(staff)/dashboard/page.tsx:28`) and the tenant portal (`src/app/portal/tenant-portal.tsx:120`).
- **`date` columns:** `dateToYmd` and `ymdToDate` (`src/lib/dates.ts:9,14`) map a Postgres `date` to and from UTC midnight. They handle calendar dates only, with no timezone.
- **Input:** `parseInstant` (`dates.ts:22`) requires an explicit offset. The payment form adds `+08:00` (`:43`), and the gateway's `+0800` is honoured (`:34`).
- **Display:** `malaysiaParts` (`dates.ts:49`) adds 8 hours to the instant.
- **SQL:** the collections report uses `AT TIME ZONE 'Asia/Kuala_Lumpur'` (`src/server/reports.ts:56-57`).

This is correct because Malaysia is a fixed UTC+8 with no daylight saving, so adding the offset is exact. Nothing reads the server's or browser's timezone: the unit tests run under three timezones, and the UI was checked in a New York browser.

## 4. Queries not subject to RLS, and what authorizes them instead

- **Prisma (as the database owner):**
  - `requireActor` (`src/lib/auth.ts:66`) verifies the caller with `getUser()`.
  - The role comes only from `memberships` and `tenants` (`auth.ts:22`).
  - Records outside the caller's scope get 404 (`src/server/access.ts:9-41`), and roles not allowed get 403 (`auth.ts:92-101`).
  - IDs in request bodies are re-checked against the caller's organization (`src/server/leases.ts:67-71`).
  - The webhook is authorized by its HMAC signature instead.
- **Secret key:** used only in `payments.ts:208`, to remove an unreferenced slip in the caller's own organization's folder, under an advisory lock. It is also used by the seed script.
- **`SECURITY DEFINER` functions:** the RLS helpers (`supabase/migrations/20261029123640_access_control.sql:35-75`) return only the rows of `auth.uid()`, and the Data API cannot call them. `check_payment_slip` (`init_schema.sql:177`) only reads `storage.objects`. `notify_lease_change` (`20261029150110_realtime_tenant_portal.sql:12`) sends a data-free signal; RLS on `realtime.messages` decides who receives it.

## 5. A void reopens invoices while the lease has `unapplied_sen` from an online payment

Voiding deletes only that payment's allocations (`src/server/payments.ts:340`). The invoices it paid become unpaid, or overdue if past due. The online payment's `unapplied_sen` is **not** applied to them automatically. It stays recorded, and the lease page shows it as "unapplied".

I chose this because the brief says voiding must not change other payments' allocations, and re-applying credit would do exactly that. Moving money between invoices is a financial decision that a manager should make deliberately, with an audit entry, not a side effect of a void. Since "remaining balance" ignores `unapplied_sen`, staff can still record new payments up to the cap.

The trade-off: a tenant can show overdue invoices while holding credit. An explicit, audited "apply credit" action for managers is listed as next work in the README.

## 6. Two things the AI assistant got wrong, and how I noticed

1. **Concurrency test assumptions.** The first run of `scripts/e2e-check.mjs` failed 4 checks. Before changing any code, I looked at the database rows. The app was right and the test was wrong: it assumed the RM 800 request would win the race (the RM 700 one did), and it expected the Northwind manager to see Beta's audit rows, which RLS correctly hides. I fixed the test, not the app. See `ai-logs/2026-10-29-claude-code-session.txt`, lines 2303 and 2584.
2. **Prisma raw query.** The assistant called `pg_advisory_xact_lock`, which returns `void`, through `$queryRaw`. The seed crashed with "Failed to deserialize column of type 'void'". It now uses `$executeRaw`. See the same file, lines 2248–2249 and 2583.
