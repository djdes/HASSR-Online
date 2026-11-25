import { isManagementRole } from "@/lib/user-roles";
import { pastDayOpen, type PastDaysPolicy } from "@/lib/journal-entry-scope";

/**
 * «Закрытый день» (Compliance feature 3.10.4):
 *   - после момента "сегодняшнее начало" (с учётом `shiftEndHour`)
 *     записи прошедших дней становятся read-only для рядовых
 *     сотрудников;
 *   - management (manager/head_chef/owner/technologist) и ROOT всегда
 *     может, но каждое такое действие должно писаться в AuditLog с
 *     указанием причины — это требование ХАССП-аудита.
 *
 * Здесь — pure-функции без зависимостей от БД и сессии. Wire-up
 * делается в API-роутах (см. /api/journal-documents/[id]/entries).
 */

/**
 * Возвращает дату "начала сегодняшнего дня" с учётом `shiftEndHour`.
 * Если shiftEndHour=0 — это полночь UTC. Если 6 — это 06:00 UTC.
 *
 * Идея: "сегодня" — это окно `[startOfToday, startOfToday+24h)`.
 * Когда now < startOfToday — мы ещё в "прошлой смене", и "сегодня"
 * начинается завтра. Здесь это покрывается тем, что startOfToday для
 * "прошлой смены" уже на сутки назад.
 */
export function getStartOfToday(refDate: Date, shiftEndHour: number): Date {
  const utcNow = refDate.getTime();
  const baseDay = new Date(refDate);
  baseDay.setUTCHours(shiftEndHour, 0, 0, 0);
  // Если now ещё не дошло до shiftEndHour — "сегодня" началось вчера.
  if (baseDay.getTime() > utcNow) {
    baseDay.setUTCDate(baseDay.getUTCDate() - 1);
  }
  return baseDay;
}

/**
 * Заперт ли указанный entryDate для редактирования "не-управлением"?
 *
 * @param entryDate Дата записи (из JournalDocumentEntry.date — это
 *   полночь UTC). Сравниваем по дню, не по точному времени.
 * @param org Часть Organization с полями lockPastDayEdits и shiftEndHour.
 * @param refDate "Сейчас" — для тестов.
 */
export function isPastDayLocked(
  entryDate: Date,
  org: { lockPastDayEdits: boolean; shiftEndHour: number },
  refDate: Date = new Date()
): boolean {
  if (!org.lockPastDayEdits) return false;
  const startOfToday = getStartOfToday(refDate, org.shiftEndHour);
  // Запись по дате "сегодня и позже" — редактируется свободно.
  // Запись по дате "вчера и раньше" — заперта.
  return entryDate.getTime() < startOfToday.getTime();
}

export type ClosedDayActor = {
  role: string;
  isRoot: boolean;
};

/**
 * Может ли актор редактировать запись с указанной датой при текущих
 * настройках org? Management всегда может (но это не значит «без
 * аудита» — caller должен залогировать override).
 */
export function canEditEntryAt(
  entryDate: Date,
  actor: ClosedDayActor,
  org: { lockPastDayEdits: boolean; shiftEndHour: number },
  refDate: Date = new Date()
): { allowed: boolean; reason: "ok" | "past_day_locked"; isOverride: boolean } {
  const isLocked = isPastDayLocked(entryDate, org, refDate);
  if (!isLocked) {
    return { allowed: true, reason: "ok", isOverride: false };
  }
  if (actor.isRoot || isManagementRole(actor.role)) {
    return { allowed: true, reason: "past_day_locked", isOverride: true };
  }
  return { allowed: false, reason: "past_day_locked", isOverride: false };
}

/**
 * ЖЁСТКОЕ правило «изменения день в день» для документов, которые
 * ведёт автоматика (`JournalDocument.autoFill = true` + журнал включён
 * в `Organization.journalAutomationJson`).
 *
 * Почему отдельно от `lockPastDayEdits`. Тот тумблер — опциональное
 * правило организации и всегда пускает management. Здесь наоборот: раз
 * сайт сам проставил всем «Здоров, t < 37» в 06:00, то дописать вчера
 * «был с температурой» — это подделка задним числом, и запрет должен
 * действовать на ВСЕ роли. Единственное исключение — ROOT (поддержка
 * платформы), и каждое такое редактирование пишется в AuditLog.
 */
export type AutomationLockContext = {
  /** Документ создан/ведётся автоматикой. */
  documentAutoFill: boolean;
  /** Журнал включён в автоматизацию у организации. */
  automationEnabled: boolean;
  /** Граница смены организации (см. getStartOfToday). */
  shiftEndHour: number;
  /**
   * «Правка прошлых дней» спецрежима (2026-11-25): дни в её окне не
   * заперты и в автодокументе. Нет — запрет как раньше.
   */
  pastDays?: PastDaysPolicy | null;
  /** Сегодня в поясе организации (`YYYY-MM-DD`) — от него считается окно. */
  todayKey?: string;
};

/** Дата записи как Date — принимаем и `YYYY-MM-DD`, и Date. */
function toEntryDate(value: Date | string): Date {
  return typeof value === "string"
    ? new Date(`${value.slice(0, 10)}T00:00:00.000Z`)
    : value;
}

/**
 * Заперта ли ячейка автодокумента. `true` только для дат СТРОГО раньше
 * сегодняшнего дня — сегодня и будущее редактируются свободно.
 */
export function isCellLocked(
  entryDate: Date | string,
  ctx: AutomationLockContext,
  refDate: Date = new Date()
): boolean {
  if (!ctx.documentAutoFill || !ctx.automationEnabled) return false;
  // Сравниваем ДНИ, а не моменты: дата записи хранится как полночь UTC,
  // а `getStartOfToday` при `shiftEndHour=6` возвращает 06:00 — иначе
  // сегодняшняя (по смене) ячейка выглядела бы «вчерашней» до 06:00.
  const startOfToday = getStartOfToday(refDate, ctx.shiftEndHour);
  const todayDay = Date.UTC(
    startOfToday.getUTCFullYear(),
    startOfToday.getUTCMonth(),
    startOfToday.getUTCDate()
  );
  const entry = toEntryDate(entryDate);
  if (entry.getTime() >= todayDay) return false;
  // Спецрежим «Правка прошлых дней»: день в окне открыт и в автодокументе.
  const todayKey = ctx.todayKey || new Date(todayDay).toISOString().slice(0, 10);
  return !pastDayOpen(ctx.pastDays, entry.toISOString().slice(0, 10), todayKey);
}

/**
 * Решение по конкретному актору. Management НЕ является исключением —
 * см. комментарий выше; проходит только ROOT, и это override с аудитом.
 */
export function canEditAutomationCell(
  entryDate: Date | string,
  actor: ClosedDayActor,
  ctx: AutomationLockContext,
  refDate: Date = new Date()
): { allowed: boolean; reason: "ok" | "past_day_locked"; isOverride: boolean } {
  if (!isCellLocked(entryDate, ctx, refDate)) {
    return { allowed: true, reason: "ok", isOverride: false };
  }
  if (actor.isRoot) {
    return { allowed: true, reason: "past_day_locked", isOverride: true };
  }
  return { allowed: false, reason: "past_day_locked", isOverride: false };
}

/** Единый текст ошибки/подсказки — один и тот же на сервере и в UI. */
export const PAST_DAY_LOCKED_MESSAGE =
  "Прошлые дни закрыты — изменения вносятся день в день";
