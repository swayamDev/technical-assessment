import "server-only";
import {
  generateSchedule,
  invoiceStatus,
  type InvoiceKind,
  type InvoiceStatus,
} from "@/lib/billing";
import { requireManager, type Actor } from "@/lib/auth";
import { dateToYmd, ymdToDate } from "@/lib/dates";
import { badRequest, conflict, isUuid, notFound } from "@/lib/http";
import { senFromBigInt } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { findVisibleLease } from "./access";
import { loadLedger, TX_OPTIONS, writeAudit } from "./ledger";

export interface CreateLeaseInput {
  unitId: string;
  tenantId: string;
  startDate: string;
  endDate: string;
  monthlyRentSen: number;
  depositSen: number;
}

export function parseCreateLeaseInput(
  body: Record<string, unknown>,
): CreateLeaseInput {
  const { unitId, tenantId, startDate, endDate, monthlyRentSen, depositSen } =
    body;
  if (!isUuid(unitId)) throw badRequest("unitId must be a unit id");
  if (!isUuid(tenantId)) throw badRequest("tenantId must be a tenant id");
  if (typeof startDate !== "string" || typeof endDate !== "string") {
    throw badRequest(
      "startDate and endDate must be dates written as YYYY-MM-DD",
    );
  }
  if (typeof monthlyRentSen !== "number" || typeof depositSen !== "number") {
    throw badRequest("monthlyRentSen and depositSen must be integers in sen");
  }
  const input = {
    unitId,
    tenantId,
    startDate,
    endDate,
    monthlyRentSen,
    depositSen,
  };
  try {
    generateSchedule(input); // validates dates and amounts with the billing rules
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : "Invalid lease");
  }
  return input;
}

/** Creates a lease and exactly the invoices generateSchedule returns, all or nothing. Managers only. */
export async function createLease(
  actor: Actor,
  input: CreateLeaseInput,
): Promise<{ id: string }> {
  const manager = requireManager(actor);
  const schedule = generateSchedule(input);

  try {
    return await prisma.$transaction(async (tx) => {
      // Ids in the body are untrusted: the unit and tenant must be in the manager's organization.
      const unit = await tx.unit.findFirst({
        where: { id: input.unitId, orgId: manager.orgId },
      });
      if (!unit) throw notFound("Unit");
      const tenant = await tx.tenant.findFirst({
        where: { id: input.tenantId, orgId: manager.orgId },
      });
      if (!tenant) throw notFound("Tenant");

      // Serialize lease creation per unit so the overlap check below is reliable; the
      // leases_no_overlap exclusion constraint is the database-level backstop.
      await tx.$queryRaw`select id from public.units where id = ${unit.id}::uuid for update`;
      const overlapping = await tx.lease.findFirst({
        where: {
          unitId: unit.id,
          startDate: { lte: ymdToDate(input.endDate) },
          endDate: { gte: ymdToDate(input.startDate) },
        },
        select: { id: true },
      });
      if (overlapping)
        throw conflict("The unit already has a lease overlapping these dates");

      const lease = await tx.lease.create({
        data: {
          orgId: manager.orgId,
          unitId: unit.id,
          tenantId: tenant.id,
          startDate: ymdToDate(input.startDate),
          endDate: ymdToDate(input.endDate),
          monthlyRentSen: BigInt(input.monthlyRentSen),
          depositSen: BigInt(input.depositSen),
          createdBy: manager.userId,
        },
      });
      await tx.invoice.createMany({
        data: schedule.map((s) => ({
          orgId: manager.orgId,
          leaseId: lease.id,
          kind: s.kind,
          periodIndex: s.periodIndex,
          periodStart: s.periodStart ? ymdToDate(s.periodStart) : null,
          periodEnd: s.periodEnd ? ymdToDate(s.periodEnd) : null,
          dueDate: ymdToDate(s.dueDate),
          amountSen: BigInt(s.amountSen),
        })),
      });
      await writeAudit(tx, {
        orgId: manager.orgId,
        actorId: manager.userId,
        action: "lease.created",
        entityId: lease.id,
        details: { ...input, invoiceCount: schedule.length },
      });
      return { id: lease.id };
    }, TX_OPTIONS);
  } catch (error) {
    if (isExclusionViolation(error))
      throw conflict("The unit already has a lease overlapping these dates");
    throw error;
  }
}

function isExclusionViolation(error: unknown): boolean {
  const text =
    error instanceof Error ? `${error.message} ${JSON.stringify(error)}` : "";
  return text.includes("leases_no_overlap") || text.includes("23P01");
}

export interface LeaseDetail {
  lease: {
    id: string;
    unitId: string;
    tenantId: string;
    startDate: string;
    endDate: string;
    monthlyRentSen: number;
    depositSen: number;
  };
  invoices: {
    id: string;
    kind: InvoiceKind;
    periodIndex: number | null;
    periodStart: string | null;
    periodEnd: string | null;
    dueDate: string;
    amountSen: number;
    paidSen: number;
    status: InvoiceStatus;
  }[];
  payments: {
    id: string;
    amountSen: number;
    unappliedSen: number;
    method: "cash" | "bank_transfer" | "online";
    status: "pending_verification" | "approved" | "rejected" | "voided";
    receivedAt: string;
  }[];
}

/** GET /api/leases/:leaseId - staff and managers of the organization, and the lease's tenant. */
export async function getLeaseDetail(
  actor: Actor,
  leaseId: string,
  now: Date = new Date(),
): Promise<LeaseDetail> {
  const lease = await findVisibleLease(actor, leaseId);
  const [ledger, payments] = await prisma.$transaction(
    async (tx) => [
      await loadLedger(tx, lease.id),
      await tx.payment.findMany({
        where: { leaseId: lease.id },
        orderBy: [{ receivedAt: "asc" }, { createdAt: "asc" }],
      }),
    ],
    TX_OPTIONS,
  );

  return {
    lease: {
      id: lease.id,
      unitId: lease.unitId,
      tenantId: lease.tenantId,
      startDate: dateToYmd(lease.startDate),
      endDate: dateToYmd(lease.endDate),
      monthlyRentSen: senFromBigInt(lease.monthlyRentSen),
      depositSen: senFromBigInt(lease.depositSen),
    },
    invoices: ledger.map((i) => ({
      id: i.id,
      kind: i.kind,
      periodIndex: i.periodIndex,
      periodStart: i.periodStart,
      periodEnd: i.periodEnd,
      dueDate: i.dueDate,
      amountSen: i.amountSen,
      paidSen: i.paidSen,
      status: invoiceStatus(i, now),
    })),
    payments: payments.map((p) => ({
      id: p.id,
      amountSen: senFromBigInt(p.amountSen),
      unappliedSen: senFromBigInt(p.unappliedSen),
      method: p.method as LeaseDetail["payments"][number]["method"],
      status: p.status as LeaseDetail["payments"][number]["status"],
      receivedAt: p.receivedAt.toISOString(),
    })),
  };
}
