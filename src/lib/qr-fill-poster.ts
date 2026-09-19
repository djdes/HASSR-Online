import QRCode from "qrcode";

import {
  DEFAULT_CLIMATE_HUMIDITY,
  DEFAULT_CLIMATE_TEMPERATURE,
  normalizeClimateRoomNorms,
  type ClimateMetricConfig,
} from "@/lib/climate-document";
import { db } from "@/lib/db";
import { JOURNAL_FILL_HUB_CODE, journalFillSubject, listHubJournals, todayKeyFor } from "@/lib/journal-fill";
import { mintQrFillToken } from "@/lib/qr-fill-token";
import type { QrFillKind, QrPoster } from "@/lib/qr-fill-types";
import { loadDirectoryBuildings } from "@/lib/room-directory";

/**
 * Единый билдер QR-плакатов: страница `/settings/qr-posters` и
 * `GET /api/qr-fill/[kind]/[id]` собирают объект одинаково — иначе превью
 * в диалоге строки и печатный плакат разошлись бы в норме/ссылке.
 *
 * Виды: `equipment` (холодильник), `room` (помещение), `journal`
 * (запись в журнал: `id` = `<code>` или `<code>:<documentId>`; хаб — `all`).
 *
 * Server-only (db + qrcode + HMAC-секрет): в клиент не импортировать,
 * типы брать из `@/lib/qr-fill-types`.
 */

function metricLabel(metric: ClimateMetricConfig, unit: string): string | null {
  if (!metric.enabled) return null;
  return rangeLabel(metric.min, metric.max, unit);
}

export function rangeLabel(min: number | null, max: number | null, unit: string): string | null {
  if (min !== null && max !== null) return `${min}…${max} ${unit}`;
  if (min !== null) return `от ${min} ${unit}`;
  if (max !== null) return `до ${max} ${unit}`;
  return null;
}

async function qrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 1, width: 600 });
}

export function qrFillUrl(origin: string, kind: QrFillKind, id: string): string {
  const token = mintQrFillToken(kind, id);
  const base = origin.replace(/\/+$/, "");
  if (kind === "journal") {
    const [orgId, code] = id.split(":");
    return `${base}/journal-fill/${orgId}/${code}?token=${encodeURIComponent(token)}`;
  }
  const path = kind === "room" ? "room-fill" : "equipment-fill";
  return `${base}/${path}/${id}?token=${encodeURIComponent(token)}`;
}

type EquipmentSource = {
  id: string;
  name: string;
  tempMin: number | null;
  tempMax: number | null;
  area: { name: string };
};

export async function buildEquipmentPoster(item: EquipmentSource, origin: string): Promise<QrPoster> {
  const url = qrFillUrl(origin, "equipment", item.id);
  const norm = rangeLabel(item.tempMin, item.tempMax, "°C");
  return {
    id: item.id,
    kind: "equipment",
    title: item.name,
    subtitle: item.area.name,
    norms: norm ? [norm] : [],
    url,
    svg: await qrSvg(url),
  };
}

type RoomSource = { id: string; name: string; climateNorms: unknown };

export async function buildRoomPoster(
  room: RoomSource,
  buildingName: string,
  origin: string
): Promise<QrPoster> {
  const norms = normalizeClimateRoomNorms(room.climateNorms);
  const url = qrFillUrl(origin, "room", room.id);
  return {
    id: room.id,
    kind: "room",
    title: room.name,
    subtitle: buildingName,
    norms: [
      metricLabel(norms?.temperature ?? DEFAULT_CLIMATE_TEMPERATURE, "°C"),
      metricLabel(norms?.humidity ?? DEFAULT_CLIMATE_HUMIDITY, "%"),
    ].filter((label): label is string => Boolean(label)),
    url,
    svg: await qrSvg(url),
  };
}

/** Плакат журнала: `documentId` сужает до конкретного документа (из его меню). */
export async function buildJournalPoster(params: {
  organizationId: string;
  code: string;
  name: string;
  subtitle: string;
  documentId?: string | null;
  origin: string;
}): Promise<QrPoster> {
  const subject = journalFillSubject(params.organizationId, params.code, params.documentId);
  const url = qrFillUrl(params.origin, "journal", subject);
  return {
    id: params.documentId ? `${params.code}:${params.documentId}` : params.code,
    kind: "journal",
    title: params.name,
    subtitle: params.subtitle,
    norms: [],
    url,
    svg: await qrSvg(url),
  };
}

