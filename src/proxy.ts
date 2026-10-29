import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase/env";

// Refreshes the Supabase session cookie on page navigations. It is not an access
// check: every page, Server Action and route handler authorizes the caller itself.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet)
          request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet)
          response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers ?? {}))
          response.headers.set(key, value);
      },
    },
  });

  await supabase.auth.getClaims();
  return response;
}

export const config = {
  // Pages only: API routes authenticate per request (cookie or Bearer token).
  matcher: [
    "/((?!api/|_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
