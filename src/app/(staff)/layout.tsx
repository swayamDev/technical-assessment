import Link from "next/link";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/sign-out-button";
import { getSessionActor } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Navigation convenience only: every page, action and API route checks the caller itself.
export default async function StaffLayout({ children }: LayoutProps<"/">) {
  const actor = await getSessionActor();
  if (!actor) redirect("/login");
  if (actor.kind === "tenant") redirect("/portal");
  if (actor.kind !== "member") {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-sm">
        <p>Your account is not linked to an organization yet.</p>
        <SignOutButton />
      </main>
    );
  }
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: actor.orgId },
  });

  return (
    <>
      <header className="bg-background border-b">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link
            href="/dashboard"
            className="font-heading text-sm font-semibold"
          >
            {org.name}
          </Link>
          <nav className="flex gap-4 text-xs">
            <Link href="/dashboard" className="hover:underline">
              Dashboard
            </Link>
            <Link href="/leases" className="hover:underline">
              Leases
            </Link>
          </nav>
          <div className="text-muted-foreground ml-auto flex items-center gap-3 text-xs">
            <span className="capitalize">{actor.role}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {children}
      </main>
    </>
  );
}