/** Все объекты организации данного вида (фильтр `allowed` — по id). */
export async function loadQrPosters(params: {
  organizationId: string;
  kind: QrFillKind;
  origin: string;
  allowed?: (id: string) => boolean;
}): Promise<QrPoster[]> {
  const allowed = params.allowed ?? (() => true);
  const posters: QrPoster[] = [];
  if (params.kind === "journal") {
    const org = await db.organization.findUnique({
      where: { id: params.organizationId },
      select: { timezone: true, disabledJournalCodes: true },
    });
    if (!org) return [];
    const journals = await listHubJournals(params.organizationId, org.disabledJournalCodes as string[], todayKeyFor(org.timezone));
    if (allowed(JOURNAL_FILL_HUB_CODE)) {
      posters.push(
        await buildJournalPoster({
          organizationId: params.organizationId,
          code: JOURNAL_FILL_HUB_CODE,
          name: "Все журналы",
          subtitle: "Один плакат на стену: сотрудник выбирает журнал после сканирования",
          origin: params.origin,
        })
      );
    }
    for (const journal of journals) {
      if (!allowed(journal.code)) continue;
      posters.push(
        await buildJournalPoster({
          organizationId: params.organizationId,
          code: journal.code,
          name: journal.name,
          subtitle: "Запись в журнал с телефона",
          origin: params.origin,
        })
      );
    }
    return posters;
  }
  if (params.kind === "room") {
    const buildings = await loadDirectoryBuildings(params.organizationId);
    for (const building of buildings) {
      for (const room of building.rooms) {
        if (!allowed(room.id)) continue;
        posters.push(await buildRoomPoster(room, building.name, params.origin));
      }
    }
    return posters;
  }
  const equipment = await db.equipment.findMany({
    where: { area: { organizationId: params.organizationId } },
    orderBy: [{ area: { name: "asc" } }, { name: "asc" }],
    select: { id: true, name: true, tempMin: true, tempMax: true, area: { select: { name: true } } },
  });
  for (const item of equipment) {
    if (!allowed(item.id)) continue;
    posters.push(await buildEquipmentPoster(item, params.origin));
  }
  return posters;
}

/** Один объект; `null`, если его нет или он не из этой организации. */
export async function loadQrPoster(params: {
  organizationId: string;
  kind: QrFillKind;
  id: string;
  origin: string;
}): Promise<QrPoster | null> {
  if (params.kind === "journal") {
    const [code, documentId] = params.id.split(":");
    if (!code) return null;
    if (code === JOURNAL_FILL_HUB_CODE) {
      return buildJournalPoster({
        organizationId: params.organizationId,
        code,
        name: "Все журналы",
        subtitle: "Сотрудник выбирает журнал после сканирования",
        origin: params.origin,
      });
    }
    const template = await db.journalTemplate.findFirst({ where: { code }, select: { name: true } });
    if (!template) return null;
    let subtitle = "Запись в журнал с телефона";
    if (documentId) {
      const document = await db.journalDocument.findFirst({
        where: { id: documentId, organizationId: params.organizationId },
        select: { title: true, building: { select: { name: true } } },
      });
      if (!document) return null;
      subtitle = document.building?.name ? `${document.title} · ${document.building.name}` : document.title;
    }
    return buildJournalPoster({
      organizationId: params.organizationId,
      code,
      name: template.name,
      subtitle,
      documentId: documentId ?? null,
      origin: params.origin,
    });
  }
  if (params.kind === "room") {
    const room = await db.room.findFirst({
      where: { id: params.id, building: { organizationId: params.organizationId } },
      select: { id: true, name: true, climateNorms: true, building: { select: { name: true } } },
    });
    if (!room) return null;
    return buildRoomPoster(room, room.building.name, params.origin);
  }
  const item = await db.equipment.findFirst({
    where: { id: params.id, area: { organizationId: params.organizationId } },
    select: { id: true, name: true, tempMin: true, tempMax: true, area: { select: { name: true } } },
  });
  if (!item) return null;
  return buildEquipmentPoster(item, params.origin);
}
