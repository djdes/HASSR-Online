import { advisoryLockKey, withAdvisoryTryLock } from "@/lib/advisory-lock";
import { deliverableEmail, notifyCoreJournalRecipients, type CoreJournalRecipient } from "@/lib/core-journal-keepers";
import { db } from "@/lib/db";
import { announceQrRollover } from "@/lib/journal-qr-rollover";
import { carryStructureFromPrevious } from "@/lib/journal-structure-carry";
import { getPrimarySlotId } from "@/lib/journal-responsible-schemas";
import { ORG_ROSTER_WHERE } from "@/lib/journal-roster";
import { orgTodayKey } from "@/lib/timezone";
import { formatDuration, formatHours, lampRemainingHours, lampWarnLevel, sessionHours, shouldSendLampWarning } from "@/lib/uv-lamp";
import {
  UV_LAMP_RUNTIME_PAGE_TITLE,
  UV_LAMP_RUNTIME_TEMPLATE_CODE,
  appendUvRuntimeSession,
  defaultUvSpecification,
  isUvRuntimeEntryDataEmpty,
  normalizeUvRuntimeDocumentConfig,
  normalizeUvRuntimeEntryData,
} from "@/lib/uv-lamp-runtime-document";

/**
 * УФ-лампа по QR (2026-09-22): «Я включил» → «Я выключил». Сеанс пишется
 * в журнал учёта работы этой лампы, наработка копится у самой лампы, при
 * 10 % остатка и при исчерпании — уведомление ответственному журнала.
 */

function hhmm(timeZone: string, at: Date): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(at).replace(/^24/, "00");
  } catch {
    return at.toISOString().slice(11, 16);
  }
}

/**
 * Документ журнала этой лампы на сегодня: связанный, найденный по номеру
 * или новый на месяц. Новый месяц — «по образцу прошлого»: номер, цех,
 * паспорт и ответственные из прошлого документа ЭТОЙ лампы. Создание — под
 * замком «лампа × месяц» с повторной проверкой: два одновременных
 * «Я выключил» 1-го числа не заведут два документа.
 */
