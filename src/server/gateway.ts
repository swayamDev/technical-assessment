import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/lib/auth";
import { malaysiaDate } from "@/lib/billing";
import { parseGatewayTimestamp } from "@/lib/dates";
import { forbidden, unprocessable } from "@/lib/http";
import { senFromBigInt } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { findVisibleLease } from "./access";
import {
  allocatePayment,
  loadLedger,
  lockLease,
  TX_OPTIONS,
  writeAudit,
} from "./ledger";

/** POST /api/leases/:leaseId/gateway-bills - the lease's tenant only. Bills the amount due now. */
export async function createGatewayBill(
  actor: Actor,
  leaseId: string,
  now: Date = new Date(),
): Promise<{ billId: string; amountSen: number }> {
  const lease = await findVisibleLease(actor, leaseId);
  if (actor.kind !== "tenant") throw forbidden();

  return prisma.$transaction(async (tx) => {
    await lockLease(tx, lease.id);
    const today = malaysiaDate(now);
    const amountSen = (await loadLedger(tx, lease.id))
      .filter((i) => i.dueDate <= today)
      .reduce((sum, i) => sum + Math.max(0, i.amountSen - i.paidSen), 0);
    if (amountSen <= 0) throw unprocessable("Nothing is due right now");

    // 128 random bits: bill ids cannot be guessed.
    const billId = `bill_${randomBytes(16).toString("hex")}`;
    await tx.gatewayBill.create({
      data: {
        id: billId,
        orgId: lease.orgId,
        leaseId: lease.id,
        amountSen: BigInt(amountSen),
        createdBy: actor.userId,
      },
    });
    await writeAudit(tx, {
      orgId: lease.orgId,
      actorId: actor.userId,
      action: "gateway_bill.created",
      entityId: billId,
      details: { leaseId: lease.id, amountSen },
    });
    return { billId, amountSen };
  }, TX_OPTIONS);
}

/** source = each field except x_signature, sorted by key, as key+value, joined with '|'. */
export function gatewaySignatureSource(fields: Record<string, string>): string {
  return Object.keys(fields)
    .filter((key) => key !== "x_signature")
    .sort()
    .map((key) => `${key}${fields[key]}`)
    .join("|");
}

export function signGatewayFields(
  fields: Record<string, string>,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(gatewaySignatureSource(fields))
    .digest("hex");
}

function signatureMatches(
  fields: Record<string, string>,
  secret: string,
): boolean {
  const given = fields.x_signature;
  if (typeof given !== "string" || !/^[0-9a-f]{64}$/.test(given)) return false;
  const expected = Buffer.from(signGatewayFields(fields, secret), "hex");
  return timingSafeEqual(expected, Buffer.from(given, "hex"));
}

export interface WebhookResult {
  status: 200 | 400 | 401 | 404 | 422;
  body: Record<string, unknown>;
}

const ok = (result: string): WebhookResult => ({
  status: 200,
  body: { ok: true, result },
});
const fail = (
  status: WebhookResult["status"],
  error: string,
): WebhookResult => ({ status, body: { error } });

/**
 * POST /api/webhooks/gateway. Only this settles a bill. Safe to receive the same callback
 * many times, concurrently or out of order: a bill creates at most one payment, ever.
 */
export async function handleGatewayCallback(
  rawBody: string,
): Promise<WebhookResult> {
  const secret = process.env.GATEWAY_X_SIGNATURE_KEY;
  if (!secret) throw new Error("GATEWAY_X_SIGNATURE_KEY is not set");

  const params = new URLSearchParams(rawBody);
  const fields: Record<string, string> = {};
  for (const [key, value] of params) {
    // A repeated field makes the signed source ambiguous: treat it as an invalid signature.
    if (Object.hasOwn(fields, key)) return fail(401, "Invalid signature");
    fields[key] = value;
  }
  if (!signatureMatches(fields, secret)) return fail(401, "Invalid signature");

  const bill = fields.id
    ? await prisma.gatewayBill.findUnique({ where: { id: fields.id } })
    : null;
  if (!bill) return fail(404, "Unknown bill");

  if (fields.paid === "true") {
    if (
      !/^\d+$/.test(fields.paid_amount ?? "") ||
      BigInt(fields.paid_amount) !== bill.amountSen
    ) {
      return fail(422, "paid_amount does not match the bill");
    }
    const paidAt = parseGatewayTimestamp(fields.paid_at);
    if (!paidAt) return fail(400, "paid_at is not a valid timestamp");
    try {
      return await settlePaidBill(
        bill.id,
        bill.leaseId,
        paidAt,
        fields.transaction_id ?? null,
      );
    } catch (error) {
      // Backstop: payments.gateway_bill_id is UNIQUE, so a racing duplicate cannot create a second payment.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        return ok("already_paid");
      throw error;
    }
  }
  if (fields.paid === "false") return markBillFailed(bill.id, bill.leaseId);
  return fail(400, "paid must be 'true' or 'false'");
}

async function settlePaidBill(
  billId: string,
  leaseId: string,
  paidAt: Date,
  transactionId: string | null,
): Promise<WebhookResult> {
  return prisma.$transaction(async (tx) => {
    // The lease lock serializes this with duplicate deliveries and with manual payments.
    await lockLease(tx, leaseId);
    const bill = await tx.gatewayBill.findUniqueOrThrow({
      where: { id: billId },
    });
    if (bill.status === "paid") return ok("already_paid");

    await tx.gatewayBill.update({
      where: { id: bill.id },
      data: { status: "paid", paidAt, transactionId, updatedAt: new Date() },
    });
    const amountSen = senFromBigInt(bill.amountSen);
    const payment = await tx.payment.create({
      data: {
        orgId: bill.orgId,
        leaseId: bill.leaseId,
        amountSen: bill.amountSen,
        method: "online",
        status: "approved",
        receivedAt: paidAt,
        gatewayBillId: bill.id,
        approvedAt: new Date(),
      },
    });
    const plan = await allocatePayment(tx, {
      id: payment.id,
      orgId: bill.orgId,
      leaseId: bill.leaseId,
      amountSen,
    });
    await writeAudit(tx, {
      orgId: bill.orgId,
      actorId: null,
      action: "payment.approved",
      entityId: payment.id,
      details: {
        source: "gateway",
        billId: bill.id,
        transactionId,
        leaseId: bill.leaseId,
        amountSen,
        allocations: plan.allocations,
        unappliedSen: plan.unappliedSen,
      },
    });
    return ok("paid");
  }, TX_OPTIONS);
}

async function markBillFailed(
  billId: string,
  leaseId: string,
): Promise<WebhookResult> {
  return prisma.$transaction(async (tx) => {
    await lockLease(tx, leaseId);
    const bill = await tx.gatewayBill.findUniqueOrThrow({
      where: { id: billId },
    });
    // A paid bill never goes back; a failed one stays failed.
    if (bill.status !== "pending") return ok(`already_${bill.status}`);
    await tx.gatewayBill.update({
      where: { id: bill.id },
      data: { status: "failed", updatedAt: new Date() },
    });
    await writeAudit(tx, {
      orgId: bill.orgId,
      actorId: null,
      action: "gateway_bill.failed",
      entityId: bill.id,
      details: { leaseId: bill.leaseId },
    });
    return ok("failed");
  }, TX_OPTIONS);
}
