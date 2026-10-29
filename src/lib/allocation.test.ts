import { describe, expect, it } from "vitest";
import {
  planAllocation,
  remainingBalanceSen,
  sortForAllocation,
  type AllocatableInvoice,
} from "./allocation";
import { generateSchedule } from "./billing";

function invoicesFor(
  lease: Parameters<typeof generateSchedule>[0],
): AllocatableInvoice[] {
  return generateSchedule(lease).map((s) => ({
    id: s.kind === "deposit" ? "deposit" : `rent-${s.periodIndex}`,
    kind: s.kind,
    periodIndex: s.periodIndex,
    dueDate: s.dueDate,
    amountSen: s.amountSen,
    paidSen: 0,
  }));
}

const aisyah = invoicesFor({
  startDate: "2026-01-31",
  endDate: "2026-07-15",
  monthlyRentSen: 150000,
  depositSen: 300000,
});

describe("sortForAllocation", () => {
  it("orders by due date, then deposit before rent, then period index", () => {
    const shuffled = [aisyah[3], aisyah[1], aisyah[6], aisyah[0], aisyah[2]];
    expect(sortForAllocation(shuffled).map((i) => i.id)).toEqual([
      "deposit",
      "rent-0",
      "rent-1",
      "rent-2",
      "rent-5",
    ]);
  });
});

describe("planAllocation", () => {
  it("allocates the seeded payments on Aisyah's lease", () => {
    const first = planAllocation(aisyah, 300000);
    expect(first).toEqual({
      allocations: [{ invoiceId: "deposit", amountSen: 300000 }],
      unappliedSen: 0,
    });

    const afterFirst = aisyah.map((i) =>
      i.id === "deposit" ? { ...i, paidSen: 300000 } : i,
    );
    expect(planAllocation(afterFirst, 200000)).toEqual({
      allocations: [
        { invoiceId: "rent-0", amountSen: 150000 },
        { invoiceId: "rent-1", amountSen: 50000 },
      ],
      unappliedSen: 0,
    });
  });

  it("tops up partially paid invoices first and pays future invoices in advance", () => {
    const partly = aisyah.map((i) =>
      i.id === "deposit" ? { ...i, paidSen: 299999 } : i,
    );
    expect(planAllocation(partly, 150002).allocations).toEqual([
      { invoiceId: "deposit", amountSen: 1 },
      { invoiceId: "rent-0", amountSen: 150000 },
      { invoiceId: "rent-1", amountSen: 1 },
    ]);
  });

  it("stores whatever is left after every invoice is paid as unapplied", () => {
    const total = remainingBalanceSen(aisyah);
    expect(total).toBe(300000 + 5 * 150000 + 77419);
    const plan = planAllocation(aisyah, total + 500);
    expect(plan.unappliedSen).toBe(500);
    expect(plan.allocations.reduce((s, a) => s + a.amountSen, 0)).toBe(total);
  });

  it("skips fully paid invoices and zero-amount invoices", () => {
    const invoices: AllocatableInvoice[] = [
      {
        id: "a",
        kind: "rent",
        periodIndex: 0,
        dueDate: "2026-01-01",
        amountSen: 100,
        paidSen: 100,
      },
      {
        id: "b",
        kind: "rent",
        periodIndex: 1,
        dueDate: "2026-02-01",
        amountSen: 0,
        paidSen: 0,
      },
      {
        id: "c",
        kind: "rent",
        periodIndex: 2,
        dueDate: "2026-03-01",
        amountSen: 100,
        paidSen: 0,
      },
    ];
    expect(planAllocation(invoices, 50)).toEqual({
      allocations: [{ invoiceId: "c", amountSen: 50 }],
      unappliedSen: 0,
    });
  });

  it("rejects non-positive or fractional amounts", () => {
    expect(() => planAllocation(aisyah, 0)).toThrow(Error);
    expect(() => planAllocation(aisyah, 1.5)).toThrow(Error);
  });
});
