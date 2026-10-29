import "server-only";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./env";

/**
 * Secret-key client. Bypasses RLS and Storage policies, so it is used only on the server,
 * only for removing orphaned slip uploads and for creating accounts in the seed script.
 */
export function createAdminClient() {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) throw new Error("SUPABASE_SECRET_KEY is not set");
  return createClient(SUPABASE_URL, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
