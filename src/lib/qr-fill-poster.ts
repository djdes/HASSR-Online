import {
  DEFAULT_CLIMATE_HUMIDITY,
  DEFAULT_CLIMATE_TEMPERATURE,
  normalizeClimateRoomNorms,
  type ClimateMetricConfig,
} from "@/lib/climate-document";
import { db } from "@/lib/db";
import { parseDisabledCodes } from "@/lib/disabled-journals";
import { brandQrSvg } from "@/lib/brand-qr";
import { buildingTargets } from "@/lib/building-targets";
import { JOURNAL_FILL_HUB_CODE, JOURNAL_FILL_PERPETUAL_UNTIL, journalFillSubject, journalFillValidUntil, listHubJournals, todayKeyFor } from "@/lib/journal-fill";
import { parseJournalPeriodsJson, resolveJournalPeriodKind } from "@/lib/journal-period";
import { HYGIENE_VERIFY_SUFFIX, splitJournalPosterId } from "@/lib/journal-qr-target";
import { resolveOrgJournalName } from "@/lib/org-journal-name";
import { mintQrFillToken } from "@/lib/qr-fill-token";
import type { QrFillKind, QrPoster, QrPosterMissing } from "@/lib/qr-fill-types";
import { loadDirectoryBuildings } from "@/lib/room-directory";
import { encodeRouteParam } from "@/lib/route-param";

/**
 * Единый билдер QR-плакатов: страница `/settings/qr-posters` и
 * `GET /api/qr-fill/[kind]/[id]` собирают объект одинаково — иначе превью
 * в диалоге строки и печатный плакат разошлись бы в норме/ссылке.
 *
 * Виды: `equipment` (холодильник), `room` (помещение), `journal`
 * (запись в журнал: `id` = `<code>` или `<code>:<documentId>`; хаб — `all`).
 *
 * Server-only (db + фирменный QR + HMAC-секрет): в клиент не импортировать,
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

/** Фирменный QR (`brand-qr.ts`): логотип, коррекция H, плашка «Отсканировать». */
async function qrSvg(url: string): Promise<string> {
  return brandQrSvg(url);
}

export function qrFillUrl(origin: string, kind: QrFillKind, id: string): string {
  const token = mintQrFillToken(kind, id);
  const base = origin.replace(/\/+$/, "");
  if (kind === "journal") {
    const [orgId, code] = id.split(":");
    return `${base}/journal-fill/${orgId}/${code}?token=${encodeURIComponent(token)}`;
  }
  const path = kind === "room" ? "room-fill" : "equipment-fill";
  return `${base}/${path}/${encodeRouteParam(id)}?token=${encodeURIComponent(token)}`;
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
 * Суффикс второго плаката — в `journal-qr-target.ts` (его строит и кнопка).
 */
export { HYGIENE_VERIFY_SUFFIX };
const HYGIENE_VERIFY_POSTER = { name: "Гигиенический журнал (сотрудники) — допуск", subtitle: "Для ответственного: «Допущен» или «Отстранён» каждому на смене" };

// ---------------------------------------------------------------------------
// Выпуск QR журнала (2026-09-23): основной — навсегда, в организации с
// точками привязан к точке; дополнительный — на документ, до конца его
// периода. Формат субъекта — `journal-fill.ts` (`journalFillSubject`).

/**
 * Точка основного QR журнала: активная точка, если у организации точки
 * включены (≥ 2 точек) и эта точка — её. Иначе null (общий QR журнала).
 */
export async function resolveMainJournalQrBuilding(organizationId: string, activeBuildingId: string | null | undefined): Promise<string | null> {
  if (!activeBuildingId) return null;
  const targets = await buildingTargets(organizationId);
  return targets.includes(activeBuildingId) ? activeBuildingId : null;
}

/**
 * Адрес основного QR журнала. `activeBuildingId` — из `getActiveBuildingId`
 * (шапка кабинета); хаб `all` к точке не привязывается. `verify` — второй
 * основной QR гигиены («допуск»).
 */
export async function mainJournalQrUrl(params: {
  organizationId: string;
  code: string;
  origin: string;
  activeBuildingId?: string | null;
  verify?: boolean;
}): Promise<{ url: string; buildingId: string | null }> {
  const buildingId =
    params.code === JOURNAL_FILL_HUB_CODE ? null : await resolveMainJournalQrBuilding(params.organizationId, params.activeBuildingId);
  const subject = journalFillSubject(params.organizationId, params.code, null, { buildingId });
  return { url: qrFillUrl(params.origin, "journal", subject) + (params.verify ? "&view=all" : ""), buildingId };
}

/**
 * Адрес дополнительного QR документа: действует по `dateTo` документа
 * включительно (бессрочный — `2099-12-31`, в интерфейсе «бессрочно»).
 */
export function documentJournalQrUrl(params: {
  organizationId: string;
  code: string;
  origin: string;
  document: { id: string; dateTo: Date | string };
  verify?: boolean;
}): { url: string; validUntil: string } {
  const validUntil = journalFillValidUntil(params.document.dateTo);
  const subject = journalFillSubject(params.organizationId, params.code, params.document.id, { validUntil });
  return { url: qrFillUrl(params.origin, "journal", subject) + (params.verify ? "&view=all" : ""), validUntil };
}

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
  /** Срок дополнительного QR документа (`journalFillValidUntil(dateTo)`); без него — старый бессрочный QR документа. */
  validUntil?: string | null;
  /** Точка основного QR (`resolveMainJournalQrBuilding`); только без `documentId`. */
  buildingId?: string | null;
}): Promise<QrPoster> {
  const subject = journalFillSubject(params.organizationId, params.code, params.documentId, {
    validUntil: params.documentId ? params.validUntil : null,
    buildingId: params.documentId ? null : params.buildingId,
  });
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
    journalCode: params.code,
    documentId: params.documentId ?? null,
    validUntil: params.documentId ? (params.validUntil ?? null) : null,
  };
}

