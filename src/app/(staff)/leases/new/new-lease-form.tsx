"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  generateSchedule,
  parseRinggitToSen,
  type ScheduledInvoice,
} from "@/lib/billing";
import { formatDate } from "@/lib/dates";
import { formatSen } from "@/lib/money";
import { apiErrorMessage } from "@/lib/utils";

interface UnitOption {
  id: string;
  name: string;
  leases: { startDate: string; endDate: string }[];
}

type Preview =
  | { kind: "incomplete" }
  | { kind: "error"; message: string }
  | { kind: "ok"; schedule: ScheduledInvoice[]; totalSen: number };

/** Parses a ringgit input, or returns an error message. */
function parseAmount(
  value: string,
  label: string,
  allowEmpty: boolean,
): number | string {
  if (allowEmpty && value.trim() === "") return 0;
  try {
    return parseRinggitToSen(value);
  } catch {
    return `${label}: enter an amount like 1,500.00`;
  }
}

export function NewLeaseForm({
  units,
  tenants,
}: {
  units: UnitOption[];
  tenants: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [unitId, setUnitId] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [rent, setRent] = useState("");
  const [deposit, setDeposit] = useState("");
  const [pending, setPending] = useState(false);

  const rentSen = parseAmount(rent, "Monthly rent", false);
  const depositSen = parseAmount(deposit, "Deposit", true);

  // The same pure function the server uses, so the preview is exactly what will be stored.
  const preview = useMemo<Preview>(() => {
    if (!startDate || !endDate || rent.trim() === "")
      return { kind: "incomplete" };
    if (typeof rentSen === "string") return { kind: "error", message: rentSen };
    if (typeof depositSen === "string")
      return { kind: "error", message: depositSen };
    try {
      const schedule = generateSchedule({
        startDate,
        endDate,
        monthlyRentSen: rentSen,
        depositSen,
      });
      return {
        kind: "ok",
        schedule,
        totalSen: schedule.reduce((sum, i) => sum + i.amountSen, 0),
      };
    } catch (error) {
      return {
        kind: "error",
        message: error instanceof Error ? error.message : "Invalid lease",
      };
    }
  }, [startDate, endDate, rent, rentSen, depositSen]);

  const unit = units.find((u) => u.id === unitId);
  // A hint only: POST /api/leases (and the database) decide, and answer 409 on overlap.
  const overlapping =
    unit && startDate && endDate
      ? unit.leases.filter(
          (l) => l.startDate <= endDate && l.endDate >= startDate,
        )
      : [];

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!unitId || !tenantId) {
      toast.error("Choose a unit and a tenant");
      return;
    }
    if (
      preview.kind !== "ok" ||
      typeof rentSen !== "number" ||
      typeof depositSen !== "number"
    ) {
      toast.error(
        preview.kind === "error"
          ? preview.message
          : "Fill in the dates and the rent",
      );
      return;
    }
    setPending(true);
    try {
      const response = await fetch("/api/leases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          unitId,
          tenantId,
          startDate,
          endDate,
          monthlyRentSen: rentSen,
          depositSen,
        }),
      });
      if (!response.ok) {
        toast.error(await apiErrorMessage(response));
        return;
      }
      const { id } = (await response.json()) as { id: string };
      toast.success(`Lease created with ${preview.schedule.length} invoices`);
      router.push(`/leases/${id}`);
      router.refresh();
    } catch {
      toast.error("Network error, please try again");
    } finally {
      setPending(false);
    }
  }

  const unitItems = units.map((u) => ({ value: u.id, label: u.name }));
  const tenantItems = tenants.map((t) => ({ value: t.id, label: t.label }));

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,22rem)_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Lease details</CardTitle>
          <CardDescription>
            Dates are calendar dates in Malaysia; the end date is the
            tenant&apos;s last day.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid gap-4" noValidate>
            <Field id="unit" label="Unit">
              {units.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  No units in your organization.
                </p>
              ) : (
                <Select
                  items={unitItems}
                  value={unitId}
                  onValueChange={(v) =>
                    setUnitId(typeof v === "string" ? v : null)
                  }
                >
                  <SelectTrigger id="unit" className="w-full">
                    <SelectValue placeholder="Choose a unit" />
                  </SelectTrigger>
                  <SelectContent>
                    {unitItems.map((u) => (
                      <SelectItem key={u.value} value={u.value}>
                        {u.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
            <Field id="tenant" label="Tenant">
              {tenants.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  No tenants in your organization.
                </p>
              ) : (
                <Select
                  items={tenantItems}
                  value={tenantId}
                  onValueChange={(v) =>
                    setTenantId(typeof v === "string" ? v : null)
                  }
                >
                  <SelectTrigger id="tenant" className="w-full">
                    <SelectValue placeholder="Choose a tenant" />
                  </SelectTrigger>
                  <SelectContent>
                    {tenantItems.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field id="startDate" label="Start date">
                <Input
                  id="startDate"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </Field>
              <Field id="endDate" label="End date">
                <Input
                  id="endDate"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field id="rent" label="Monthly rent (RM)">
                <Input
                  id="rent"
                  inputMode="decimal"
                  placeholder="1,500.00"
                  value={rent}
                  onChange={(e) => setRent(e.target.value)}
                  aria-invalid={rent !== "" && typeof rentSen === "string"}
                />
              </Field>
              <Field id="deposit" label="Deposit (RM)">
                <Input
                  id="deposit"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={deposit}
                  onChange={(e) => setDeposit(e.target.value)}
                  aria-invalid={typeof depositSen === "string"}
                />
              </Field>
            </div>
            {overlapping.length > 0 && (
              <Alert variant="destructive">
                <AlertTitle>
                  Overlaps an existing lease on {unit?.name}
                </AlertTitle>
                <AlertDescription>
                  {overlapping
                    .map(
                      (l) =>
                        `${formatDate(l.startDate)} to ${formatDate(l.endDate)}`,
                    )
                    .join("; ")}
                </AlertDescription>
              </Alert>
            )}
            <Button type="submit" disabled={pending}>
              {pending ? "Creating lease…" : "Create lease"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invoice preview</CardTitle>
          <CardDescription>
            Exactly the invoices that will be created, in allocation order.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {preview.kind === "incomplete" && (
            <p className="text-muted-foreground py-8 text-center text-sm">
              Enter the dates and the monthly rent to see the schedule.
            </p>
          )}
          {preview.kind === "error" && (
            <Alert variant="destructive">
              <AlertTitle>This lease cannot be created</AlertTitle>
              <AlertDescription>{preview.message}</AlertDescription>
            </Alert>
          )}
          {preview.kind === "ok" && typeof rentSen === "number" && (
            <div className="max-h-[32rem] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.schedule.map((i) => (
                    <TableRow
                      key={i.kind === "deposit" ? "deposit" : i.periodIndex}
                    >
                      <TableCell>
                        {i.kind === "deposit"
                          ? "Deposit"
                          : `Rent ${(i.periodIndex ?? 0) + 1}`}
                      </TableCell>
                      <TableCell>
                        {i.periodStart && i.periodEnd
                          ? `${formatDate(i.periodStart)} – ${formatDate(i.periodEnd)}`
                          : "—"}
                      </TableCell>
                      <TableCell>{formatDate(i.dueDate)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatSen(i.amountSen)}
                        {i.kind === "rent" && i.amountSen !== rentSen && (
                          <div className="text-muted-foreground text-[10px]">
                            prorated
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={3}>
                      Total ({preview.schedule.length} invoice
                      {preview.schedule.length === 1 ? "" : "s"})
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatSen(preview.totalSen)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
