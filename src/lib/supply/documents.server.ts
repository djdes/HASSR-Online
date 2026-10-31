import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";

import { normalizeAcceptanceDocumentConfig } from "@/lib/acceptance-document";
import { logAudit } from "@/lib/audit";
import { buildingTargets } from "@/lib/building-targets";
import { db } from "@/lib/db";
import { withDocumentConfigLock } from "@/lib/document-config-lock";
import { ensureActiveDocument } from "@/lib/journal-auto-create";

import {
  applySupplyCheck,
  supplyItemToAcceptanceRow,
  type SupplyDeliveryCheck,
  type SupplyDocumentRef,
  type SupplyItemCheck,
  type SupplySource,
} from "./to-acceptance-row";
import { pointByKpp } from "./supply-points";
import type { ParsedUpd, SupplyItem } from "./upd";

/**
 * Входящие накладные: сохранить без дублей и принять в журнал приёмки.
 *
 * Порядок как у Меркурия: строки журнала — наш документ, поэтому сначала
 * пишем их, потом закрываем накладную. Повторная приёмка невозможна: перед
 * записью накладная «захватывается» переходом new → processing.
 */

/** Шаблон журнала, в который попадает приёмка. */
export const ACCEPTANCE_TEMPLATE_CODE = "incoming_control";

export class SupplyError extends Error {
  constructor(
    readonly code: "not_found" | "already_decided" | "bad_check" | "no_journal" | "bad_building",
    message: string,
  ) {
    super(message);
    this.name = "SupplyError";
  }
}

/** Ключ загруженного файла: тот же файл — та же накладная. */
export function fileExternalId(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function dayStart(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

function dateKeyOf(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

/** Строки накладной из JSON в БД: только целые записи. */
export function readSupplyItems(value: unknown): SupplyItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw, index) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    if (typeof item.name !== "string" || !item.name) return [];
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const str = (v: unknown) => (typeof v === "string" && v ? v : null);
    return [
      {
        line: num(item.line) ?? index + 1,
        name: item.name,
        unit: str(item.unit),
        quantity: num(item.quantity),
        price: num(item.price),
        amount: num(item.amount),
        code: str(item.code),
        expiryDate: str(item.expiryDate),
      },
    ];
  });
}

/**
 * Точка накладной по КПП грузополучателя или покупателя (2026-11-01): только
 * при включённых точках и только если КПП стоит ровно у одной точки.
 */
async function supplyPointByKpp(organizationId: string, parsed: ParsedUpd): Promise<string | null> {
  const parties = [parsed.consignee, parsed.buyer];
  if (!parties.some((party) => party?.kpp)) return null;
  const points = (await buildingTargets(organizationId)).filter((id): id is string => id !== null);
  if (points.length === 0) return null;
  const buildings = await db.building.findMany({ where: { organizationId, id: { in: points } }, select: { id: true, kpp: true } });
  return pointByKpp(parties, buildings);
}

export async function saveSupplyDocument(input: {
  organizationId: string;
  source: SupplySource;
  externalId: string;
  parsed: ParsedUpd;
  fileName?: string | null;
  actor?: { id: string; name: string | null } | null;
  /** Точка, известная заранее (склад iiko); иначе — по КПП грузополучателя. */
  buildingId?: string | null;
  /** Если КПП не помог: точка, на которой загрузили файл. */
  fallbackBuildingId?: string | null;
}): Promise<{ id: string; created: boolean }> {
  const where = {
    organizationId_source_externalId: {
      organizationId: input.organizationId,
      source: input.source,
      externalId: input.externalId,
    },
  };
  const existing = await db.supplyDocument.findUnique({ where, select: { id: true } });
  if (existing) return { id: existing.id, created: false };
  const { parsed } = input;
  // Та же накладная другим путём (файлом, а она уже пришла из Диадока, или
  // наоборот): продавец, номер и дата совпали — это она.
  const sameInvoice = await db.supplyDocument.findFirst({
    where: {
      organizationId: input.organizationId,
      number: parsed.number,
      date: dayStart(parsed.date),
      ...(parsed.seller.inn ? { sellerInn: parsed.seller.inn } : { sellerName: parsed.seller.name }),
    },
    select: { id: true },
  });
  if (sameInvoice) return { id: sameInvoice.id, created: false };
  const buildingId =
    input.buildingId ?? (await supplyPointByKpp(input.organizationId, parsed)) ?? input.fallbackBuildingId ?? null;
  try {
    const doc = await db.supplyDocument.create({
      data: {
        organizationId: input.organizationId,
        buildingId,
        source: input.source,
        externalId: input.externalId,
        kind: parsed.kind,
        function: parsed.function || null,
        number: parsed.number,
        date: dayStart(parsed.date),
        sellerName: parsed.seller.name,
        sellerInn: parsed.seller.inn,
        sellerKpp: parsed.seller.kpp,
        items: parsed.items as unknown as Prisma.InputJsonValue,
        total: parsed.total,
        basis: parsed.basis,
        shippedDate: parsed.shippedDate ? dayStart(parsed.shippedDate) : null,
        fileName: input.fileName ?? null,
      },
      select: { id: true },
    });
    await logAudit({
      organizationId: input.organizationId,
      userId: input.actor?.id,
      userName: input.actor?.name ?? undefined,
      action: "supply.document_add",
      entity: "SupplyDocument",
      entityId: doc.id,
      details: { source: input.source, number: parsed.number, seller: parsed.seller.name },
    });
    return { id: doc.id, created: true };
  } catch (error) {
    // Тот же документ одновременно пришёл из синхронизации и загрузки.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const again = await db.supplyDocument.findUnique({ where, select: { id: true } });
      if (again) return { id: again.id, created: false };
    }
    throw error;
  }
}

