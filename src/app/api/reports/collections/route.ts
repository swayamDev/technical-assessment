import { requireActor, requireMember } from "@/lib/auth";
import { handle } from "@/lib/http";
import { collectionsReport, parseMonthRange } from "@/server/reports";

export async function GET(request: Request) {
  return handle(async () => {
    const actor = await requireActor(request);
    requireMember(actor);
    const { searchParams } = new URL(request.url);
    const range = parseMonthRange(
      searchParams.get("from"),
      searchParams.get("to"),
    );
    return Response.json(await collectionsReport(actor, range));
  });
}
