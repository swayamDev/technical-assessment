import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSessionActor } from "@/lib/auth";
import { dateToYmd } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import { NewLeaseForm } from "./new-lease-form";

export const metadata = { title: "New lease · Rent Collection" };

export default async function NewLeasePage() {
  const actor = await getSessionActor();
  if (actor?.kind !== "member") redirect("/login");
  if (actor.role !== "manager") {
    return (
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Only managers can create leases</CardTitle>
          <CardDescription>
            <Link href="/leases" className="text-primary hover:underline">
              Back to leases
            </Link>
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // Only this manager's organization. POST /api/leases re-checks both ids on the server.
  const [units, tenants] = await Promise.all([
    prisma.unit.findMany({
      where: { orgId: actor.orgId },
      orderBy: { name: "asc" },
      include: {
        leases: {
          select: { startDate: true, endDate: true },
          orderBy: { startDate: "asc" },
        },
      },
    }),
    prisma.tenant.findMany({
      where: { orgId: actor.orgId },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, email: true },
    }),
  ]);

  return (
    <div className="grid gap-4">
      <div>
        <Link
          href="/leases"
          className="text-muted-foreground text-xs hover:underline"
        >
          ← Leases
        </Link>
        <h1 className="font-heading text-xl font-semibold">New lease</h1>
      </div>
      <NewLeaseForm
        units={units.map((u) => ({
          id: u.id,
          name: u.name,
          leases: u.leases.map((l) => ({
            startDate: dateToYmd(l.startDate),
            endDate: dateToYmd(l.endDate),
          })),
        }))}
        tenants={tenants.map((t) => ({
          id: t.id,
          label: `${t.fullName} (${t.email})`,
        }))}
      />
    </div>
  );
}
