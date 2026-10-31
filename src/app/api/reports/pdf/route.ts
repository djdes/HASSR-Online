import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { resolveOrgJournalName } from "@/lib/org-journal-name";
import { generateJournalPDF } from "@/lib/pdf";
import { getViewedPointId } from "@/lib/active-building";
import { isManagementRole } from "@/lib/user-roles";
import { resolveExportLocale } from "@/i18n/export-locale";
import { translatorFor } from "@/i18n/translator";
import { parseReportDate } from "@/lib/report-export";

export async function GET(request: Request) {
  let t = await translatorFor("ru");
  try {
    const session = await getServerSession(authOptions);
    const { searchParams } = new URL(request.url);
    const locale = resolveExportLocale(searchParams.get("locale"), session?.user ?? {});
    t = await translatorFor(locale ?? resolveExportLocale(null, session?.user ?? {})!);

    if (!session) {
      return NextResponse.json(
        { code: "REPORT_UNAUTHORIZED", error: t("reports.errors.unauthorized") },
        { status: 401 }
      );
    }

    // Management + ROOT impersonation. Раньше missing isRoot bypass
    // — ROOT не мог скачать отчёт за импесонируемого клиента.
    if (!isManagementRole(session.user.role) && !session.user.isRoot) {
      return NextResponse.json(
        { code: "REPORT_MANAGEMENT_ONLY", error: t("reports.errors.managementOnly") },
        { status: 403 }
      );
    }

    if (!locale) {
      return NextResponse.json({ code: "INVALID_LOCALE", error: t("language.invalid") }, { status: 400 });
    }
    const templateCode = searchParams.get("template");
    const dateFrom = searchParams.get("from");
    const dateTo = searchParams.get("to");
    const areaId = searchParams.get("area") || undefined;

    if (!templateCode || !dateFrom || !dateTo) {
      return NextResponse.json(
        { code: "REPORT_REQUIRED_PARAMETERS_PDF", error: t("reports.errors.requiredParametersPdf") },
        { status: 400 }
      );
    }

    // Validate date format
    const parsedFrom = parseReportDate(dateFrom);
    const parsedTo = parseReportDate(dateTo);
    if (parsedFrom === null || parsedTo === null) {
      return NextResponse.json(
        { code: "REPORT_INVALID_DATE", error: t("reports.errors.invalidDate") },
        { status: 400 }
      );
    }
    // Раньше: from=2020 to=2030 принимались, сервер несколько минут
    // генерил гигантский PDF и блокировал workers. Теперь sanity-bounds.
    if (parsedFrom > parsedTo) {
      return NextResponse.json(
        { code: "REPORT_DATE_ORDER", error: t("reports.errors.dateOrder") },
        { status: 400 }
      );
    }
    const MAX_RANGE_MS = 366 * 24 * 60 * 60 * 1000;
    if (parsedTo - parsedFrom > MAX_RANGE_MS) {
      return NextResponse.json(
        { code: "REPORT_PERIOD_TOO_LONG", error: t("reports.errors.periodTooLong") },
        { status: 400 }
      );
    }

    // Название — из базы и как в шапке журналов, а не снимок из сессии:
    // в JWT оно устаревает до перелогина, у ROOT в чужой организации — своё.
    const organization = await db.organization.findUnique({
      where: { id: getActiveOrgId(session) },
      select: { name: true, journalShortName: true, legalProfileJson: true },
    });
    const pdfBuffer = await generateJournalPDF({
      templateCode,
      organizationId: getActiveOrgId(session),
      organizationName: resolveOrgJournalName(organization),
      dateFrom,
      dateTo,
      areaId,
      locale,
      // Точка из шапки: только её документы и цеха (2026-10-31).
      pointId: await getViewedPointId(session),
    });

    const fileName = `report_${templateCode}_${dateFrom}_${dateTo}.pdf`;

    const uint8 = new Uint8Array(pdfBuffer);

    return new Response(uint8, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        // inline=1 — запасной путь для оболочки Telegram (см. report-form.tsx).
        "Content-Disposition": `${searchParams.get("inline") === "1" ? "inline" : "attachment"}; filename="${fileName}"`,
        "Content-Length": String(uint8.length),
        "Content-Language": locale,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("PDF generation error:", error);
    return NextResponse.json({ code: "REPORT_INTERNAL", error: t("reports.errors.internalServer") }, { status: 500 });
  }
}
