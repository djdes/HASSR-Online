import { db } from "@/lib/db";
import { parseDisabledCodes } from "@/lib/disabled-journals";
import { JOURNAL_FILL_HUB_CODE, journalFillValidUntil, listHubJournals, todayKeyFor } from "@/lib/journal-fill";
import { HYGIENE_VERIFY_SUFFIX, isJournalObjectQrCode, splitJournalPosterId } from "@/lib/journal-qr-target";
import { journalResponsibleLabel } from "@/lib/journal-responsible-person";
import { resolveOrgJournalName } from "@/lib/org-journal-name";
import {
  buildJournalPoster,
  formatPeriodLabel,
  loadMainJournalQrNotices,
  loadQrPoster,
  loadQrPosters,
  resolveMainJournalQrBuilding,
} from "@/lib/qr-fill-poster";
import type { QrPoster, QrPosterItem, QrPosterMissing, QrPrintFormat } from "@/lib/qr-fill-types";
import { resolveJournalObjectScope } from "@/lib/qr-journal-scope";
import type { QrPostersRequest } from "@/lib/qr-posters-request";

/**
 * Сборка страницы «QR-коды журнала» (server-only): группы карточек на
 * готовых билдерах `qr-fill-poster.ts`, отметки и форматы по умолчанию.
 *
 * Экраны (`parseQrPostersRequest`):
 *   • journal  — основные QR журнала (отмечены; у гигиены два) +
 *     дополнительные QR активных документов (не отмечены, со сроком), а у
 *     журналов объектов вместо дополнительных — наклейки объектов (отмечены);
 *   • objects  — наклейки оборудования / помещений (отмечены);
 *   • overview — «Все журналы» (отмечен) и основные QR отдельных журналов.
 * `selectedIds` (старые ссылки с `ids=`) отмечает ровно эти карточки.
 */

export type QrPostersScreen = "journal" | "objects" | "overview";

export type QrPostersView = {
  screen: QrPostersScreen;
  journal: {
    code: string;
    name: string;
    isObject: boolean;
    disabled: boolean;
  } | null;
  /** Вид наклеек: экран объектов или журнал объектов. */
  objectKind: "equipment" | "room" | null;
  /** Наклейки сужены до строк документа. */
  documentTitle: string | null;
  items: QrPosterItem[];
  missing: QrPosterMissing[];
  /** Журнал объектов без объектов: кто должен их завести. */
  objectsEmpty: { responsible: string } | null;
  /** Общий экран: сколько наклеек у справочников. */
  counts: { equipment: number; rooms: number } | null;
  /** Наклейки показаны не все (выбор строк / документ). */
  filtered: boolean;
  origin: string;
  autoprint: boolean;
};

const MAX_EXTRA_DOCUMENTS = 30;
const HYGIENE_VERIFY_TITLE = "Гигиенический журнал (сотрудники) — допуск";
const HYGIENE_VERIFY_SUBTITLE = "Для ответственного: «Допущен» или «Отстранён» каждому на смене";

const CAPTION = {
  hub: "Сотрудник сканирует, выбирает журнал и себя — запись ложится в действующий документ.",
  main: "Сотрудник сканирует, выбирает себя и заполняет форму — запись ложится в действующий документ.",
  verify: "Ответственный сканирует и отмечает каждому на смене «Допущен» или «Отстранён».",
  objectMain: "Показывает статус объектов за сегодня. Записывают по наклейке на самом объекте.",
  equipment: "Сотрудник сканирует наклейку на дверце и вносит температуру.",
  uv: "Сотрудник сканирует наклейку на лампе и отмечает включение.",
  room: "Сотрудник сканирует наклейку в помещении и вносит температуру и влажность.",
} as const;

function objectSubtitle(code: string): string {
  if (code === "climate_control") return "Статус помещений · показания — по наклейке в помещении";
  if (code === "uv_lamp_runtime") return "Статус ламп · отметка — по наклейке на лампе";
  return "Статус холодильников · температура — по наклейке на дверце";
}

