import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { mailingErrorResponse } from "@/lib/mailing/http.server";
import { getJournal, normalizeJournalFilters } from "@/lib/mailing/operations.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET ?campaign=&status=&reason=&search=&from=&to=&page= — журнал отправки:
 * каждый получатель — кому, когда, что, статус, причина; по 50 на странице.
 */
export async function GET(request: Request) {
  await requireRoot();
  try {
    const params = Object.fromEntries(new URL(request.url).searchParams);
    return NextResponse.json(await getJournal(normalizeJournalFilters(params)));
  } catch (error) {
    return mailingErrorResponse(error, "journal");
  }
}
