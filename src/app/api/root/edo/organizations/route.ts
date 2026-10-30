import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { edoErrorResponse } from "@/lib/edo/api-response.server";
import { searchEdoOrganizations } from "@/lib/edo/send.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET ?q= — клиенты-организации по названию или ИНН (для выбора получателя). */
export async function GET(request: Request) {
  await requireRoot();
  const q = new URL(request.url).searchParams.get("q") ?? "";
  try {
    return NextResponse.json({ organizations: await searchEdoOrganizations(q.slice(0, 100)) });
  } catch (e) {
    return edoErrorResponse(e, "organizations");
  }
}