// ---------------------------------------------------------------------------
// Подсказки на плакатах журналов (только на экране, не печатаются): что
// будет при сканировании, если документа на сегодня нет.

export const QR_POSTER_NOTICE_LAPSED =
  "Прошлый период закончился — при первом сканировании откроется новый документ по образцу прошлого";
export const QR_POSTER_NOTICE_EMPTY = "У журнала ещё нет документа — создайте первый";
/** Основной QR журнала без документов: первый скан сам создаёт документ (C4). */
export const QR_POSTER_NOTICE_FIRST_SCAN = "Документа ещё нет — он создастся при первом сканировании";
export const QR_POSTER_NOTICE_MISSING = "На сегодня документа нет, а сам он не создаётся — создайте документ в журнале";
export const QR_POSTER_NOTICE_CLOSED =
  "Документ за этот период закрыт — пока его не вернут в активные, запись по QR не пройдёт";
export const QR_POSTER_NOTICE_DISABLED = "Журнал выключен в наборе журналов — QR ответит «журнал отключён»";

type JournalQrState = "active" | "lapsed" | "closed" | "empty" | "missing" | "disabled";

const NOTICE_BY_STATE: Record<JournalQrState, string | null> = {
  active: null,
  lapsed: QR_POSTER_NOTICE_LAPSED,
  closed: QR_POSTER_NOTICE_CLOSED,
  empty: QR_POSTER_NOTICE_EMPTY,
  missing: QR_POSTER_NOTICE_MISSING,
  disabled: QR_POSTER_NOTICE_DISABLED,
};

/**
 * Подсказки основных QR журналов (экран, не печать). Пустой журнал по
 * основному QR сам создаёт первый документ — там подсказка другая.
 */
export async function loadMainJournalQrNotices(params: {
  organizationId: string;
  codes: string[];
  todayKey: string;
  disabledCodes: Set<string>;
  journalPeriods: unknown;
}): Promise<Map<string, string | null>> {
  const states = await loadJournalQrStates(params);
  const notices = new Map<string, string | null>();
  for (const [code, state] of states) notices.set(code, state === "empty" ? QR_POSTER_NOTICE_FIRST_SCAN : NOTICE_BY_STATE[state]);
  return notices;
}

