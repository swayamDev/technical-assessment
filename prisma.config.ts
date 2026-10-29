import { loadEnvConfig } from "@next/env";
import { defineConfig } from "prisma/config";

// Load .env.local / .env the same way Next.js does (Prisma 7 does not load env files itself).
loadEnvConfig(process.cwd());

export default defineConfig({
  schema: "prisma/schema.prisma",
  // supabase/migrations/ is the source of truth for the database; Prisma only introspects it.
  datasource: {
    // process.env instead of env(): `prisma generate` (postinstall) must work before .env.local exists.
    url: process.env.DATABASE_URL ?? "",
  },
});
