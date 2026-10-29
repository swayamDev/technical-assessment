import { requireActor } from "@/lib/auth";
import { handle, readJsonObjectOrEmpty } from "@/lib/http";
import { recordPayment } from "@/server/payments";

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/leases/[leaseId]/payments">,
) {
  return handle(async () => {
    const actor = await requireActor(request);
    const { leaseId } = await ctx.params;
    const body = await readJsonObjectOrEmpty(request);
    return Response.json(await recordPayment(actor, leaseId, body), {
      status: 201,
    });
  });
}
