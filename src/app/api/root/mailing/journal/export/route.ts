import { NextResponse } from "next/server";

import { recordAuditLog } from "@/lib/audit-log";
import { requireRoot } from "@/lib/auth-helpers";
import { PLATFORM_ORG_ID } from "@/lib/mailing/campaigns.server";
import { mailingErrorResponse } from "@/lib/mailing/http.server";
import { journalCsv, normalizeJournalFilters } from "@/lib/mailing/operations.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — журнал отправки целиком по тем же фильтрам, CSV для Excel. */
export async function GET(request: Request) {
  const session = await requireRoot();
  try {
    const filters = normalizeJournalFilters(Object.fromEntries(new URL(request.url).searchParams));
    const { csv, rows, truncated } = await journalCsv(filters);
    // Выгрузка адресов — в аудит, как и остальные действия раздела.
    await recordAuditLog({
      request,
      session,
      organizationId: PLATFORM_ORG_ID,
      action: "mailing.journal.export",
      entity: "MailingCampaign",
      entityId: filters.campaign || null,
      details: { filters, rows, truncated },
    });
    const stamp = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const name = `mailing-journal-${filters.campaign || "all"}-${stamp}.csv`;
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
        ...(truncated ? { "X-Mailing-Truncated": "1" } : {}),
      },
    });
  } catch (error) {
    return mailingErrorResponse(error, "journal export");
  }
}
