import { db } from "@/lib/db";
import { effectiveJournalSlots } from "@/lib/journal-responsibles-points";
import { emitWebhook } from "@/lib/webhooks/dispatch";
import { webhookPointFields } from "@/lib/webhooks/point";
import { sendTemperatureAlertEmail } from "@/lib/email";
import {
  escapeTelegramHtml as esc,
  notifyEmployee,
  notifyOrganization,
} from "@/lib/telegram";
import { COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE } from "@/lib/cold-equipment-document";
import { getPrimarySlotId } from "@/lib/journal-responsible-schemas";
import { MANAGEMENT_ROLES, getDbRoleValuesWithLegacy } from "@/lib/user-roles";
import { resolveLocale } from "@/i18n/locales";
import { filterRecipientsByPlace, placeOfEvent } from "@/lib/place-recipients";

/**
 * Отклонение температуры: сначала ответственному, потом руководству.
 *
 * Зачем модуль. Раньше каждое показание вне нормы независимо от пути
 * ввода (Tuya-cron, ESP32, QR-наклейка, ручная запись) слало одно и то
 * же сообщение всем управляющим. Три беды:
 *   - адресат размыт: пишем всем «руководителям», а идти и чинить
 *     холодильник должен ответственный за журнал;
 *   - дубли: пока холодильник греется, каждое показание = новый пуш;
 *   - нет эскалации: если ответственный не отреагировал, никто выше
 *     об этом не узнает.
 *
 * Теперь эпизод — это `TemperatureDeviationIncident`, а не показание.
 * Первое отклонение → адресное сообщение ответственному. Повторные
 * показания только обновляют инцидент. Возврат в норму (или вписанный
 * комментарий «что сделали») закрывает его. Если инцидент висит дольше
 * `Organization.deviationEscalationMinutes` — ровно одно сообщение
 * руководству, и только когда включён `escalateDeviationsToManagement`.
 *
 * Все обращения к БД и отправкам вынесены в `Deps`, чтобы поведение
 * проверялось юнит-тестами без базы (см. temperature-deviations.test.ts).
 */

/** Значение вне нормы? Пустая граница = не ограничено с этой стороны. */
export function isOutOfRange(
  value: number,
  tempMin: number | null,
  tempMax: number | null
): boolean {
  if (!Number.isFinite(value)) return false;
  if (tempMin !== null && value < tempMin) return true;
  if (tempMax !== null && value > tempMax) return true;
  return false;
}

/** «от -18 до -15» — человеческая запись нормы для текста уведомления. */
export function formatRange(
  tempMin: number | null,
  tempMax: number | null
): string {
  const parts = [
    tempMin !== null ? `от ${tempMin}` : "",
    tempMax !== null ? `до ${tempMax}` : "",
  ].filter(Boolean);
  return parts.join(" ");
}

/** Ключ эпизода: по нему ищем уже открытый инцидент. */
export function subjectKeyForEquipment(equipmentId: string): string {
  return `equipment:${equipmentId}`;
}

export function subjectKeyForDocumentItem(
  documentId: string,
  itemId: string
): string {
  return `doc:${documentId}:${itemId}`;
}

export const DEFAULT_ESCALATION_MINUTES = 60;
export const MIN_ESCALATION_MINUTES = 5;
export const MAX_ESCALATION_MINUTES = 1440;

export type DeviationIncident = {
  id: string;
  organizationId: string;
  subjectKey: string;
  subjectName: string;
  equipmentId: string | null;
  documentId: string | null;
  responsibleUserId: string | null;
  firstValue: number;
  lastValue: number;
  tempMin: number | null;
  tempMax: number | null;
  notifiedAt: Date | null;
  escalatedAt: Date | null;
  resolvedAt: Date | null;
};

export type DeviationOrgSettings = {
  escalateDeviationsToManagement: boolean;
  deviationEscalationMinutes: number;
};

export type ResponsiblePerson = {
  id: string;
  name: string | null;
  telegramChatId: string | null;
};

/** Откуда тревога — по нему ищем точку (`placeOfEvent`). */
export type TemperaturePlace = { equipmentId: string | null; documentId: string | null };

function placeOfIncident(incident: { equipmentId: string | null; documentId: string | null }): TemperaturePlace {
  return { equipmentId: incident.equipmentId, documentId: incident.documentId };
}

