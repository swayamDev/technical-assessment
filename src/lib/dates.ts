// Conversions between calendar dates, instants and Malaysia time. Never uses the
// machine's or the viewer's timezone: Malaysia is a fixed UTC+8 with no daylight saving.

import { isValidDateString } from "./billing";

const MYT_OFFSET_MS = 8 * 60 * 60 * 1000;

/** A Postgres `date` read by Prisma (UTC midnight) as 'YYYY-MM-DD'. */
export function dateToYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' as the Date Prisma writes to a Postgres `date` column. */
export function ymdToDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

/**
 * Strict ISO 8601 instant with an explicit offset, e.g. '2026-03-01T00:30:00+08:00' or
 * '2026-02-28T16:30:00Z'. Returns null for anything else, including times without an offset.
 */
export function parseInstant(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const match =
    /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(\.\d{1,9})?)?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(
      value,
    );
  if (!match || !isValidDateString(match[1])) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The gateway's paid_at format: 'YYYY-MM-DD HH:MM:SS +0800'. */
export function parseGatewayTimestamp(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const match =
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/.exec(value);
  if (!match) return null;
  return parseInstant(`${match[1]}T${match[2]}${match[3]}:${match[4]}`);
}

/** A Malaysia wall-clock time from a datetime-local input ('YYYY-MM-DDTHH:MM') as an ISO instant. */
export function malaysiaLocalToIso(local: string): string | null {
  const instant = parseInstant(`${local}+08:00`);
  return instant ? instant.toISOString() : null;
}

/** Malaysia wall-clock parts of an instant. */
function malaysiaParts(instant: Date | string) {
  const shifted = new Date(
    new Date(instant).getTime() + MYT_OFFSET_MS,
  ).toISOString();
  return { date: shifted.slice(0, 10), time: shifted.slice(11, 16) };
}

/** 'YYYY-MM-DDTHH:MM' in Malaysia time, for a datetime-local input. */
export function toMalaysiaLocalInput(instant: Date | string): string {
  const { date, time } = malaysiaParts(instant);
  return `${date}T${time}`;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** '2026-03-01' -> '1 Mar 2026'. */
export function formatDate(ymd: string): string {
  const [year, month, day] = ymd.split("-");
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
}

/** An instant shown in Malaysia time, e.g. '1 Mar 2026, 00:30 MYT'. */
export function formatMalaysiaDateTime(instant: Date | string): string {
  const { date, time } = malaysiaParts(instant);
  return `${formatDate(date)}, ${time} MYT`;
}

/** '2026-03' -> 'Mar 2026'. */
export function formatMonth(month: string): string {
  const [year, m] = month.split("-");
  return `${MONTHS[Number(m) - 1]} ${year}`;
}
