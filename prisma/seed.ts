// npm run seed - creates the assessment's seed data on a freshly reset database.
// Accounts go through the Supabase Auth admin API; leases and payments go through the
// app's own services (createLease, recordPayment, approvePayment), so the invoices and
// allocations are exactly the ones the app would produce.

import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

export const SEED_PASSWORD = "RentDemo#2026";

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const { prisma } = await import("@/lib/prisma");
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { PAYMENT_SLIPS_BUCKET, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } =
    await import("@/lib/supabase/env");
  const { resolveActor } = await import("@/lib/auth");
  const { createLease } = await import("@/server/leases");
  const { approvePayment, recordPayment } = await import("@/server/payments");

  if ((await prisma.organization.count()) > 0) {
    throw new Error(
      "The database already has data. Run `npx supabase db reset` first, then `npm run seed`.",
    );
  }

  const admin = createAdminClient();

  async function createUser(email: string): Promise<string> {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: SEED_PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user)
      throw new Error(
        `Could not create ${email}: ${error?.message ?? "unknown error"}`,
      );
    return data.user.id;
  }

  async function actorFor(userId: string) {
    return resolveActor(userId);
  }

  // Organizations, staff and managers
  const northwind = await prisma.organization.create({
    data: { name: "Northwind Properties" },
  });
  const beta = await prisma.organization.create({
    data: { name: "Beta Realty" },
  });

  const nwManagerId = await createUser("manager@northwind.test");
  const nwStaffId = await createUser("staff@northwind.test");
  const betaManagerId = await createUser("manager@beta.test");
  await prisma.membership.createMany({
    data: [
      { userId: nwManagerId, orgId: northwind.id, role: "manager" },
      { userId: nwStaffId, orgId: northwind.id, role: "staff" },
      { userId: betaManagerId, orgId: beta.id, role: "manager" },
    ],
  });

  // Tenants
  async function createTenant(orgId: string, email: string, fullName: string) {
    const userId = await createUser(email);
    return prisma.tenant.create({ data: { orgId, userId, fullName, email } });
  }
  const aisyah = await createTenant(
    northwind.id,
    "aisyah@northwind.test",
    "Aisyah Rahman",
  );
  const ben = await createTenant(northwind.id, "ben@northwind.test", "Ben Lim");
  const probe = await createTenant(
    northwind.id,
    "probe@northwind.test",
    "Probe Tenant",
  );
  const chen = await createTenant(beta.id, "chen@beta.test", "Chen Wei");

  // Units
  const unit = (orgId: string, name: string) =>
    prisma.unit.create({ data: { orgId, name } });
  const a123 = await unit(northwind.id, "A-12-3");
  const b051 = await unit(northwind.id, "B-05-1");
  const c017 = await unit(northwind.id, "C-01-7");
  await unit(northwind.id, "D-03-2");
  const kl1 = await unit(beta.id, "KL-1");

  // Leases, through the app's lease creation
  const nwManager = await actorFor(nwManagerId);
  const betaManager = await actorFor(betaManagerId);
  const aisyahLease = await createLease(nwManager, {
    unitId: a123.id,
    tenantId: aisyah.id,
    startDate: "2026-01-31",
    endDate: "2026-07-15",
    monthlyRentSen: 150000,
    depositSen: 300000,
  });
  await createLease(nwManager, {
    unitId: b051.id,
    tenantId: ben.id,
    startDate: "2026-01-01",
    endDate: "2026-04-15",
    monthlyRentSen: 100029,
    depositSen: 0,
  });
  await createLease(nwManager, {
    unitId: c017.id,
    tenantId: probe.id,
    startDate: "2026-02-28",
    endDate: "2027-02-27",
    monthlyRentSen: 200000,
    depositSen: 400000,
  });
  await createLease(betaManager, {
    unitId: kl1.id,
    tenantId: chen.id,
    startDate: "2026-03-15",
    endDate: "2027-03-14",
    monthlyRentSen: 220000,
    depositSen: 440000,
  });

  // Payment 1: cash, recorded by the manager (approved immediately)
  await recordPayment(nwManager, aisyahLease.id, {
    amountSen: 300000,
    method: "cash",
    receivedAt: "2026-01-31T10:00:00+08:00",
  });

  // Payment 2: bank transfer with a slip, recorded by staff, then approved by the manager.
  // The slip is uploaded with the staff member's own session, as the app does.
  const staffClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await staffClient.auth.signInWithPassword({
    email: "staff@northwind.test",
    password: SEED_PASSWORD,
  });
  if (signIn.error)
    throw new Error(`Staff sign-in failed: ${signIn.error.message}`);
  const slipPath = `${northwind.id}/seed-bank-transfer-slip.pdf`;
  const upload = await staffClient.storage
    .from(PAYMENT_SLIPS_BUCKET)
    .upload(slipPath, new Blob([MINIMAL_PDF], { type: "application/pdf" }), {
      contentType: "application/pdf",
    });
  if (upload.error)
    throw new Error(`Slip upload failed: ${upload.error.message}`);
  await staffClient.auth.signOut();

  const staff = await actorFor(nwStaffId);
  const transfer = await recordPayment(staff, aisyahLease.id, {
    amountSen: 200000,
    method: "bank_transfer",
    receivedAt: "2026-03-01T00:30:00+08:00",
    slipPath,
  });
  await approvePayment(nwManager, transfer.id);

  console.log("Seed complete.");
  console.log(`All seeded accounts use the password: ${SEED_PASSWORD}`);
  await prisma.$disconnect();
}

const MINIMAL_PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj
trailer<</Root 1 0 R>>
%%EOF
`;

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
