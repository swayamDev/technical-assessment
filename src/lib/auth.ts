import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { prisma } from "./prisma";
import { csrfRejection, mutationRequestFrom } from "./csrf";
import { ApiError, forbidden, unauthorized } from "./http";
import { createClient } from "./supabase/server";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./supabase/env";

/**
 * Who is calling. Roles and organizations come only from the memberships and tenants
 * tables, never from anything the user can edit (such as user_metadata).
 */
export type Actor =
  | { kind: "member"; userId: string; orgId: string; role: "manager" | "staff" }
  | { kind: "tenant"; userId: string; orgId: string; tenantId: string }
  | { kind: "none"; userId: string };

export type MemberActor = Extract<Actor, { kind: "member" }>;
export type TenantActor = Extract<Actor, { kind: "tenant" }>;

/** Loads the caller's role for a verified user id. */
export async function resolveActor(userId: string): Promise<Actor> {
  const membership = await prisma.membership.findUnique({ where: { userId } });
  if (
    membership &&
    (membership.role === "manager" || membership.role === "staff")
  ) {
    return {
      kind: "member",
      userId,
      orgId: membership.orgId,
      role: membership.role,
    };
  }
  const tenant = await prisma.tenant.findUnique({ where: { userId } });
  if (tenant)
    return { kind: "tenant", userId, orgId: tenant.orgId, tenantId: tenant.id };
  return { kind: "none", userId };
}

/** Verifies a Supabase access token with the Auth server and returns its user id, or null. */
async function userIdFromAccessToken(token: string): Promise<string | null> {
  const supabase = createSupabaseClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const { data, error } = await supabase.auth.getUser(token);
  return error || !data.user ? null : data.user.id;
}

/** The verified user id from the session cookie, or null. */
async function userIdFromCookies(): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  return error || !data.user ? null : data.user.id;
}

/**
 * Authenticates an API request from `Authorization: Bearer <token>` or the session cookie.
 * A request that sends an Authorization header is judged on that header alone. Throws 401.
 * Cookie-authenticated mutations must also pass the CSRF check (403 otherwise).
 */
export async function requireActor(request: Request): Promise<Actor> {
  const header = request.headers.get("authorization");
  let userId: string | null;
  if (header !== null) {
    const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
    userId = match ? await userIdFromAccessToken(match[1]) : null;
  } else {
    userId = await userIdFromCookies();
    // Browsers attach the session cookie automatically, so cookie-authenticated
    // mutations must also prove they come from this app's own pages.
    if (userId) {
      const rejection = csrfRejection(mutationRequestFrom(request));
      if (rejection) throw new ApiError(403, rejection);
    }
  }
  if (!userId) throw unauthorized();
  return resolveActor(userId);
}

/** For Server Components and Server Actions: the signed-in actor, or null. */
export async function getSessionActor(): Promise<Actor | null> {
  const userId = await userIdFromCookies();
  return userId ? resolveActor(userId) : null;
}

/** Narrows to staff or manager of an organization, or throws 403. */
export function requireMember(actor: Actor): MemberActor {
  if (actor.kind !== "member") throw forbidden();
  return actor;
}

/** Narrows to a manager, or throws 403. */
export function requireManager(actor: Actor): MemberActor {
  if (actor.kind !== "member" || actor.role !== "manager") throw forbidden();
  return actor;
}
