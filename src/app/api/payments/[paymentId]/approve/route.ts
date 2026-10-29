import { requireActor } from "@/lib/auth";
import { handle } from "@/lib/http";
import { approvePayment } from "@/server/payments";

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/payments/[paymentId]/approve">,
) {
  return handle(async () => {
    const actor = await requireActor(request);
    const { paymentId } = await ctx.params;
    return Response.json(await approvePayment(actor, paymentId));
  });
}
