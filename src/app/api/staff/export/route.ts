import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { isManagementRole } from "@/lib/user-roles";
import {
  INHERIT_JOURNALS_LABEL,
  STAFF_COLUMNS,
  STAFF_SHEET_NAME,
  buildStaffExportRow,
} from "@/lib/staff-excel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/staff/export — выгрузка сотрудников в Excel.
 * GET /api/staff/export?template=1 — пустой шаблон для заполнения.
 *
 * Шаблон намеренно отдаёт ТОТ ЖЕ эндпоинт: разъехавшиеся шаблон и
 * импорт — это «файл не подходит» на файле, который мы сами и выдали.
 *
 * Пароли и логины не выгружаются: логин у большинства сотрудников
 * синтетический (вход через Telegram), а показывать его в файле,
 * который пойдёт по почте, незачем.
 */
export async function GET(request: Request) {
  const session = await requireAuth();
  if (!isManagementRole(session.user.role) && !session.user.isRoot) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const orgId = getActiveOrgId(session);
  const isTemplate = new URL(request.url).searchParams.get("template") === "1";

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "WeSetup";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(STAFF_SHEET_NAME);
  sheet.columns = STAFF_COLUMNS.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width,
  }));

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF5566F6" },
  };
  headerRow.alignment = { vertical: "middle" };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  if (isTemplate) {
    // Две строки-примера, а не пустой лист: человек видит формат
    // выходных и журналов и не гадает, как их писать.
    sheet.addRow({
      fullName: "Иванова Мария Петровна",
      position: "Повар",
      phone: "+7 999 123-45-67",
      contactEmail: "ivanova@example.ru",
      daysOff: "Сб, Вс",
      journals: INHERIT_JOURNALS_LABEL,
    });
    sheet.addRow({
      fullName: "Сидоров Пётр Иванович",
      position: "Уборщица",
      phone: "",
      contactEmail: "",
      daysOff: "Вс",
      journals: INHERIT_JOURNALS_LABEL,
    });

    const guide = workbook.addWorksheet("Инструкция");
    guide.columns = [
      { header: "Колонка", key: "column", width: 22 },
      { header: "Читается при загрузке", key: "imported", width: 22 },
      { header: "Что писать", key: "hint", width: 70 },
    ];
    guide.getRow(1).font = { bold: true };
    for (const column of STAFF_COLUMNS) {
      guide.addRow({
        column: column.header,
        imported: column.imported ? "да" : "нет",
        hint: column.hint,
      });
    }
    guide.addRow({});
    guide.addRow({
      column: "Строки-примеры",
      imported: "",
      hint: "Удалите их перед загрузкой или замените своими данными.",
    });
    guide.addRow({
      column: "Повторная загрузка",
      imported: "",
      hint: "Безопасна: уже заведённые сотрудники будут пропущены, а не задвоены.",
    });
  } else {
    const users = await db.user.findMany({
      where: { organizationId: orgId },
      orderBy: [{ archivedAt: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        positionTitle: true,
        phone: true,
        contactEmail: true,
        email: true,
        weeklyDaysOff: true,
        telegramChatId: true,
        isActive: true,
        archivedAt: true,
        journalAccessMigrated: true,
        jobPosition: { select: { name: true } },
      },
    });

    // Названия журналов достаём одним запросом на всю выгрузку, а не по
    // сотруднику: на сотне человек это сотня лишних round-trip'ов.
    const [accessRows, templates] = await Promise.all([
      db.userJournalAccess.findMany({
        where: { userId: { in: users.map((user) => user.id) }, canRead: true },
        select: { userId: true, templateCode: true },
      }),
      db.journalTemplate.findMany({ select: { code: true, name: true } }),
    ]);
    const templateName = new Map(templates.map((item) => [item.code, item.name]));
    const namesByUser = new Map<string, string[]>();
    for (const row of accessRows) {
      const list = namesByUser.get(row.userId) ?? [];
      list.push(templateName.get(row.templateCode) ?? row.templateCode);
      namesByUser.set(row.userId, list);
    }

    for (const user of users) {
      sheet.addRow(
        buildStaffExportRow({
          ...user,
          jobPositionName: user.jobPosition?.name ?? null,
          journalNames: (namesByUser.get(user.id) ?? []).sort((a, b) =>
            a.localeCompare(b, "ru")
          ),
        })
      );
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = isTemplate
    ? "wesetup-sotrudniki-shablon.xlsx"
    : `wesetup-sotrudniki-${new Date().toISOString().slice(0, 10)}.xlsx`;

  return new NextResponse(buffer as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