export type TemperatureReading = {
  organizationId: string;
  /** Ключ эпизода — `subjectKeyFor*`. */
  subjectKey: string;
  /** Имя холодильника для текста сообщения. */
  subjectName: string;
  value: number;
  tempMin: number | null;
  tempMax: number | null;
  equipmentId?: string | null;
  documentId?: string | null;
  /** Кто снял показание: «IoT-датчик (авто)», имя сотрудника и т.п. */
  source: string;
  /** Название зоны — попадает в письмо руководству. */
  areaName?: string | null;
  /**
   * Комментарий «что сделали» из журнала. Непустой закрывает инцидент
   * даже если температура ещё не пришла в норму: холодильник не
   * остывает мгновенно, а работа уже началась.
   */
  correctionNote?: string | null;
  now?: Date;
};

export type ProcessResult = {
  action:
    | "opened"
    | "updated"
    | "resolved"
    | "escalated"
    | "noop";
  incidentId?: string;
  notifiedResponsibleId?: string | null;
  notifiedManagement?: boolean;
};

export type Deps = {
  loadOrgSettings: (
    organizationId: string
  ) => Promise<DeviationOrgSettings | null>;
  findOpenIncident: (
    organizationId: string,
    subjectKey: string
  ) => Promise<DeviationIncident | null>;
  createIncident: (input: {
    organizationId: string;
    subjectKey: string;
    subjectName: string;
    equipmentId: string | null;
    documentId: string | null;
    responsibleUserId: string | null;
    value: number;
    tempMin: number | null;
    tempMax: number | null;
    notifiedAt: Date | null;
    now: Date;
  }) => Promise<DeviationIncident>;
  touchIncident: (
    incidentId: string,
    input: { lastValue: number; now: Date }
  ) => Promise<void>;
  resolveIncident: (
    incidentId: string,
    input: { reason: "in_range" | "correction"; lastValue: number; now: Date }
  ) => Promise<void>;
  markEscalated: (incidentId: string, now: Date) => Promise<void>;
  /** Ответственный за журнал холодильного оборудования. */
  findResponsible: (input: {
    organizationId: string;
    documentId: string | null;
    equipmentId: string | null;
  }) => Promise<ResponsiblePerson | null>;
  notifyResponsible: (userId: string, text: string) => Promise<void>;
  /** `place` — откуда тревога: руководителям этой точки и офису (фаза 3). */
  notifyManagement: (organizationId: string, text: string, place?: TemperaturePlace) => Promise<void>;
  emailManagement: (input: {
    organizationId: string;
    place?: TemperaturePlace;
    subjectName: string;
    value: number;
    tempMin: number | null;
    tempMax: number | null;
    areaName: string | null;
    source: string;
  }) => Promise<void>;
};

/* ----------------------------------------------------------------------
 * Тексты
 * -------------------------------------------------------------------- */

function alertTextForResponsible(reading: TemperatureReading): string {
  const range = formatRange(reading.tempMin, reading.tempMax);
  return (
    `<b>Температура вышла за норму</b>\n\n` +
    `Оборудование: <b>${esc(reading.subjectName)}</b>\n` +
    `Сейчас: <b>${reading.value}°C</b>\n` +
    (range ? `Норма: ${esc(range)}°C\n` : "") +
    `Источник: ${esc(reading.source)}\n\n` +
    `Что сделать: проверьте загрузку и дверцу, при необходимости ` +
    `переставьте продукты и вызовите сервис. Впишите в журнал, что вы ` +
    `сделали — тогда отметка об отклонении закроется.`
  );
}

function escalationText(
  incident: DeviationIncident,
  minutes: number,
  responsibleName: string | null
): string {
  const range = formatRange(incident.tempMin, incident.tempMax);
  const who = responsibleName
    ? `Ответственный (${esc(responsibleName)}) не отметил, что исправил.`
    : `Ответственный за журнал не назначен.`;
  return (
    `<b>Отклонение температуры не исправлено</b>\n\n` +
    `Оборудование: <b>${esc(incident.subjectName)}</b>\n` +
    `Последнее показание: <b>${incident.lastValue}°C</b>\n` +
    (range ? `Норма: ${esc(range)}°C\n` : "") +
    `Отклонение длится дольше ${minutes} мин. ${who}`
  );
}