type OrgContext = {
  organizationId: string;
  orgName: string;
  todayKey: string;
  disabledCodes: Set<string>;
  journalPeriods: unknown;
  activeBuildingId: string | null;
  origin: string;
};

function pick(selectedIds: string[] | null, key: string, fallback: boolean): boolean {
  return selectedIds ? selectedIds.includes(key) : fallback;
}

async function buildingName(buildingId: string | null): Promise<string | null> {
  if (!buildingId) return null;
  const building = await db.building.findUnique({ where: { id: buildingId }, select: { name: true } });
  return building?.name ?? null;
}

/** Основные QR журнала: сам журнал и у гигиены «допуск». */
async function mainItems(ctx: OrgContext, code: string, name: string, request: QrPostersRequest, isObject: boolean): Promise<QrPosterItem[]> {
  const buildingId = await resolveMainJournalQrBuilding(ctx.organizationId, ctx.activeBuildingId);
  const point = await buildingName(buildingId);
  const notices = isObject
    ? new Map<string, string | null>()
    : await loadMainJournalQrNotices({ ...ctx, codes: [code] });
  const subtitle = isObject ? objectSubtitle(code) : point ? `${point} · запись с телефона` : "Запись в журнал с телефона";
  const format: QrPrintFormat = (!isObject && request.format) || "a4";
  const items: QrPosterItem[] = [
    {
      key: code,
      group: "main",
      poster: {
        ...(await buildJournalPoster({ organizationId: ctx.organizationId, code, name, subtitle, orgName: ctx.orgName, origin: ctx.origin, buildingId })),
        notice: notices.get(code) ?? null,
      },
      defaultSelected: pick(request.selectedIds, code, true),
      defaultFormat: format,
      label: name,
      sublabel: point,
      caption: isObject ? CAPTION.objectMain : CAPTION.main,
      buildingName: point,
    },
  ];
  if (code === "hygiene") {
    const key = `hygiene${HYGIENE_VERIFY_SUFFIX}`;
    items.push({
      key,
      group: "main",
      poster: {
        ...(await buildJournalPoster({
          organizationId: ctx.organizationId,
          code,
          name: HYGIENE_VERIFY_TITLE,
          subtitle: point ? `${point} · ${HYGIENE_VERIFY_SUBTITLE}` : HYGIENE_VERIFY_SUBTITLE,
          orgName: ctx.orgName,
          origin: ctx.origin,
          buildingId,
          verify: true,
        })),
        notice: notices.get(code) ?? null,
      },
      defaultSelected: pick(request.selectedIds, key, true),
      defaultFormat: format,
      label: "Допуск сотрудников к смене",
      sublabel: point,
      caption: CAPTION.verify,
      buildingName: point,
    });
  }
  return items;
}

type ExtraDoc = { id: string; title: string; status: string; dateFrom: Date; dateTo: Date; building: { name: string } | null };

async function extraItemsForDoc(ctx: OrgContext, code: string, name: string, doc: ExtraDoc, request: QrPostersRequest, highlighted: boolean): Promise<QrPosterItem[]> {
  const validUntil = journalFillValidUntil(doc.dateTo);
  const expired = ctx.todayKey > validUntil;
  const periodLabel = formatPeriodLabel(doc.dateFrom, doc.dateTo);
  const variants = code === "hygiene" ? [false, true] : [false];
  const items: QrPosterItem[] = [];
  for (const verify of variants) {
    const key = `${code}${verify ? HYGIENE_VERIFY_SUFFIX : ""}:${doc.id}`;
    const subtitle = doc.building?.name ? `${doc.title} · ${doc.building.name}` : doc.title;
    const poster: QrPoster = {
      ...(await buildJournalPoster({
        organizationId: ctx.organizationId,
        code,
        name: verify ? HYGIENE_VERIFY_TITLE : name,
        subtitle,
        orgName: ctx.orgName,
        origin: ctx.origin,
        documentId: doc.id,
        validUntil,
        verify,
      })),
      periodLabel,
      notice: doc.status === "closed" ? "Документ закрыт — пока его не вернут в активные, запись по этому QR не пройдёт" : null,
    };
    items.push({
      key,
      group: "extra",
      poster,
      defaultSelected: expired ? false : pick(request.selectedIds, key, false),
      defaultFormat: request.format ?? "a4",
      label: verify ? `Допуск · ${doc.title}` : doc.title,
      sublabel: [periodLabel, doc.building?.name].filter(Boolean).join(" · "),
      caption: verify ? `Допуск только в документ «${doc.title}».` : `Запись только в документ «${doc.title}».`,
      expired,
      buildingName: doc.building?.name ?? null,
      highlighted,
    });
  }
  return items;
}