/** Состояние журналов на сегодня — четыре запроса на весь лист плакатов. */
async function loadJournalQrStates(params: {
  organizationId: string;
  codes: string[];
  todayKey: string;
  disabledCodes: Set<string>;
  journalPeriods: unknown;
}): Promise<Map<string, JournalQrState>> {
  const codes = Array.from(new Set(params.codes)).filter((code) => code && code !== JOURNAL_FILL_HUB_CODE);
  const states = new Map<string, JournalQrState>();
  if (codes.length === 0) return states;
  const day = new Date(`${params.todayKey}T00:00:00.000Z`);
  const templates = await db.journalTemplate.findMany({ where: { code: { in: codes } }, select: { id: true, code: true } });
  const templateIds = templates.map((template) => template.id);
  const [active, closed, groups] = await Promise.all([
    db.journalDocument.findMany({
      where: { organizationId: params.organizationId, templateId: { in: templateIds }, status: "active", dateFrom: { lte: day }, dateTo: { gte: day } },
      select: { templateId: true },
    }),
    db.journalDocument.findMany({
      where: { organizationId: params.organizationId, templateId: { in: templateIds }, status: "closed", dateFrom: { lte: day }, dateTo: { gte: day } },
      select: { templateId: true },
    }),
    db.journalDocument.groupBy({
      by: ["templateId"],
      where: { organizationId: params.organizationId, templateId: { in: templateIds } },
      _max: { dateTo: true },
    }),
  ]);
  const activeIds = new Set(active.map((doc) => doc.templateId));
  const closedIds = new Set(closed.map((doc) => doc.templateId));
  const maxDateTo = new Map(groups.map((group) => [group.templateId, group._max.dateTo]));
  const overrides = parseJournalPeriodsJson(params.journalPeriods ?? null);
  for (const template of templates) {
    const last = maxDateTo.get(template.id) ?? null;
    let state: JournalQrState;
    if (params.disabledCodes.has(template.code)) state = "disabled";
    else if (activeIds.has(template.id)) state = "active";
    else if (closedIds.has(template.id)) state = "closed";
    else if (!last) state = "empty";
    else if (last.getTime() >= day.getTime()) state = "missing";
    else state = (overrides[template.code]?.kind ?? resolveJournalPeriodKind(template.code)) === "perpetual" ? "missing" : "lapsed";
    states.set(template.code, state);
  }
  return states;
}

type ExplicitJournalPoster =
  | { poster: QrPoster; code: string; document: { status: string; dateFrom: Date; dateTo: Date } | null }
  | { missing: QrPosterMissing };

/**
 * Плакат журнала по id из адреса (`<код>`, `<код>:<документ>`,
 * `hygiene@verify[:документ]`, `all`) — любого журнала организации, даже
 * без документа на сегодня. Не собрался — причина для экрана.
 */
async function buildJournalPosterById(params: {
  organizationId: string;
  id: string;
  orgName: string;
  origin: string;
  /** Активная точка кабинета: основной QR в сети точек привязан к ней. */
  activeBuildingId?: string | null;
}): Promise<ExplicitJournalPoster> {
  const { code, documentId, verify } = splitJournalPosterId(params.id);
  if (!code) return { missing: { id: params.id, label: params.id, reason: "Пустой код журнала" } };
  if (verify && code !== "hygiene") {
    return { missing: { id: params.id, label: params.id, reason: "Плакат допуска есть только у гигиенического журнала" } };
  }
  if (code === JOURNAL_FILL_HUB_CODE) {
    return {
      code,
      document: null,
      poster: await buildJournalPoster({
        organizationId: params.organizationId,
        code,
        name: "Все журналы",
        subtitle: "Сотрудник выбирает журнал после сканирования",
        orgName: params.orgName,
        origin: params.origin,
      }),
    };
  }
  const template = await db.journalTemplate.findFirst({ where: { code }, select: { name: true } });
  if (!template) return { missing: { id: params.id, label: code, reason: "Такого журнала нет" } };
  let subtitle = "Запись в журнал с телефона";
  let document: { status: string; dateFrom: Date; dateTo: Date } | null = null;
  if (documentId) {
    const found = await db.journalDocument.findFirst({
      where: { id: documentId, organizationId: params.organizationId, template: { code } },
      select: { title: true, status: true, dateFrom: true, dateTo: true, building: { select: { name: true } } },
    });
    if (!found) {
      return { missing: { id: params.id, label: template.name, reason: "Документ не найден — возможно, его удалили" } };
    }
    document = { status: found.status, dateFrom: found.dateFrom, dateTo: found.dateTo };
    subtitle = found.building?.name ? `${found.title} · ${found.building.name}` : found.title;
  }
  // Документ — дополнительный QR до конца его периода; журнал — основной,
  // в сети точек привязан к активной точке.
  const validUntil = document ? journalFillValidUntil(document.dateTo) : null;
  const buildingId = documentId ? null : await resolveMainJournalQrBuilding(params.organizationId, params.activeBuildingId);
  const poster = verify
    ? await buildJournalPoster({
        organizationId: params.organizationId,
        code,
        ...HYGIENE_VERIFY_POSTER,
        orgName: params.orgName,
        documentId,
        origin: params.origin,
        verify: true,
        validUntil,
        buildingId,
      })
    : await buildJournalPoster({
        organizationId: params.organizationId,
        code,
        name: template.name,
        subtitle,
        orgName: params.orgName,
        documentId,
        origin: params.origin,
        validUntil,
        buildingId,
      });
  if (document) poster.periodLabel = formatPeriodLabel(document.dateFrom, document.dateTo);
  return { poster, code, document };
}