function resolvedText(
  incident: DeviationIncident,
  reason: "in_range" | "correction",
  lastValue: number
): string {
  return reason === "in_range"
    ? `<b>Температура вернулась в норму</b>\n\n` +
        `Оборудование: <b>${esc(incident.subjectName)}</b>\n` +
        `Сейчас: <b>${lastValue}°C</b>`
    : `<b>Отклонение отработано</b>\n\n` +
        `Оборудование: <b>${esc(incident.subjectName)}</b>\n` +
        `Ответственный вписал в журнал, что сделал.`;
}

/* ----------------------------------------------------------------------
 * Главный обработчик
 * -------------------------------------------------------------------- */

/**
 * Обработать одно показание температуры. Вызывается из каждой точки
 * ввода — датчик, QR-наклейка, ручная запись, сетка журнала.
 *
 * Никогда не бросает наружу: уведомление не должно ронять запись в
 * журнал. Ошибки логируются, вызывающая сторона получает "noop".
 */
export async function processTemperatureReading(
  reading: TemperatureReading,
  overrides?: Partial<Deps>
): Promise<ProcessResult> {
  const deps = { ...defaultDeps(), ...overrides };
  const now = reading.now ?? new Date();

  try {
    const outOfRange = isOutOfRange(
      reading.value,
      reading.tempMin,
      reading.tempMax
    );
    const open = await deps.findOpenIncident(
      reading.organizationId,
      reading.subjectKey
    );

    // Норма и открытых инцидентов нет — самый частый случай, выходим.
    if (!outOfRange && !open) {
      return { action: "noop" };
    }

    // Возврат в норму либо вписанное корректирующее действие — закрываем.
    const hasCorrection = Boolean(reading.correctionNote?.trim());
    if (open && (!outOfRange || hasCorrection)) {
      const reason = outOfRange ? "correction" : "in_range";
      await deps.resolveIncident(open.id, {
        reason,
        lastValue: reading.value,
        now,
      });
      const text = resolvedText(open, reason, reading.value);
      if (open.responsibleUserId) {
        await deps.notifyResponsible(open.responsibleUserId, text);
      }
      // Руководству сообщаем только если оно об инциденте уже знало.
      if (open.escalatedAt) {
        await deps.notifyManagement(open.organizationId, text, placeOfIncident(open));
      }
      return { action: "resolved", incidentId: open.id };
    }

    if (!outOfRange) {
      return { action: "noop" };
    }

    // Эпизод уже идёт — обновляем и проверяем, не пора ли эскалировать.
    if (open) {
      await deps.touchIncident(open.id, { lastValue: reading.value, now });
      const escalated = await maybeEscalate(
        { ...open, lastValue: reading.value },
        now,
        deps
      );
      return escalated
        ? { action: "escalated", incidentId: open.id, notifiedManagement: true }
        : { action: "updated", incidentId: open.id };
    }

    // Новый эпизод: ищем ответственного за журнал.
    const responsible = await deps.findResponsible({
      organizationId: reading.organizationId,
      documentId: reading.documentId ?? null,
      equipmentId: reading.equipmentId ?? null,
    });
    const canPing = Boolean(responsible?.telegramChatId);
    const incident = await deps.createIncident({
      organizationId: reading.organizationId,
      subjectKey: reading.subjectKey,
      subjectName: reading.subjectName,
      equipmentId: reading.equipmentId ?? null,
      documentId: reading.documentId ?? null,
      responsibleUserId: canPing ? (responsible?.id ?? null) : null,
      value: reading.value,
      tempMin: reading.tempMin,
      tempMax: reading.tempMax,
      notifiedAt: canPing ? now : null,
      now,
    });

    if (canPing && responsible) {
      await deps.notifyResponsible(
        responsible.id,
        alertTextForResponsible(reading)
      );
      return {
        action: "opened",
        incidentId: incident.id,
        notifiedResponsibleId: responsible.id,
      };
    }

    // Ответственного нет (или у него нет Telegram) — сообщаем сразу
    // руководству, иначе отклонение потеряется совсем.
    const text = alertTextForResponsible(reading);
    await deps.notifyManagement(reading.organizationId, text, placeOfIncident(incident));
    await deps.emailManagement({
      organizationId: reading.organizationId,
      place: placeOfIncident(incident),
      subjectName: reading.subjectName,
      value: reading.value,
      tempMin: reading.tempMin,
      tempMax: reading.tempMax,
      areaName: reading.areaName ?? null,
      source: reading.source,
    });
    await deps.markEscalated(incident.id, now);
    return {
      action: "escalated",
      incidentId: incident.id,
      notifiedManagement: true,
    };
  } catch (err) {
    console.warn(
      "[temperature-deviations] processing failed:",
      err instanceof Error ? err.message : err
    );
    return { action: "noop" };
  }
}

