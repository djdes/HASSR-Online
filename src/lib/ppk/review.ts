/**
 * Версии документов и заседания группы ХАССП: чистые расчёты дат и номеров.
 * Им пользуются страницы, протокол и напоминания.
 */
import type { DocVersion, TeamMeeting } from "./records";

/** Дата YYYY-MM-DD плюс `months` месяцев; день обрезается до конца месяца (31.11 → 28.02). */
export function addMonths(ymd: string, months: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Версии одного документа: новые сверху. */
export function sortedVersions<T extends DocVersion>(versions: T[], doc: DocVersion["doc"]): T[] {
  return versions.filter((item) => item.doc === doc).sort((a, b) => b.version - a.version);
}

/** Последняя (с наибольшим номером) версия документа или null. */
export function latestDocVersion<T extends DocVersion>(versions: T[], doc: DocVersion["doc"]): T | null {
  return sortedVersions(versions, doc)[0] ?? null;
}

/** Срок очередного заседания: дата последнего + 3 месяца (по положению — не реже раза в квартал). */
export function nextMeetingDate(meetings: Pick<TeamMeeting, "date">[]): string | null {
  const last = meetings.map((item) => item.date).sort().at(-1);
  return last ? addMonths(last, 3) : null;
}

/** Порядковый номер заседания по дате (при равных датах — в порядке списка), с 1. */
export function meetingNumber(meetings: TeamMeeting[], meeting: TeamMeeting): number {
  const ordered = meetings
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.date.localeCompare(b.item.date) || a.index - b.index);
  return ordered.findIndex((entry) => entry.item === meeting) + 1;
}

/** «Иванова Анна Петровна» → «Иванова А.»; одно слово остаётся как есть. */
export function shortName(name: string): string {
  const [surname, first] = name.trim().split(/\s+/);
  if (!surname) return "";
  return first ? `${surname} ${first.slice(0, 1).toUpperCase()}.` : surname;
}

/** Что печатать на листе документа: последняя версия и утвердивший (если сотрудник ещё в кабинете). */
export function approvalOf(
  versions: DocVersion[],
  doc: DocVersion["doc"],
  staff: { id: string; name: string; title: string }[],
): { version: number; approvedAt: string; approver: { name: string; title: string } | null } | null {
  const latest = latestDocVersion(versions, doc);
  if (!latest) return null;
  const person = latest.approvedById ? staff.find((item) => item.id === latest.approvedById) : undefined;
  return {
    version: latest.version,
    approvedAt: latest.approvedAt,
    approver: person ? { name: person.name, title: person.title } : null,
  };
}
