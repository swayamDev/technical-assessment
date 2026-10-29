import "server-only";
import type { Actor } from "@/lib/auth";
import { isUuid, notFound } from "@/lib/http";
import { prisma } from "@/lib/prisma";

// Visibility checks. A record the caller may not see is reported as 404, whether it
// does not exist or belongs to another organization or tenant.

export async function findVisibleLease(actor: Actor, leaseId: string) {
  if (!isUuid(leaseId)) throw notFound("Lease");
  const lease = await prisma.lease.findUnique({ where: { id: leaseId } });
  if (!lease || !canSeeLease(actor, lease)) throw notFound("Lease");
  return lease;
}

export async function findVisiblePayment(actor: Actor, paymentId: string) {
  if (!isUuid(paymentId)) throw notFound("Payment");
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { lease: { select: { tenantId: true } } },
  });
  if (
    !payment ||
    !canSeeLease(actor, {
      orgId: payment.orgId,
      tenantId: payment.lease.tenantId,
    })
  ) {
    throw notFound("Payment");
  }
  return payment;
}

function canSeeLease(
  actor: Actor,
  lease: { orgId: string; tenantId: string },
): boolean {
  if (actor.kind === "member") return lease.orgId === actor.orgId;
  if (actor.kind === "tenant") return lease.tenantId === actor.tenantId;
  return false;
}