async function journalScreen(ctx: OrgContext, request: QrPostersRequest, code: string, documentId: string | null): Promise<Omit<QrPostersView, "origin" | "autoprint">> {
  const empty = { objectKind: null, documentTitle: null, objectsEmpty: null, counts: null, filtered: false } as const;
  const template = await db.journalTemplate.findFirst({ where: { code }, select: { id: true, name: true } });
  if (!template || code === JOURNAL_FILL_HUB_CODE) {
    return { ...empty, screen: "journal", journal: null, items: [], missing: [{ id: code, label: code, reason: "Такого журнала нет" }] };
  }
  const isObject = isJournalObjectQrCode(code);
  const journal = { code, name: template.name, isObject, disabled: ctx.disabledCodes.has(code) };
  const items = await mainItems(ctx, code, template.name, request, isObject);
  const missing: QrPosterMissing[] = [];

  if (isObject) {
    const scope = await resolveJournalObjectScope(ctx.organizationId, code, ctx.todayKey, documentId);
    const objectKind = scope?.kind ?? (code === "climate_control" ? "room" : "equipment");
    const ids = new Set(scope?.ids ?? []);
    const loaded = await loadQrPosters({ organizationId: ctx.organizationId, kind: objectKind, origin: ctx.origin, allowed: (id) => ids.has(id) });
    for (const poster of loaded.posters) {
      items.push({
        key: poster.id,
        group: "object",
        poster,
        defaultSelected: pick(request.selectedIds, poster.id, true),
        defaultFormat: request.format ?? "sticker",
        label: poster.title,
        sublabel: poster.norms.length > 0 ? `норма ${poster.norms.join(", ")}` : null,
        caption: objectKind === "room" ? CAPTION.room : code === "uv_lamp_runtime" ? CAPTION.uv : CAPTION.equipment,
      });
    }
    const objectsEmpty = loaded.posters.length === 0
      ? { responsible: await journalResponsibleLabel({ organizationId: ctx.organizationId, templateCode: code, todayKey: ctx.todayKey, documentId }) }
      : null;
    return {
      screen: "journal",
      journal,
      objectKind,
      documentTitle: scope?.document?.title ?? null,
      items,
      missing,
      objectsEmpty,
      counts: null,
      filtered: Boolean(scope?.document),
    };
  }

  const day = new Date(`${ctx.todayKey}T00:00:00.000Z`);
  const select = { id: true, title: true, status: true, dateFrom: true, dateTo: true, building: { select: { name: true } } } as const;
  const docs: ExtraDoc[] = await db.journalDocument.findMany({
    where: { organizationId: ctx.organizationId, templateId: template.id, status: "active", dateTo: { gte: day } },
    orderBy: [{ dateFrom: "desc" }, { createdAt: "desc" }],
    take: MAX_EXTRA_DOCUMENTS,
    select,
  });
  // Документы из адреса (`doc=`, `ids=код:документ`), которых нет в списке:
  // закончившийся — строкой «срок истёк», закрытый — с подсказкой.
  const wantedDocIds = new Set<string>();
  if (documentId) wantedDocIds.add(documentId);
  for (const id of request.selectedIds ?? []) {
    const part = splitJournalPosterId(id);
    if (part.documentId && part.code === code) wantedDocIds.add(part.documentId);
  }
  const listed = new Set(docs.map((doc) => doc.id));
  const extraIds = Array.from(wantedDocIds).filter((id) => !listed.has(id));
  if (extraIds.length > 0) {
    const found: ExtraDoc[] = await db.journalDocument.findMany({
      where: { id: { in: extraIds }, organizationId: ctx.organizationId, templateId: template.id },
      select,
    });
    const foundIds = new Set(found.map((doc) => doc.id));
    for (const id of extraIds) {
      if (!foundIds.has(id)) missing.push({ id: `${code}:${id}`, label: template.name, reason: "Документ не найден — возможно, его удалили" });
    }
    docs.push(...found);
  }
  // Документ, из которого пришли, — первым.
  docs.sort((a, b) => Number(wantedDocIds.has(b.id)) - Number(wantedDocIds.has(a.id)));
  for (const doc of docs) items.push(...(await extraItemsForDoc(ctx, code, template.name, doc, request, wantedDocIds.has(doc.id))));
  return { ...empty, screen: "journal", journal, items, missing };
}

