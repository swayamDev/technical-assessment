import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/sign-out-button";
import { getSessionActor } from "@/lib/auth";
import { TenantPortal } from "./tenant-portal";

export const metadata = { title: "My lease · Rent Collection" };

export default async function PortalPage() {
  const actor = await getSessionActor();
  if (!actor) redirect("/login");
  if (actor.kind === "member") redirect("/dashboard");
  if (actor.kind !== "tenant") redirect("/login");

  return (
    <>
      <header className="bg-background border-b">
        <div className="mx-auto flex max-w-4xl items-center gap-4 px-4 py-3">
          <span className="font-heading text-sm font-semibold">My lease</span>
          <div className="ml-auto">
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">
        {/* Reads the tenant's own data in the browser with supabase-js; RLS limits it to their rows. */}
        <TenantPortal tenantId={actor.tenantId} />
      </main>
    </>
  );
}
