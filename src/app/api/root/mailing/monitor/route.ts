import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { mailingErrorResponse } from "@/lib/mailing/http.server";
import { monitorCampaigns } from "@/lib/mailing/operations.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — «Сейчас идут»: активные рассылки и завершённые за 3 дня с прогрессом. */
export async function GET() {
  await requireRoot();
  try {
    return NextResponse.json(await monitorCampaigns());
  } catch (error) {
    return mailingErrorResponse(error, "monitor");
  }
}
