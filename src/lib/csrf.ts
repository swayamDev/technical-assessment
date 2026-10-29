// CSRF protection for API mutations authenticated by the session cookie. Bearer-token
// requests are not affected: a browser never attaches a bearer token on its own.

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface MutationRequest {
  method: string;
  origin: string | null;
  host: string | null;
  forwardedHost: string | null;
  contentType: string | null;
}

/**
 * Returns why a cookie-authenticated request must be refused, or null if it may proceed.
 * Mutations must come from this app's own origin (Origin host = Host, or X-Forwarded-Host
 * behind a proxy) and send JSON. JSON is not a "simple" content type, so a cross-origin
 * page cannot send it without a CORS preflight, which this app never grants.
 * This is a defence in depth on top of authentication, never a replacement for it.
 */
export function csrfRejection(req: MutationRequest): string | null {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return null;

  const expectedHost = req.forwardedHost?.split(",")[0]?.trim() || req.host;
  let originHost: string | null = null;
  try {
    originHost = req.origin ? new URL(req.origin).host : null;
  } catch {
    originHost = null;
  }
  if (!originHost || !expectedHost || originHost !== expectedHost) {
    return "Cross-origin request refused";
  }

  const mediaType = req.contentType?.split(";")[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    return "Content-Type must be application/json";
  }
  return null;
}

export function mutationRequestFrom(request: Request): MutationRequest {
  return {
    method: request.method,
    origin: request.headers.get("origin"),
    host: request.headers.get("host"),
    forwardedHost: request.headers.get("x-forwarded-host"),
    contentType: request.headers.get("content-type"),
  };
}
