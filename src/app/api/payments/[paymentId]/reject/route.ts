import { requireActor } from "@/lib/auth";
import { handle, readJsonObjectOrEmpty } from "@/lib/http";
import { rejectPayment } from "@/server/payments";

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/payments/[paymentId]/reject">,
) {
  return handle(async () => {
    const actor = await requireActor(request);
    const { paymentId } = await ctx.params;
    const body = await readJsonObjectOrEmpty(request);
    return Response.json(await rejectPayment(actor, paymentId, body));
  });
}
