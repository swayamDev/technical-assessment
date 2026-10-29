// Public Supabase settings, safe for the browser (NEXT_PUBLIC_ values are inlined at build time).
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

export const PAYMENT_SLIPS_BUCKET = "payment-slips";
