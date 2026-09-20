import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { resolveOrgJournalName } from "@/lib/org-journal-name";
import { generateJournalPDF } from "@/lib/pdf";
import { isManagementRole } from "@/lib/user-roles";

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json(
        { error: "Не авторизован" },
        { status: 401 }
      );
    }

    // Management + ROOT impersonation. Раньше missing isRoot bypass
    // — ROOT не мог скачать отчёт за импесонируемого клиента.
    if (!isManagementRole(session.user.role) && !session.user.isRoot) {
      return NextResponse.json(
        { error: "Это действие доступно руководителю" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const templateCode = searchParams.get("template");
    const dateFrom = searchParams.get("from");
    const dateTo = searchParams.get("to");
    const areaId = searchParams.get("area") || undefined;

    if (!templateCode || !dateFrom || !dateTo) {
      return NextResponse.json(
        { error: "Укажите шаблон журнала, дату начала и дату окончания" },
        { status: 400 }
      );
    }

    // Validate date format
    const parsedFrom = Date.parse(dateFrom);
    const parsedTo = Date.parse(dateTo);
    if (Number.isNaN(parsedFrom) || Number.isNaN(parsedTo)) {
      return NextResponse.json(
        { error: "Некорректный формат даты" },
        { status: 400 }
      );
    }
    // Раньше: from=2020 to=2030 принимались, сервер несколько минут
    // генерил гигантский PDF и блокировал workers. Теперь sanity-bounds.
    if (parsedFrom > parsedTo) {
      return NextResponse.json(
        { error: "Дата начала позже даты окончания" },
        { status: 400 }
      );
    }
    const MAX_RANGE_MS = 366 * 24 * 60 * 60 * 1000;
    if (parsedTo - parsedFrom > MAX_RANGE_MS) {
      return NextResponse.json(
        { error: "Период отчёта не должен превышать 366 дней" },
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
    });

    const fileName = `report_${templateCode}_${dateFrom}_${dateTo}.pdf`;

    const uint8 = new Uint8Array(pdfBuffer);

    return new Response(uint8, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(uint8.length),
      },
    });
  } catch (error) {
    console.error("PDF generation error:", error);
    const message =
      error instanceof Error ? error.message : "Внутренняя ошибка сервера";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
