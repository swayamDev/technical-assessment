import "server-only";
import { remainingBalanceSen } from "@/lib/allocation";
import {
  requireManager,
  requireMember,
  type Actor,
  type MemberActor,
} from "@/lib/auth";
import { parseInstant } from "@/lib/dates";
import { badRequest, conflict, unprocessable } from "@/lib/http";
import { formatSen, senFromBigInt } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { createAdminClient } from "@/lib/supabase/admin";
import { PAYMENT_SLIPS_BUCKET } from "@/lib/supabase/env";
import { findVisibleLease, findVisiblePayment } from "./access";
import {
  allocatePayment,
  loadLedger,
  lockLease,
  pendingSen,
  TX_OPTIONS,
  writeAudit,
  type Tx,
} from "./ledger";

export type PaymentStatus =
  "pending_verification" | "approved" | "rejected" | "voided";

export interface RecordPaymentInput {
  amountSen: number;
  method: "cash" | "bank_transfer";
  receivedAt: Date;
  slipPath: string | null;
}

export function parseRecordPaymentInput(
  body: Record<string, unknown>,
): RecordPaymentInput {
  const { amountSen, method, receivedAt, slipPath } = body;
  if (
    typeof amountSen !== "number" ||
    !Number.isSafeInteger(amountSen) ||
    amountSen <= 0
  ) {
    throw badRequest("amountSen must be a positive integer in sen");
  }
  if (method !== "cash" && method !== "bank_transfer") {
    throw badRequest("method must be 'cash' or 'bank_transfer'");
  }
  const received = parseInstant(receivedAt);
  if (!received)
    throw badRequest(
      "receivedAt must be an ISO 8601 date and time with an offset",
    );
  if (method === "bank_transfer") {
    if (typeof slipPath !== "string" || slipPath.length === 0)
      throw badRequest("A bank transfer needs a slip");
    return { amountSen, method, receivedAt: received, slipPath };
  }
  if (slipPath !== undefined && slipPath !== null)
    throw badRequest("Only bank transfers have a slip");
  return { amountSen, method, receivedAt: received, slipPath: null };
}

export function parseReason(body: Record<string, unknown>): string {
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if ([...reason].length < 5)
    throw badRequest("A reason of at least 5 characters is required");
  return reason;
}

/** Holds a per-slip lock until the transaction ends (serializes recording vs. cleanup). */
async function lockSlip(tx: Tx, slipPath: string): Promise<void> {
  await tx.$executeRaw`select pg_advisory_xact_lock(hashtextextended(${`slip:${slipPath}`}, 0))`;
}

/** True if the slip is an uploaded file in this organization's folder. */
async function slipExists(
  tx: Tx,
  orgId: string,
  slipPath: string,
): Promise<boolean> {
  if (!slipPath.startsWith(`${orgId}/`) || slipPath.includes(".."))
    return false;
  const rows = await tx.$queryRaw<{ found: number }[]>`
    select 1 as found from storage.objects where bucket_id = ${PAYMENT_SLIPS_BUCKET} and name = ${slipPath}`;
  return rows.length > 0;
}

/** POST /api/leases/:leaseId/payments - staff (pending) and managers (approved immediately). */
export async function recordPayment(
  actor: Actor,
  leaseId: string,
  body: Record<string, unknown>,
): Promise<{ id: string; status: PaymentStatus }> {
  const slipCandidate =
    typeof body.slipPath === "string" ? body.slipPath : null;

  try {
    const lease = await findVisibleLease(actor, leaseId);
    const member = requireMember(actor);
    const input = parseRecordPaymentInput(body);
    return await prisma.$transaction(async (tx) => {
      await lockLease(tx, lease.id);
      if (input.slipPath) {
        await lockSlip(tx, input.slipPath);
        if (!(await slipExists(tx, member.orgId, input.slipPath))) {
          throw badRequest(
            "slipPath must point to an uploaded slip in your organization's folder",
          );
        }
        const used = await tx.payment.findUnique({
          where: { slipPath: input.slipPath },
          select: { id: true },
        });
        if (used)
          throw badRequest("This slip is already attached to another payment");
      }

      // Cap: remaining balance minus the payments still waiting for approval.
      const cap =
        remainingBalanceSen(await loadLedger(tx, lease.id)) -
        (await pendingSen(tx, lease.id));
      if (input.amountSen > cap) {
        throw unprocessable(
          `The amount is more than the ${formatSen(Math.max(cap, 0))} that can still be paid`,
        );
      }

      const approved = member.role === "manager";
      const status: PaymentStatus = approved
        ? "approved"
        : "pending_verification";
      const payment = await tx.payment.create({
        data: {
          orgId: lease.orgId,
          leaseId: lease.id,
          amountSen: BigInt(input.amountSen),
          method: input.method,
          status,
          receivedAt: input.receivedAt,
          slipPath: input.slipPath,
          recordedBy: member.userId,
          ...(approved
            ? { approvedBy: member.userId, approvedAt: new Date() }
            : {}),
        },
      });
      const details = {
        leaseId: lease.id,
        amountSen: input.amountSen,
        method: input.method,
        status,
      };
      await writeAudit(tx, {
        orgId: lease.orgId,
        actorId: member.userId,
        action: "payment.recorded",
        entityId: payment.id,
        details,
      });
      if (approved) {
        const plan = await allocatePayment(tx, {
          id: payment.id,
          orgId: lease.orgId,
          leaseId: lease.id,
          amountSen: input.amountSen,
        });
        await writeAudit(tx, {
          orgId: lease.orgId,
          actorId: member.userId,
          action: "payment.approved",
          entityId: payment.id,
          details: {
            ...details,
            allocations: plan.allocations,
            unappliedSen: plan.unappliedSen,
          },
        });
      }
      return { id: payment.id, status };
    }, TX_OPTIONS);
  } catch (error) {
    if (slipCandidate && actor.kind === "member")
      await removeOrphanedSlip(actor, slipCandidate);
    throw error;
  }
}