/**
 * Эскалация одного инцидента, если он висит дольше порога.
 * Возвращает true, если сообщение руководству ушло именно сейчас.
 */
async function maybeEscalate(
  incident: DeviationIncident,
  now: Date,
  deps: Deps
): Promise<boolean> {
  if (incident.escalatedAt || incident.resolvedAt) return false;

  const settings = await deps.loadOrgSettings(incident.organizationId);
  if (!settings || !settings.escalateDeviationsToManagement) return false;

  const minutes = clampEscalationMinutes(settings.deviationEscalationMinutes);
  const since = incident.notifiedAt;
  // notifiedAt пуст только когда ответственного не нашли — такой
  // инцидент эскалируется в момент создания, сюда не доходит.
  if (!since) return false;
  const elapsedMin = (now.getTime() - since.getTime()) / 60000;
  if (elapsedMin < minutes) return false;

  const responsible = incident.responsibleUserId
    ? await deps.findResponsible({
        organizationId: incident.organizationId,
        documentId: incident.documentId,
        equipmentId: incident.equipmentId,
      })
    : null;

  await deps.notifyManagement(
    incident.organizationId,
    escalationText(incident, minutes, responsible?.name ?? null),
    placeOfIncident(incident)
  );
  await deps.emailManagement({
    organizationId: incident.organizationId,
    place: placeOfIncident(incident),
    subjectName: incident.subjectName,
    value: incident.lastValue,
    tempMin: incident.tempMin,
    tempMax: incident.tempMax,
    areaName: null,
    source: "Отклонение не исправлено вовремя",
  });
  await deps.markEscalated(incident.id, now);
  return true;
}

export function clampEscalationMinutes(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_ESCALATION_MINUTES;
  }
  return Math.min(
    MAX_ESCALATION_MINUTES,
    Math.max(MIN_ESCALATION_MINUTES, Math.floor(value))
  );
}

/**
 * Пройти по всем открытым инцидентам и эскалировать просроченные.
 * Вызывается кроном — показания могут не приходить вовсе (датчик
 * отвалился, повар перестал заполнять), а отклонение при этом висит.
 */
export async function escalateOpenIncidents(
  args?: { now?: Date },
  overrides?: Partial<Deps> & {
    listOpenIncidents?: () => Promise<DeviationIncident[]>;
  }
): Promise<{ checked: number; escalated: number }> {
  const deps = { ...defaultDeps(), ...overrides };
  const listOpen = overrides?.listOpenIncidents ?? defaultListOpenIncidents;
  const now = args?.now ?? new Date();

  const incidents = await listOpen();
  let escalated = 0;
  for (const incident of incidents) {
    try {
      if (await maybeEscalate(incident, now, deps)) escalated += 1;
    } catch (err) {
      console.warn(
        `[temperature-deviations] escalation failed for ${incident.id}:`,
        err instanceof Error ? err.message : err
      );
    }
  }
  return { checked: incidents.length, escalated };
}

/* ----------------------------------------------------------------------
 * Реальные зависимости (Prisma + Telegram + e-mail)
 * -------------------------------------------------------------------- */

async function defaultListOpenIncidents(): Promise<DeviationIncident[]> {
  const rows = await db.temperatureDeviationIncident.findMany({
    where: { resolvedAt: null, escalatedAt: null, notifiedAt: { not: null } },
    take: 500,
  });
  return rows.map(toIncident);
}

function toIncident(row: {
  id: string;
  organizationId: string;
  subjectKey: string;
  subjectName: string;
  equipmentId: string | null;
  documentId: string | null;
  responsibleUserId: string | null;
  firstValue: number;
  lastValue: number;
  tempMin: number | null;
  tempMax: number | null;
  notifiedAt: Date | null;
  escalatedAt: Date | null;
  resolvedAt: Date | null;
}): DeviationIncident {
  return {
    id: row.id,
    organizationId: row.organizationId,
    subjectKey: row.subjectKey,
    subjectName: row.subjectName,
    equipmentId: row.equipmentId,
    documentId: row.documentId,
    responsibleUserId: row.responsibleUserId,
    firstValue: row.firstValue,
    lastValue: row.lastValue,
    tempMin: row.tempMin,
    tempMax: row.tempMax,
    notifiedAt: row.notifiedAt,
    escalatedAt: row.escalatedAt,
    resolvedAt: row.resolvedAt,
  };
}