async function objectsScreen(ctx: OrgContext, request: QrPostersRequest, kind: "equipment" | "room"): Promise<Omit<QrPostersView, "origin" | "autoprint">> {
  const loaded = await loadQrPosters({ organizationId: ctx.organizationId, kind, origin: ctx.origin, explicitIds: request.selectedIds ?? [] });
  const format = request.format ?? "a4";
  return {
    screen: "objects",
    journal: null,
    objectKind: kind,
    documentTitle: null,
    items: loaded.posters.map((poster) => ({
      key: poster.id,
      group: "object" as const,
      poster,
      defaultSelected: true,
      defaultFormat: format,
      label: poster.title,
      sublabel: poster.norms.length > 0 ? `норма ${poster.norms.join(", ")}` : null,
      caption: kind === "room" ? CAPTION.room : CAPTION.equipment,
    })),
    missing: loaded.missing,
    objectsEmpty: null,
    counts: null,
    filtered: Boolean(request.selectedIds),
  };
}

async function overviewScreen(ctx: OrgContext, request: QrPostersRequest): Promise<Omit<QrPostersView, "origin" | "autoprint">> {
  const format = request.format ?? "a4";
  const items: QrPosterItem[] = [
    {
      key: JOURNAL_FILL_HUB_CODE,
      group: "main",
      poster: await buildJournalPoster({
        organizationId: ctx.organizationId,
        code: JOURNAL_FILL_HUB_CODE,
        name: "Все журналы",
        subtitle: "Один плакат на стену: сотрудник выбирает журнал после сканирования",
        orgName: ctx.orgName,
        origin: ctx.origin,
      }),
      defaultSelected: pick(request.selectedIds, JOURNAL_FILL_HUB_CODE, true),
      defaultFormat: format,
      label: "Все журналы",
      sublabel: null,
      caption: CAPTION.hub,
    },
  ];
  const journals = await listHubJournals(ctx.organizationId, Array.from(ctx.disabledCodes), ctx.todayKey, { includeLapsed: true });
  const notices = await loadMainJournalQrNotices({ ...ctx, codes: journals.map((journal) => journal.code) });
  const buildingId = await resolveMainJournalQrBuilding(ctx.organizationId, ctx.activeBuildingId);
  const point = await buildingName(buildingId);
  for (const journal of journals) {
    const variants = journal.code === "hygiene" ? [false, true] : [false];
    for (const verify of variants) {
      const key = verify ? `${journal.code}${HYGIENE_VERIFY_SUFFIX}` : journal.code;
      items.push({
        key,
        group: "extra",
        poster: {
          ...(await buildJournalPoster({
            organizationId: ctx.organizationId,
            code: journal.code,
            name: verify ? HYGIENE_VERIFY_TITLE : journal.name,
            subtitle: verify ? HYGIENE_VERIFY_SUBTITLE : point ? `${point} · запись с телефона` : "Запись в журнал с телефона",
            orgName: ctx.orgName,
            origin: ctx.origin,
            buildingId,
            verify,
          })),
          notice: notices.get(journal.code) ?? null,
        },
        defaultSelected: pick(request.selectedIds, key, false),
        defaultFormat: format,
        label: verify ? "Гигиена — допуск сотрудников" : journal.name,
        sublabel: point,
        caption: verify ? CAPTION.verify : CAPTION.main,
        buildingName: point,
      });
    }
  }
  // Старые ссылки на несколько журналов: чего нет в списке — собрать по id.
  const missing: QrPosterMissing[] = [];
  const known = new Set(items.map((item) => item.key));
  for (const id of request.selectedIds ?? []) {
    if (known.has(id)) continue;
    const poster = await loadQrPoster({ organizationId: ctx.organizationId, kind: "journal", id, origin: ctx.origin, activeBuildingId: ctx.activeBuildingId });
    if (!poster) {
      missing.push({ id, label: splitJournalPosterId(id).code || id, reason: "Журнал или документ не найден" });
      continue;
    }
    items.push({
      key: poster.id,
      group: "extra",
      poster,
      defaultSelected: !(poster.validUntil && ctx.todayKey > poster.validUntil),
      defaultFormat: format,
      label: poster.title,
      sublabel: poster.subtitle,
      caption: CAPTION.main,
      expired: Boolean(poster.validUntil && ctx.todayKey > poster.validUntil),
    });
  }
  const [equipment, rooms] = await Promise.all([
    db.equipment.count({ where: { area: { organizationId: ctx.organizationId } } }),
    db.room.count({ where: { building: { organizationId: ctx.organizationId } } }),
  ]);
  return {
    screen: "overview",
    journal: null,
    objectKind: null,
    documentTitle: null,
    items,
    missing,
    objectsEmpty: null,
    counts: { equipment, rooms },
    filtered: false,
  };
}

