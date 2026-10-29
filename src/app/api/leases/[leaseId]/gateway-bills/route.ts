import { requireActor } from "@/lib/auth";
import { handle } from "@/lib/http";
import { createGatewayBill } from "@/server/gateway";

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/leases/[leaseId]/gateway-bills">,
) {
  return handle(async () => {
    const actor = await requireActor(request);
    const { leaseId } = await ctx.params;
    return Response.json(await createGatewayBill(actor, leaseId), {
      status: 201,
    });
  });
}
