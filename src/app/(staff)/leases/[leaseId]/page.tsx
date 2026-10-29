import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { StatusBadge } from "@/components/status-badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getSessionActor } from "@/lib/auth";
import { formatDate, formatMalaysiaDateTime } from "@/lib/dates";
import { ApiError } from "@/lib/http";
import { formatSen } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { getLeaseDetail } from "@/server/leases";
import { PaymentActions } from "./payment-actions";
import { RecordPaymentDialog } from "./record-payment-dialog";
import { SlipLink } from "./slip-link";

const METHOD_LABELS = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  online: "Online",
} as const;

export default async function LeasePage({
  params,
}: PageProps<"/leases/[leaseId]">) {
  const actor = await getSessionActor();
  if (actor?.kind !== "member") redirect("/login");
  const { leaseId } = await params;

  let detail;
  try {
    detail = await getLeaseDetail(actor, leaseId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const [lease, paymentExtras] = await Promise.all([
    prisma.lease.findUniqueOrThrow({
      where: { id: leaseId },
      include: { unit: true, tenant: true },
    }),
    prisma.payment.findMany({
      where: { leaseId },
      select: {
        id: true,
        slipPath: true,
        rejectionReason: true,
        voidReason: true,
        gatewayBillId: true,
      },
    }),
  ]);
  const extras = new Map(paymentExtras.map((p) => [p.id, p]));

  const totalSen = detail.invoices.reduce((s, i) => s + i.amountSen, 0);
  const paidSen = detail.invoices.reduce((s, i) => s + i.paidSen, 0);
  const pendingSen = detail.payments
    .filter((p) => p.status === "pending_verification")
    .reduce((s, p) => s + p.amountSen, 0);
  const capSen = Math.max(totalSen - paidSen - pendingSen, 0);
  const isManager = actor.role === "manager";

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Link
            href="/leases"
            className="text-muted-foreground text-xs hover:underline"
          >
            ← Leases
          </Link>
          <h1 className="font-heading text-xl font-semibold">
            {lease.unit.name} · {lease.tenant.fullName}
          </h1>
          <p className="text-muted-foreground text-xs">
            {formatDate(detail.lease.startDate)} to{" "}
            {formatDate(detail.lease.endDate)} ·{" "}
            {formatSen(detail.lease.monthlyRentSen)} a month · deposit{" "}
            {formatSen(detail.lease.depositSen)}
          </p>
        </div>
        <div className="ml-auto">
          <RecordPaymentDialog
            leaseId={leaseId}
            orgId={actor.orgId}
            capSen={capSen}
            isManager={isManager}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Summary label="Total invoiced" value={formatSen(totalSen)} />
        <Summary label="Paid" value={formatSen(paidSen)} />
        <Summary
          label="Remaining"
          value={formatSen(totalSen - paidSen)}
          hint={
            pendingSen > 0
              ? `${formatSen(pendingSen)} pending approval`
              : undefined
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
          <CardDescription>In the order payments are allocated</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.invoices.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell>
                    {invoice.kind === "deposit" ||
                    !invoice.periodStart ||
                    !invoice.periodEnd
                      ? "Deposit"
                      : `${formatDate(invoice.periodStart)} – ${formatDate(invoice.periodEnd)}`}
                  </TableCell>
                  <TableCell>{formatDate(invoice.dueDate)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatSen(invoice.amountSen)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatSen(invoice.paidSen)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={invoice.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payments</CardTitle>
          <CardDescription>
            Received dates and times are in Malaysia time
          </CardDescription>
        </CardHeader>
        <CardContent>
          {detail.payments.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              No payments recorded yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Received</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Details</TableHead>
                  {isManager && (
                    <TableHead className="text-right">Actions</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.payments.map((payment) => {
                  const extra = extras.get(payment.id);
                  return (
                    <TableRow key={payment.id}>
                      <TableCell className="whitespace-nowrap">
                        {formatMalaysiaDateTime(payment.receivedAt)}
                      </TableCell>
                      <TableCell>{METHOD_LABELS[payment.method]}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatSen(payment.amountSen)}
                        {payment.unappliedSen > 0 && (
                          <div className="text-muted-foreground text-[10px]">
                            {formatSen(payment.unappliedSen)} unapplied
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={payment.status} />
                      </TableCell>
                      <TableCell className="text-muted-foreground max-w-56 text-xs">
                        {extra?.slipPath && <SlipLink path={extra.slipPath} />}
                        {extra?.rejectionReason && (
                          <div>Rejected: {extra.rejectionReason}</div>
                        )}
                        {extra?.voidReason && (
                          <div>Voided: {extra.voidReason}</div>
                        )}
                        {extra?.gatewayBillId && (
                          <div className="truncate font-mono">
                            {extra.gatewayBillId}
                          </div>
                        )}
                      </TableCell>
                      {isManager && (
                        <TableCell className="text-right">
                          <PaymentActions
                            paymentId={payment.id}
                            status={payment.status}
                            amountLabel={formatSen(payment.amountSen)}
                          />
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Summary({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-xl tabular-nums">{value}</CardTitle>
        {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
      </CardHeader>
    </Card>
  );
}