export async function ensureUvDocumentForLamp(params: {
  organizationId: string;
  lamp: { id: string; name: string; areaName: string; lampLifetimeHours: number | null };
  todayKey: string;
}): Promise<{ id: string; responsibleUserId: string | null } | null> {
  const day = new Date(`${params.todayKey}T00:00:00.000Z`);
  const findLinked = async () => {
    const docs = await db.journalDocument.findMany({
      where: { organizationId: params.organizationId, status: "active", template: { code: UV_LAMP_RUNTIME_TEMPLATE_CODE }, dateFrom: { lte: day }, dateTo: { gte: day } },
      select: { id: true, config: true, responsibleUserId: true },
      orderBy: { dateFrom: "desc" },
    });
    return { docs, linked: docs.find((doc) => normalizeUvRuntimeDocumentConfig(doc.config).equipmentId === params.lamp.id) ?? null };
  };
  const { docs, linked } = await findLinked();
  if (linked) return { id: linked.id, responsibleUserId: linked.responsibleUserId };
  const byName = docs.find((doc) => {
    const config = normalizeUvRuntimeDocumentConfig(doc.config);
    return !config.equipmentId && config.lampNumber.trim().toLowerCase() === params.lamp.name.trim().toLowerCase();
  });
  if (byName) {
    const config = { ...((byName.config as Record<string, unknown> | null) ?? {}), equipmentId: params.lamp.id };
    await db.journalDocument.update({ where: { id: byName.id }, data: { config: config as never } });
    return { id: byName.id, responsibleUserId: byName.responsibleUserId };
  }
  const template = await db.journalTemplate.findFirst({ where: { code: UV_LAMP_RUNTIME_TEMPLATE_CODE }, select: { id: true, name: true } });
  if (!template) return null;

  const [year, month] = params.todayKey.split("-").map(Number);
  const locked = await withAdvisoryTryLock(
    advisoryLockKey("uv", params.organizationId, params.lamp.id, params.todayKey.slice(0, 7)),
    async () => {
      // Под замком — заново: документ мог создать соседний запрос.
      const again = (await findLinked()).linked;
      if (again) return { doc: { id: again.id, responsibleUserId: again.responsibleUserId }, rollover: false };

      const dateFrom = new Date(Date.UTC(year, month - 1, 1));
      const dateTo = new Date(Date.UTC(year, month, 0));
      const previous = await previousLampDocument(params.organizationId, template.id, params.lamp.id);
      const carried = previous
        ? carryStructureFromPrevious(UV_LAMP_RUNTIME_TEMPLATE_CODE, previous.config, {
            liveEquipmentIds: new Set([params.lamp.id]),
            periodFrom: dateFrom.toISOString().slice(0, 10),
          })
        : null;
      const carriedSpec = carried && typeof carried.spec === "object" && carried.spec ? (carried.spec as Record<string, unknown>) : {};
      // Ответственный — как у остальных документов журнала (слот «ответственных
      // за журналы»), иначе — из прошлого документа лампы, если человек ещё работает.
      const org = await db.organization.findUnique({ where: { id: params.organizationId }, select: { journalResponsibleUsersJson: true } });
      const slots = ((org?.journalResponsibleUsersJson ?? {}) as Record<string, Record<string, string | null> | undefined>)[UV_LAMP_RUNTIME_TEMPLATE_CODE] ?? {};
      const alive = await aliveUserIds(params.organizationId, [previous?.responsibleUserId, previous?.verifierUserId]);
      const previousResponsible = previous?.responsibleUserId && alive.has(previous.responsibleUserId) ? previous.responsibleUserId : null;
      const responsibleUserId = slots[getPrimarySlotId(UV_LAMP_RUNTIME_TEMPLATE_CODE)] ?? previousResponsible;
      const created = await db.journalDocument.create({
        data: {
          organizationId: params.organizationId,
          templateId: template.id,
          title: `${UV_LAMP_RUNTIME_PAGE_TITLE} · ${params.lamp.name}`,
          dateFrom,
          dateTo,
          status: "active",
          responsibleUserId,
          responsibleTitle: responsibleUserId && responsibleUserId === previousResponsible ? previous?.responsibleTitle ?? null : null,
          verifierUserId: previous?.verifierUserId && alive.has(previous.verifierUserId) ? previous.verifierUserId : null,
          config: {
            ...(carried ?? {}),
            lampNumber: typeof carried?.lampNumber === "string" && carried.lampNumber.trim() ? carried.lampNumber : params.lamp.name,
            areaName: typeof carried?.areaName === "string" && carried.areaName.trim() ? carried.areaName : params.lamp.areaName,
            spec: {
              ...defaultUvSpecification(),
              ...carriedSpec,
              ...(params.lamp.lampLifetimeHours ? { lampLifetimeHours: params.lamp.lampLifetimeHours } : {}),
            },
            equipmentId: params.lamp.id,
          } as never,
        },
        select: { id: true, responsibleUserId: true },
      });
      // Новый месяц по образцу прошлого — в аудит и колокольчик; первый документ лампы — молча, как раньше.
      return { doc: created, rollover: previous !== null };
    }
  );
  if (!locked.acquired) {
    // Замок дольше попыток держит соседний запрос — он и создаёт документ.
    const again = (await findLinked()).linked;
    return again ? { id: again.id, responsibleUserId: again.responsibleUserId } : null;
  }
  if (locked.value.rollover) {
    await announceQrRollover({
      organizationId: params.organizationId,
      templateCode: UV_LAMP_RUNTIME_TEMPLATE_CODE,
      journalName: template.name,
      documentId: locked.value.doc.id,
      source: "uv-lamp",
    }).catch(() => null);
  }
  return locked.value.doc;
}

