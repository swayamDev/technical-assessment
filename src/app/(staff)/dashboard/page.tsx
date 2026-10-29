import { redirect } from "next/navigation";
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
import { malaysiaDate } from "@/lib/billing";
import { formatMonth } from "@/lib/dates";
import { formatSen } from "@/lib/money";
import { cn } from "@/lib/utils";
import { collectionsReport, overdueInvoiceCount } from "@/server/reports";

export const metadata = { title: "Dashboard · Rent Collection" };

/** The last `count` months up to the current Malaysia month, as YYYY-MM. */
function lastMonths(count: number, now: Date): { from: string; to: string } {
  const [year, month] = malaysiaDate(now).split("-").map(Number);
  const index = year * 12 + (month - 1) - (count - 1);
  const from = `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
  return { from, to: `${year}-${String(month).padStart(2, "0")}` };
}

export default async function DashboardPage() {
  const actor = await getSessionActor();
  if (actor?.kind !== "member") redirect("/login");

  const now = new Date();
  const [overdue, report] = await Promise.all([
    overdueInvoiceCount(actor, now),
    collectionsReport(actor, lastMonths(6, now)),
  ]);
  const max = Math.max(...report.map((r) => r.collectedSen), 1);
  const total = report.reduce((sum, r) => sum + r.collectedSen, 0);

  return (
    <div className="grid gap-6">
      <h1 className="font-heading text-xl font-semibold">Dashboard</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardDescription>Overdue invoices</CardDescription>
            <CardTitle
              className={cn(
                "text-3xl tabular-nums",
                overdue > 0 && "text-destructive",
              )}
            >
              {overdue}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-xs">
            Not fully paid after their due date (Malaysia time).
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Collected in the last 6 months</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {formatSen(total)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-xs">
            Approved payments, by date received.
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Collections</CardTitle>
          <CardDescription>
            Approved payments per month received (Malaysia time)
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          <div className="flex h-40 items-end gap-3" aria-hidden="true">
            {report.map((r) => (
              <div
                key={r.month}
                className="flex h-full flex-1 flex-col items-center justify-end gap-1"
              >
                <div
                  className="bg-primary w-full max-w-12"
                  style={{
                    height: `${r.collectedSen > 0 ? Math.max((r.collectedSen / max) * 85, 2) : 0}%`,
                  }}
                />
                <span className="text-muted-foreground text-[10px]">
                  {formatMonth(r.month)}
                </span>
              </div>
            ))}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead className="text-right">Collected</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.map((r) => (
                <TableRow key={r.month}>
                  <TableCell>{formatMonth(r.month)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatSen(r.collectedSen)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
