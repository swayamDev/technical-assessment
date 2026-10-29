import { errorResponse } from "@/lib/http";
import { handleGatewayCallback } from "@/server/gateway";

// Called by the payment gateway (application/x-www-form-urlencoded). Authenticated by the
// HMAC signature, not by a user session. Never log the payload or the secret.
export async function POST(request: Request) {
  try {
    const result = await handleGatewayCallback(await request.text());
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    return errorResponse(error);
  }
}
