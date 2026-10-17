import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import {
  INSPECTION_VISIT_ERRORS,
  INSPECTION_VISIT_FILE_MAX_BYTES,
  INSPECTION_VISIT_MAX_FILES,
  INSPECTION_VISIT_MAX_REQUEST_BYTES,
  INSPECTION_VISIT_MAX_TOTAL_BYTES,
  inspectionVisitFileName,
  type InspectionVisitFields,
} from "@/lib/inspection-visits";
import { ORDER_SCAN_ERRORS } from "@/lib/journal-order-scans";
import { validateOrderScanFile } from "@/lib/journal-order-scans-pdf";

/**
 * Журнал посещений — запись в БД, проверка вложений, выборки для кабинета,
 * портала и архива. Файлы лежат в `InspectionVisitFile.content` и отдаются
 * только через API с проверкой прав — публичной ссылки на файл нет.
 */

export type CheckedVisitFile = { fileName: string; mimeType: string; bytes: Uint8Array<ArrayBuffer> };

/** Тело запроса больше предела — отказ до чтения формы. */
export function inspectionVisitRequestTooBig(request: Request): boolean {
  const length = Number(request.headers.get("content-length") ?? "");
  return Number.isFinite(length) && length > INSPECTION_VISIT_MAX_REQUEST_BYTES;
}

/** Файлы из формы (`file`, несколько) — только непустые поля типа File. */
export function visitFilesFromForm(form: FormData): File[] {
  return form.getAll("file").filter((item): item is File => item instanceof File && (item.size > 0 || item.name !== ""));
}

/**
 * Проверка вложений: число, размер, тип по содержимому (HEIC и чужие
 * форматы — отказ), PDF открывается, картинка встраивается в PDF. Правила
 * те же, что у сканов приказов (`validateOrderScanFile`).
 */
export async function checkInspectionVisitFiles(
  files: File[],
  already = 0
): Promise<{ ok: true; files: CheckedVisitFile[] } | { ok: false; error: string; status: number }> {
  if (files.length + already > INSPECTION_VISIT_MAX_FILES) {
    // К новой записи — ошибка формы; к записи, где файлы уже есть, — конфликт.
    return { ok: false, error: INSPECTION_VISIT_ERRORS.tooMany, status: already > 0 ? 409 : 400 };
  }
  if (files.some((file) => file.size > INSPECTION_VISIT_FILE_MAX_BYTES)) {
    return { ok: false, error: INSPECTION_VISIT_ERRORS.tooBig, status: 413 };
  }
  // Без Content-Length (chunked) предел тела не проверить заранее — сумма здесь.
  if (files.reduce((sum, file) => sum + file.size, 0) > INSPECTION_VISIT_MAX_TOTAL_BYTES) {
    return { ok: false, error: INSPECTION_VISIT_ERRORS.requestTooBig, status: 413 };
  }
  const checked: CheckedVisitFile[] = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await validateOrderScanFile({ bytes, fileName: file.name, declaredMime: file.type });
    if (!result.ok) {
      const error = result.error === ORDER_SCAN_ERRORS.empty ? INSPECTION_VISIT_ERRORS.empty : result.error;
      return { ok: false, error, status: 400 };
    }
    checked.push({ fileName: storedVisitFileName(file.name), mimeType: result.mime, bytes });
  }
  return { ok: true, files: checked };
}

/** Имя файла для хранения: без управляющих символов, не длиннее 255. */
export function storedVisitFileName(name: string): string {
  const clean = name.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return (clean || "osnovanie").slice(0, 255);
}

/**
 * Отказ без подсказки (AC3): тот же 404 на «нет файла», «чужой», «нет
 * права» и «ссылка больше не действует»; не кэшируется.
 */
