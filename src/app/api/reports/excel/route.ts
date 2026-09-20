import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
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

    const template = await db.journalTemplate.findUnique({
      where: { code: templateCode },
    });

    if (!template) {
      return NextResponse.json({ error: "Шаблон не найден" }, { status: 404 });
    }

    const where: Record<string, unknown> = {
      templateId: template.id,
      organizationId: getActiveOrgId(session),
      createdAt: {
        gte: new Date(from),
        lte: new Date(to + "T23:59:59.999Z"),
      },
    };

    if (areaId) {
      where.areaId = areaId;
    }

    const entries = await db.journalEntry.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        filledBy: { select: { name: true } },
        area: { select: { name: true } },
        equipment: { select: { name: true } },
      },
    });

    // Parse template fields
    const fields = template.fields as Array<{
      key: string;
      label: string;
      type: string;
      options?: Array<{ value: string; label: string }>;
    }>;

    // Build workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "WeSetup";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet(template.name);

    // Columns: Дата, Сотрудник, Участок, Оборудование + dynamic fields
    const columns: Partial<ExcelJS.Column>[] = [
      { header: "Дата", key: "date", width: 18 },
      { header: "Сотрудник", key: "filledBy", width: 20 },
      { header: "Участок", key: "area", width: 18 },
      { header: "Оборудование", key: "equipment", width: 18 },
    ];

    for (const field of fields) {
      if (field.type === "equipment" || field.type === "employee") continue;
      columns.push({
        header: field.label,
        key: field.key,
        width: Math.max(field.label.length * 1.5, 14),
      });
    }

    sheet.columns = columns;

    // Style header
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF2563EB" },
    };
    headerRow.alignment = { vertical: "middle", horizontal: "center" };

    // Add data rows
    for (const entry of entries) {
      const data = entry.data as Record<string, unknown>;
      const row: Record<string, unknown> = {
        date: entry.createdAt.toLocaleString("ru-RU"),
        filledBy: entry.filledBy.name,
        area: entry.area?.name ?? "—",
        equipment: entry.equipment?.name ?? "—",
      };

      for (const field of fields) {
        if (field.type === "equipment" || field.type === "employee") continue;
        let val = data[field.key];
        // Resolve select labels
        if (field.options && typeof val === "string") {
          const opt = field.options.find((o) => o.value === val);
          if (opt) val = opt.label;
        }
        // Boolean → Да/Нет
        if (field.type === "boolean") {
          val = val ? "Да" : "Нет";
        }
        row[field.key] = val ?? "—";
      }

      sheet.addRow(row);
    }

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();

    const filename = `report_${templateCode}_${from}_${to}.xlsx`;

    return new NextResponse(buffer as ArrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("Excel export error:", error);
    return NextResponse.json({ error: "Внутренняя ошибка" }, { status: 500 });
  }
}
