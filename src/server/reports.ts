import "server-only";
import { requireMember, type Actor } from "@/lib/auth";
import { invoiceStatus } from "@/lib/billing";
import { dateToYmd } from "@/lib/dates";
import { badRequest } from "@/lib/http";
import { senFromBigInt } from "@/lib/money";
import { prisma } from "@/lib/prisma";

const MAX_REPORT_MONTHS = 120;

function parseMonth(
  value: unknown,
  field: string,
): { year: number; month: number } {
  const match =
    typeof value === "string" ? /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value) : null;
  if (!match) throw badRequest(`${field} must be a month written as YYYY-MM`);
  return { year: Number(match[1]), month: Number(match[2]) };
}

export function parseMonthRange(
  from: unknown,
  to: unknown,
): { from: string; to: string } {
  const start = parseMonth(from, "from");
  const end = parseMonth(to, "to");
  const months = (end.year - start.year) * 12 + (end.month - start.month) + 1;
  if (months < 1) throw badRequest("from must not be after to");
  if (months > MAX_REPORT_MONTHS)
    throw badRequest(`The range can be at most ${MAX_REPORT_MONTHS} months`);
  return { from: from as string, to: to as string };
}

/**
 * Approved payments per calendar month of received_at in Malaysia time, one entry per month
 * (including months with nothing collected). Staff and managers of the organization.
 */
export async function collectionsReport(
  actor: Actor,
  range: { from: string; to: string },
): Promise<{ month: string; collectedSen: number }[]> {
  const member = requireMember(actor);
  // Each Malaysia month [start, next start) is converted to instants with AT TIME ZONE,
  // independent of the database session's timezone.
  const rows = await prisma.$queryRaw<{ month: string; collected: bigint }[]>`
    with months as (
      select m as month_start
      from generate_series(${`${range.from}-01`}::timestamp, ${`${range.to}-01`}::timestamp, interval '1 month') as m
    )
    select to_char(months.month_start, 'YYYY-MM') as month,
           coalesce(sum(p.amount_sen), 0)::bigint as collected
    from months
    left join public.payments p
      on p.org_id = ${member.orgId}::uuid
     and p.status = 'approved'
     and p.received_at >= (months.month_start at time zone 'Asia/Kuala_Lumpur')
     and p.received_at < ((months.month_start + interval '1 month') at time zone 'Asia/Kuala_Lumpur')
    group by months.month_start
    order by months.month_start`;
  return rows.map((r) => ({
    month: r.month,
    collectedSen: senFromBigInt(r.collected),
  }));
}

/** Number of the organization's invoices that are overdue now (status computed, never stored). */
export async function overdueInvoiceCount(
  actor: Actor,
  now: Date = new Date(),
): Promise<number> {
  const member = requireMember(actor);
  const [invoices, paid] = await Promise.all([
    prisma.invoice.findMany({
      where: { orgId: member.orgId },
      select: { id: true, dueDate: true, amountSen: true },
    }),
    prisma.paymentAllocation.groupBy({
      by: ["invoiceId"],
      where: { orgId: member.orgId },
      _sum: { amountSen: true },
    }),
  ]);
  const paidByInvoice = new Map(
    paid.map((p) => [
      p.invoiceId,
      senFromBigInt(p._sum.amountSen ?? BigInt(0)),
    ]),
  );
  return invoices.filter(
    (i) =>
      invoiceStatus(
        {
          dueDate: dateToYmd(i.dueDate),
          amountSen: senFromBigInt(i.amountSen),
          paidSen: paidByInvoice.get(i.id) ?? 0,
        },
        now,
      ) === "overdue",
  ).length;
}
