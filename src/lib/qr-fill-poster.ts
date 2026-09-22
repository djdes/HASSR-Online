import QRCode from "qrcode";

import {
  DEFAULT_CLIMATE_HUMIDITY,
  DEFAULT_CLIMATE_TEMPERATURE,
  normalizeClimateRoomNorms,
  type ClimateMetricConfig,
} from "@/lib/climate-document";
import { db } from "@/lib/db";
import { JOURNAL_FILL_HUB_CODE, journalFillSubject, listHubJournals, todayKeyFor } from "@/lib/journal-fill";
import { resolveOrgJournalName } from "@/lib/org-journal-name";
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

/**
 * Краткое название организации для плакатов — то же, что в шапке журналов.
 * Берём один раз на сборку: плакатов на листе бывает десятки.
 */
export async function loadPosterOrgName(organizationId: string): Promise<string> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { name: true, journalShortName: true, legalProfileJson: true },
  });
  return resolveOrgJournalName(org);
}

type EquipmentSource = {
  id: string;
  name: string;
  tempMin: number | null;
  tempMax: number | null;
  area: { name: string };
};

export async function buildEquipmentPoster(
  item: EquipmentSource,
  origin: string,
  orgName: string
): Promise<QrPoster> {
  const url = qrFillUrl(origin, "equipment", item.id);
  const norm = rangeLabel(item.tempMin, item.tempMax, "°C");
  return {
    id: item.id,
    kind: "equipment",
    title: item.name,
    orgName,
    // Цех не печатаем: плакат висит на самом холодильнике, а строка с
    // организацией и без него получалась длинной.
    subtitle: "",
    norms: norm ? [norm] : [],
    url,
    svg: await qrSvg(url),
  };
}

type RoomSource = { id: string; name: string; climateNorms: unknown };

export async function buildRoomPoster(
  room: RoomSource,
  _buildingName: string,
  origin: string,
  orgName: string
): Promise<QrPoster> {
  const norms = normalizeClimateRoomNorms(room.climateNorms);
  const url = qrFillUrl(origin, "room", room.id);
  return {
    id: room.id,
    kind: "room",
    title: room.name,
    orgName,
    // Точку не печатаем: её название почти повторяет организацию.
    subtitle: "",
    norms: [
      metricLabel(norms?.temperature ?? DEFAULT_CLIMATE_TEMPERATURE, "°C"),
      metricLabel(norms?.humidity ?? DEFAULT_CLIMATE_HUMIDITY, "%"),
    ].filter((label): label is string => Boolean(label)),
    url,
    svg: await qrSvg(url),
  };
}

/**
 * Гигиена по форме Приложения №1 — два плаката: сотрудники подписывают
 * три графы, ответственный по второму ставит «допущен / отстранён».
 */
export const HYGIENE_VERIFY_SUFFIX = "@verify";
const HYGIENE_VERIFY_POSTER = { name: "Гигиенический журнал (сотрудники) — допуск", subtitle: "Для ответственного: «Допущен» или «Отстранён» каждому на смене" };

/** Плакат журнала: `documentId` сужает до конкретного документа (из его меню). */
export async function buildJournalPoster(params: {
  organizationId: string;
  code: string;
  name: string;
  subtitle: string;
  orgName: string;
  documentId?: string | null;
  origin: string;
  /** Второй плакат гигиены — «Допуск сотрудников» для ответственного. */
  verify?: boolean;
}): Promise<QrPoster> {
  const subject = journalFillSubject(params.organizationId, params.code, params.documentId);
  const url = qrFillUrl(params.origin, "journal", subject) + (params.verify ? "&view=all" : "");
  const code = params.verify ? `${params.code}${HYGIENE_VERIFY_SUFFIX}` : params.code;
  return {
    id: params.documentId ? `${code}:${params.documentId}` : code,
    kind: "journal",
    title: params.name,
    orgName: params.orgName,
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
      select: {
        timezone: true,
        disabledJournalCodes: true,
        name: true,
        journalShortName: true,
        legalProfileJson: true,
      },
    });
    if (!org) return [];
    const orgName = resolveOrgJournalName(org);
    const journals = await listHubJournals(params.organizationId, org.disabledJournalCodes as string[], todayKeyFor(org.timezone));
    if (allowed(JOURNAL_FILL_HUB_CODE)) {
      posters.push(
        await buildJournalPoster({
          organizationId: params.organizationId,
          code: JOURNAL_FILL_HUB_CODE,
          name: "Все журналы",
          subtitle: "Один плакат на стену: сотрудник выбирает журнал после сканирования",
          orgName,
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
          orgName,
          origin: params.origin,
        })
      );
      if (journal.code === "hygiene" && allowed(`hygiene${HYGIENE_VERIFY_SUFFIX}`)) {
        posters.push(
          await buildJournalPoster({
            organizationId: params.organizationId,
            code: journal.code,
            ...HYGIENE_VERIFY_POSTER,
            orgName,
            origin: params.origin,
            verify: true,
          })
        );
      }
    }
    return posters;
  }
  const orgName = await loadPosterOrgName(params.organizationId);
  if (params.kind === "room") {
    const buildings = await loadDirectoryBuildings(params.organizationId);
    for (const building of buildings) {
      for (const room of building.rooms) {
        if (!allowed(room.id)) continue;
        posters.push(await buildRoomPoster(room, building.name, params.origin, orgName));
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
    posters.push(await buildEquipmentPoster(item, params.origin, orgName));
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
  const orgName = await loadPosterOrgName(params.organizationId);
  if (params.kind === "journal") {
    const [rawCode, documentId] = params.id.split(":");
    const verify = rawCode?.endsWith(HYGIENE_VERIFY_SUFFIX) ?? false;
    const code = verify ? rawCode.slice(0, -HYGIENE_VERIFY_SUFFIX.length) : rawCode;
    if (!code || (verify && code !== "hygiene")) return null;
    if (code === JOURNAL_FILL_HUB_CODE) {
      return buildJournalPoster({
        organizationId: params.organizationId,
        code,
        name: "Все журналы",
        subtitle: "Сотрудник выбирает журнал после сканирования",
        orgName,
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
    if (verify) {
      return buildJournalPoster({ organizationId: params.organizationId, code, ...HYGIENE_VERIFY_POSTER, orgName, documentId: documentId ?? null, origin: params.origin, verify: true });
    }
    return buildJournalPoster({
      organizationId: params.organizationId,
      code,
      name: template.name,
      subtitle,
      orgName,
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
    return buildRoomPoster(room, room.building.name, params.origin, orgName);
  }
  const item = await db.equipment.findFirst({
    where: { id: params.id, area: { organizationId: params.organizationId } },
    select: { id: true, name: true, tempMin: true, tempMax: true, area: { select: { name: true } } },
  });
  if (!item) return null;
  return buildEquipmentPoster(item, params.origin, orgName);
}
