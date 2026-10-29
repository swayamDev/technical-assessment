import "server-only";

/** An error with an HTTP status whose message is safe to show the caller. */
export class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const badRequest = (message: string) => new ApiError(400, message);
export const unauthorized = () => new ApiError(401, "Not signed in");
export const forbidden = () =>
  new ApiError(403, "You are not allowed to do this");
export const notFound = (what = "Record") =>
  new ApiError(404, `${what} not found`);
export const conflict = (message: string) => new ApiError(409, message);
export const unprocessable = (message: string) => new ApiError(422, message);

export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  // Unexpected errors: log the type and message only (never request payloads or secrets).
  console.error(
    "Unhandled error:",
    error instanceof Error ? `${error.name}: ${error.message}` : "unknown",
  );
  return Response.json({ error: "Something went wrong" }, { status: 500 });
}

/** Runs a route handler body, turning ApiErrors (and anything unexpected) into JSON error responses. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    return errorResponse(error);
  }
}

/** Parses a JSON object request body, or throws 400. */
export async function readJsonObject(
  request: Request,
): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw badRequest("Request body must be JSON");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw badRequest("Request body must be a JSON object");
  }
  return body as Record<string, unknown>;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Parses a JSON object body, or returns {} so the caller's own validation reports what is missing. */
export async function readJsonObjectOrEmpty(
  request: Request,
): Promise<Record<string, unknown>> {
  try {
    return await readJsonObject(request);
  } catch {
    return {};
  }
}