export type AcceptSupplyInput = {
  organizationId: string;
  documentId: string;
  actor: { id: string; name: string | null };
  delivery: SupplyDeliveryCheck;
  items: Array<SupplyItemCheck & { line: number }>;
  /** Точка, где принимали товар (журналы по точкам); null — общий журнал. */
  buildingId?: string | null;
};

export type AcceptSupplyOutcome = {
  status: "accepted" | "rejected";
  journalDocumentId: string;
  rowIds: string[];
};

/** Принять накладную: строки в журнал приёмки, накладная закрыта. */
export async function acceptSupplyDocument(input: AcceptSupplyInput): Promise<AcceptSupplyOutcome> {
  const doc = await db.supplyDocument.findFirst({
    where: { id: input.documentId, organizationId: input.organizationId },
  });
  if (!doc) throw new SupplyError("not_found", "Накладная не найдена");
  if (doc.status !== "new") throw new SupplyError("already_decided", "Накладная уже разобрана");

  const lines = readSupplyItems(doc.items);
  const checks = new Map(input.items.map((check) => [check.line, check]));
  if (lines.length === 0 || lines.some((line) => !checks.has(line.line))) {
    throw new SupplyError("bad_check", "Отметьте решение по каждой строке накладной");
  }
  if (input.buildingId) {
    const building = await db.building.findFirst({
      where: { id: input.buildingId, organizationId: input.organizationId },
      select: { id: true },
    });
    if (!building) throw new SupplyError("bad_building", "Точка не найдена");
  }

  // Захват: вторая одновременная приёмка той же накладной сюда не пройдёт.
  const claimed = await db.supplyDocument.updateMany({
    where: { id: doc.id, organizationId: input.organizationId, status: "new" },
    data: { status: "processing" },
  });
  if (claimed.count === 0) throw new SupplyError("already_decided", "Накладная уже разобрана");

  try {
    const report = await ensureActiveDocument(db, {
      organizationId: input.organizationId,
      templateCode: ACCEPTANCE_TEMPLATE_CODE,
      now: new Date(),
      buildingId: input.buildingId ?? null,
    });
    if (!report.documentId) throw new SupplyError("no_journal", "Не удалось открыть журнал приёмки");

    const ref: SupplyDocumentRef = {
      id: doc.id,
      source: doc.source as SupplySource,
      number: doc.number,
      date: dateKeyOf(doc.date) ?? "",
      seller: { name: doc.sellerName, inn: doc.sellerInn, kpp: doc.sellerKpp },
      basis: doc.basis,
      shippedDate: dateKeyOf(doc.shippedDate),
    };
    const rowIds = await withDocumentConfigLock(report.documentId, async (locked) => {
      const config = normalizeAcceptanceDocumentConfig(locked.config);
      const rows = lines.map((item) =>
        applySupplyCheck(
          supplyItemToAcceptanceRow({
            doc: ref,
            item,
            responsibleTitle: config.defaultResponsibleTitle ?? null,
            responsibleUserId: config.defaultResponsibleUserId ?? input.actor.id,
          }),
          input.delivery,
          checks.get(item.line)!,
        ),
      );
      const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));
      return {
        config: {
          ...config,
          rows: [...config.rows, ...rows],
          // Справочники документа пополняются — в следующий раз подсказки уже есть.
          products: unique([...config.products, ...rows.map((row) => row.productName)]),
          suppliers: unique([...config.suppliers, ...rows.map((row) => row.supplier)]),
        } as unknown as Prisma.InputJsonValue,
        result: rows.map((row) => row.id),
      };
    });
    if (!rowIds) throw new SupplyError("no_journal", "Журнал приёмки не найден");

    const status = lines.every((line) => checks.get(line.line)!.decision === "reject") ? "rejected" : "accepted";
    await db.supplyDocument.update({
      where: { id: doc.id },
      data: {
        status,
        decidedAt: new Date(),
        decidedById: input.actor.id,
        journalDocumentId: report.documentId,
        journalRowIds: rowIds,
        // Точка, где приняли товар, — накладная остаётся в её «Входящих».
        buildingId: input.buildingId ?? doc.buildingId,
      },
    });
    await logAudit({
      organizationId: input.organizationId,
      userId: input.actor.id,
      userName: input.actor.name ?? undefined,
      action: "supply.accept",
      entity: "SupplyDocument",
      entityId: doc.id,
      details: { number: doc.number, seller: doc.sellerName, rows: rowIds.length, status, buildingId: input.buildingId ?? null },
    });
    return { status, journalDocumentId: report.documentId, rowIds };
  } catch (error) {
    // Строки не записались — накладная снова ждёт приёмки.
    await db.supplyDocument.updateMany({ where: { id: doc.id, status: "processing" }, data: { status: "new" } });
    throw error;
  }
}

/** «Не принимать в журнал» — например, услуга, а не товар. Строк нет. */
export async function ignoreSupplyDocument(input: {
  organizationId: string;
  documentId: string;
  actor: { id: string; name: string | null };
}): Promise<void> {
  const updated = await db.supplyDocument.updateMany({
    where: { id: input.documentId, organizationId: input.organizationId, status: "new" },
    data: { status: "ignored", decidedAt: new Date(), decidedById: input.actor.id },
  });
  if (updated.count === 0) {
    const exists = await db.supplyDocument.count({ where: { id: input.documentId, organizationId: input.organizationId } });
    throw exists ? new SupplyError("already_decided", "Накладная уже разобрана") : new SupplyError("not_found", "Накладная не найдена");
  }
  await logAudit({
    organizationId: input.organizationId,
    userId: input.actor.id,
    userName: input.actor.name ?? undefined,
    action: "supply.ignore",
    entity: "SupplyDocument",
    entityId: input.documentId,
  });
}
