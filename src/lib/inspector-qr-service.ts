import crypto from "node:crypto";

import { brandQrSvg, type BrandQrOptions } from "@/lib/brand-qr";
import { db } from "@/lib/db";
import { buildInspectorUrl, hashInspectorToken } from "@/lib/inspector-tokens";
import {
  INSPECTOR_QR_OPEN_PERIOD_TO,
  INSPECTOR_QR_TTL_DAYS,
  INSPECTOR_QR_WINDOW_MONTHS,
  deriveInspectorQrToken,
  type InspectorQrTtl,
} from "@/lib/inspector-qr";
import { orgTodayKey } from "@/lib/timezone";
import { formatDayKeyRu } from "@/lib/inspector-qr";
import { inspectorTokensWhere } from "@/lib/inspector-point";

/**
 * Выпуск и поиск «QR для проверяющих» (серверная часть кабинета).
 *
 * Строка создаётся со случайным временным хэшем (id ещё неизвестен),
 * затем в той же транзакции получает хэш выведенного из id токена.
 */
export async function createInspectorQrToken(input: {
  organizationId: string;
  createdById: string | null;
  ttl: InspectorQrTtl;
  label: string | null;
  /** QR на одну точку (2026-11-01); null — вся организация. */
  buildingId?: string | null;
}) {
  const org = await db.organization.findUnique({
    where: { id: input.organizationId },
    select: { timezone: true },
  });
  const today = orgTodayKey(org?.timezone || "Europe/Moscow");
  const [y, m, d] = today.split("-").map(Number);
  const periodFrom = new Date(Date.UTC(y, m - 1 - INSPECTOR_QR_WINDOW_MONTHS, d));
  const expiresAt = new Date(Date.now() + INSPECTOR_QR_TTL_DAYS[input.ttl] * 86_400_000);

  return db.$transaction(async (tx) => {
    const row = await tx.inspectorToken.create({
      data: {
        organizationId: input.organizationId,
        tokenHash: `pending:${crypto.randomBytes(24).toString("hex")}`,
        label: input.label,
        periodFrom,
        periodTo: INSPECTOR_QR_OPEN_PERIOD_TO,
        expiresAt,
        createdById: input.createdById,
        buildingId: input.buildingId ?? null,
      },
      select: { id: true },
    });
    return tx.inspectorToken.update({
      where: { id: row.id },
      data: { tokenHash: hashInspectorToken(deriveInspectorQrToken(row.id)) },
      select: { id: true, label: true, periodFrom: true, periodTo: true, expiresAt: true, createdAt: true, buildingId: true },
    });
  });
}

export function inspectorQrUrl(tokenId: string): string {
  return buildInspectorUrl(deriveInspectorQrToken(tokenId));
}

/** Фирменный QR (`brand-qr.ts`) — тот же на портале и на листе A4 для печати. */
export async function inspectorQrSvg(url: string, qr?: BrandQrOptions): Promise<string> {
  return brandQrSvg(url, qr);
}

/**
 * Действующий QR организации (самый долгий) — для сертификата: раньше
 * каждое скачивание сертификата выпускало новый 90-дневный токен, и
 * список доступов зарастал копиями. Нет действующего — выпускаем один
 * «до отзыва». `buildingId` — QR точки (руководитель точки, 2026-11-01).
 */
export async function findOrCreateOrgInspectorQr(
  organizationId: string,
  createdById: string | null,
  buildingId: string | null = null
) {
  const existing = await db.inspectorToken.findFirst({
    where: {
      organizationId,
      buildingId,
      revokedAt: null,
      expiresAt: { gt: new Date(Date.now() + 7 * 86_400_000) },
      periodTo: INSPECTOR_QR_OPEN_PERIOD_TO,
    },
    orderBy: { expiresAt: "desc" },
    select: { id: true, expiresAt: true },
  });
  if (existing) return { ...existing, created: false };
  const created = await createInspectorQrToken({
    organizationId,
    createdById,
    ttl: "forever",
    label: "QR для проверяющих (сертификат)",
    buildingId,
  });
  return { id: created.id, expiresAt: created.expiresAt, created: true };
}

export type CabinetInspectorToken = {
  id: string;
  label: string | null;
  periodFrom: string;
  periodTo: string;
  expiresAt: string;
  lastAccessedAt: string | null;
  accessCount: number;
  revokedAt: string | null;
  createdAt: string;
  isQr: boolean;
  /** Ссылка на одну точку (2026-11-01); null — вся организация. */
  buildingId: string | null;
  buildingName: string | null;
  /** Только у QR: адрес выводится из id — показ и печать повторяемы. */
  inspectorUrl: string | null;
  qrSvg: string | null;
};