export async function loadQrPostersView(params: {
  organizationId: string;
  request: QrPostersRequest;
  origin: string;
  activeBuildingId: string | null;
}): Promise<QrPostersView> {
  const { request } = params;
  const org = await db.organization.findUnique({
    where: { id: params.organizationId },
    select: { timezone: true, disabledJournalCodes: true, journalPeriods: true, name: true, journalShortName: true, legalProfileJson: true },
  });
  const ctx: OrgContext = {
    organizationId: params.organizationId,
    orgName: resolveOrgJournalName(org),
    todayKey: todayKeyFor(org?.timezone),
    disabledCodes: parseDisabledCodes(org?.disabledJournalCodes),
    journalPeriods: org?.journalPeriods ?? null,
    activeBuildingId: params.activeBuildingId,
    origin: params.origin,
  };

  let body: Omit<QrPostersView, "origin" | "autoprint">;
  const target = request.target;
  if (target.type === "journal") {
    body = await journalScreen(ctx, request, target.code, target.documentId);
  } else if (target.type === "objects") {
    // Меню холодильников и климата (`kind=…&doc=`) — экран их журнала.
    const document = target.documentId
      ? await db.journalDocument.findFirst({
          where: { id: target.documentId, organizationId: ctx.organizationId },
          select: { template: { select: { code: true } } },
        })
      : null;
    body =
      document && isJournalObjectQrCode(document.template.code)
        ? await journalScreen(ctx, request, document.template.code, target.documentId)
        : await objectsScreen(ctx, request, target.kind);
  } else {
    body = await overviewScreen(ctx, request);
  }
  return { ...body, origin: params.origin, autoprint: request.autoprint };
}
