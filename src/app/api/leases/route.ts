import { requireActor, requireManager } from "@/lib/auth";
import { handle, readJsonObject } from "@/lib/http";
import { createLease, parseCreateLeaseInput } from "@/server/leases";

export async function POST(request: Request) {
  return handle(async () => {
    const actor = await requireActor(request);
    requireManager(actor);
    const input = parseCreateLeaseInput(await readJsonObject(request));
    return Response.json(await createLease(actor, input), { status: 201 });
  });
}
