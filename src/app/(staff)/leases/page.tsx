import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Prisma } from "@/generated/prisma/client";
import { getSessionActor } from "@/lib/auth";
import { dateToYmd, formatDate } from "@/lib/dates";
import { formatSen, senFromBigInt } from "@/lib/money";
import { prisma } from "@/lib/prisma";

export const metadata = { title: "Leases · Rent Collection" };

const PAGE_SIZE = 10;

export default async function LeasesPage({
  searchParams,
}: PageProps<"/leases">) {
  const actor = await getSessionActor();
  if (actor?.kind !== "member") redirect("/login");

  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const page = Math.max(
    1,
    Number.parseInt(typeof params.page === "string" ? params.page : "1", 10) ||
      1,
  );

  const where: Prisma.LeaseWhereInput = {
    orgId: actor.orgId,
    ...(q
      ? {
          OR: [
            { unit: { name: { contains: q, mode: "insensitive" } } },
            { tenant: { fullName: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const [total, leases] = await Promise.all([
    prisma.lease.count({ where }),
    prisma.lease.findMany({
      where,
      include: { unit: true, tenant: true },
      orderBy: [{ startDate: "desc" }, { id: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (p: number) =>
    `/leases?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-heading text-xl font-semibold">Leases</h1>
        <form className="ml-auto flex gap-2" role="search">
          <Input
            name="q"
            defaultValue={q}
            placeholder="Search unit or tenant"
            aria-label="Search leases"
            className="w-56"
          />
          <button
            type="submit"
            className={buttonVariants({ variant: "outline" })}
          >
            Search
          </button>
        </form>
        {actor.role === "manager" && (
          <Link href="/leases/new" className={buttonVariants()}>
            New lease
          </Link>
        )}
      </div>
      <Card>
        <CardContent>
          {leases.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              {q ? `No leases match "${q}".` : "No leases yet."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Unit</TableHead>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>End</TableHead>
                  <TableHead className="text-right">Monthly rent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leases.map((lease) => (
                  <TableRow key={lease.id}>
                    <TableCell>
                      <Link
                        href={`/leases/${lease.id}`}
                        className="text-primary font-medium hover:underline"
                      >
                        {lease.unit.name}
                      </Link>
                    </TableCell>
                    <TableCell>{lease.tenant.fullName}</TableCell>
                    <TableCell>
                      {formatDate(dateToYmd(lease.startDate))}
                    </TableCell>
                    <TableCell>
                      {formatDate(dateToYmd(lease.endDate))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatSen(senFromBigInt(lease.monthlyRentSen))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {pages > 1 && (
        <nav
          className="flex items-center justify-end gap-2 text-xs"
          aria-label="Pagination"
        >
          {page > 1 && (
            <Link
              href={pageHref(page - 1)}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Previous
            </Link>
          )}
          <span className="text-muted-foreground">
            Page {page} of {pages}
          </span>
          {page < pages && (
            <Link
              href={pageHref(page + 1)}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Next
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