export type CabinetInspectorActivity = {
  id: string;
  tokenId: string | null;
  at: string;
  action: string;
  what: string;
  viewer: string | null;
  ip: string | null;
};

const ACTIVITY_TEXT: Record<string, string> = {
  summary_page: "Открыл список журналов",
  journal_page: "Открыл журнал",
  document: "Просмотрел документ",
  document_pdf: "Скачал PDF документа",
  summary_pdf: "Скачал сводный PDF",
  introduce: "Представился",
  visit: "Внёс запись в журнал посещений",
  ppk_document: "Открыл документ производственного контроля",
  visit_file: "Открыл основание проверки",
};

/**
 * Ссылки и последние действия проверяющих для кабинета. `pointScope` —
 * руководитель точки (2026-11-01): только ссылки его точек и действия по ним.
 */
export async function loadCabinetInspectorData(
  organizationId: string,
  options: { pointScope?: readonly string[] | null } = {}
): Promise<{
  tokens: CabinetInspectorToken[];
  activity: CabinetInspectorActivity[];
}> {
  const scoped = Boolean(options.pointScope && options.pointScope.length > 0);
  const [rows, logs] = await Promise.all([
    db.inspectorToken.findMany({
      where: { organizationId, ...inspectorTokensWhere(options.pointScope) },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        label: true,
        periodFrom: true,
        periodTo: true,
        expiresAt: true,
        lastAccessedAt: true,
        accessCount: true,
        revokedAt: true,
        createdAt: true,
        buildingId: true,
        building: { select: { name: true } },
      },
    }),
    db.auditLog.findMany({
      where: { organizationId, entity: "InspectorToken", action: { startsWith: "inspector." } },
      orderBy: { createdAt: "desc" },
      // Руководителю точки — действия только по ссылкам его точек: берём с запасом и фильтруем.
      take: scoped ? 300 : 30,
      select: { id: true, entityId: true, createdAt: true, action: true, details: true, ipAddress: true },
    }),
  ]);
  const now = new Date();
  const tokens = await Promise.all(
    rows.map(async (t): Promise<CabinetInspectorToken> => {
      const isQr = t.periodTo.getUTCFullYear() >= 2099;
      const active = !t.revokedAt && t.expiresAt > now;
      const url = isQr ? inspectorQrUrl(t.id) : null;
      return {
        id: t.id,
        label: t.label,
        periodFrom: t.periodFrom.toISOString(),
        periodTo: t.periodTo.toISOString(),
        expiresAt: t.expiresAt.toISOString(),
        lastAccessedAt: t.lastAccessedAt?.toISOString() ?? null,
        accessCount: t.accessCount,
        revokedAt: t.revokedAt?.toISOString() ?? null,
        createdAt: t.createdAt.toISOString(),
        isQr,
        buildingId: t.buildingId,
        buildingName: t.building?.name ?? null,
        inspectorUrl: url && active ? url : null,
        qrSvg: url && active ? await inspectorQrSvg(url) : null,
      };
    })
  );
  const visibleTokenIds = new Set(rows.map((row) => row.id));
  const visibleLogs = scoped ? logs.filter((l) => l.entityId && visibleTokenIds.has(l.entityId)).slice(0, 30) : logs;
  const activity = visibleLogs.map((l): CabinetInspectorActivity => {
    const d = (l.details && typeof l.details === "object" ? l.details : {}) as Record<string, unknown>;
    const kind = typeof d.kind === "string" ? d.kind : "";
    const subject = [d.journal, d.title].find((v): v is string => typeof v === "string" && v.length > 0);
    const period = typeof d.from === "string" && typeof d.to === "string" ? ` за ${formatDayKeyRu(d.from)} - ${formatDayKeyRu(d.to)}` : "";
    return {
      id: l.id,
      tokenId: l.entityId,
      at: l.createdAt.toISOString(),
      action: l.action,
      what: `${ACTIVITY_TEXT[kind] ?? l.action}${subject ? `: ${subject}` : ""}${kind === "summary_page" || kind === "summary_pdf" ? period : ""}`,
      viewer: typeof d.viewer === "string" ? d.viewer : null,
      ip: l.ipAddress,
    };
  });
  return { tokens, activity };
}