const ddmm = (date: Date) => `${String(date.getUTCDate()).padStart(2, "0")}.${String(date.getUTCMonth() + 1).padStart(2, "0")}`;

/** Период документа для подписи: «01.09–30.09.2026»; бессрочный — «с 01.09.2026». */
export function formatPeriodLabel(dateFrom: Date, dateTo: Date): string {
  const fromYear = dateFrom.getUTCFullYear();
  if (journalFillValidUntil(dateTo) === JOURNAL_FILL_PERPETUAL_UNTIL) return `с ${ddmm(dateFrom)}.${fromYear}`;
  const toYear = dateTo.getUTCFullYear();
  return fromYear === toYear ? `${ddmm(dateFrom)}–${ddmm(dateTo)}.${toYear}` : `${ddmm(dateFrom)}.${fromYear}–${ddmm(dateTo)}.${toYear}`;
}

/** Подсказка плаката документа: сам документ важнее состояния журнала. */
function documentNotice(
  document: { status: string; dateFrom: Date; dateTo: Date } | null,
  journalState: JournalQrState | undefined,
  day: Date
): string | null {
  if (document && document.dateFrom.getTime() <= day.getTime() && document.dateTo.getTime() >= day.getTime()) {
    if (document.status === "active") return null;
    if (document.status === "closed") return QR_POSTER_NOTICE_CLOSED;
  }
  return journalState ? NOTICE_BY_STATE[journalState] : null;
}

export type QrPostersResult = {
  posters: QrPoster[];
  missing: QrPosterMissing[];
  /**
   * Где объект (id → цех у оборудования, точка у помещения): на плакат не
   * печатается, но нужен странице QR-кодов для поиска и порядка.
   */
  locations?: Record<string, string>;
};

/**
 * Все объекты организации данного вида (фильтр `allowed` — по id).
 * `explicitIds` — явно запрошенные в `ids=`: плакаты журналов по ним
 * собираются даже без документа на сегодня, а то, что собрать не
 * вышло, возвращается в `missing` с причиной — вместо пустого экрана
 * «Выбранные объекты не найдены».
 */
