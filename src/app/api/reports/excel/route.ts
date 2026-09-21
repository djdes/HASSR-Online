import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { loadReportTable } from "@/lib/report-export-data";
import { REPORT_EMPTY_MESSAGE } from "@/lib/report-export";
import ExcelJS from "exceljs";
import { isManagementRole } from "@/lib/user-roles";

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    if (!isManagementRole(session.user.role) && !session.user.isRoot) {
      return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const templateCode = searchParams.get("templateCode");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const areaId = searchParams.get("areaId");

    if (!templateCode || !from || !to) {
      return NextResponse.json({ error: "templateCode, from, to обязательны" }, { status: 400 });
    }

    // Раньше: new Date(to + "T23:59:59.999Z") при невалидном to давал
    // Invalid Date — Prisma принимал как «без верхней границы», Excel
    // получался за всё время существования org-и. Плюс не было
    // max-range: from=2020 to=2030 ок'и проходило, сервер генерил
    // огромный xlsx 5-10 минут блокируя worker.
    const parsedFrom = Date.parse(from);
    const parsedTo = Date.parse(to);
    if (Number.isNaN(parsedFrom) || Number.isNaN(parsedTo)) {
      return NextResponse.json({ error: "Некорректный формат даты" }, { status: 400 });
    }
    if (parsedFrom > parsedTo) {
      return NextResponse.json({ error: "Дата начала позже даты окончания" }, { status: 400 });
    }
    const MAX_RANGE_MS = 366 * 24 * 60 * 60 * 1000;
    if (parsedTo - parsedFrom > MAX_RANGE_MS) {
      return NextResponse.json(
        { error: "Период отчёта не должен превышать 366 дней" },
        { status: 400 }
      );
    }

    const loaded = await loadReportTable({
      templateCode,
      organizationId: getActiveOrgId(session),
      dateFrom: from,
      dateTo: to,
      areaId,
    });

    if (!loaded) {
      return NextResponse.json({ error: "Шаблон не найден" }, { status: 404 });
    }
    const { templateName, table } = loaded;

    // Build workbook. Строки — документные записи журнала за период
    // (+ легаси JournalEntry, если есть), см. loadReportTable.
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "WeSetup";
    workbook.created = new Date();

    // Имя листа в Excel — до 31 символа и без спецсимволов []:*?/\
    const sheetName = templateName.replace(/[[\]:*?/\\]/g, " ").slice(0, 31) || "Журнал";
    const sheet = workbook.addWorksheet(sheetName);

    sheet.columns = table.headers.map((header, index) => ({
      header,
      key: `c${index}`,
      width: index === 0 ? 18 : Math.min(Math.max(header.length * 1.2, 14), 40),
    }));

    // Style header
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF2563EB" },
    };
    headerRow.alignment = { vertical: "middle", horizontal: "center", wrapText: true };

    if (table.isEmpty) {
      sheet.addRow([REPORT_EMPTY_MESSAGE]);
    } else {
      for (const row of table.rows) sheet.addRow(row);
    }

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();

    const filename = `report_${templateCode}_${from}_${to}.xlsx`;
    // inline=1 — запасной путь для оболочки Telegram (см. report-form.tsx):
    // WebView не умеет «скачать» blob, файл открывается переходом по ссылке.
    const disposition = searchParams.get("inline") === "1" ? "inline" : "attachment";

    return new NextResponse(buffer as ArrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `${disposition}; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("Excel export error:", error);
    return NextResponse.json({ error: "Внутренняя ошибка" }, { status: 500 });
  }
}