/**
 * Recording failed after the slip was uploaded: delete the file unless a payment uses it.
 * Only touches the caller's own organization's folder.
 */
export async function removeOrphanedSlip(
  member: MemberActor,
  slipPath: string,
): Promise<void> {
  if (!slipPath.startsWith(`${member.orgId}/`) || slipPath.includes(".."))
    return;
  try {
    await prisma.$transaction(async (tx) => {
      await lockSlip(tx, slipPath);
      const used = await tx.payment.findUnique({
        where: { slipPath },
        select: { id: true },
      });
      if (used) return;
      const { error } = await createAdminClient()
        .storage.from(PAYMENT_SLIPS_BUCKET)
        .remove([slipPath]);
      if (error)
        console.error("Could not remove orphaned slip:", error.message);
    }, TX_OPTIONS);
  } catch (error) {
    console.error(
      "Could not remove orphaned slip:",
      error instanceof Error ? error.message : "unknown",
    );
  }
}

/** POST /api/payments/:paymentId/approve - managers only. */
export async function approvePayment(
  actor: Actor,
  paymentId: string,
): Promise<{ status: PaymentStatus }> {
  const found = await findVisiblePayment(actor, paymentId);
  const manager = requireManager(actor);
  return prisma.$transaction(async (tx) => {
    await lockLease(tx, found.leaseId);
    // Re-read under the lease lock: a concurrent approval may have just committed.
    const payment = await tx.payment.findUniqueOrThrow({
      where: { id: found.id },
    });
    if (payment.status !== "pending_verification")
      throw conflict("Only a pending payment can be approved");

    const amountSen = senFromBigInt(payment.amountSen);
    const remaining = remainingBalanceSen(
      await loadLedger(tx, payment.leaseId),
    );
    if (amountSen > remaining) {
      throw unprocessable(
        `The amount is more than the lease's remaining balance of ${formatSen(remaining)}`,
      );
    }

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: "approved",
        approvedBy: manager.userId,
        approvedAt: new Date(),
      },
    });
    const plan = await allocatePayment(tx, {
      id: payment.id,
      orgId: payment.orgId,
      leaseId: payment.leaseId,
      amountSen,
    });
    await writeAudit(tx, {
      orgId: payment.orgId,
      actorId: manager.userId,
      action: "payment.approved",
      entityId: payment.id,
      details: {
        leaseId: payment.leaseId,
        amountSen,
        allocations: plan.allocations,
        unappliedSen: plan.unappliedSen,
      },
    });
    return { status: "approved" as const };
  }, TX_OPTIONS);
}

/** POST /api/payments/:paymentId/reject - managers only, pending payments, with a reason. */
export async function rejectPayment(
  actor: Actor,
  paymentId: string,
  body: Record<string, unknown>,
): Promise<{ status: PaymentStatus }> {
  const found = await findVisiblePayment(actor, paymentId);
  const manager = requireManager(actor);
  const reason = parseReason(body);
  return prisma.$transaction(async (tx) => {
    await lockLease(tx, found.leaseId);
    const payment = await tx.payment.findUniqueOrThrow({
      where: { id: found.id },
    });
    if (payment.status !== "pending_verification")
      throw conflict("Only a pending payment can be rejected");

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: "rejected",
        rejectedBy: manager.userId,
        rejectedAt: new Date(),
        rejectionReason: reason,
      },
    });
    await writeAudit(tx, {
      orgId: payment.orgId,
      actorId: manager.userId,
      action: "payment.rejected",
      entityId: payment.id,
      details: {
        leaseId: payment.leaseId,
        amountSen: senFromBigInt(payment.amountSen),
        reason,
      },
    });
    return { status: "rejected" as const };
  }, TX_OPTIONS);
}

/** POST /api/payments/:paymentId/void - managers only, approved payments, with a reason. */
export async function voidPayment(
  actor: Actor,
  paymentId: string,
  body: Record<string, unknown>,
): Promise<{ status: PaymentStatus }> {
  const found = await findVisiblePayment(actor, paymentId);
  const manager = requireManager(actor);
  const reason = parseReason(body);
  return prisma.$transaction(async (tx) => {
    await lockLease(tx, found.leaseId);
    const payment = await tx.payment.findUniqueOrThrow({
      where: { id: found.id },
    });
    if (payment.status !== "approved")
      throw conflict("Only an approved payment can be voided");

    // Only this payment's allocations are removed; other payments' allocations do not change.
    const removed = await tx.paymentAllocation.findMany({
      where: { paymentId: payment.id },
    });
    await tx.paymentAllocation.deleteMany({ where: { paymentId: payment.id } });
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: "voided",
        voidedBy: manager.userId,
        voidedAt: new Date(),
        voidReason: reason,
      },
    });
    await writeAudit(tx, {
      orgId: payment.orgId,
      actorId: manager.userId,
      action: "payment.voided",
      entityId: payment.id,
      details: {
        leaseId: payment.leaseId,
        amountSen: senFromBigInt(payment.amountSen),
        reason,
        removedAllocations: removed.map((a) => ({
          invoiceId: a.invoiceId,
          amountSen: senFromBigInt(a.amountSen),
        })),
      },
    });
    return { status: "voided" as const };
  }, TX_OPTIONS);
}
