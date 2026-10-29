import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import {
  planAllocation,
  sortForAllocation,
  type AllocatableInvoice,
} from "@/lib/allocation";
import type { InvoiceKind } from "@/lib/billing";
import { dateToYmd } from "@/lib/dates";
import { senFromBigInt } from "@/lib/money";

export type Tx = Prisma.TransactionClient;

/** Interactive transaction options: room to wait for row locks under concurrent requests. */
export const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;

/**
 * Locks the lease row until the transaction ends. Every change to a lease's payments,
 * allocations or bills takes this lock first, so they run one at a time per lease.
 */
export async function lockLease(tx: Tx, leaseId: string): Promise<void> {
  await tx.$queryRaw`select id from public.leases where id = ${leaseId}::uuid for update`;
}

export interface LedgerInvoice extends AllocatableInvoice {
  periodStart: string | null;
  periodEnd: string | null;
}

/** The lease's invoices with their paid amounts (sum of allocations), in allocation order. */
export async function loadLedger(
  tx: Tx,
  leaseId: string,
): Promise<LedgerInvoice[]> {
  const invoices = await tx.invoice.findMany({
    where: { leaseId },
    include: { allocations: { select: { amountSen: true } } },
  });
  return sortForAllocation(
    invoices.map((invoice) => ({
      id: invoice.id,
      kind: invoice.kind as InvoiceKind,
      periodIndex: invoice.periodIndex,
      periodStart: invoice.periodStart ? dateToYmd(invoice.periodStart) : null,
      periodEnd: invoice.periodEnd ? dateToYmd(invoice.periodEnd) : null,
      dueDate: dateToYmd(invoice.dueDate),
      amountSen: senFromBigInt(invoice.amountSen),
      paidSen: invoice.allocations.reduce(
        (sum, a) => sum + senFromBigInt(a.amountSen),
        0,
      ),
    })),
  );
}

/** Total of the lease's payments still waiting for a manager. */
export async function pendingSen(tx: Tx, leaseId: string): Promise<number> {
  const { _sum } = await tx.payment.aggregate({
    where: { leaseId, status: "pending_verification" },
    _sum: { amountSen: true },
  });
  return senFromBigInt(_sum.amountSen ?? BigInt(0));
}

/**
 * Allocates an approved payment to the lease's unpaid invoices and stores the rest as
 * unapplied_sen. The caller must hold the lease lock.
 */
export async function allocatePayment(
  tx: Tx,
  payment: { id: string; orgId: string; leaseId: string; amountSen: number },
): Promise<{
  allocations: { invoiceId: string; amountSen: number }[];
  unappliedSen: number;
}> {
  const plan = planAllocation(
    await loadLedger(tx, payment.leaseId),
    payment.amountSen,
  );
  if (plan.allocations.length > 0) {
    await tx.paymentAllocation.createMany({
      data: plan.allocations.map((a) => ({
        orgId: payment.orgId,
        leaseId: payment.leaseId,
        paymentId: payment.id,
        invoiceId: a.invoiceId,
        amountSen: BigInt(a.amountSen),
      })),
    });
  }
  await tx.payment.update({
    where: { id: payment.id },
    data: { unappliedSen: BigInt(plan.unappliedSen) },
  });
  return plan;
}

export async function writeAudit(
  tx: Tx,
  entry: {
    orgId: string;
    actorId: string | null;
    action: string;
    entityId: string;
    details?: Prisma.InputJsonObject;
  },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      orgId: entry.orgId,
      actorId: entry.actorId,
      action: entry.action,
      entityId: entry.entityId,
      details: entry.details ?? {},
    },
  });
}
