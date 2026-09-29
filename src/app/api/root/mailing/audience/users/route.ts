import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { filterAudienceUsers, normalizeUserFilters } from "@/lib/mailing/audience";
import { loadAudienceUsers } from "@/lib/mailing/audience.server";
import { intParam, mailingErrorResponse } from "@/lib/mailing/http.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/root/mailing/audience/users — пользователи для рассылки с
 * фильтрами (роль, сфера, тариф, поиск, каналы, дата регистрации).
 * `idsOnly=1` — все найденные id для «выбрать всех найденных».
 */
export async function GET(request: Request) {
  await requireRoot();
  try {
    const params = new URL(request.url).searchParams;
    const filters = normalizeUserFilters(Object.fromEntries(params.entries()));
    const rows = filterAudienceUsers(await loadAudienceUsers(), filters);
    if (params.get("idsOnly") === "1") {
      return NextResponse.json({ total: rows.length, ids: rows.map((r) => r.id) });
    }
    const offset = intParam(params.get("offset"), 0, 0, 1_000_000);
    const limit = intParam(params.get("limit"), 100, 1, 500);
    return NextResponse.json({ total: rows.length, rows: rows.slice(offset, offset + limit), filters });
  } catch (error) {
    return mailingErrorResponse(error, "audience users");
  }
}
