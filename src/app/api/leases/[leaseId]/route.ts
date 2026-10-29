import { requireActor } from "@/lib/auth";
import { handle } from "@/lib/http";
import { getLeaseDetail } from "@/server/leases";

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/leases/[leaseId]">,
) {
  return handle(async () => {
    const actor = await requireActor(request);
    const { leaseId } = await ctx.params;
    return Response.json(await getLeaseDetail(actor, leaseId));
  });
}