function defaultDeps(): Deps {
  return {
    loadOrgSettings: async (organizationId) => {
      const org = await db.organization.findUnique({
        where: { id: organizationId },
        select: {
          escalateDeviationsToManagement: true,
          deviationEscalationMinutes: true,
        },
      });
      return org ?? null;
    },

    findOpenIncident: async (organizationId, subjectKey) => {
      const row = await db.temperatureDeviationIncident.findFirst({
        where: { organizationId, subjectKey, resolvedAt: null },
        orderBy: { createdAt: "desc" },
      });
      return row ? toIncident(row) : null;
    },

    createIncident: async (input) => {
      const row = await db.temperatureDeviationIncident.create({
        data: {
          organizationId: input.organizationId,
          subjectKey: input.subjectKey,
          subjectName: input.subjectName,
          equipmentId: input.equipmentId,
          documentId: input.documentId,
          responsibleUserId: input.responsibleUserId,
          firstValue: input.value,
          lastValue: input.value,
          tempMin: input.tempMin,
          tempMax: input.tempMax,
          notifiedAt: input.notifiedAt,
          lastSeenAt: input.now,
        },
      });
      emitWebhook(row.organizationId, "journal.deviation", async () => ({
        incidentId: row.id,
        subject: row.subjectName,
        value: row.lastValue,
        tempMin: row.tempMin,
        tempMax: row.tempMax,
        equipmentId: row.equipmentId,
        // Точка (2026-11-01): получатель раскладывает события по точкам.
        ...(await webhookPointFields(row.organizationId, {
          equipmentId: row.equipmentId,
          documentId: row.documentId,
        })),
      }));
      return toIncident(row);
    },

    touchIncident: async (incidentId, input) => {
      await db.temperatureDeviationIncident.update({
        where: { id: incidentId },
        data: { lastValue: input.lastValue, lastSeenAt: input.now },
      });
    },

    resolveIncident: async (incidentId, input) => {
      await db.temperatureDeviationIncident.update({
        where: { id: incidentId },
        data: {
          resolvedAt: input.now,
          resolvedReason: input.reason,
          lastValue: input.lastValue,
          lastSeenAt: input.now,
        },
      });
    },

    markEscalated: async (incidentId, now) => {
      await db.temperatureDeviationIncident.update({
        where: { id: incidentId },
        data: { escalatedAt: now },
      });
    },

    findResponsible: async ({ organizationId, documentId, equipmentId }) =>
      findColdEquipmentResponsible({ organizationId, documentId, equipmentId }),

    notifyResponsible: async (userId, text) => {
      await notifyEmployee(userId, text);
    },

    notifyManagement: async (organizationId, text, place) => {
      await notifyOrganization(
        organizationId,
        text,
        ["owner", "technologist"],
        "temperature",
        undefined,
        { buildingId: place ? await placeOfEvent(organizationId, place) : null }
      );
    },

    emailManagement: async (input) => {
      const managers = await db.user.findMany({
        where: {
          organizationId: input.organizationId,
          role: { in: getDbRoleValuesWithLegacy(MANAGEMENT_ROLES) },
          isActive: true,
        },
        select: { email: true, locale: true, buildingIds: true },
      });
      const users = await filterRecipientsByPlace(
        input.organizationId,
        managers,
        input.place ? await placeOfEvent(input.organizationId, input.place) : null
      );
      const organization = await db.organization.findUnique({ where: { id: input.organizationId }, select: { locale: true } });
      for (const user of users) {
        await sendTemperatureAlertEmail({
          to: user.email,
          equipmentName: input.subjectName,
          temperature: input.value,
          tempMin: input.tempMin,
          tempMax: input.tempMax,
          areaName: input.areaName ?? undefined,
          filledBy: input.source,
          organizationId: input.organizationId,
          locale: resolveLocale({ authenticated: true, userLocale: user.locale, organizationLocale: organization?.locale }),
        });
      }
    },
  };
}

