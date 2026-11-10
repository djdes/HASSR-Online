/** Подача данных CRM на экране: время, стадии, каналы. Чистый модуль. */

import { CRM_STAGE_LABELS, crmChannelLabel, type CrmStage } from "@/lib/crm/constants";

const TIME_ZONE = "Europe/Moscow";

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TIME_ZONE }).format(new Date(iso));
}

/** «5 мин», «3 ч», «2 дн» — сколько прошло. */
export function formatAgo(iso: string | null | undefined, now: Date): string {
  if (!iso) return "—";
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "<1 мин";
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} ч`;
  return `${Math.round(hours / 24)} дн`;
}

/** Срок следующего шага: «сегодня 15:00», «просрочен 2 дн», «12 нояб., 10:00». */
export function formatDue(iso: string | null | undefined, now: Date): { label: string; tone: "overdue" | "today" | "later" } | null {
  if (!iso) return null;
  const at = new Date(iso);
  const key = (date: Date) => new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "numeric", year: "numeric", timeZone: TIME_ZONE }).format(date);
  const time = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: TIME_ZONE }).format(at);
  if (at.getTime() <= now.getTime()) return { label: `просрочен ${formatAgo(iso, now)}`, tone: "overdue" };
  if (key(at) === key(now)) return { label: `сегодня ${time}`, tone: "today" };
  return { label: formatDateTime(iso), tone: "later" };
}

export function stageLabel(stage: string): string {
  return CRM_STAGE_LABELS[stage as CrmStage] ?? stage;
}

export const STAGE_TONE: Record<string, string> = {
  new: "bg-[#eef1ff] text-[#3848c7]",
  in_work: "bg-[#fff8eb] text-[#7a4a00]",
  won: "bg-[#ecfdf5] text-[#116b2a]",
  lost: "bg-[#f5f6ff] text-[#6f7282]",
  spam: "bg-[#f5f6ff] text-[#9b9fb3]",
};

export const DIRECTION_LABEL: Record<string, string> = {
  in: "Клиент",
  out: "Мы",
  note: "Заметка",
  event: "Событие",
};

export function channelLabel(channel: string): string {
  return crmChannelLabel(channel);
}

/**
 * «Канал · тема» без повтора: «Регистрация · Регистрация» и «Показ за 15 минут ·
 * Показ WeSetup за 15 минут» читаются как одно и то же — тогда только тема.
 */
export function itemHeadline(channel: string, subject: string | null | undefined): string {
  const label = channelLabel(channel);
  const topic = subject?.trim();
  if (!topic) return label;
  const word = (value: string) => value.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, " ").trim().split(" ")[0] ?? "";
  // «Звонок · Исходящий звонок» — тоже повтор: тема уже называет канал.
  return word(topic) === word(label) || topic.toLowerCase().includes(label.toLowerCase()) ? topic : `${label} · ${topic}`;
}

export function displayName(contact: { name: string | null; company: string | null; email: string | null; phone: string | null }): string {
  return contact.name?.trim() || contact.email || contact.phone || contact.company || "Без имени";
}

/** Значение для <input type="datetime-local"> по Москве. */
export function toMoscowInput(iso: string | null): string {
  if (!iso) return "";
  const shifted = new Date(new Date(iso).getTime() + 3 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 16);
}

/** «2026-11-08T10:00» (Москва) → ISO с часовым поясом. */
export function fromMoscowInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  return new Date(`${value}:00+03:00`).toISOString();
}
