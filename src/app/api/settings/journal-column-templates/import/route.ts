import { NextResponse } from "next/server";
import ExcelJS from "exceljs";

import { authOptions } from "@/lib/auth";
import { columnsFromHeaderLabels, findHeaderLabels } from "@/lib/journal-column-templates";
import { hasColumnRegistry, resolveColumns } from "@/lib/journal-columns";
import { getServerSession } from "@/lib/server-session";
import { isManagementRole } from "@/lib/user-roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Колонки журнала «по типовой форме» из Excel.
 *
 *   POST multipart { file: .xlsx, code } — разобрать шапку первого листа и
 *        вернуть превью: какие колонки узнали, какие станут своими;
 *   GET  ?code=… — образец: .xlsx с шапкой стандартного набора колонок.
 *
 * Книга читается exceljs (только .xlsx); ячейки берём через `cell.text`,
 * чтобы форматированный текст и формулы давали строку, а не объект.
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  if (!isManagementRole(session.user.role) && !session.user.isRoot) {
    return NextResponse.json({ error: "Загружать форму может руководитель" }, { status: 403 });
  }
  const form = await request.formData().catch(() => null);
  const code = String(form?.get("code") ?? "");
  const file = form?.get("file");
  if (!hasColumnRegistry(code)) {
    return NextResponse.json({ error: "У этого журнала колонки не настраиваются" }, { status: 404 });
  }
  if (!(file instanceof File)) return NextResponse.json({ error: "Файл не приложен" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Файл больше 2 МБ" }, { status: 413 });
  if (/\.xls$/i.test(file.name)) {
    return NextResponse.json(
      { error: "Старый формат .xls не читается — сохраните файл в Excel как .xlsx и загрузите снова" },
      { status: 400 }
    );
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(await file.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "Не удалось прочитать файл. Нужен .xlsx" }, { status: 400 });
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) return NextResponse.json({ error: "В файле нет листов" }, { status: 400 });

  const grid: string[][] = [];
  const lastRow = Math.min(sheet.rowCount, 15);
  for (let r = 1; r <= lastRow; r += 1) {
    const row = sheet.getRow(r);
    const cells: string[] = [];
    const lastCol = Math.min(row.cellCount || sheet.columnCount, 40);
    for (let c = 1; c <= lastCol; c += 1) {
      cells.push(String(row.getCell(c).text ?? "").trim());
    }
    grid.push(cells);
  }
  const labels = findHeaderLabels(grid);
  if (labels.length === 0) {
    return NextResponse.json({ error: "В первых строках листа не нашлось шапки таблицы" }, { status: 400 });
  }
  const preview = columnsFromHeaderLabels(code, labels);
  if (preview.matched.length === 0 && preview.custom.length === 0) {
    return NextResponse.json({ error: "Не удалось узнать ни одной колонки" }, { status: 400 });
  }
  return NextResponse.json({ labels, ...preview });
}

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const code = new URL(request.url).searchParams.get("code") ?? "";
  if (!hasColumnRegistry(code)) {
    return NextResponse.json({ error: "У этого журнала колонки не настраиваются" }, { status: 404 });
  }
  const columns = resolveColumns(code, {}).filter((column) => !column.hidden && !column.unavailable);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Форма журнала");
  sheet.addRow(columns.map((column) => column.label));
  sheet.addRow(columns.map((_, index) => String(index + 1)));
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { wrapText: true, vertical: "middle", horizontal: "center" };
  sheet.columns.forEach((column) => {
    column.width = 22;
  });
  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="journal-form-${code}.xlsx"`,
    },
  });
}