export function inspectionVisitNotFound(): Response {
  return new Response("Не найдено", {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

/** Сколько записей внесено по токену за последние сутки. */
export async function countTokenVisitsLastDay(tokenId: string, now = new Date()): Promise<number> {
  return db.inspectionVisit.count({
    where: { tokenId, createdAt: { gte: new Date(now.getTime() - 86_400_000) } },
  });
}

export async function createInspectionVisit(input: {
  organizationId: string;
  tokenId: string | null;
  source: "inspector" | "manager";
  fields: InspectionVisitFields;
  visitedAt?: Date;
  files: CheckedVisitFile[];
  createdById?: string | null;
  createdByName?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const uploadedByName = input.source === "inspector" ? input.fields.inspectorName : (input.createdByName ?? null);
  return db.inspectionVisit.create({
    data: {
      organizationId: input.organizationId,
      tokenId: input.tokenId,
      source: input.source,
      ...(input.visitedAt ? { visitedAt: input.visitedAt } : {}),
      inspectorName: input.fields.inspectorName,
      inspectorPosition: input.fields.inspectorPosition,
      authority: input.fields.authority,
      kind: input.fields.kind,
      kindNote: input.fields.kindNote,
      basisNumber: input.fields.basisNumber,
      basisDate: input.fields.basisDate,
      createdById: input.createdById ?? null,
      createdByName: input.createdByName ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
      files: {
        create: input.files.map((file) => ({
          organizationId: input.organizationId,
          fileName: file.fileName,
          mimeType: file.mimeType,
          sizeBytes: file.bytes.length,
          content: file.bytes,
          uploadedByName,
        })),
      },
    },
    select: { id: true, visitedAt: true, files: { select: { id: true } } },
  });
}

export type InspectionVisitListItem = {
  id: string;
  source: string;
  visitedAt: string;
  inspectorName: string;
  inspectorPosition: string | null;
  authority: string;
  kind: string;
  kindNote: string | null;
  basisNumber: string | null;
  /** YYYY-MM-DD */
  basisDate: string | null;
  createdByName: string | null;
  files: { id: string; fileName: string; mimeType: string; sizeBytes: number }[];
};

const listSelect = {
  id: true,
  source: true,
  visitedAt: true,
  inspectorName: true,
  inspectorPosition: true,
  authority: true,
  kind: true,
  kindNote: true,
  basisNumber: true,
  basisDate: true,
  createdByName: true,
  files: {
    select: { id: true, fileName: true, mimeType: true, sizeBytes: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
} satisfies Prisma.InspectionVisitSelect;

/**
 * Посещения организации (новые сверху) — без содержимого файлов. `tokenId` —
 * только записи этого токена (портал проверяющего).
 */
export async function listInspectionVisits(
  organizationId: string,
  options: { tokenId?: string; take?: number } = {}
): Promise<InspectionVisitListItem[]> {
  const rows = await db.inspectionVisit.findMany({
    where: { organizationId, ...(options.tokenId ? { tokenId: options.tokenId } : {}) },
    orderBy: [{ visitedAt: "desc" }, { id: "desc" }],
    take: options.take ?? 50,
    select: listSelect,
  });
  return rows.map((row) => ({
    ...row,
    visitedAt: row.visitedAt.toISOString(),
    basisDate: row.basisDate ? row.basisDate.toISOString().slice(0, 10) : null,
  }));
}

/** Посещения периода с файлами — для архива проверки. */
export async function loadInspectionVisitsForBundle(organizationId: string, from: Date, toEndOfDay: Date) {
  return db.inspectionVisit.findMany({
    where: { organizationId, visitedAt: { gte: from, lte: toEndOfDay } },
    orderBy: [{ visitedAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      source: true,
      visitedAt: true,
      inspectorName: true,
      inspectorPosition: true,
      authority: true,
      kind: true,
      kindNote: true,
      basisNumber: true,
      basisDate: true,
      createdByName: true,
      files: {
        select: { id: true, fileName: true, mimeType: true, content: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
  });
}

/** Файл с данными для проверки доступа (без содержимого). */
export async function findInspectionVisitFile(fileId: string) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(fileId)) return null;
  return db.inspectionVisitFile.findUnique({
    where: { id: fileId },
    select: {
      id: true,
      organizationId: true,
      fileName: true,
      mimeType: true,
      visit: { select: { organizationId: true, tokenId: true } },
    },
  });
}

/** Ответ с файлом: inline или скачивание; не кэшируется — отзыв доступа действует сразу. */
export async function inspectionVisitFileResponse(
  file: { id: string; fileName: string; mimeType: string },
  download: boolean
): Promise<Response> {
  const row = await db.inspectionVisitFile.findUnique({ where: { id: file.id }, select: { content: true } });
  if (!row) return inspectionVisitNotFound();
  const body = new Uint8Array(row.content);
  const name = inspectionVisitFileName(file.fileName, file.mimeType);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(body.byteLength),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
