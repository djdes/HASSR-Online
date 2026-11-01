import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { inspectionVisitAreaWhere } from "@/lib/checklist-point-scope";
import {
  INSPECTION_VISIT_ERRORS,
  INSPECTION_VISIT_FILE_MAX_BYTES,
  INSPECTION_VISIT_MAX_FILES,
  INSPECTION_VISIT_MAX_REQUEST_BYTES,
  INSPECTION_VISIT_MAX_TOTAL_BYTES,
  INSPECTION_VISIT_TOKEN_DAILY_BYTES,
  INSPECTION_VISITS_PER_TOKEN_PER_DAY,
  inspectionVisitFileName,
  type InspectionVisitFields,
} from "@/lib/inspection-visits";
import { ORDER_SCAN_ERRORS } from "@/lib/journal-order-scans";
import { validateOrderScanFile } from "@/lib/journal-order-scans-pdf";
import type { PdfCheckOptions } from "@/lib/pdf-isolated-check";

/**
 * Журнал посещений — запись в БД, проверка вложений, выборки для кабинета,
 * портала и архива. Файлы лежат в `InspectionVisitFile.content` и отдаются
 * только через API с проверкой прав — публичной ссылки на файл нет.
 */

export type CheckedVisitFile = { fileName: string; mimeType: string; bytes: Uint8Array<ArrayBuffer> };

const DAY_MS = 86_400_000;

/**
 * Размер тела до чтения формы: нет Content-Length — 411 (браузерный FormData
 * его всегда шлёт, а без него предел не проверить), больше предела — 413.
 */
export function inspectionVisitRequestSizeError(request: Request): Response | null {
  const header = request.headers.get("content-length");
  const length = header && /^\d{1,12}$/.test(header.trim()) ? Number(header) : NaN;
  if (!Number.isFinite(length)) {
    return NextResponse.json({ error: INSPECTION_VISIT_ERRORS.lengthRequired }, { status: 411 });
  }
  if (length > INSPECTION_VISIT_MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: INSPECTION_VISIT_ERRORS.requestTooBig }, { status: 413 });
  }
  return null;
}

/** Файлы из формы (`file`, несколько) — только непустые поля типа File. */
export function visitFilesFromForm(form: FormData): File[] {
  return form.getAll("file").filter((item): item is File => item instanceof File && (item.size > 0 || item.name !== ""));
}

/**
 * Проверка вложений: число, размер, тип по содержимому (HEIC и чужие
 * форматы — отказ), размер картинки по заголовку, PDF — в отдельном потоке
 * с пределами. Правила те же, что у сканов приказов (`validateOrderScanFile`).
 */
