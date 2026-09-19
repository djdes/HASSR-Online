import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import {
  TRACEABILITY_IMPORT_COLUMNS,
  createTraceabilityRow,
  normalizeTraceabilityRow,
  validateTraceabilityRow,
} from "@/lib/traceability-document";
import { isManagementRole } from "@/lib/user-roles";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { canWriteJournal } from "@/lib/journal-acl";

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

type ImportError = {
  rowNumber: number;
  errors: string[];
};

function normalizeHeaderCell(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/°/g, "")
    .replace(/№/g, "")
    .replace(/т/g, "t")
    .replace(/с/g, "c")
    .replace(/[.,]/g, "")
    .replace(/\/+/g, " ")
    .replace(/\s+/g, " ");
}

function trimTrailingEmptyCells(row: unknown[]) {
  let end = row.length;

  while (end > 0) {
    const value = row[end - 1];
    if (value !== null && value !== undefined && String(value).trim() !== "") break;
    end -= 1;
  }

  return row.slice(0, end);
}

function parseIsoDateCell(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  const text = String(value ?? "").trim();
  if (!text) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  const match = text.match(/^(\d{2})[./-](\d{2})[./-](\d{4})$/);
  if (match) {
    const [, day, month, year] = match;
    return `${year}-${month}-${day}`;
  }

  return "";
}

