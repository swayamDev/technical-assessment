// End-to-end checks against a running app on a freshly seeded database:
//   npx supabase db reset && npm run seed && npm run build && npm start   (or npm run dev)
//   node scripts/e2e-check.mjs
// It creates extra data (a lease on D-03-2, payments, bills), so reset and re-seed afterwards.

import { createHmac } from "node:crypto";
import nextEnv from "@next/env";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

nextEnv.loadEnvConfig(process.cwd());

const APP = process.env.APP_URL ?? "http://localhost:3000";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLISHABLE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const GATEWAY_KEY = process.env.GATEWAY_X_SIGNATURE_KEY;
const PASSWORD = process.env.SEED_PASSWORD ?? "RentDemo#2026";

let failures = 0;
function check(name, condition, extra = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name} ${extra}`);
  }
}

async function signIn(email) {
  const client = createClient(SUPABASE_URL, PUBLISHABLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (error) throw new Error(`${email}: ${error.message}`);
  const token = data.session.access_token;
  const asUser = createClient(SUPABASE_URL, PUBLISHABLE, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  return { token, db: asUser, userId: data.user.id };
}

async function api(method, path, token, body) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${APP}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

/** A real browser session cookie, built by @supabase/ssr exactly as the app's pages do. */
async function cookieSession(email) {
  const jar = new Map();
  const client = createServerClient(SUPABASE_URL, PUBLISHABLE, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) {
          if (value) jar.set(name, value);
          else jar.delete(name);
        }
      },
    },
  });
  const { error } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (error || jar.size === 0)
    throw new Error(`cookie sign-in failed for ${email}`);
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

/** A request as a browser would send it: cookie auth, with the given Origin and Content-Type. */
async function browserApi(
  method,
  path,
  { cookie, origin, contentType, body, token },
) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (token) headers.authorization = `Bearer ${token}`;
  if (origin) headers.origin = origin;
  if (contentType) headers["content-type"] = contentType;
  const res = await fetch(`${APP}${path}`, { method, headers, body });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

function signedWebhookBody(fields) {
  const source = Object.keys(fields)
    .sort()
    .map((k) => `${k}${fields[k]}`)
    .join("|");
  return new URLSearchParams({
    ...fields,
    x_signature: createHmac("sha256", GATEWAY_KEY).update(source).digest("hex"),
  });
}

async function webhook(body) {
  const res = await fetch(`${APP}/api/webhooks/gateway`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const statuses = (results) =>
  results
    .map((r) => r.status)
    .sort()
    .join(",");

async function main() {
  console.log("Signature test vector");
  {
    const fields = {
      id: "bill_8f3a2c",
      paid: "true",
      paid_amount: "210050",
      paid_at: "2026-04-01 00:30:12 +0800",
      transaction_id: "TX-000123",
      transaction_status: "completed",
    };
    const source = Object.keys(fields)
      .sort()
      .map((k) => `${k}${fields[k]}`)
      .join("|");
    const sig = createHmac("sha256", "test_x_signature_key")
      .update(source)
      .digest("hex");
    check(
      "matches the brief",
      sig ===
        "06994fab2d674e7829144eaa2204631716d3c099b503d38945e92b6296531641",
    );
  }

  const users = {};
  for (const email of [
    "manager@northwind.test",
    "staff@northwind.test",
    "aisyah@northwind.test",
    "ben@northwind.test",
    "probe@northwind.test",
    "manager@beta.test",
    "chen@beta.test",
  ]) {
    users[email.split("@")[0] + (email.endsWith("beta.test") ? "@beta" : "")] =
      await signIn(email);
  }
  const { manager, staff, aisyah, ben, probe } = users;
  const betaManager = users["manager@beta"];
  const chen = users["chen@beta"];

  // Find ids through the Data API as the Northwind manager
  const { data: leases } = await manager.db
    .from("leases")
    .select("id, tenant_id, unit_id, units(name)");
  const leaseByUnit = Object.fromEntries(leases.map((l) => [l.units.name, l]));
  const aisyahLease = leaseByUnit["A-12-3"].id;
  const probeLease = leaseByUnit["C-01-7"].id;
  const { data: units } = await manager.db
    .from("units")
    .select("id, name, org_id");
  const unitD = units.find((u) => u.name === "D-03-2");
  const nwOrg = unitD.org_id;
  const { data: tenants } = await manager.db
    .from("tenants")
    .select("id, full_name");
  const probeTenant = tenants.find((t) => t.full_name === "Probe Tenant").id;
  const { data: betaUnits } = await betaManager.db
    .from("units")
    .select("id, org_id");
  const betaOrg = betaUnits[0].org_id;

  console.log("Authentication");
  check(
    "no token -> 401",
    (await api("GET", `/api/leases/${aisyahLease}`)).status === 401,
  );
  check(
    "bad token -> 401",
    (await api("GET", `/api/leases/${aisyahLease}`, "not-a-token")).status ===
      401,
  );

  console.log("GET /api/leases/:id");
  const detail = await api("GET", `/api/leases/${aisyahLease}`, aisyah.token);
  check("own tenant -> 200", detail.status === 200);
  check(
    "7 invoices in allocation order",
    detail.json.invoices?.length === 7 &&
      detail.json.invoices[0].kind === "deposit",
  );
  check("last period 77419", detail.json.invoices?.[6]?.amountSen === 77419);
  check(
    "paid amounts",
    JSON.stringify(
      detail.json.invoices?.slice(0, 3).map((i) => [i.paidSen, i.status]),
    ) ===
      JSON.stringify([
        [300000, "paid"],
        [150000, "paid"],
        [50000, "overdue"],
      ]),
    JSON.stringify(detail.json.invoices?.slice(0, 3)),
  );
  check("2 payments", detail.json.payments?.length === 2);
  check(
    "other tenant -> 404",
    (await api("GET", `/api/leases/${aisyahLease}`, ben.token)).status === 404,
  );
  check(
    "other org tenant -> 404",
    (await api("GET", `/api/leases/${aisyahLease}`, chen.token)).status === 404,
  );
  check(
    "other org manager -> 404",
    (await api("GET", `/api/leases/${aisyahLease}`, betaManager.token))
      .status === 404,
  );
  check(
    "staff -> 200",
    (await api("GET", `/api/leases/${aisyahLease}`, staff.token)).status ===
      200,
  );
  check(
    "bad id -> 404",
    (await api("GET", `/api/leases/nope`, manager.token)).status === 404,
  );

  console.log("Collections report");
  const report = await api(
    "GET",
    "/api/reports/collections?from=2026-01&to=2026-03",
    manager.token,
  );
  check(
    "seed report",
    JSON.stringify(report.json) ===
      JSON.stringify([
        { month: "2026-01", collectedSen: 300000 },
        { month: "2026-02", collectedSen: 0 },
        { month: "2026-03", collectedSen: 200000 },
      ]),
    JSON.stringify(report.json),
  );
  check(
    "tenant -> 403",
    (
      await api(
        "GET",
        "/api/reports/collections?from=2026-01&to=2026-03",
        aisyah.token,
      )
    ).status === 403,
  );
  check(
    "from > to -> 400",
    (
      await api(
        "GET",
        "/api/reports/collections?from=2026-04&to=2026-03",
        manager.token,
      )
    ).status === 400,
  );
  check(
    "bad month -> 400",
    (
      await api(
        "GET",
        "/api/reports/collections?from=2026-13&to=2027-01",
        manager.token,
      )
    ).status === 400,
  );
  const betaReport = await api(
    "GET",
    "/api/reports/collections?from=2026-01&to=2026-03",
    betaManager.token,
  );
  check(
    "beta sees only its own (zeros)",
    betaReport.json.every?.((m) => m.collectedSen === 0),
  );

  console.log("POST /api/leases");
  const newLease = {
    unitId: unitD.id,
    tenantId: probeTenant,
    startDate: "2030-01-01",
    endDate: "2030-01-31",
    monthlyRentSen: 100000,
    depositSen: 0,
  };
  check(
    "staff -> 403",
    (await api("POST", "/api/leases", staff.token, newLease)).status === 403,
  );
  check(
    "tenant -> 403",
    (await api("POST", "/api/leases", probe.token, newLease)).status === 403,
  );
  check(
    "beta manager with northwind ids -> 404",
    (await api("POST", "/api/leases", betaManager.token, newLease)).status ===
      404,
  );
  check(
    "invalid dates -> 400",
    (
      await api("POST", "/api/leases", manager.token, {
        ...newLease,
        endDate: "2030-02-30",
      })
    ).status === 400,
  );
  check(
    "float rent -> 400",
    (
      await api("POST", "/api/leases", manager.token, {
        ...newLease,
        monthlyRentSen: 10.5,
      })
    ).status === 400,
  );
  const created = await Promise.all([
    api("POST", "/api/leases", manager.token, newLease),
    api("POST", "/api/leases", manager.token, {
      ...newLease,
      startDate: "2030-01-15",
      endDate: "2030-03-01",
    }),
  ]);
  check(
    "concurrent overlapping -> one 201, one 409",
    statuses(created) === "201,409",
    statuses(created),
  );
  const smallLease = created.find((r) => r.status === 201).json.id;
  check(
    "adjacent lease -> 201",
    (
      await api("POST", "/api/leases", manager.token, {
        ...newLease,
        startDate: "2030-04-01",
        endDate: "2030-04-30",
      })
    ).status === 201,
  );
  check(
    "same-day overlap -> 409",
    (
      await api("POST", "/api/leases", manager.token, {
        ...newLease,
        startDate: "2030-04-30",
        endDate: "2030-05-30",
      })
    ).status === 409,
  );
  const { data: audit } = await manager.db
    .from("audit_log")
    .select("action")
    .eq("action", "lease.created");
  // 3 seeded Northwind leases + 2 created above; Beta's seeded lease is hidden by RLS
  check(
    "lease creations audited (own org only)",
    audit.length === 5,
    String(audit.length),
  );

  console.log("Payments (lease with RM 1,000 remaining)");
  const pay = (token, body, lease = smallLease) =>
    api("POST", `/api/leases/${lease}/payments`, token, body);
  const cash = (amountSen) => ({
    amountSen,
    method: "cash",
    receivedAt: "2030-01-02T10:00:00+08:00",
  });
  check("tenant -> 403", (await pay(probe.token, cash(100))).status === 403);
  check(
    "other org -> 404",
    (await pay(betaManager.token, cash(100))).status === 404,
  );
  check(
    "no offset -> 400",
    (
      await pay(staff.token, {
        ...cash(100),
        receivedAt: "2030-01-02T10:00:00",
      })
    ).status === 400,
  );
  check(
    "bank transfer without slip -> 400",
    (await pay(staff.token, { ...cash(100), method: "bank_transfer" }))
      .status === 400,
  );
  check(
    "over remaining -> 422",
    (await pay(staff.token, cash(100001))).status === 422,
  );
  const concurrent = await Promise.all([
    pay(staff.token, cash(80000)),
    pay(staff.token, cash(70000)),
  ]);
  check(
    "RM 800 + RM 700 at once -> one 201, one 422",
    statuses(concurrent) === "201,422",
    statuses(concurrent),
  );
  const winner = concurrent.find((r) => r.status === 201);
  const pendingId = winner.json.id;
  const winnerSen = concurrent[0] === winner ? 80000 : 70000;
  check(
    "staff payment is pending",
    concurrent.find((r) => r.status === 201).json.status ===
      "pending_verification",
  );

  console.log("Approve / reject / void");
  check(
    "staff approve -> 403",
    (await api("POST", `/api/payments/${pendingId}/approve`, staff.token))
      .status === 403,
  );
  check(
    "beta manager approve -> 404",
    (await api("POST", `/api/payments/${pendingId}/approve`, betaManager.token))
      .status === 404,
  );
  check(
    "reject without reason -> 400",
    (
      await api("POST", `/api/payments/${pendingId}/reject`, manager.token, {
        reason: "no",
      })
    ).status === 400,
  );
  const approvals = await Promise.all([
    api("POST", `/api/payments/${pendingId}/approve`, manager.token),
    api("POST", `/api/payments/${pendingId}/approve`, manager.token),
  ]);
  check(
    "approve twice at once -> one 200, one 409",
    statuses(approvals) === "200,409",
    statuses(approvals),
  );
  const { data: allocs } = await manager.db
    .from("payment_allocations")
    .select("amount_sen")
    .eq("payment_id", pendingId);
  check(
    "allocated once",
    allocs.length === 1 && allocs[0].amount_sen === winnerSen,
    JSON.stringify(allocs),
  );
  check(
    "reject approved -> 409",
    (
      await api("POST", `/api/payments/${pendingId}/reject`, manager.token, {
        reason: "wrong one",
      })
    ).status === 409,
  );
  const second = await pay(staff.token, cash(100000 - winnerSen));
  check("pending up to cap -> 201", second.status === 201);
  check(
    "cap counts pending -> 422",
    (await pay(staff.token, cash(1))).status === 422,
  );
  check(
    "reject -> 200",
    (
      await api(
        "POST",
        `/api/payments/${second.json.id}/reject`,
        manager.token,
        { reason: "duplicate entry" },
      )
    ).json.status === "rejected",
  );
  check(
    "void without reason -> 400",
    (await api("POST", `/api/payments/${pendingId}/void`, manager.token, {}))
      .status === 400,
  );
  check(
    "void -> 200",
    (
      await api("POST", `/api/payments/${pendingId}/void`, manager.token, {
        reason: "bounced cheque",
      })
    ).json.status === "voided",
  );
  check(
    "void again -> 409",
    (
      await api("POST", `/api/payments/${pendingId}/void`, manager.token, {
        reason: "bounced cheque",
      })
    ).status === 409,
  );
  const { data: allocsAfter } = await manager.db
    .from("payment_allocations")
    .select("id")
    .eq("payment_id", pendingId);
  check("void removed allocations", allocsAfter.length === 0);
  const managerPay = await pay(manager.token, cash(100000));
  check(
    "manager payment approved immediately",
    managerPay.json.status === "approved",
  );
  const { data: auditActions } = await manager.db
    .from("audit_log")
    .select("action");
  for (const action of [
    "payment.approved",
    "payment.rejected",
    "payment.voided",
  ]) {
    check(
      `audit has ${action}`,
      auditActions.some((a) => a.action === action),
    );
  }

  console.log("Slips and Storage");
  const pdf = new Blob(["%PDF-1.4\n%%EOF\n"], { type: "application/pdf" });
  const up = (who, path) =>
    who.db.storage
      .from("payment-slips")
      .upload(path, pdf, { contentType: "application/pdf" });
  check(
    "tenant cannot upload",
    (await up(probe, `${nwOrg}/tenant.pdf`)).error !== null,
  );
  check(
    "staff cannot upload to another org",
    (await up(staff, `${betaOrg}/x.pdf`)).error !== null,
  );
  check(
    "staff cannot upload at root",
    (await up(staff, `root.pdf`)).error !== null,
  );
  const okUp = await up(staff, `${nwOrg}/e2e-slip.pdf`);
  check("staff uploads to own org", okUp.error === null, okUp.error?.message);
  const html = await staff.db.storage
    .from("payment-slips")
    .upload(`${nwOrg}/x.html`, new Blob(["<b>"], { type: "text/html" }), {
      contentType: "text/html",
    });
  check("wrong file type rejected", html.error !== null);
  check(
    "tenant cannot sign URL",
    (
      await probe.db.storage
        .from("payment-slips")
        .createSignedUrl(`${nwOrg}/e2e-slip.pdf`, 60)
    ).error !== null,
  );
  check(
    "other org cannot sign URL",
    (
      await betaManager.db.storage
        .from("payment-slips")
        .createSignedUrl(`${nwOrg}/e2e-slip.pdf`, 60)
    ).error !== null,
  );
  check(
    "staff can sign URL",
    (
      await staff.db.storage
        .from("payment-slips")
        .createSignedUrl(`${nwOrg}/e2e-slip.pdf`, 60)
    ).error === null,
  );
  const tenantList = await probe.db.storage.from("payment-slips").list(nwOrg);
  check("tenant lists nothing", (tenantList.data ?? []).length === 0);
  const anon = createClient(SUPABASE_URL, PUBLISHABLE, {
    auth: { persistSession: false },
  });
  check(
    "anon lists nothing",
    ((await anon.storage.from("payment-slips").list(nwOrg)).data ?? [])
      .length === 0,
  );

  // Probe lease has plenty remaining: test slip rules there
  const bt = (slipPath) => ({
    amountSen: 100,
    method: "bank_transfer",
    receivedAt: "2026-10-01T09:00:00+08:00",
    slipPath,
  });
  check(
    "slip in other org's folder -> 400",
    (await pay(staff.token, bt(`${betaOrg}/x.pdf`), probeLease)).status === 400,
  );
  check(
    "missing slip -> 400",
    (await pay(staff.token, bt(`${nwOrg}/does-not-exist.pdf`), probeLease))
      .status === 400,
  );
  await up(staff, `${nwOrg}/orphan.pdf`);
  check(
    "over cap with slip -> 422",
    (
      await pay(
        staff.token,
        { ...bt(`${nwOrg}/orphan.pdf`), amountSen: 999999999 },
        probeLease,
      )
    ).status === 422,
  );
  const orphanSigned = await staff.db.storage
    .from("payment-slips")
    .createSignedUrl(`${nwOrg}/orphan.pdf`, 60);
  check("failed recording removed the slip", orphanSigned.error !== null);
  const btOk = await pay(staff.token, bt(`${nwOrg}/e2e-slip.pdf`), probeLease);
  check(
    "bank transfer with slip -> 201",
    btOk.status === 201,
    JSON.stringify(btOk.json),
  );
  check(
    "slip reuse -> 400",
    (await pay(staff.token, bt(`${nwOrg}/e2e-slip.pdf`), probeLease)).status ===
      400,
  );
  const signedAfter = await staff.db.storage
    .from("payment-slips")
    .createSignedUrl(`${nwOrg}/e2e-slip.pdf`, 60);
  check("used slip kept after failed reuse", signedAfter.error === null);
  await api("POST", `/api/payments/${btOk.json.id}/reject`, manager.token, {
    reason: "test cleanup",
  });

  console.log("Data API");
  check(
    "anon reads nothing",
    (await anon.from("organizations").select("*")).error !== null,
  );
  const { data: aisyahLeases } = await aisyah.db.from("leases").select("id");
  check(
    "tenant sees only own lease",
    aisyahLeases.length === 1 && aisyahLeases[0].id === aisyahLease,
  );
  const { data: aisyahUnits } = await aisyah.db.from("units").select("name");
  check(
    "tenant sees only own unit",
    aisyahUnits.length === 1 && aisyahUnits[0].name === "A-12-3",
  );
  const { data: aisyahTenants } = await aisyah.db
    .from("tenants")
    .select("full_name");
  check("tenant sees only own tenant row", aisyahTenants.length === 1);
  check(
    "tenant sees no memberships",
    ((await aisyah.db.from("memberships").select("*")).data ?? []).length === 0,
  );
  check(
    "tenant sees no audit log",
    ((await aisyah.db.from("audit_log").select("*")).data ?? []).length === 0,
  );
  check(
    "staff sees no audit log",
    ((await staff.db.from("audit_log").select("*")).data ?? []).length === 0,
  );
  const phone = await aisyah.db
    .from("tenants")
    .update({ phone: "+60 12-345 6789" })
    .eq("user_id", aisyah.userId)
    .select("phone");
  check(
    "tenant updates own phone",
    phone.data?.[0]?.phone === "+60 12-345 6789",
    JSON.stringify(phone.error),
  );
  check(
    "tenant cannot update name",
    (
      await aisyah.db
        .from("tenants")
        .update({ full_name: "X" })
        .eq("user_id", aisyah.userId)
    ).error !== null,
  );
  const otherPhone = await aisyah.db
    .from("tenants")
    .update({ phone: "+60 11-111 1111" })
    .neq("user_id", aisyah.userId)
    .select("id");
  check(
    "tenant cannot update others' phone",
    (otherPhone.data ?? []).length === 0,
  );
  check(
    "staff cannot update phone",
    (
      (
        await staff.db
          .from("tenants")
          .update({ phone: "+60 11-111 1111" })
          .eq("org_id", nwOrg)
          .select("id")
      ).data ?? []
    ).length === 0,
  );
  check(
    "manager cannot insert payment",
    (
      await manager.db.from("payments").insert({
        org_id: nwOrg,
        lease_id: aisyahLease,
        amount_sen: 1,
        method: "cash",
        status: "approved",
        received_at: new Date().toISOString(),
      })
    ).error !== null,
  );
  check(
    "manager cannot delete audit",
    (await manager.db.from("audit_log").delete().gt("id", 0)).error !== null,
  );
  check(
    "beta manager sees no northwind leases",
    (
      (await betaManager.db.from("leases").select("id").eq("org_id", nwOrg))
        .data ?? []
    ).length === 0,
  );
  check(
    "rpc helper not exposed",
    (await manager.db.rpc("member_org_id")).error !== null,
  );

  console.log("CSRF (cookie-authenticated mutations)");
  {
    const SAME = new URL(APP).origin;
    const EVIL = "https://evil.example";
    const probeCookie = await cookieSession("probe@northwind.test");
    const staffCookie = await cookieSession("staff@northwind.test");
    const billsPath = `/api/leases/${probeLease}/gateway-bills`;
    const countBills = async () =>
      (
        await manager.db
          .from("gateway_bills")
          .select("id", { count: "exact", head: true })
          .eq("lease_id", probeLease)
      ).count;
    const countPayments = async () =>
      (
        await manager.db
          .from("payments")
          .select("id", { count: "exact", head: true })
          .eq("lease_id", probeLease)
      ).count;

    const billsBefore = await countBills();
    const valid = await browserApi("POST", billsPath, {
      cookie: probeCookie,
      origin: SAME,
      contentType: "application/json",
      body: "{}",
    });
    check(
      "same-origin JSON with cookie -> 201",
      valid.status === 201,
      JSON.stringify(valid.json),
    );
    check(
      "valid browser request created one bill",
      (await countBills()) === billsBefore + 1,
    );

    const crossOrigin = await browserApi("POST", billsPath, {
      cookie: probeCookie,
      origin: EVIL,
      contentType: "application/json",
      body: "{}",
    });
    check(
      "cross-origin with cookie -> 403 { error }",
      crossOrigin.status === 403 && typeof crossOrigin.json.error === "string",
      JSON.stringify(crossOrigin),
    );
    const otherPort = await browserApi("POST", billsPath, {
      cookie: probeCookie,
      origin: "http://localhost:4000",
      contentType: "application/json",
      body: "{}",
    });
    check("same-site other port with cookie -> 403", otherPort.status === 403);
    const noOrigin = await browserApi("POST", billsPath, {
      cookie: probeCookie,
      contentType: "application/json",
      body: "{}",
    });
    check("missing Origin with cookie -> 403", noOrigin.status === 403);
    const textPlain = await browserApi("POST", billsPath, {
      cookie: probeCookie,
      origin: SAME,
      contentType: "text/plain",
      body: "{}",
    });
    check("text/plain with cookie -> 403", textPlain.status === 403);
    const form = await browserApi("POST", billsPath, {
      cookie: probeCookie,
      origin: SAME,
      contentType: "application/x-www-form-urlencoded",
      body: "a=1",
    });
    check("form-encoded with cookie -> 403", form.status === 403);
    check(
      "refused requests created no bills",
      (await countBills()) === billsBefore + 1,
    );

    const paymentsBefore = await countPayments();
    const forgedPayment = await browserApi(
      "POST",
      `/api/leases/${probeLease}/payments`,
      {
        cookie: staffCookie,
        origin: EVIL,
        contentType: "text/plain",
        body: JSON.stringify({
          amountSen: 100,
          method: "cash",
          receivedAt: "2026-10-01T09:00:00+08:00",
        }),
      },
    );
    check(
      "cross-origin payment with staff cookie -> 403",
      forgedPayment.status === 403,
    );
    check(
      "no payment recorded by the forged request",
      (await countPayments()) === paymentsBefore,
    );
    const browserPayment = await browserApi(
      "POST",
      `/api/leases/${probeLease}/payments`,
      {
        cookie: staffCookie,
        origin: SAME,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({
          amountSen: 100,
          method: "cash",
          receivedAt: "2026-10-01T09:00:00+08:00",
        }),
      },
    );
    check(
      "same-origin payment with staff cookie -> 201",
      browserPayment.status === 201 &&
        browserPayment.json.status === "pending_verification",
      JSON.stringify(browserPayment.json),
    );

    const safeGet = await browserApi("GET", `/api/leases/${probeLease}`, {
      cookie: probeCookie,
      origin: EVIL,
    });
    check("GET with cookie is not affected -> 200", safeGet.status === 200);
    const anonymous = await browserApi("POST", billsPath, {
      origin: EVIL,
      contentType: "text/plain",
      body: "{}",
    });
    check("no session -> still 401", anonymous.status === 401);
    const badCookie = await browserApi("POST", billsPath, {
      cookie: "sb-127-auth-token=garbage",
      origin: EVIL,
      contentType: "application/json",
      body: "{}",
    });
    check("invalid cookie -> still 401", badCookie.status === 401);
    const bearerCrossOrigin = await browserApi("POST", billsPath, {
      token: probe.token,
      origin: EVIL,
    });
    check(
      "bearer token without Origin/JSON is not affected -> 201",
      bearerCrossOrigin.status === 201,
      JSON.stringify(bearerCrossOrigin.json),
    );
  }

  console.log("Gateway");
  check(
    "staff cannot create bill -> 403",
    (await api("POST", `/api/leases/${probeLease}/gateway-bills`, staff.token))
      .status === 403,
  );
  check(
    "other tenant -> 404",
    (await api("POST", `/api/leases/${probeLease}/gateway-bills`, aisyah.token))
      .status === 404,
  );
  check(
    "nothing due -> 422",
    (await api("POST", `/api/leases/${smallLease}/gateway-bills`, probe.token))
      .status === 422,
  );
  const bill = await api(
    "POST",
    `/api/leases/${probeLease}/gateway-bills`,
    probe.token,
  );
  check(
    "tenant creates bill -> 201",
    bill.status === 201 && /^bill_[0-9a-f]{32}$/.test(bill.json.billId),
    JSON.stringify(bill.json),
  );
  const { billId, amountSen } = bill.json;
  const paidFields = {
    id: billId,
    paid: "true",
    paid_amount: String(amountSen),
    paid_at: "2026-10-29 12:00:00 +0800",
    transaction_id: "TX-1",
    transaction_status: "completed",
  };
  const forged = signedWebhookBody(paidFields);
  forged.set("paid_amount", "1");
  check("forged -> 401", (await webhook(forged)).status === 401);
  const noSig = new URLSearchParams(paidFields);
  check("missing signature -> 401", (await webhook(noSig)).status === 401);
  check(
    "unknown bill -> 404",
    (
      await webhook(
        signedWebhookBody({ ...paidFields, id: "bill_" + "0".repeat(32) }),
      )
    ).status === 404,
  );
  check(
    "wrong amount -> 422",
    (
      await webhook(
        signedWebhookBody({
          ...paidFields,
          paid_amount: String(amountSen - 1),
        }),
      )
    ).status === 422,
  );
  check(
    "extra fields are signed too",
    (
      await webhook(
        signedWebhookBody({ ...paidFields, paid_amount: "1", extra: "x" }),
      )
    ).status === 422,
  );
  const deliveries = await Promise.all(
    Array.from({ length: 6 }, () => webhook(signedWebhookBody(paidFields))),
  );
  check(
    "6 concurrent deliveries -> all 200",
    deliveries.every((d) => d.status === 200),
    statuses(deliveries),
  );
  const { data: billPayments } = await manager.db
    .from("payments")
    .select("id, received_at, status, method")
    .eq("gateway_bill_id", billId);
  check("exactly one payment", billPayments.length === 1);
  check(
    "received_at = paid_at",
    billPayments[0] &&
      new Date(billPayments[0].received_at).toISOString() ===
        "2026-10-29T04:00:00.000Z",
  );
  check(
    "late paid=false -> 200",
    (
      await webhook(
        signedWebhookBody({ ...paidFields, paid: "false", paid_amount: "0" }),
      )
    ).status === 200,
  );
  const { data: billRow } = await probe.db
    .from("gateway_bills")
    .select("status")
    .eq("id", billId);
  check("paid bill stays paid", billRow[0]?.status === "paid");
  check("tenant sees own bill only via RLS", billRow.length === 1);

  const bill2 = await api(
    "POST",
    `/api/leases/${aisyahLease}/gateway-bills`,
    aisyah.token,
  );
  const failFields = {
    id: bill2.json.billId,
    paid: "false",
    paid_amount: "0",
    paid_at: "2026-10-29 12:00:00 +0800",
    transaction_id: "TX-2",
    transaction_status: "failed",
  };
  check(
    "paid=false -> 200",
    (await webhook(signedWebhookBody(failFields))).status === 200,
  );
  check(
    "repeat paid=false -> 200",
    (await webhook(signedWebhookBody(failFields))).status === 200,
  );
  const { data: failedRow } = await aisyah.db
    .from("gateway_bills")
    .select("status")
    .eq("id", bill2.json.billId);
  check("bill failed", failedRow[0]?.status === "failed");
  check(
    "failed bill can still be paid",
    (
      await webhook(
        signedWebhookBody({
          ...failFields,
          paid: "true",
          paid_amount: String(bill2.json.amountSen),
          transaction_status: "completed",
        }),
      )
    ).status === 200,
  );
  const { data: failedThenPaid } = await aisyah.db
    .from("gateway_bills")
    .select("status")
    .eq("id", bill2.json.billId);
  check("failed -> paid", failedThenPaid[0]?.status === "paid");

  console.log(
    failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
