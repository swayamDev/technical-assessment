// Pure allocation rules: which invoices a payment pays, and how much is left over.

import type { InvoiceKind } from "./billing";

export interface AllocatableInvoice {
  id: string;
  kind: InvoiceKind;
  periodIndex: number | null;
  dueDate: string; // 'YYYY-MM-DD'
  amountSen: number;
  paidSen: number;
}

export interface AllocationPlan {
  allocations: { invoiceId: string; amountSen: number }[];
  unappliedSen: number;
}

/** Allocation order: due date, then deposit before rent, then period index. */
export function compareForAllocation(
  a: AllocatableInvoice,
  b: AllocatableInvoice,
): number {
  if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
  if (a.kind !== b.kind) return a.kind === "deposit" ? -1 : 1;
  return (a.periodIndex ?? -1) - (b.periodIndex ?? -1);
}

export function sortForAllocation<T extends AllocatableInvoice>(
  invoices: readonly T[],
): T[] {
  return [...invoices].sort(compareForAllocation);
}

/** Fills each invoice up to its unpaid amount, in allocation order, including invoices not yet due. */
export function planAllocation(
  invoices: readonly AllocatableInvoice[],
  paymentSen: number,
): AllocationPlan {
  if (!Number.isSafeInteger(paymentSen) || paymentSen <= 0) {
    throw new Error("paymentSen must be a positive integer");
  }
  let remaining = paymentSen;
  const allocations: AllocationPlan["allocations"] = [];
  for (const invoice of sortForAllocation(invoices)) {
    if (remaining === 0) break;
    const unpaid = invoice.amountSen - invoice.paidSen;
    if (unpaid <= 0) continue;
    const amountSen = Math.min(unpaid, remaining);
    allocations.push({ invoiceId: invoice.id, amountSen });
    remaining -= amountSen;
  }
  return { allocations, unappliedSen: remaining };
}

/** Total of all invoices minus everything allocated to them. */
export function remainingBalanceSen(
  invoices: readonly Pick<AllocatableInvoice, "amountSen" | "paidSen">[],
): number {
  return invoices.reduce(
    (sum, i) => sum + Math.max(0, i.amountSen - i.paidSen),
    0,
  );
}
