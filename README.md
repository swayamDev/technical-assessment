# Rent Collection

Part of the rent collection module of a property management platform for Malaysian property managers. It covers leases, invoices, cash and bank-transfer payments with a manager approval step, online payments through a gateway webhook, and a tenant portal.

Built with Next.js 16 (App Router), TypeScript (strict), Supabase (local Postgres, Auth, Storage), Prisma 7, shadcn/ui and Tailwind CSS.

## Running it

Requires Docker and Node.js 22.12+ or 24+. Prisma 7 needs 20.19+ and vitest 5 needs 22.12+; this was tested on Node 26. These are the grader's exact commands; they were tested on a fresh clone with npm 12:

```bash
npx supabase start            # starts the stack from supabase/config.toml
npx supabase db reset         # rebuilds the database from supabase/migrations/
npm install                   # also runs `prisma generate` (postinstall)
cp .env.example .env.local    # replace keys with `npx supabase status` values if they differ
npm run seed
npm run build && npm start    # http://localhost:3000
```

`npm run seed` only works on a freshly reset database. To start over, run `npx supabase db reset && npm run seed`.

### Accounts

Every seeded account uses the password **`RentDemo#2026`**.

| Account | Role |
| --- | --- |
| manager@northwind.test | Northwind manager |
| staff@northwind.test | Northwind staff |
| aisyah@northwind.test, ben@northwind.test, probe@northwind.test | Northwind tenants |
| manager@beta.test | Beta Realty manager |
| chen@beta.test | Beta Realty tenant |

### Environment variables

All values in `.env.example` are for the local stack. The comments in that file say where each value comes from.

| Variable | Where it comes from | Used by |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `npx supabase status`: Project URL | browser and server |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `npx supabase status`: Publishable | browser and server |
| `SUPABASE_SECRET_KEY` | `npx supabase status`: Secret | server only (`src/lib/supabase/admin.ts`, `server-only`) |
| `DATABASE_URL` | `npx supabase status`: Database URL | Prisma |
| `DIRECT_URL` | Same as `DATABASE_URL` locally (the pooler is off) | reserved for migrations |
| `GATEWAY_X_SIGNATURE_KEY` | Shared with the payment gateway (`test_x_signature_key` locally) | webhook signature check |

### Paying a gateway bill

Sign in as a tenant and click **Pay now**. The dialog shows the bill id, the amount and a ready-made command:

```bash
GATEWAY_X_SIGNATURE_KEY=test_x_signature_key node gateway-sim.mjs <bill_id> <amount_sen> [true|false]
```

Then open **Check payment status** (`/payments/return?bill_id=...`). That page only reads the bill's status; only the webhook settles a bill.

## Checks

| Command | What it checks |
| --- | --- |
| `npm test` | Unit tests for `src/lib/billing.ts` and `src/lib/allocation.ts`, run three times: under `TZ=UTC`, `Asia/Kuala_Lumpur` and `America/New_York` |
| `node scripts/e2e-check.mjs` | 118 end-to-end checks against a running app on a freshly seeded database. Covers 401/403/404 per role and organization; CSRF on cookie-authenticated mutations; concurrent cap, approval and lease overlap; Data API and Storage access per role; forged, duplicated, concurrent and out-of-order webhooks. It adds data, so reset and re-seed afterwards. |
| `npm run typecheck`, `npm run lint` | TypeScript strict mode and ESLint |

## Where things are

| Path | What it does |
| --- | --- |
| `src/lib/billing.ts` | Pure billing rules: schedule, invoice status, ringgit parsing, Malaysia "today" |
| `src/lib/allocation.ts` | Pure allocation order and planning |
| `src/lib/auth.ts` | Authenticates from a Bearer token or the session cookie with `getUser()`; the role comes from `memberships` and `tenants`. Cookie-authenticated mutations must also come from the app's own origin and send JSON (`src/lib/csrf.ts`), otherwise 403 |
| `src/server/*` | Services: leases, payments, gateway, reports. Each lease's money changes run under a `FOR UPDATE` lock on the lease row |
| `src/app/api/*` | The HTTP API from the brief (thin route handlers) |
| `supabase/migrations/` | Tables, constraints, triggers, grants, RLS policies, the storage bucket and its policies |
| `prisma/schema.prisma` | Introspected from the database; drift check: `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` |
| `prisma/seed.ts` | Seeds through `createLease`, `recordPayment` and `approvePayment` |

Design decisions are in [DECISIONS.md](DECISIONS.md), and the Part B code review is in [REVIEW.md](REVIEW.md).

## What works

Everything in sections 3 to 9 of the brief:

- the billing functions;
- access control in server code, the Data API and Storage;
- payments with the cap, approval, rejection and void, including under concurrency;
- allocation and the audit log;
- the gateway bill and an idempotent webhook;
- the collections report;
- the staff, manager and tenant UI, with every date and time shown in Malaysia time.

Bonus items done:

- unit tests for billing and allocation;
- server-side search and pagination for the leases list, kept in the URL.

## Skipped

- **Bonus: create-lease form with a live schedule preview.** Leases are created through `POST /api/leases` or the seed; there is no form.
- **Bonus: realtime updates in the tenant portal.** The portal shows the new status after a reload.

## Known issues and limits

- **Unapplied credit is not re-applied automatically.** A void can reopen invoices while an online payment still has `unapplied_sen`; it stays as unapplied credit (see DECISIONS.md §5).
- **Every "Pay now" click creates a new bill.** If the tenant pays two bills, the second payment fills future invoices first, and anything left becomes `unapplied_sen`.
- **`audit_log` is append-only, with one exception.** It is enforced for every application role and the database owner, but a Postgres superuser could still disable the triggers.
- **Each API request makes one round trip to the Auth server.** `getUser()` validates the token with the server every time.
- **Two lockfiles in effect.** The repository is developed with pnpm (`pnpm-lock.yaml`), but npm, which the grader uses, ignores that file and resolves the version ranges in `package.json`.

## What I would do next

- An audited "apply unapplied credit" action for managers.
- The create-lease form with a live schedule preview, and realtime updates in the tenant portal.
- Reuse a tenant's pending bill instead of creating a new one on every click.
- Run the e2e checks in CI against an ephemeral Supabase stack.