function parseNumericCell(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  const text = String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(",", ".");

  if (!text) return null;

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTypedQuantity(value: unknown) {
  const parsed = parseNumericCell(value);
  if (parsed == null) return { pieces: null, kg: null };

  const asText = String(value ?? "").trim();
  const hasFraction = /[.,]\d+$/.test(asText);

  if (hasFraction) {
    return { pieces: null, kg: parsed };
  }

  return { pieces: parsed, kg: null };
}

function normalizeCellText(value: unknown) {
  return String(value ?? "").trim();
}

function buildRowFromCells(cells: unknown[]) {
  const date = parseIsoDateCell(cells[0]);
  const incomingQuantity = parseTypedQuantity(cells[4]);
  const outgoingQuantity = parseTypedQuantity(cells[6]);

  return createTraceabilityRow({
    date,
    incoming: {
      rawMaterialName: normalizeCellText(cells[1]),
      batchNumber: normalizeCellText(cells[2]),
      packagingDate: parseIsoDateCell(cells[3]),
      quantityPieces: incomingQuantity.pieces,
      quantityKg: incomingQuantity.kg,
    },
    outgoing: {
      productName: normalizeCellText(cells[5]),
      quantityPacksPieces: outgoingQuantity.pieces,
      quantityPacksKg: outgoingQuantity.kg,
      shockTemp: parseNumericCell(cells[7]),
    },
  });
}

function buildRowErrors(rowNumber: number, row: ReturnType<typeof buildRowFromCells>) {
  return validateTraceabilityRow(row).map((issue) => ({
    field: issue.field,
    message: issue.message,
    rowNumber,
  }));
}

function asImportResponse(params: {
  rows: ReturnType<typeof normalizeTraceabilityRow>[];
  errors: ImportError[];
  importedCount: number;
  status?: number;
}) {
  return NextResponse.json(
    {
      rows: params.rows,
      errors: params.errors,
      importedCount: params.importedCount,
    },
    { status: params.status ?? 200 }
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return asImportResponse({
      rows: [],
      errors: [{ rowNumber: 0, errors: ["Не авторизован"] }],
      importedCount: 0,
      status: 401,
    });
  }

  const { id } = await params;
  if (!id) {
    return asImportResponse({
      rows: [],
      errors: [{ rowNumber: 0, errors: ["Документ не найден"] }],
      importedCount: 0,
      status: 400,
    });
  }

  // Документ проверяем ДО разбора файла: раньше ручка вообще его не
  // открывала, и строки можно было загрузить в чужой и в закрытый
  // документ — закрытый период после этого переставал сходиться.
  const document = await db.journalDocument.findUnique({
    where: { id },
    select: {
      organizationId: true,
      status: true,
      template: { select: { code: true } },
    },
  });
  if (!document || document.organizationId !== getActiveOrgId(session)) {
    return asImportResponse({
      rows: [],
      errors: [{ rowNumber: 0, errors: ["Документ не найден"] }],
      importedCount: 0,
      status: 404,
    });
  }
  if (document.status !== "active") {
    return asImportResponse({
      rows: [],
      errors: [
        {
          rowNumber: 0,
          errors: [
            "Документ закрыт. Верните его в активные, чтобы загрузить строки.",
          ],
        },
      ],
      importedCount: 0,
      status: 400,
    });
  }
  const canWrite =
    isManagementRole(session.user.role) ||
    (Boolean(document.template?.code) &&
      (await canWriteJournal(
        {
          id: session.user.id,
          role: session.user.role,
          isRoot: session.user.isRoot === true,
        },
        document.template!.code
      )));
  if (!canWrite) {
    return asImportResponse({
      rows: [],
      errors: [{ rowNumber: 0, errors: ["Недостаточно прав"] }],
      importedCount: 0,
      status: 403,
    });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return asImportResponse({
      rows: [],
      errors: [{ rowNumber: 0, errors: ["Некорректная форма загрузки"] }],
      importedCount: 0,
      status: 400,
    });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return asImportResponse({
      rows: [],
      errors: [{ rowNumber: 0, errors: ["Файл не загружен"] }],
      importedCount: 0,
      status: 400,
    });
  }

  if (file.size > MAX_IMPORT_BYTES) {
    return asImportResponse({
      rows: [],
      errors: [
        {
          rowNumber: 0,
          errors: [
            `Файл слишком большой. Максимум ${Math.round(
              MAX_IMPORT_BYTES / 1024 / 1024
            )} МБ.`,
          ],
        },
      ],
      importedCount: 0,
      status: 413,
    });
  }

  let workbook: XLSX.WorkBook;
  try {
    const bytes = await file.arrayBuffer();
    workbook = XLSX.read(bytes, {
      type: "array",
      cellDates: true,
    });
  } catch {
    return asImportResponse({
      rows: [],
      errors: [{ rowNumber: 0, errors: ["Не удалось прочитать Excel-файл"] }],
      importedCount: 0,
      status: 400,
    });
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return asImportResponse({
      rows: [],
      errors: [{ rowNumber: 0, errors: ["Файл пустой"] }],
      importedCount: 0,
      status: 400,
    });
  }

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    blankrows: false,
    raw: false,
  });

  if (matrix.length === 0) {
    return asImportResponse({
      rows: [],
      errors: [{ rowNumber: 0, errors: ["Файл пустой"] }],
      importedCount: 0,
      status: 400,
    });
  }

  const headerRow = trimTrailingEmptyCells(matrix[0] ?? []);
  if (headerRow.length !== TRACEABILITY_IMPORT_COLUMNS.length) {
    return asImportResponse({
      rows: [],
      errors: [
        {
          rowNumber: 1,
          errors: [
            `Ожидалось ровно ${TRACEABILITY_IMPORT_COLUMNS.length} колонок в фиксированном порядке`,
          ],
        },
      ],
      importedCount: 0,
      status: 400,
    });
  }

  const expectedHeaders = TRACEABILITY_IMPORT_COLUMNS.map(normalizeHeaderCell);
  const actualHeaders = headerRow.map(normalizeHeaderCell);
  for (let index = 0; index < expectedHeaders.length; index += 1) {
    if (actualHeaders[index] !== expectedHeaders[index]) {
      return asImportResponse({
        rows: [],
        errors: [
          {
            rowNumber: 1,
            errors: [
              `Колонка ${index + 1} должна быть "${TRACEABILITY_IMPORT_COLUMNS[index]}"`,
            ],
          },
        ],
        importedCount: 0,
        status: 400,
      });
    }
  }

  const importedRows: ReturnType<typeof normalizeTraceabilityRow>[] = [];
  const errors: ImportError[] = [];

  for (let index = 1; index < matrix.length; index += 1) {
    const rowNumber = index + 1;
    const cells = trimTrailingEmptyCells(matrix[index] ?? []);

    if (cells.length === 0) {
      continue;
    }

    if (cells.length !== TRACEABILITY_IMPORT_COLUMNS.length) {
      errors.push({
        rowNumber,
        errors: [
          `Ожидалось ${TRACEABILITY_IMPORT_COLUMNS.length} значений, получено ${cells.length}`,
        ],
      });
      continue;
    }

    const row = normalizeTraceabilityRow(buildRowFromCells(cells));
    const rowErrors = buildRowErrors(rowNumber, row);

    if (rowErrors.length > 0) {
      errors.push({
        rowNumber,
        errors: rowErrors.map((item) => `${item.field}: ${item.message}`),
      });
      continue;
    }

    importedRows.push(row);
  }

  return asImportResponse({
    rows: importedRows,
    errors,
    importedCount: importedRows.length,
  });
}
