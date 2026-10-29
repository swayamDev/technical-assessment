// Pure billing rules. No I/O and no framework imports. Every calendar computation is
// done on integer day numbers, so results never depend on the machine's timezone.

export type InvoiceKind = "deposit" | "rent";

export interface ScheduledInvoice {
  kind: InvoiceKind;
  periodIndex: number | null; // 0, 1, 2... for rent; null for the deposit
  periodStart: string | null; // 'YYYY-MM-DD'; null for the deposit
  periodEnd: string | null; // 'YYYY-MM-DD', inclusive; null for the deposit
  dueDate: string; // 'YYYY-MM-DD'
  amountSen: number; // integer
}

export type InvoiceStatus = "paid" | "partially_paid" | "unpaid" | "overdue";

/** Malaysia is UTC+8 all year (no daylight saving). */
const MYT_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

interface CivilDate {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Days since 1970-01-01 in the proleptic Gregorian calendar (H. Hinnant's days_from_civil). */
function toDayNumber({ year, month, day }: CivilDate): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy =
    Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Inverse of toDayNumber (H. Hinnant's civil_from_days). */
function fromDayNumber(dayNumber: number): CivilDate {
  const z = dayNumber + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe -
      Math.floor(doe / 1460) +
      Math.floor(doe / 36524) -
      Math.floor(doe / 146096)) /
      365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return { year: yoe + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

function formatDate({ year, month, day }: CivilDate): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Parses a strict 'YYYY-MM-DD' real calendar date, or throws. */
function parseDate(value: unknown, field: string): CivilDate {
  const match =
    typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!match) throw new Error(`${field} must be a date written as YYYY-MM-DD`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new Error(`${field} is not a real calendar date`);
  }
  return { year, month, day };
}

/** True if value is a real calendar date written as 'YYYY-MM-DD'. */
export function isValidDateString(value: unknown): value is string {
  try {
    parseDate(value, "date");
    return true;
  } catch {
    return false;
  }
}

/** Start date plus k calendar months, clamped to the last day of a shorter month. */
function anchorDate(start: CivilDate, k: number): CivilDate {
  const monthIndex = start.month - 1 + k;
  const year = start.year + Math.floor(monthIndex / 12);
  const month = (monthIndex % 12) + 1;
  return { year, month, day: Math.min(start.day, daysInMonth(year, month)) };
}

/** round(numerator / denominator) with halves rounded up, for non-negative integers. */
function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (2n * numerator + denominator) / (2n * denominator);
}

export function generateSchedule(lease: {
  startDate: string;
  endDate: string;
  monthlyRentSen: number;
  depositSen: number;
}): ScheduledInvoice[] {
  const start = parseDate(lease.startDate, "startDate");
  const end = parseDate(lease.endDate, "endDate");
  const startDay = toDayNumber(start);
  const endDay = toDayNumber(end);
  if (endDay < startDay)
    throw new Error("endDate must not be before startDate");
  if (
    !Number.isSafeInteger(lease.monthlyRentSen) ||
    lease.monthlyRentSen <= 0
  ) {
    throw new Error("monthlyRentSen must be a positive integer");
  }
  if (!Number.isSafeInteger(lease.depositSen) || lease.depositSen < 0) {
    throw new Error("depositSen must be a non-negative integer");
  }

  const schedule: ScheduledInvoice[] = [];
  if (lease.depositSen > 0) {
    schedule.push({
      kind: "deposit",
      periodIndex: null,
      periodStart: null,
      periodEnd: null,
      dueDate: formatDate(start),
      amountSen: lease.depositSen,
    });
  }

  for (let k = 0; ; k++) {
    const anchorDay = toDayNumber(anchorDate(start, k));
    if (anchorDay > endDay) break;
    const fullEndDay = toDayNumber(anchorDate(start, k + 1)) - 1;
    const periodEndDay = Math.min(fullEndDay, endDay);

    let amountSen = lease.monthlyRentSen;
    if (periodEndDay < fullEndDay) {
      const daysUsed = BigInt(periodEndDay - anchorDay + 1);
      const fullDays = BigInt(fullEndDay - anchorDay + 1);
      amountSen = Number(
        divideRoundHalfUp(BigInt(lease.monthlyRentSen) * daysUsed, fullDays),
      );
    }

    const periodStart = formatDate(fromDayNumber(anchorDay));
    schedule.push({
      kind: "rent",
      periodIndex: k,
      periodStart,
      periodEnd: formatDate(fromDayNumber(periodEndDay)),
      dueDate: periodStart,
      amountSen,
    });
  }

  return schedule;
}

/** The Malaysia calendar date ('YYYY-MM-DD') at the given instant, whatever the machine's timezone. */
export function malaysiaDate(now: Date): string {
  const ms = now.getTime();
  if (Number.isNaN(ms)) throw new Error("Invalid date");
  return formatDate(fromDayNumber(Math.floor((ms + MYT_OFFSET_MS) / DAY_MS)));
}

export function invoiceStatus(
  invoice: { dueDate: string; amountSen: number; paidSen: number },
  now: Date,
): InvoiceStatus {
  if (invoice.paidSen >= invoice.amountSen) return "paid";
  // 'YYYY-MM-DD' strings compare correctly as text once both are validated.
  const due = formatDate(parseDate(invoice.dueDate, "dueDate"));
  if (malaysiaDate(now) > due) return "overdue";
  if (invoice.paidSen > 0) return "partially_paid";
  return "unpaid";
}

export function parseRinggitToSen(input: string): number {
  if (typeof input !== "string") throw new Error("Amount must be text");
  // Digits with optional comma thousands separators (groups of exactly three), then an
  // optional 1-2 digit decimal part. \d is ASCII-only in JS regexes.
  const match = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!match) throw new Error("Enter an amount like 1,500.50");
  const ringgit = BigInt(match[1].replaceAll(",", ""));
  const sen = BigInt((match[2] ?? "").padEnd(2, "0"));
  const total = ringgit * 100n + sen;
  if (total > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Amount is too large");
  return Number(total);
}
