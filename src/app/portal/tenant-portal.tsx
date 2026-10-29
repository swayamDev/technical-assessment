"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  invoiceStatus,
  malaysiaDate,
  type InvoiceKind,
  type InvoiceStatus,
} from "@/lib/billing";
import { formatDate, formatMalaysiaDateTime } from "@/lib/dates";
import { formatSen } from "@/lib/money";
import { createClient } from "@/lib/supabase/client";
import { PayNow } from "./pay-now";
import { PhoneForm } from "./phone-form";

interface Tenant {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
}

interface LeaseView {
  id: string;
  unitName: string;
  startDate: string;
  endDate: string;
  monthlyRentSen: number;
  depositSen: number;
  dueNowSen: number;
  invoices: {
    id: string;
    kind: InvoiceKind;
    periodStart: string | null;
    periodEnd: string | null;
    dueDate: string;
    amountSen: number;
    paidSen: number;
    status: InvoiceStatus;
  }[];
  payments: {
    id: string;
    amountSen: number;
    method: string;
    status: string;
    receivedAt: string;
  }[];
}

const METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  online: "Online",
};

async function loadPortal(
  tenantId: string,
): Promise<{ tenant: Tenant; leases: LeaseView[] }> {
  const supabase = createClient();
  const [tenantRes, leasesRes, invoicesRes, allocationsRes, paymentsRes] =
    await Promise.all([
      supabase
        .from("tenants")
        .select("id, full_name, email, phone")
        .eq("id", tenantId)
        .single(),
      supabase
        .from("leases")
        .select(
          "id, start_date, end_date, monthly_rent_sen, deposit_sen, units(name)",
        )
        .order("start_date", { ascending: false }),
      supabase
        .from("invoices")
        .select(
          "id, lease_id, kind, period_index, period_start, period_end, due_date, amount_sen",
        ),
      supabase.from("payment_allocations").select("invoice_id, amount_sen"),
      supabase
        .from("payments")
        .select("id, lease_id, amount_sen, method, status, received_at")
        .order("received_at", { ascending: false }),
    ]);
  const failed = [
    tenantRes,
    leasesRes,
    invoicesRes,
    allocationsRes,
    paymentsRes,
  ].find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);

  const paidByInvoice = new Map<string, number>();
  for (const a of allocationsRes.data ?? []) {
    paidByInvoice.set(
      a.invoice_id,
      (paidByInvoice.get(a.invoice_id) ?? 0) + Number(a.amount_sen),
    );
  }
  const now = new Date();
  const today = malaysiaDate(now);

  const leases = (leasesRes.data ?? []).map((lease): LeaseView => {
    const unit = Array.isArray(lease.units) ? lease.units[0] : lease.units;
    const invoices = (invoicesRes.data ?? [])
      .filter((i) => i.lease_id === lease.id)
      .map((i) => {
        const amountSen = Number(i.amount_sen);
        const paidSen = paidByInvoice.get(i.id) ?? 0;
        return {
          id: i.id as string,
          kind: i.kind as InvoiceKind,
          periodIndex: i.period_index as number | null,
          periodStart: i.period_start as string | null,
          periodEnd: i.period_end as string | null,
          dueDate: i.due_date as string,
          amountSen,
          paidSen,
          status: invoiceStatus(
            { dueDate: i.due_date, amountSen, paidSen },
            now,
          ),
        };
      })
      .sort(
        (a, b) =>
          a.dueDate.localeCompare(b.dueDate) ||
          (a.kind === b.kind ? 0 : a.kind === "deposit" ? -1 : 1) ||
          (a.periodIndex ?? -1) - (b.periodIndex ?? -1),
      );
    return {
      id: lease.id,
      unitName: unit?.name ?? "Unit",
      startDate: lease.start_date,
      endDate: lease.end_date,
      monthlyRentSen: Number(lease.monthly_rent_sen),
      depositSen: Number(lease.deposit_sen),
      dueNowSen: invoices
        .filter((i) => i.dueDate <= today)
        .reduce((s, i) => s + Math.max(0, i.amountSen - i.paidSen), 0),
      invoices,
      payments: (paymentsRes.data ?? [])
        .filter((p) => p.lease_id === lease.id)
        .map((p) => ({
          id: p.id,
          amountSen: Number(p.amount_sen),
          method: p.method,
          status: p.status,
          receivedAt: p.received_at,
        })),
    };
  });
  return { tenant: tenantRes.data as Tenant, leases };
}

export function TenantPortal({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<{
    tenant: Tenant;
    leases: LeaseView[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setData(await loadPortal(tenantId));
      setError(null);
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Could not load your lease";
      setError(message);
      toast.error(message);
    }
  }, [tenantId]);

  useEffect(() => {
    // Initial load from the browser (supabase-js under RLS), not from server-rendered props.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  if (error && !data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load your lease</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!data) {
    return (
      <div className="grid gap-4" aria-busy="true" aria-label="Loading">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-lg">
            {data.tenant.full_name}
          </CardTitle>
          <CardDescription>{data.tenant.email}</CardDescription>
        </CardHeader>
        <CardContent>
          <PhoneForm
            tenantId={data.tenant.id}
            phone={data.tenant.phone}
            onSaved={refresh}
          />
        </CardContent>
      </Card>

      {data.leases.length === 0 && (
        <p className="text-muted-foreground text-sm">You have no leases yet.</p>
      )}

      {data.leases.map((lease) => (
        <div key={lease.id} className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Unit {lease.unitName}</CardTitle>
              <CardDescription>
                {formatDate(lease.startDate)} to {formatDate(lease.endDate)} ·{" "}
                {formatSen(lease.monthlyRentSen)} a month
                {lease.depositSen > 0 &&
                  ` · deposit ${formatSen(lease.depositSen)}`}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-4">
              <div>
                <div className="text-muted-foreground text-xs">
                  Amount due now
                </div>
                <div className="text-2xl font-semibold tabular-nums">
                  {formatSen(lease.dueNowSen)}
                </div>
              </div>
              <div className="ml-auto">
                <PayNow leaseId={lease.id} dueNowSen={lease.dueNowSen} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Invoices</CardTitle>
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
                  {lease.invoices.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell>
                        {i.kind === "deposit" || !i.periodStart || !i.periodEnd
                          ? "Deposit"
                          : `${formatDate(i.periodStart)} – ${formatDate(i.periodEnd)}`}
                      </TableCell>
                      <TableCell>{formatDate(i.dueDate)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatSen(i.amountSen)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatSen(i.paidSen)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={i.status} />
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
              <CardDescription>Times are in Malaysia time</CardDescription>
            </CardHeader>
            <CardContent>
              {lease.payments.length === 0 ? (
                <p className="text-muted-foreground py-4 text-center text-sm">
                  No payments yet.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Received</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lease.payments.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>
                          {formatMalaysiaDateTime(p.receivedAt)}
                        </TableCell>
                        <TableCell>
                          {METHOD_LABELS[p.method] ?? p.method}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatSen(p.amountSen)}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={p.status} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      ))}
    </div>
  );
}
