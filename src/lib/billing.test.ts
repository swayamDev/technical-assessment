import { describe, expect, it } from "vitest";
import {
  generateSchedule,
  invoiceStatus,
  malaysiaDate,
  parseRinggitToSen,
  type ScheduledInvoice,
} from "./billing";

const rent = (
  periodIndex: number,
  periodStart: string,
  periodEnd: string,
  amountSen: number,
): ScheduledInvoice => ({
  kind: "rent",
  periodIndex,
  periodStart,
  periodEnd,
  dueDate: periodStart,
  amountSen,
});

describe("test environment", () => {
  it("runs in the timezone the runner asked for", () => {
    const expected = process.env.EXPECTED_TZ;
    if (expected)
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(expected);
  });
});

describe("generateSchedule", () => {
  it("matches the brief's worked example (Aisyah's lease)", () => {
    expect(
      generateSchedule({
        startDate: "2026-01-31",
        endDate: "2026-07-15",
        monthlyRentSen: 150000,
        depositSen: 300000,
      }),
    ).toEqual([
      {
        kind: "deposit",
        periodIndex: null,
        periodStart: null,
        periodEnd: null,
        dueDate: "2026-01-31",
        amountSen: 300000,
      },
      rent(0, "2026-01-31", "2026-02-27", 150000),
      rent(1, "2026-02-28", "2026-03-30", 150000),
      rent(2, "2026-03-31", "2026-04-29", 150000),
      rent(3, "2026-04-30", "2026-05-30", 150000),
      rent(4, "2026-05-31", "2026-06-29", 150000),
      rent(5, "2026-06-30", "2026-07-15", 77419),
    ]);
  });

  it("omits the deposit when it is zero and rounds an exact half up (Ben's lease)", () => {
    // Last period: 100029 x 15 / 30 = 50014.5 -> 50015
    expect(
      generateSchedule({
        startDate: "2026-01-01",
        endDate: "2026-04-15",
        monthlyRentSen: 100029,
        depositSen: 0,
      }),
    ).toEqual([
      rent(0, "2026-01-01", "2026-01-31", 100029),
      rent(1, "2026-02-01", "2026-02-28", 100029),
      rent(2, "2026-03-01", "2026-03-31", 100029),
      rent(3, "2026-04-01", "2026-04-15", 50015),
    ]);
  });

  it("produces 12 full periods for a one-year lease ending the day before an anchor", () => {
    const schedule = generateSchedule({
      startDate: "2026-02-28",
      endDate: "2027-02-27",
      monthlyRentSen: 200000,
      depositSen: 400000,
    });
    expect(schedule).toHaveLength(13);
    expect(schedule.slice(1).every((i) => i.amountSen === 200000)).toBe(true);
    expect(schedule[12]).toEqual(rent(11, "2027-01-28", "2027-02-27", 200000));
  });

  it("anchors every period on the start date, not the previous anchor", () => {
    const anchors = generateSchedule({
      startDate: "2026-01-31",
      endDate: "2026-12-31",
      monthlyRentSen: 100,
      depositSen: 0,
    }).map((i) => i.periodStart);
    expect(anchors.slice(0, 4)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
    expect(anchors.at(-1)).toBe("2026-12-31");
  });

  it("uses Feb 29 in leap years and returns to the start day after", () => {
    const schedule = generateSchedule({
      startDate: "2024-01-31",
      endDate: "2024-03-31",
      monthlyRentSen: 100,
      depositSen: 0,
    });
    expect(schedule.map((i) => [i.periodStart, i.periodEnd])).toEqual([
      ["2024-01-31", "2024-02-28"],
      ["2024-02-29", "2024-03-30"],
      ["2024-03-31", "2024-03-31"],
    ]);
    // 1 of 30 days of the period from 2024-03-31 to 2024-04-29
    expect(schedule[2].amountSen).toBe(3);
  });

  it("clamps a Feb 29 start to Feb 28 in common years", () => {
    const schedule = generateSchedule({
      startDate: "2024-02-29",
      endDate: "2025-03-28",
      monthlyRentSen: 100,
      depositSen: 0,
    });
    expect(schedule[11]).toEqual(rent(11, "2025-01-29", "2025-02-27", 100));
    expect(schedule[12]).toEqual(rent(12, "2025-02-28", "2025-03-28", 100));
  });

  it("handles a one-day lease", () => {
    expect(
      generateSchedule({
        startDate: "2026-03-15",
        endDate: "2026-03-15",
        monthlyRentSen: 310000,
        depositSen: 5,
      }),
    ).toEqual([
      {
        kind: "deposit",
        periodIndex: null,
        periodStart: null,
        periodEnd: null,
        dueDate: "2026-03-15",
        amountSen: 5,
      },
      rent(0, "2026-03-15", "2026-03-15", 10000),
    ]);
  });

  it("crosses year boundaries", () => {
    const schedule = generateSchedule({
      startDate: "2026-11-30",
      endDate: "2027-03-29",
      monthlyRentSen: 100,
      depositSen: 0,
    });
    expect(schedule.map((i) => i.periodStart)).toEqual([
      "2026-11-30",
      "2026-12-30",
      "2027-01-30",
      "2027-02-28",
    ]);
    expect(schedule.at(-1)).toEqual(rent(3, "2027-02-28", "2027-03-29", 100));
  });

  it("charges the full rent when the last period is exactly full", () => {
    const schedule = generateSchedule({
      startDate: "2026-01-15",
      endDate: "2026-02-14",
      monthlyRentSen: 99999,
      depositSen: 0,
    });
    expect(schedule).toEqual([rent(0, "2026-01-15", "2026-02-14", 99999)]);
  });

  it.each([
    ["2026-02-30", "2026-03-31"],
    ["2026-13-01", "2026-12-31"],
    ["2026-1-01", "2026-12-31"],
    ["2026/01/01", "2026-12-31"],
    ["2026-01-01T00:00:00Z", "2026-12-31"],
    [" 2026-01-01", "2026-12-31"],
    ["2026-00-10", "2026-12-31"],
    ["2026-01-00", "2026-12-31"],
    ["2025-02-29", "2026-12-31"],
    ["", "2026-12-31"],
    ["2026-01-01", "2026-04-31"],
  ])("rejects invalid dates %s / %s", (startDate, endDate) => {
    expect(() =>
      generateSchedule({
        startDate,
        endDate,
        monthlyRentSen: 100,
        depositSen: 0,
      }),
    ).toThrow(Error);
  });

  it("rejects an end date before the start date", () => {
    expect(() =>
      generateSchedule({
        startDate: "2026-03-02",
        endDate: "2026-03-01",
        monthlyRentSen: 100,
        depositSen: 0,
      }),
    ).toThrow(Error);
  });

  it.each([0, -100, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects monthlyRentSen %s",
    (monthlyRentSen) => {
      expect(() =>
        generateSchedule({
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          monthlyRentSen,
          depositSen: 0,
        }),
      ).toThrow(Error);
    },
  );

  it.each([-1, 0.5, Number.NaN])("rejects depositSen %s", (depositSen) => {
    expect(() =>
      generateSchedule({
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        monthlyRentSen: 100,
        depositSen,
      }),
    ).toThrow(Error);
  });
});

describe("invoiceStatus", () => {
  const due = "2026-03-01";

  it("is paid when fully or over paid, even after the due date", () => {
    const late = new Date("2027-01-01T00:00:00Z");
    expect(
      invoiceStatus({ dueDate: due, amountSen: 100, paidSen: 100 }, late),
    ).toBe("paid");
    expect(
      invoiceStatus({ dueDate: due, amountSen: 100, paidSen: 150 }, late),
    ).toBe("paid");
  });

  it("becomes overdue exactly at 00:00 Malaysia time the day after the due date", () => {
    const before = new Date("2026-03-01T15:59:59.999Z");
    const at = new Date("2026-03-01T16:00:00.000Z");
    expect(
      invoiceStatus({ dueDate: due, amountSen: 100, paidSen: 0 }, before),
    ).toBe("unpaid");
    expect(
      invoiceStatus({ dueDate: due, amountSen: 100, paidSen: 40 }, before),
    ).toBe("partially_paid");
    expect(
      invoiceStatus({ dueDate: due, amountSen: 100, paidSen: 0 }, at),
    ).toBe("overdue");
    expect(
      invoiceStatus({ dueDate: due, amountSen: 100, paidSen: 40 }, at),
    ).toBe("overdue");
  });

  it("is not overdue on the due date itself in Malaysia, even when it is the previous day in UTC", () => {
    // 2026-03-01 00:30 MYT is 2026-02-28 in UTC and New York
    expect(
      invoiceStatus(
        { dueDate: due, amountSen: 100, paidSen: 0 },
        new Date("2026-02-28T16:30:00Z"),
      ),
    ).toBe("unpaid");
  });

  it("is unpaid or partially paid before the due date", () => {
    const early = new Date("2026-01-01T00:00:00Z");
    expect(
      invoiceStatus({ dueDate: due, amountSen: 100, paidSen: 0 }, early),
    ).toBe("unpaid");
    expect(
      invoiceStatus({ dueDate: due, amountSen: 100, paidSen: 1 }, early),
    ).toBe("partially_paid");
  });
});

describe("malaysiaDate", () => {
  it("returns the Malaysia calendar date for an instant", () => {
    expect(malaysiaDate(new Date("2026-03-01T15:59:59.999Z"))).toBe(
      "2026-03-01",
    );
    expect(malaysiaDate(new Date("2026-03-01T16:00:00Z"))).toBe("2026-03-02");
    expect(malaysiaDate(new Date("2026-12-31T16:00:00Z"))).toBe("2027-01-01");
  });
});

describe("parseRinggitToSen", () => {
  it.each([
    ["1,500.50", 150050],
    ["1.15", 115],
    ["7", 700],
    ["0.5", 50],
    ["0.05", 5],
    ["1500", 150000],
    ["1,000,000.99", 100000099],
    ["  42.10 \t", 4210],
    ["0", 0],
    ["1.10", 110],
  ])("parses %j as %i sen", (input, expected) => {
    expect(parseRinggitToSen(input)).toBe(expected);
  });

  it.each([
    "",
    "   ",
    "-5",
    "+5",
    "1.234",
    "1e3",
    "RM 10",
    "1,23",
    "1,2345",
    ",500",
    "1,500,",
    "1.",
    ".5",
    "1 500",
    "1..5",
    "NaN",
    "Infinity",
    "1,500.5.0",
    "１２",
    "12,34.00",
    "99999999999999999999",
  ])("rejects %j", (input) => {
    expect(() => parseRinggitToSen(input)).toThrow(Error);
  });

  it("avoids floating-point error", () => {
    expect(parseRinggitToSen("0.29")).toBe(29);
    expect(parseRinggitToSen("1,000.29")).toBe(100029);
    expect(parseRinggitToSen("4.35")).toBe(435);
  });
});
