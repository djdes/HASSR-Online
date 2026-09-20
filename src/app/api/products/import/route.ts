import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { isManagementRole } from "@/lib/user-roles";
import * as XLSX from "xlsx";

// Hard limit on the uploaded spreadsheet to prevent OOM when parsing into memory.
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const MAX_IMPORT_ROWS = 20_000;

// Column name mappings for iiko, 1C, and generic Russian Excel exports
const COLUMN_MAP: Record<string, string> = {
  // Product name
  "наименование": "name",
  "название": "name",
  "товар": "name",
  "продукт": "name",
  "номенклатура": "name",
  "name": "name",
  "product": "name",
  // Supplier
  "поставщик": "supplier",
  "контрагент": "supplier",
  "производитель": "supplier",
  "supplier": "supplier",
  "vendor": "supplier",
  // Barcode
  "штрихкод": "barcode",
  "штрих-код": "barcode",
  "штрих код": "barcode",
  "баркод": "barcode",
  "ean": "barcode",
  "barcode": "barcode",
  // Unit
  "единица": "unit",
  "единица измерения": "unit",
  "ед.изм.": "unit",
  "ед. изм.": "unit",
  "ед.": "unit",
  "unit": "unit",
  // Category
  "категория": "category",
  "группа": "category",
  "category": "category",
  "group": "category",
  // Storage temperature
  "температура хранения": "storageTemp",
  "условия хранения": "storageTemp",
  "хранение": "storageTemp",
  "storage": "storageTemp",
  // Shelf life
  "срок годности": "shelfLifeDays",
  "срок хранения": "shelfLifeDays",
  "shelf life": "shelfLifeDays",
};

// Unit normalization
const UNIT_MAP: Record<string, string> = {
  "кг": "kg",
  "килограмм": "kg",
  "kg": "kg",
  "л": "l",
  "литр": "l",
  "l": "l",
  "шт": "pcs",
  "штука": "pcs",
  "штук": "pcs",
  "pcs": "pcs",
  "г": "g",
  "грамм": "g",
  "g": "g",
  "мл": "ml",
  "миллилитр": "ml",
  "ml": "ml",
  "уп": "pack",
  "упаковка": "pack",
  "pack": "pack",
};

function normalizeColumnName(col: string): string | null {
  const lower = col.toLowerCase().trim();
  return COLUMN_MAP[lower] || null;
}

function normalizeUnit(unit: string): string {
  const lower = unit.toLowerCase().trim().replace(/\.$/, "");
  return UNIT_MAP[lower] || "kg";
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    // Раньше: только legacy "operator" блокировался — после миграции
    // схемы "cook"/"waiter"/"cleaner" могли импортировать каталог
    // (overwrite product DB всей организации). Теперь проверяем
    // management role (manager + head_chef + legacy owner/technologist).
    if (!isManagementRole(session.user.role) && !session.user.isRoot) {
      return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "Файл не загружен" },
        { status: 400 }
      );
    }

    if (file.size > MAX_IMPORT_BYTES) {
      return NextResponse.json(
        {
          error: `Файл слишком большой (максимум ${MAX_IMPORT_BYTES / 1024 / 1024} MB). Разбейте выгрузку на несколько файлов.`,
        },
        { status: 413 }
      );
    }

    // Parse Excel/CSV
    const bytes = await file.arrayBuffer();
    const workbook = XLSX.read(bytes, { type: "array" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

    if (rawRows.length === 0) {
      return NextResponse.json(
        { error: "Файл пустой или не содержит данных" },
        { status: 400 }
      );
    }

    if (rawRows.length > MAX_IMPORT_ROWS) {
      return NextResponse.json(
        {
          error: `Слишком много строк (${rawRows.length}). Максимум за один импорт — ${MAX_IMPORT_ROWS}.`,
        },
        { status: 413 }
      );
    }

    // Map columns
    const firstRow = rawRows[0];
    const columnMapping: Record<string, string> = {};
    for (const col of Object.keys(firstRow)) {
      const mapped = normalizeColumnName(col);
      if (mapped) {
        columnMapping[col] = mapped;
      }
    }

    if (!Object.values(columnMapping).includes("name")) {
      return NextResponse.json(
        {
          error:
            'Не найден столбец с названием продукта. Ожидается: "Наименование", "Название", "Товар", "Номенклатура" или "Продукт"',
        },
        { status: 400 }
      );
    }

    // Process rows
    const products: Array<{
      name: string;
      supplier: string | null;
      barcode: string | null;
      unit: string;
      category: string | null;
      storageTemp: string | null;
      shelfLifeDays: number | null;
      organizationId: string;
    }> = [];

    let skipped = 0;

    for (const row of rawRows) {
      const mapped: Record<string, unknown> = {};
      for (const [origCol, mappedCol] of Object.entries(columnMapping)) {
        mapped[mappedCol] = row[origCol];
      }

      const name = String(mapped.name || "").trim();
      if (!name) {
        skipped++;
        continue;
      }

      const unitRaw = String(mapped.unit || "kg").trim();
      const shelfRaw = mapped.shelfLifeDays;
      let shelfDays: number | null = null;
      if (shelfRaw != null && shelfRaw !== "") {
        const parsed = parseInt(String(shelfRaw), 10);
        if (!isNaN(parsed)) shelfDays = parsed;
      }

      products.push({
        name,
        supplier: mapped.supplier ? String(mapped.supplier).trim() : null,
        barcode: mapped.barcode ? String(mapped.barcode).trim() : null,
        unit: normalizeUnit(unitRaw),
        category: mapped.category ? String(mapped.category).trim() : null,
        storageTemp: mapped.storageTemp
          ? String(mapped.storageTemp).trim()
          : null,
        shelfLifeDays: shelfDays,
        organizationId: getActiveOrgId(session),
      });
    }

    if (products.length === 0) {
      return NextResponse.json(
        { error: "Не найдено ни одного продукта с названием" },
        { status: 400 }
      );
    }

    // `skipDuplicates` здесь не работал: у Product нет unique-индекса по
    // (organizationId, name), только обычный @@index. Повторный импорт того
    // же файла задваивал весь справочник. Отсеиваем дубли сами — и по уже
    // заведённым продуктам, и внутри самого файла.
    const existing = await db.product.findMany({
      where: { organizationId: getActiveOrgId(session) },
      select: { name: true },
    });
    const seen = new Set(existing.map((item) => item.name.trim().toLowerCase()));
    const fresh: typeof products = [];
    let duplicates = 0;
    for (const product of products) {
      const key = product.name.trim().toLowerCase();
      if (seen.has(key)) {
        duplicates++;
        continue;
      }
      seen.add(key);
      fresh.push(product);
    }

    const result =
      fresh.length > 0
        ? await db.product.createMany({ data: fresh })
        : { count: 0 };

    return NextResponse.json({
      imported: result.count,
      skipped,
      duplicates,
      total: rawRows.length,
    });
  } catch (error) {
    console.error("Product import error:", error);
    return NextResponse.json(
      { error: "Ошибка импорта. Проверьте формат файла." },
      { status: 500 }
    );
  }
}
