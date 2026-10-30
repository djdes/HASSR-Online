import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { edoErrorResponse } from "@/lib/edo/api-response.server";
import { listEdoSourceOptions } from "@/lib/edo/sources.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — что можно отправить организации из WeSetup: счета по безналу и УПД по оплаченным заказам. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireRoot();
  const { id } = await params;
  if (!id || id.length > 64) return NextResponse.json({ error: "Организация не найдена" }, { status: 404 });
  try {
    return NextResponse.json({ sources: await listEdoSourceOptions(id) });
  } catch (e) {
    return edoErrorResponse(e, "sources");
  }
}