export async function checkInspectionVisitFiles(
  files: File[],
  already = 0,
  options: { pdfCheck?: PdfCheckOptions } = {}
): Promise<{ ok: true; files: CheckedVisitFile[] } | { ok: false; error: string; status: number }> {
  if (files.length + already > INSPECTION_VISIT_MAX_FILES) {
    // К новой записи — ошибка формы; к записи, где файлы уже есть, — конфликт.
    return { ok: false, error: INSPECTION_VISIT_ERRORS.tooMany, status: already > 0 ? 409 : 400 };
  }
  if (files.some((file) => file.size > INSPECTION_VISIT_FILE_MAX_BYTES)) {
    return { ok: false, error: INSPECTION_VISIT_ERRORS.tooBig, status: 413 };
  }
  if (files.reduce((sum, file) => sum + file.size, 0) > INSPECTION_VISIT_MAX_TOTAL_BYTES) {
    return { ok: false, error: INSPECTION_VISIT_ERRORS.requestTooBig, status: 413 };
  }
  const checked: CheckedVisitFile[] = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await validateOrderScanFile({ bytes, fileName: file.name, declaredMime: file.type }, options);
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

/** Сколько записей внесено по токену за последние сутки (быстрый отказ до разбора формы). */
export async function countTokenVisitsLastDay(tokenId: string, now = new Date()): Promise<number> {
  return db.inspectionVisit.count({
    where: { tokenId, createdAt: { gte: new Date(now.getTime() - DAY_MS) } },
  });
}

/**
 * Транзакционная блокировка по ключу: параллельные запросы с тем же ключом
 * выстраиваются в очередь до конца транзакции («посчитать → создать»
 * атомарно, лимит не обходится пачкой одновременных запросов).
 */
async function lockKey(tx: Prisma.TransactionClient, key: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${key}::text))`;
}

const TX_OPTIONS = { maxWait: 15_000, timeout: 60_000 } as const;

type VisitInput = {
  organizationId: string;
  source: "inspector" | "manager";
  fields: InspectionVisitFields;
  visitedAt?: Date;
  files: CheckedVisitFile[];
  createdById?: string | null;
  createdByName?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

function visitData(input: VisitInput & { tokenId: string | null }) {
  const uploadedByName = input.source === "inspector" ? input.fields.inspectorName : (input.createdByName ?? null);
  return {
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
  } satisfies Prisma.InspectionVisitUncheckedCreateInput;
}

const createdSelect = { id: true, visitedAt: true, files: { select: { id: true } } } satisfies Prisma.InspectionVisitSelect;

/** Запись руководства из кабинета (без токена и без суточных лимитов). */
export async function createInspectionVisit(input: VisitInput) {
  return db.inspectionVisit.create({ data: visitData({ ...input, tokenId: null }), select: createdSelect });
}

/**
 * Запись проверяющего по токену. Под блокировкой токена: записей за сутки
 * не больше `INSPECTION_VISITS_PER_TOKEN_PER_DAY`, сканов — не больше
 * `INSPECTION_VISIT_TOKEN_DAILY_BYTES` (скрытые записи тоже считаются).
 */
export async function createTokenInspectionVisit(
  input: VisitInput & { tokenId: string },
  now = new Date()
): Promise<
  | { ok: true; visit: { id: string; visitedAt: Date; files: { id: string }[] } }
  | { ok: false; error: string; status: number }
> {
  const since = new Date(now.getTime() - DAY_MS);
  const incoming = input.files.reduce((sum, file) => sum + file.bytes.length, 0);
  return db.$transaction(async (tx) => {
    await lockKey(tx, `inspection-visit-token:${input.tokenId}`);
    const count = await tx.inspectionVisit.count({ where: { tokenId: input.tokenId, createdAt: { gte: since } } });
    if (count >= INSPECTION_VISITS_PER_TOKEN_PER_DAY) {
      return { ok: false as const, error: INSPECTION_VISIT_ERRORS.dailyLimit, status: 429 };
    }
    const used = await tx.inspectionVisitFile.aggregate({
      _sum: { sizeBytes: true },
      where: { visit: { tokenId: input.tokenId, createdAt: { gte: since } } },
    });
    if ((used._sum.sizeBytes ?? 0) + incoming > INSPECTION_VISIT_TOKEN_DAILY_BYTES) {
      return { ok: false as const, error: INSPECTION_VISIT_ERRORS.dailyVolume, status: 429 };
    }
    const visit = await tx.inspectionVisit.create({ data: visitData(input), select: createdSelect });
    return { ok: true as const, visit };
  }, TX_OPTIONS);
}

/**
 * Приложить сканы к записи: под блокировкой записи пересчитываем, сколько
 * файлов уже есть, — параллельные загрузки не превысят 5 файлов.
 */
export async function attachInspectionVisitFiles(input: {
  visitId: string;
  organizationId: string;
  files: CheckedVisitFile[];
  uploadedByName: string | null;
}): Promise<{ ok: true; added: number } | { ok: false; error: string; status: number }> {
  return db.$transaction(async (tx) => {
    await lockKey(tx, `inspection-visit-files:${input.visitId}`);
    const existing = await tx.inspectionVisitFile.count({ where: { visitId: input.visitId } });
    if (existing + input.files.length > INSPECTION_VISIT_MAX_FILES) {
      return { ok: false as const, error: INSPECTION_VISIT_ERRORS.tooMany, status: 409 };
    }
    await tx.inspectionVisitFile.createMany({
      data: input.files.map((file) => ({
        visitId: input.visitId,
        organizationId: input.organizationId,
        fileName: file.fileName,
        mimeType: file.mimeType,
        sizeBytes: file.bytes.length,
        content: file.bytes,
        uploadedByName: input.uploadedByName,
      })),
    });
    return { ok: true as const, added: input.files.length };
  }, TX_OPTIONS);
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
  /** Скрыта как ошибочная — ISO или null. */
  hiddenAt: string | null;
  hiddenByName: string | null;
  hiddenReason: string | null;
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
  hiddenAt: true,
  hiddenByName: true,
  hiddenReason: true,
  files: {
    select: { id: true, fileName: true, mimeType: true, sizeBytes: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
} satisfies Prisma.InspectionVisitSelect;

/**
 * Посещения организации (новые сверху) — без содержимого файлов.
 *   • `tokenId` + `ids` — портал: только записи этого токена из cookie браузера;
 *   • `includeHidden` — кабинет: со скрытыми (по умолчанию их нет);
 *   • `pointIds` — кабинет на точке (2026-11-01, «точка видит только своё»):
 *     без записей по ссылке другой точки (`inspectionVisitAreaWhere`).
 */
export async function listInspectionVisits(
  organizationId: string,
  options: { tokenId?: string; ids?: readonly string[]; includeHidden?: boolean; take?: number; pointIds?: readonly string[] | null } = {}
): Promise<InspectionVisitListItem[]> {
  if (options.ids && options.ids.length === 0) return [];
  const rows = await db.inspectionVisit.findMany({
    where: {
      organizationId,
      ...(options.tokenId ? { tokenId: options.tokenId } : {}),
      ...(options.ids ? { id: { in: [...options.ids] } } : {}),
      ...(options.includeHidden ? {} : { hiddenAt: null }),
      ...inspectionVisitAreaWhere(options.pointIds),
    },
    orderBy: [{ visitedAt: "desc" }, { id: "desc" }],
    take: options.take ?? 50,
    select: listSelect,
  });
  return rows.map((row) => ({
    ...row,
    visitedAt: row.visitedAt.toISOString(),
    basisDate: row.basisDate ? row.basisDate.toISOString().slice(0, 10) : null,
    hiddenAt: row.hiddenAt ? row.hiddenAt.toISOString() : null,
  }));
}

/**
 * Посещения периода для архива — без скрытых и без содержимого файлов:
 * содержимое берётся по одному файлу при добавлении в архив
 * (`loadInspectionVisitFileContent`), в пределах объёма. Архив точки
 * (`pointIds`) — без записей по ссылке другой точки.
 */
export async function loadInspectionVisitsForBundle(organizationId: string, from: Date, toEndOfDay: Date, pointIds: readonly string[] | null = null) {
  return db.inspectionVisit.findMany({
    where: { organizationId, hiddenAt: null, visitedAt: { gte: from, lte: toEndOfDay }, ...inspectionVisitAreaWhere(pointIds) },
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
        select: { id: true, fileName: true, mimeType: true, sizeBytes: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
  });
}

/** Содержимое одного файла посещения (архив добавляет файлы по одному). */
export async function loadInspectionVisitFileContent(fileId: string, organizationId: string): Promise<Uint8Array | null> {
  const row = await db.inspectionVisitFile.findUnique({ where: { id: fileId }, select: { organizationId: true, content: true } });
  return row && row.organizationId === organizationId ? row.content : null;
}

/** Файл с данными для проверки доступа (без содержимого); точка ссылки записи — для кабинета на точке. */
export async function findInspectionVisitFile(fileId: string) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(fileId)) return null;
  return db.inspectionVisitFile.findUnique({
    where: { id: fileId },
    select: {
      id: true,
      visitId: true,
      organizationId: true,
      fileName: true,
      mimeType: true,
      visit: { select: { organizationId: true, tokenId: true, hiddenAt: true, token: { select: { buildingId: true } } } },
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
