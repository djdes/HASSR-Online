import type { CalendarEvent } from "@/lib/calendar/ics";
import { calculateNextCalibrationDate, normalizeEquipmentCalibrationConfig } from "@/lib/equipment-calibration-document";
import { normalizeMedBookEntryData } from "@/lib/med-book-document";

/**
 * Откуда берутся события календаря — чистые функции над уже прочитанными
 * строками. Окно: месяц назад (просроченное видно) и год вперёд.
 */
export type CalendarWindow = { from: string; to: string };

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function calendarWindow(now: Date, options: { pastDays?: number; futureDays?: number } = {}): CalendarWindow {
  const past = options.pastDays ?? 30;
  const future = options.futureDays ?? 365;
  const from = new Date(now.getTime() - past * 86_400_000);
  const to = new Date(now.getTime() + future * 86_400_000);
  return { from: isoDay(from), to: isoDay(to) };
}

export function inWindow(date: string, window: CalendarWindow): boolean {
  return date >= window.from && date <= window.to;
}

function dayOf(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
  return Number.isNaN(value.getTime()) ? null : isoDay(value);
}

export function subscriptionEvents(
  org: { name: string; subscriptionEnd: Date | null },
  window: CalendarWindow
): CalendarEvent[] {
  const date = dayOf(org.subscriptionEnd);
  if (!date || !inWindow(date, window)) return [];
  return [
    {
      uid: "subscription",
      kind: "subscription",
      date,
      title: "Окончание подписки WeSetup",
      description: `Подписка организации «${org.name}» заканчивается в этот день. Продлить: wesetup.ru/settings/subscription`,
    },
  ];
}

export function competencyEvents(
  rows: Array<{ id: string; skill: string; expiresAt: Date | null; userName: string | null }>,
  window: CalendarWindow
): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const row of rows) {
    const date = dayOf(row.expiresAt);
    if (!date || !inWindow(date, window)) continue;
    out.push({
      uid: `competency-${row.id}`,
      kind: "competency",
      date,
      title: `Истекает допуск: ${row.skill}${row.userName ? ` — ${row.userName}` : ""}`,
      description: "Обучение или допуск сотрудника нужно продлить. Раздел «Компетенции».",
    });
  }
  return out;
}

const CAPA_DONE = new Set(["closed", "resolved", "done", "cancelled", "verified"]);

export function capaEvents(
  rows: Array<{ id: string; title: string; dueDate: Date | null; status: string; priority: string }>,
  window: CalendarWindow
): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const row of rows) {
    if (CAPA_DONE.has(row.status)) continue;
    const date = dayOf(row.dueDate);
    if (!date || !inWindow(date, window)) continue;
    out.push({
      uid: `capa-${row.id}`,
      kind: "capa",
      date,
      title: `Срок CAPA: ${row.title}`,
      description: `Приоритет: ${row.priority}. Раздел «Корректирующие действия».`,
    });
  }
  return out;
}

const BATCH_DONE = new Set(["used", "written_off", "disposed", "closed", "consumed"]);

export function batchEvents(
  rows: Array<{ id: string; code: string; productName: string; expiryDate: Date | null; status: string }>,
  window: CalendarWindow
): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const row of rows) {
    if (BATCH_DONE.has(row.status)) continue;
    const date = dayOf(row.expiryDate);
    if (!date || !inWindow(date, window)) continue;
    out.push({
      uid: `batch-${row.id}`,
      kind: "batch",
      date,
      title: `Срок годности: ${row.productName} (${row.code})`,
      description: "Партия из журнала прослеживаемости. Списать или использовать до этого дня.",
    });
  }
  return out;
}

export function medBookEvents(
  entries: Array<{ id: string; employeeName: string; data: unknown }>,
  window: CalendarWindow
): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const entry of entries) {
    const data = normalizeMedBookEntryData(entry.data);
    for (const [exam, item] of Object.entries(data.examinations)) {
      const date = dayOf(item.expiryDate);
      if (!date || !inWindow(date, window)) continue;
      out.push({
        uid: `medbook-${entry.id}-${slug(exam)}`,
        kind: "medbook",
        date,
        title: `Медкнижка: ${entry.employeeName} — ${exam}`,
        description: "Срок медосмотра по журналу медицинских книжек. Записать сотрудника заранее.",
      });
    }
    for (const [vaccination, item] of Object.entries(data.vaccinations)) {
      if (item.type !== "done") continue;
      const date = dayOf(item.expiryDate ?? null);
      if (!date || !inWindow(date, window)) continue;
      out.push({
        uid: `medbook-${entry.id}-vac-${slug(vaccination)}`,
        kind: "medbook",
        date,
        title: `Прививка: ${entry.employeeName} — ${vaccination}`,
        description: "Срок действия прививки по журналу медицинских книжек.",
      });
    }
  }
  return out;
}

export function calibrationEvents(
  documents: Array<{ id: string; config: unknown }>,
  window: CalendarWindow
): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const doc of documents) {
    const config = normalizeEquipmentCalibrationConfig(doc.config);
    for (const row of config.rows) {
      const date = calculateNextCalibrationDate(row.lastCalibrationDate, row.calibrationInterval);
      if (!date || !inWindow(date, window)) continue;
      const name = row.equipmentName || "оборудование";
      out.push({
        uid: `calibration-${doc.id}-${row.id}`,
        kind: "calibration",
        date,
        title: `Поверка: ${name}${
          isHumanEquipmentNumber(row.equipmentNumber, row.sourceEquipmentId)
            ? ` (${row.equipmentNumber})`
            : ""
        }`,
        description: [row.location && `Где: ${row.location}`, row.purpose && `Назначение: ${row.purpose}`, `Интервал: ${row.calibrationInterval} мес.`]
          .filter(Boolean)
          .join("\n"),
      });
    }
  }
  return out;
}

/**
 * Показывать ли номер прибора в названии события.
 *
 * Когда у оборудования нет серийного номера, журнал поверки подставляет
 * хвост его id («UIYLZRUD», см. equipment-calibration-document.ts). Для
 * человека это набор букв — в календаре показываем только имя. Настоящие
 * номера почти всегда содержат цифры или разделители («СИ-01», «T-1»).
 */
export function isHumanEquipmentNumber(
  value: string | null | undefined,
  sourceEquipmentId?: string | null
): boolean {
  const number = (value ?? "").trim();
  if (!number) return false;
  if (sourceEquipmentId && sourceEquipmentId.slice(-8).toUpperCase() === number) {
    return false;
  }
  return !/^[A-Z]{5,10}$/.test(number);
}

function slug(value: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, "-").replace(/^-+|-+$/g, "");
  return cleaned || "x";
}