export async function loadQrPosters(params: {
  organizationId: string;
  kind: QrFillKind;
  origin: string;
  allowed?: (id: string) => boolean;
  explicitIds?: string[];
}): Promise<QrPostersResult> {
  const allowed = params.allowed ?? (() => true);
  const posters: QrPoster[] = [];
  const explicitIds = Array.from(new Set((params.explicitIds ?? []).map((id) => id.trim()).filter(Boolean)));
  if (params.kind === "journal") {
    const org = await db.organization.findUnique({
      where: { id: params.organizationId },
      select: {
        timezone: true,
        disabledJournalCodes: true,
        journalPeriods: true,
        name: true,
        journalShortName: true,
        legalProfileJson: true,
      },
    });
    if (!org) return { posters: [], missing: [] };
    const orgName = resolveOrgJournalName(org);
    const todayKey = todayKeyFor(org.timezone);
    const day = new Date(`${todayKey}T00:00:00.000Z`);
    const disabledCodes = parseDisabledCodes(org.disabledJournalCodes);
    const stateParams = { organizationId: params.organizationId, todayKey, disabledCodes, journalPeriods: org.journalPeriods };

    if (explicitIds.length > 0) {
      const missing: QrPosterMissing[] = [];
      const built: Array<Extract<ExplicitJournalPoster, { poster: QrPoster }>> = [];
      for (const id of explicitIds) {
        const result = await buildJournalPosterById({ organizationId: params.organizationId, id, orgName, origin: params.origin });
        if ("missing" in result) missing.push(result.missing);
        else built.push(result);
      }
      const states = await loadJournalQrStates({ ...stateParams, codes: built.map((item) => item.code) });
      return {
        posters: built.map((item) => ({ ...item.poster, notice: documentNotice(item.document, states.get(item.code), day) })),
        missing,
      };
    }

    // Журналы с кончившимся периодом — тоже на лист: первый скан откроет
    // документ нового периода.
    const journals = await listHubJournals(params.organizationId, Array.from(disabledCodes), todayKey, { includeLapsed: true });
    const states = await loadJournalQrStates({ ...stateParams, codes: journals.map((journal) => journal.code) });
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
      const state = states.get(journal.code);
      const notice = state ? NOTICE_BY_STATE[state] : null;
      posters.push({
        ...(await buildJournalPoster({
          organizationId: params.organizationId,
          code: journal.code,
          name: journal.name,
          subtitle: "Запись в журнал с телефона",
          orgName,
          origin: params.origin,
        })),
        notice,
      });
      if (journal.code === "hygiene" && allowed(`hygiene${HYGIENE_VERIFY_SUFFIX}`)) {
        posters.push({
          ...(await buildJournalPoster({
            organizationId: params.organizationId,
            code: journal.code,
            ...HYGIENE_VERIFY_POSTER,
            orgName,
            origin: params.origin,
            verify: true,
          })),
          notice,
        });
      }
    }
    return { posters, missing: [] };
  }
  const orgName = await loadPosterOrgName(params.organizationId);
  const wanted = (id: string) => allowed(id) && (explicitIds.length === 0 || explicitIds.includes(id));
  const locations: Record<string, string> = {};
  if (params.kind === "room") {
    const buildings = await loadDirectoryBuildings(params.organizationId);
    for (const building of buildings) {
      for (const room of building.rooms) {
        if (!wanted(room.id)) continue;
        locations[room.id] = building.name;
        posters.push(await buildRoomPoster(room, building.name, params.origin, orgName));
      }
    }
  } else {
    const equipment = await db.equipment.findMany({
      where: { area: { organizationId: params.organizationId } },
      orderBy: [{ area: { name: "asc" } }, { name: "asc" }],
      select: { id: true, name: true, tempMin: true, tempMax: true, area: { select: { name: true } } },
    });
    for (const item of equipment) {
      if (!wanted(item.id)) continue;
      if (item.area?.name) locations[item.id] = item.area.name;
      posters.push(await buildEquipmentPoster(item, params.origin, orgName));
    }
  }
  const found = new Set(posters.map((poster) => poster.id));
  const missing = explicitIds
    .filter((id) => !found.has(id))
    .map((id) => ({ id, label: id, reason: "Не найдено в справочнике — возможно, удалено" }));
  return { posters, missing, locations };
}

/** Один объект; `null`, если его нет или он не из этой организации. */
export async function loadQrPoster(params: {
  organizationId: string;
  kind: QrFillKind;
  id: string;
  origin: string;
  /** Активная точка кабинета — для основного QR журнала в сети точек. */
  activeBuildingId?: string | null;
}): Promise<QrPoster | null> {
  const orgName = await loadPosterOrgName(params.organizationId);
  if (params.kind === "journal") {
    const result = await buildJournalPosterById({
      organizationId: params.organizationId,
      id: params.id,
      orgName,
      origin: params.origin,
      activeBuildingId: params.activeBuildingId,
    });
    return "poster" in result ? result.poster : null;
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
