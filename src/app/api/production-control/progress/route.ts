import { NextResponse } from "next/server";
import { requirePpkAccess } from "@/lib/ppk/access.server";
import { loadPpkStatuses } from "@/lib/ppk/facts.server";

export const dynamic = "force-dynamic";

/** GET — статусы блоков раздела ППК для текущей организации. */
export async function GET() {
  const auth = await requirePpkAccess();
  if (!auth.ok) return auth.response;
  const statuses = await loadPpkStatuses(auth.scope);
  return NextResponse.json({ statuses }, { headers: { "Cache-Control": "private, no-store" } });
}