/** Последний документ журнала УФ именно этой лампы (любого статуса). */
async function previousLampDocument(organizationId: string, templateId: string, lampId: string) {
  const docs = await db.journalDocument.findMany({
    where: { organizationId, templateId },
    select: { config: true, responsibleUserId: true, responsibleTitle: true, verifierUserId: true },
    orderBy: [{ dateFrom: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
  return docs.find((doc) => normalizeUvRuntimeDocumentConfig(doc.config).equipmentId === lampId) ?? null;
}

async function aliveUserIds(organizationId: string, ids: Array<string | null | undefined>): Promise<Set<string>> {
  const wanted = ids.filter((id): id is string => Boolean(id));
  if (wanted.length === 0) return new Set();
  const users = await db.user.findMany({
    where: { id: { in: wanted }, organizationId, isActive: true, archivedAt: null },
    select: { id: true },
  });
  return new Set(users.map((user) => user.id));
}

/** Кто отмечает лампу: закреплённые за ней, иначе ответственные журнала УФ-ламп, иначе все. */
export async function listLampOperators(params: { organizationId: string; fillerUserIds: string[]; documentResponsibleId: string | null }) {
  const roster = await db.user.findMany({
    where: { organizationId: params.organizationId, ...ORG_ROSTER_WHERE },
    select: { id: true, name: true, role: true, positionTitle: true, qrPinHash: true, canManageSettings: true, jobPosition: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
  const ids = new Set(params.fillerUserIds);
  if (ids.size === 0) {
    if (params.documentResponsibleId) ids.add(params.documentResponsibleId);
    const org = await db.organization.findUnique({ where: { id: params.organizationId }, select: { journalResponsibleUsersJson: true } });
    const slots = ((org?.journalResponsibleUsersJson ?? {}) as Record<string, Record<string, string | null> | undefined>)[UV_LAMP_RUNTIME_TEMPLATE_CODE] ?? {};
    for (const value of Object.values(slots)) if (value) ids.add(value);
  }
  const list = ids.size > 0 ? roster.filter((user) => ids.has(user.id)) : roster;
  return list.length > 0 ? list : roster;
}

export type LampState = {
  running: { since: string; byName: string | null } | null;
  lifetimeHours: number | null;
  usedHours: number;
  remainingHours: number | null;
};

export async function lampState(equipmentId: string, timeZone: string): Promise<LampState | null> {
  const lamp = await db.equipment.findUnique({
    where: { id: equipmentId },
    select: { runningSince: true, runningUserId: true, lampLifetimeHours: true, lampUsedHours: true },
  });
  if (!lamp) return null;
  const by = lamp.runningUserId ? await db.user.findUnique({ where: { id: lamp.runningUserId }, select: { name: true } }) : null;
  return {
    running: lamp.runningSince ? { since: hhmm(timeZone, lamp.runningSince), byName: by?.name ?? null } : null,
    lifetimeHours: lamp.lampLifetimeHours,
    usedHours: lamp.lampUsedHours,
    remainingHours: lampRemainingHours(lamp.lampLifetimeHours, lamp.lampUsedHours),
  };
}

export type LampToggleResult =
  | { ok: true; action: "on"; since: string }
  | { ok: true; action: "off"; hours: number; durationLabel: string; remainingHours: number | null; warn: "warn" | "over" | null }
  | { ok: false; status: number; error: string };

export async function toggleLamp(params: {
  organizationId: string;
  timeZone: string;
  lamp: { id: string; name: string; areaName: string };
  employee: { id: string; name: string };
  action: "on" | "off";
}): Promise<LampToggleResult> {
  const now = new Date();
  const current = await db.equipment.findUnique({
    where: { id: params.lamp.id },
    select: { runningSince: true, runningUserId: true, lampLifetimeHours: true, lampUsedHours: true, lampWarnLevel: true },
  });
  if (!current) return { ok: false, status: 404, error: "Лампа не найдена" };

  if (params.action === "on") {
    if (current.runningSince) {
      return { ok: false, status: 409, error: `Лампа уже включена с ${hhmm(params.timeZone, current.runningSince)} — сначала нажмите «Я выключил».` };
    }
    // Условный апдейт: два одновременных «включил» не создадут два сеанса.
    const updated = await db.equipment.updateMany({
      where: { id: params.lamp.id, runningSince: null },
      data: { runningSince: now, runningUserId: params.employee.id },
    });
    if (updated.count === 0) return { ok: false, status: 409, error: "Лампу только что включили — обновите страницу." };
    await db.equipmentRunSession.create({
      data: { equipmentId: params.lamp.id, organizationId: params.organizationId, startedAt: now, startedById: params.employee.id },
    });
    return { ok: true, action: "on", since: hhmm(params.timeZone, now) };
  }

  if (!current.runningSince) return { ok: false, status: 409, error: "Лампа не включена — сначала нажмите «Я включил»." };
  const startedAt = current.runningSince;
  const startedById = current.runningUserId ?? params.employee.id;
  const cleared = await db.equipment.updateMany({
    where: { id: params.lamp.id, runningSince: startedAt },
    data: { runningSince: null, runningUserId: null },
  });
  if (cleared.count === 0) return { ok: false, status: 409, error: "Лампу только что выключили — обновите страницу." };
  const hours = sessionHours(startedAt, now);
  const usedHours = Math.round((current.lampUsedHours + hours) * 100) / 100;
  const level = lampWarnLevel(current.lampLifetimeHours, usedHours);
  const sendWarning = shouldSendLampWarning(level, current.lampWarnLevel);
  await db.equipment.update({
    where: { id: params.lamp.id },
    data: { lampUsedHours: usedHours, ...(sendWarning ? { lampWarnLevel: level } : {}) },
  });

  // Сеанс — в журнал учёта работы этой лампы, на день включения.
  const dayKey = orgTodayKey(params.timeZone, startedAt);
  const doc = await ensureUvDocumentForLamp({
    organizationId: params.organizationId,
    lamp: { id: params.lamp.id, name: params.lamp.name, areaName: params.lamp.areaName, lampLifetimeHours: current.lampLifetimeHours },
    todayKey: dayKey,
  });
  const session = await db.equipmentRunSession.findFirst({ where: { equipmentId: params.lamp.id, endedAt: null }, orderBy: { startedAt: "desc" } });
  if (session) {
    await db.equipmentRunSession.update({
      where: { id: session.id },
      data: { endedAt: now, endedById: params.employee.id, hours, documentId: doc?.id ?? null },
    });
  }
  if (doc) {
    const date = new Date(`${dayKey}T00:00:00.000Z`);
    const existing = await db.journalDocumentEntry.findUnique({
      where: { documentId_employeeId_date: { documentId: doc.id, employeeId: startedById, date } },
      select: { data: true },
    });
    const base = normalizeUvRuntimeEntryData(existing?.data ?? null);
    const sessionTimes = { startTime: hhmm(params.timeZone, startedAt), endTime: hhmm(params.timeZone, now) };
    // Первый сеанс дня — в основные поля записи, следующие — в дополнительные.
    const next = isUvRuntimeEntryDataEmpty(base) ? sessionTimes : appendUvRuntimeSession(base, sessionTimes);
    const data = { ...next, source: "qr" };
    await db.journalDocumentEntry.upsert({
      where: { documentId_employeeId_date: { documentId: doc.id, employeeId: startedById, date } },
      create: { documentId: doc.id, employeeId: startedById, date, data: data as never },
      update: { data: data as never },
    });
  }

  if (sendWarning && level) {
    const remaining = lampRemainingHours(current.lampLifetimeHours, usedHours);
    const recipients = await lampRecipients(params.organizationId, doc?.responsibleUserId ?? null);
    const title =
      level === "over"
        ? `${params.lamp.name}: ресурс лампы исчерпан — замените лампу`
        : `${params.lamp.name}: ресурс лампы почти исчерпан — пора заказать`;
    const detail = `Наработка ${formatHours(usedHours)} из ${formatHours(current.lampLifetimeHours ?? 0)}${remaining !== null ? `, осталось ${formatHours(remaining)}` : ""}.`;
    await notifyCoreJournalRecipients({
      organizationId: params.organizationId,
      recipients,
      kind: "uv-lamp-resource",
      dedupeKey: `uv-lamp:${params.lamp.id}:${level}`,
      title,
      items: [{ id: params.lamp.id, label: params.lamp.name, hint: detail }],
      linkHref: "/settings/equipment",
      linkLabel: "Открыть оборудование",
      telegramText: `💡 ${title}\n${detail}\nПосле замены: «Оборудование» → лампа → «Заменили лампу».`,
      emailSubject: title,
      emailBodyHtml: `<p>${escapeHtml(title)}.</p><p>${escapeHtml(detail)}</p><p>После замены лампы откройте «Настройки → Оборудование» → лампа → «Заменили лампу — начать отсчёт заново».</p>`,
    }).catch(() => null);
  }

  return {
    ok: true,
    action: "off",
    hours,
    durationLabel: formatDuration(hours),
    remainingHours: lampRemainingHours(current.lampLifetimeHours, usedHours),
    warn: level,
  };
}

/** Ответственный журнала УФ-ламп (документ → слот журнала), иначе руководство. */
async function lampRecipients(organizationId: string, documentResponsibleId: string | null): Promise<CoreJournalRecipient[]> {
  let userId = documentResponsibleId;
  if (!userId) {
    const org = await db.organization.findUnique({ where: { id: organizationId }, select: { journalResponsibleUsersJson: true } });
    const slots = ((org?.journalResponsibleUsersJson ?? {}) as Record<string, Record<string, string | null> | undefined>)[UV_LAMP_RUNTIME_TEMPLATE_CODE] ?? {};
    userId = slots[getPrimarySlotId(UV_LAMP_RUNTIME_TEMPLATE_CODE)] ?? null;
  }
  if (userId) {
    const user = await db.user.findFirst({ where: { id: userId, organizationId, isActive: true }, select: { id: true, name: true, email: true, contactEmail: true } });
    if (user) return [{ id: user.id, name: user.name, email: deliverableEmail(user) }];
  }
  const managers = await db.user.findMany({
    where: { organizationId, isActive: true, archivedAt: null, isRoot: false, role: { in: ["manager", "head_chef", "owner", "technologist"] } },
    select: { id: true, name: true, email: true, contactEmail: true },
  });
  return managers.map((user) => ({ id: user.id, name: user.name, email: deliverableEmail(user) }));
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