/**
 * Ответственный за журнал холодильного оборудования.
 *
 * Порядок поиска: явный документ → активный документ, где этот
 * холодильник указан как источник → назначение из настроек
 * «Ответственные за журналы». Возвращаем только активного сотрудника —
 * писать уволенному бессмысленно.
 */
export async function findColdEquipmentResponsible(args: {
  organizationId: string;
  documentId: string | null;
  equipmentId: string | null;
}): Promise<ResponsiblePerson | null> {
  const { organizationId, documentId, equipmentId } = args;

  let userId: string | null = null;
  // Точка — документа, иначе цеха оборудования: ответственный её журнала.
  let pointId: string | null = null;

  if (documentId) {
    const doc = await db.journalDocument.findFirst({
      where: { id: documentId, organizationId },
      select: { responsibleUserId: true, buildingId: true },
    });
    userId = doc?.responsibleUserId ?? null;
    pointId = doc?.buildingId ?? null;
  }
  if (!pointId && equipmentId) {
    const equipment = await db.equipment.findFirst({
      where: { id: equipmentId, area: { organizationId } },
      select: { area: { select: { buildingId: true } } },
    });
    pointId = equipment?.area.buildingId ?? null;
  }

  if (!userId && equipmentId) {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const docs = await db.journalDocument.findMany({
      where: {
        organizationId,
        status: "active",
        template: { code: COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE },
        dateFrom: { lte: todayStart },
        dateTo: { gte: todayStart },
        responsibleUserId: { not: null },
      },
      select: { responsibleUserId: true, config: true },
    });
    for (const doc of docs) {
      const config = doc.config as
        | { equipment?: Array<{ sourceEquipmentId?: string | null }> }
        | null;
      const bound = config?.equipment?.some(
        (item) => item?.sourceEquipmentId === equipmentId
      );
      if (bound) {
        userId = doc.responsibleUserId;
        break;
      }
    }
  }

  if (!userId) {
    // Ответственные журнала холодильников точки (2026-10-31).
    const slots = await effectiveJournalSlots(organizationId, pointId, COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE);
    const primarySlot = getPrimarySlotId(COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE);
    userId = slots[primarySlot] ?? null;
  }

  if (!userId) return null;

  const user = await db.user.findFirst({
    where: { id: userId, organizationId, isActive: true },
    select: { id: true, name: true, telegramChatId: true },
  });
  return user ?? null;
}

/* ----------------------------------------------------------------------
 * Сеточный журнал холодильного оборудования
 * -------------------------------------------------------------------- */

/**
 * Разобрать сохранённую строку журнала «Контроль холодильного
 * оборудования» и прогнать каждый холодильник через обработчик.
 *
 * Основной путь ввода у большинства заведений — именно эта сетка, а не
 * датчики: температуру вписывает повар. Нормы берём из конфига
 * документа (у каждого холодильника свои min/max), корректирующий
 * комментарий — из `corrections[itemId]`.
 *
 * Тихая: любые ошибки логируются, запись в журнал не срывается.
 */
export async function processColdEquipmentEntryDeviations(args: {
  organizationId: string;
  documentId: string;
  documentConfig: unknown;
  entryData: unknown;
  source: string;
  now?: Date;
}): Promise<void> {
  try {
    const { normalizeColdEquipmentDocumentConfig, normalizeColdEquipmentEntryData } =
      await import("@/lib/cold-equipment-document");
    const config = normalizeColdEquipmentDocumentConfig(args.documentConfig);
    const data = normalizeColdEquipmentEntryData(args.entryData);

    for (const item of config.equipment) {
      const value = data.temperatures?.[item.id];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      await processTemperatureReading({
        organizationId: args.organizationId,
        subjectKey: subjectKeyForDocumentItem(args.documentId, item.id),
        subjectName: item.name,
        value,
        tempMin: item.min ?? null,
        tempMax: item.max ?? null,
        equipmentId: item.sourceEquipmentId ?? null,
        documentId: args.documentId,
        source: args.source,
        correctionNote: data.corrections?.[item.id] ?? null,
        now: args.now,
      });
    }
  } catch (err) {
    console.warn(
      "[temperature-deviations] cold-equipment entry scan failed:",
      err instanceof Error ? err.message : err
    );
  }
}
