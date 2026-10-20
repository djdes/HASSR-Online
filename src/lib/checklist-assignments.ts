/**
 * Назначение чек-листа («Чек-листы → Назначение», 2026-10-19): кому, как часто,
 * до скольки, кто проверяет. Здесь — только чистые функции: проверка формы,
 * период и его срок, статус периода, кто входит в «кому», кому и когда слать
 * напоминание. База, страницы и крон (`/api/cron/checklist-reminders`) зовут
 * их; тесты — `checklist-assignments.test.ts`.
 *
 * Модель периода — «день срока»: у ежедневного назначения период — каждый
 * день, у еженедельного — выбранный день недели, у ежемесячного — выбранное
 * число (в коротком месяце — последний день), у разового — выбранная дата.
 * В день периода до срока проверка «ожидает», после срока — «просрочена»,
 * в другие дни — «не в этот день». Разовое назначение после своей даты
 * остаётся просроченным, пока проверку не проведут.
 *
 * Время — по часовому поясу организации: всё считается на «местных часах»
 * (`LocalClock`: день `YYYY-MM-DD` и минуты от полуночи), поэтому функции не
 * зависят от часового пояса сервера. Без TasksFlow (П-12, П-13 не затронуты).
 */
import { z } from "zod";
import { summarizeChecklistResult } from "@/lib/checklist-results";

export const CHECKLIST_ASSIGNMENT_TARGETS = ["building", "position", "user"] as const;
export type ChecklistAssignmentTarget = (typeof CHECKLIST_ASSIGNMENT_TARGETS)[number];

export const CHECKLIST_ASSIGNMENT_FREQUENCIES = ["once", "daily", "weekly", "monthly"] as const;
export type ChecklistAssignmentFrequency = (typeof CHECKLIST_ASSIGNMENT_FREQUENCIES)[number];

/** Напоминание приходит в день срока, за столько минут до срока (не раньше полуночи). */
export const CHECKLIST_REMINDER_LEAD_MINUTES = 120;

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DEFAULT_TIME_ZONE = "Europe/Moscow";

/** Настоящий день календаря `YYYY-MM-DD` (не 2026-02-30). */
export function isDayKey(value: string): boolean {
  if (!DAY_KEY.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const idSchema = z.string().trim().min(1).max(100);

/** Поля формы «Назначить чек-лист» (POST и полная правка PATCH). */
export const checklistAssignmentInputSchema = z
  .object({
    templateId: idSchema,
    targetKind: z.enum(CHECKLIST_ASSIGNMENT_TARGETS),
    targetId: idSchema,
    frequency: z.enum(CHECKLIST_ASSIGNMENT_FREQUENCIES),
    onceDate: z.string().nullish(),
    weekday: z.number().int().min(1).max(7).nullish(),
    monthDay: z.number().int().min(1).max(31).nullish(),
    dueTime: z.string().regex(TIME, "Срок — время ЧЧ:ММ"),
    verifierUserId: idSchema.nullish(),
    remindTelegram: z.boolean().default(true),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.frequency === "once" && !(value.onceDate && isDayKey(value.onceDate))) {
      ctx.addIssue({ code: "custom", path: ["onceDate"], message: "Выберите дату проверки" });
    }
    if (value.frequency === "weekly" && !value.weekday) {
      ctx.addIssue({ code: "custom", path: ["weekday"], message: "Выберите день недели" });
    }
    if (value.frequency === "monthly" && !value.monthDay) {
      ctx.addIssue({ code: "custom", path: ["monthDay"], message: "Выберите число месяца" });
    }
  })
  .transform((value) => ({
    templateId: value.templateId,
    targetKind: value.targetKind,
    targetId: value.targetId,
    frequency: value.frequency,
    // Лишние для периодичности поля обнуляем: в базе — только то, что значит.
    onceDate: value.frequency === "once" ? (value.onceDate ?? null) : null,
    weekday: value.frequency === "weekly" ? (value.weekday ?? null) : null,
    monthDay: value.frequency === "monthly" ? (value.monthDay ?? null) : null,
    dueTime: value.dueTime,
    verifierUserId: value.verifierUserId ?? null,
    remindTelegram: value.remindTelegram,
  }));
export type ChecklistAssignmentInput = z.output<typeof checklistAssignmentInputSchema>;

/** PATCH: только «Пауза/Включить» — или полная правка формы (плюс `active`). */
export const checklistAssignmentToggleSchema = z.object({ active: z.boolean() }).strict();

export type ChecklistSchedule = {
  frequency: ChecklistAssignmentFrequency;
  onceDate: string | null;
  weekday: number | null;
  monthDay: number | null;
  dueTime: string;
};

/** «Местные часы» организации: день и минуты от полуночи. */
export type LocalClock = { dayKey: string; minutes: number };

/** Момент `now` на часах часового пояса `timeZone` (неверный пояс — Москва). */
export function localClock(now: Date, timeZone: string | null | undefined): LocalClock {
  const read = (zone: string) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
    return { dayKey: `${get("year")}-${get("month")}-${get("day")}`, minutes: (Number(get("hour")) % 24) * 60 + Number(get("minute")) };
  };
  try {
    return read(timeZone || DEFAULT_TIME_ZONE);
  } catch {
    return read(DEFAULT_TIME_ZONE);
  }
}

function dayParts(dayKey: string): [number, number, number] {
  const [y, m, d] = dayKey.split("-").map(Number);
  return [y, m, d];
}

/** День недели по ISO: 1 = пн … 7 = вс. */
export function isoWeekday(dayKey: string): number {
  const [y, m, d] = dayParts(dayKey);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

export function addDays(dayKey: string, days: number): string {
  const [y, m, d] = dayParts(dayKey);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function minutesOfTime(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** Есть ли у назначения период в этот день. */
export function isScheduledDay(schedule: ChecklistSchedule, dayKey: string): boolean {
  switch (schedule.frequency) {
    case "once":
      return schedule.onceDate === dayKey;
    case "daily":
      return true;
    case "weekly":
      return isoWeekday(dayKey) === schedule.weekday;
    case "monthly": {
      if (!schedule.monthDay) return false;
      const [y, m, d] = dayParts(dayKey);
      return d === Math.min(schedule.monthDay, daysInMonth(y, m));
    }
  }
}

export type ChecklistPeriod = {
  /** Ключ периода: `daily:2026-10-19` — по нему крон не повторяет напоминание. */
  key: string;
  /** День срока. */
  dayKey: string;
  /** Срок — минуты от полуночи дня срока. */
  dueMinutes: number;
};

function periodOf(schedule: ChecklistSchedule, dayKey: string): ChecklistPeriod {
  return { key: `${schedule.frequency}:${dayKey}`, dayKey, dueMinutes: minutesOfTime(schedule.dueTime) };
}

/**
 * Период «на сегодня». Разовое назначение после своей даты остаётся в своём
 * периоде (просрочено, пока не проведут); остальные — только в свой день.
 */
export function currentPeriod(schedule: ChecklistSchedule, today: string): ChecklistPeriod | null {
  if (schedule.frequency === "once") {
    return schedule.onceDate && schedule.onceDate <= today ? periodOf(schedule, schedule.onceDate) : null;
  }
  return isScheduledDay(schedule, today) ? periodOf(schedule, today) : null;
}

/** Ближайший день срока, начиная с `fromDay` (включительно); у разового — его дата, если ещё впереди. */
export function nextScheduledDay(schedule: ChecklistSchedule, fromDay: string): string | null {
  if (schedule.frequency === "once") return schedule.onceDate && schedule.onceDate >= fromDay ? schedule.onceDate : null;
  for (let offset = 0; offset < 62; offset++) {
    const day = addDays(fromDay, offset);
    if (isScheduledDay(schedule, day)) return day;
  }
  return null;
}

/**
 * Период начинается не раньше назначения: если назначили в день срока уже
 * после срока, первый период — следующий (иначе назначение «просрочено»
 * в ту же минуту, как его создали).
 */
function periodApplies(period: ChecklistPeriod, startedAt: LocalClock | null): boolean {
  if (!startedAt) return true;
  if (period.dayKey > startedAt.dayKey) return true;
  return period.dayKey === startedAt.dayKey && startedAt.minutes <= period.dueMinutes;
}

export type ChecklistPeriodStatus = "pending" | "done" | "overdue" | "off";

export type ChecklistPeriodState = {
  status: ChecklistPeriodStatus;
  period: ChecklistPeriod | null;
  /** Следующий день срока (для «не в этот день» — когда снова). */
  nextDayKey: string | null;
};

/**
 * Статус назначения сейчас. `completedDayKeys` — дни (по часам организации),
 * когда завершены проверки по этому назначению: у разового засчитывается
 * любая, у остальных — завершённая в день периода.
 */
export function periodState(
  schedule: ChecklistSchedule,
  clock: LocalClock,
  completedDayKeys: readonly string[],
  startedAt: LocalClock | null = null,
): ChecklistPeriodState {
  const candidate = currentPeriod(schedule, clock.dayKey);
  const period = candidate && periodApplies(candidate, startedAt) ? candidate : null;
  if (!period) {
    const from = candidate ? addDays(clock.dayKey, 1) : clock.dayKey;
    return { status: "off", period: null, nextDayKey: nextScheduledDay(schedule, from) };
  }
  const done =
    schedule.frequency === "once"
      ? completedDayKeys.some((day) => day >= period.dayKey)
      : completedDayKeys.includes(period.dayKey);
  if (done) return { status: "done", period, nextDayKey: nextScheduledDay(schedule, addDays(clock.dayKey, 1)) };
  const overdue = clock.dayKey > period.dayKey || clock.minutes > period.dueMinutes;
  return { status: overdue ? "overdue" : "pending", period, nextDayKey: nextScheduledDay(schedule, addDays(clock.dayKey, 1)) };
}

/** Сотрудник, которого можно назначить: активный, не уволен, не ROOT. */
export type RecipientCandidate = {
  id: string;
  isActive: boolean;
  archivedAt: Date | string | null;
  isRoot?: boolean | null;
  jobPositionId: string | null;
  buildingIds: readonly string[];
};

/**
 * Работает ли человек на точке: пустой `buildingIds` — на всех; id
 * удалённых точек не считаются (как `allowedBuildingsForUser`).
 */
export function worksAtBuilding(user: Pick<RecipientCandidate, "buildingIds">, buildingId: string, orgBuildingIds: readonly string[]): boolean {
  const own = user.buildingIds.filter((id) => orgBuildingIds.includes(id));
  return own.length === 0 || own.includes(buildingId);
}

/** Кто входит в «кому»: люди точки, должности или один человек — только активные. */
export function assignmentRecipients<T extends RecipientCandidate>(
  target: { kind: ChecklistAssignmentTarget; id: string },
  users: readonly T[],
  orgBuildingIds: readonly string[],
): T[] {
  return users.filter((user) => {
    if (!user.isActive || user.archivedAt || user.isRoot) return false;
    switch (target.kind) {
      case "building":
        return orgBuildingIds.includes(target.id) && worksAtBuilding(user, target.id, orgBuildingIds);
      case "position":
        return user.jobPositionId === target.id;
      case "user":
        return user.id === target.id;
    }
  });
}

export type ReminderAssignment = {
  active: boolean;
  remindTelegram: boolean;
  lastReminderPeriodKey: string | null;
  schedule: ChecklistSchedule;
  startedAt: LocalClock | null;
};

export type ReminderPlan = {
  periodKey: string;
  dueMinutes: number;
  overdue: boolean;
  send: { userId: string; chatId: string }[];
};

/**
 * Кому слать напоминание сейчас. Шлём один раз на период (по
 * `lastReminderPeriodKey`), только в день срока, начиная за
 * `CHECKLIST_REMINDER_LEAD_MINUTES` до срока; выполненным — не шлём;
 * получателям без Telegram — не шлём. `null` — сейчас никому.
 */
export function reminderPlan(input: {
  assignment: ReminderAssignment;
  clock: LocalClock;
  completedDayKeys: readonly string[];
  recipients: readonly { id: string; telegramChatId: string | null }[];
}): ReminderPlan | null {
  const { assignment, clock } = input;
  if (!assignment.active || !assignment.remindTelegram) return null;
  const state = periodState(assignment.schedule, clock, input.completedDayKeys, assignment.startedAt);
  if (!state.period || state.status === "done" || state.status === "off") return null;
  if (state.period.dayKey !== clock.dayKey) return null;
  if (assignment.lastReminderPeriodKey === state.period.key) return null;
  if (clock.minutes < Math.max(0, state.period.dueMinutes - CHECKLIST_REMINDER_LEAD_MINUTES)) return null;
  const send = input.recipients
    .filter((user) => user.telegramChatId && user.telegramChatId.trim())
    .map((user) => ({ userId: user.id, chatId: user.telegramChatId!.trim() }));
  return { periodKey: state.period.key, dueMinutes: state.period.dueMinutes, overdue: state.status === "overdue", send };
}

/** Во сколько придёт напоминание (минуты от полуночи дня срока). */
export function reminderMinutes(dueTime: string): number {
  return Math.max(0, minutesOfTime(dueTime) - CHECKLIST_REMINDER_LEAD_MINUTES);
}

export function formatMinutes(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * Разовое назначение нельзя поставить в прошлое: срок уже прошёл —
 * проверка сразу была бы просроченной.
 */
export function onceDueInPast(input: Pick<ChecklistAssignmentInput, "frequency" | "onceDate" | "dueTime">, clock: LocalClock): boolean {
  if (input.frequency !== "once" || !input.onceDate) return false;
  if (input.onceDate < clock.dayKey) return true;
  return input.onceDate === clock.dayKey && minutesOfTime(input.dueTime) < clock.minutes;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Текст напоминания в Telegram (HTML, как у соседних кронов — по-русски). */
export function checklistReminderMessage(input: { templateTitle: string; dueTime: string; overdue: boolean }): string {
  const title = escapeHtml(input.templateTitle);
  return [
    `📋 <b>Чек-лист: ${title}</b>`,
    input.overdue
      ? `Срок был сегодня до ${input.dueTime} — проверку ещё не провели.`
      : `Сегодня до ${input.dueTime} нужно провести проверку.`,
    "",
    "Нажмите «Открыть чек-лист», ответьте на вопросы и завершите проверку.",
  ].join("\n");
}

/** Текст проверяющему: проверку по назначению завершили. */
export function checklistReviewMessage(input: {
  templateTitle: string;
  completedByName: string;
  earned: number;
  possible: number;
  violations: number;
  stopped: boolean;
}): string {
  const percent = input.possible > 0 ? ` (${Math.round((input.earned / input.possible) * 100)}%)` : "";
  return [
    `✅ <b>Проверка завершена: ${escapeHtml(input.templateTitle)}</b>`,
    `Провёл(а): ${escapeHtml(input.completedByName || "—")}`,
    `Баллы: ${input.earned} из ${input.possible}${percent} · нарушений: ${input.violations}`,
    ...(input.stopped ? ["⚠️ Критическое нарушение — проверка остановлена досрочно."] : []),
    "",
    "Откройте результат и нажмите «Принять результат».",
  ].join("\n");
}

export type VerifierNotice =
  | { chatId: string; userId: string; organizationId: string; text: string; path: string }
  | { skip: "not-completed" | "no-verifier" | "self" | "no-telegram" };

/**
 * Кому и что написать, когда проверку по назначению завершили: проверяющему
 * с привязанным Telegram, если это не он сам провёл проверку. Ссылка — на
 * «Результаты» с подсветкой проверки.
 */
export function verifierNotice(input: {
  inspection: {
    id: string;
    organizationId: string;
    title: string;
    status: string;
    result: unknown;
    completedById: string | null;
    completedByName: string | null;
  };
  verifierUserId: string | null;
  verifier: { id: string; telegramChatId: string | null } | null;
}): VerifierNotice {
  const { inspection, verifierUserId, verifier } = input;
  if (inspection.status !== "completed") return { skip: "not-completed" };
  if (!verifierUserId) return { skip: "no-verifier" };
  if (verifierUserId === inspection.completedById) return { skip: "self" };
  const chatId = verifier?.id === verifierUserId ? verifier.telegramChatId?.trim() : null;
  if (!chatId) return { skip: "no-telegram" };
  const summary = summarizeChecklistResult(inspection.result) ?? { earned: 0, possible: 0, violations: 0, stopped: false };
  return {
    chatId,
    userId: verifierUserId,
    organizationId: inspection.organizationId,
    text: checklistReviewMessage({
      templateTitle: inspection.title,
      completedByName: inspection.completedByName ?? "",
      earned: summary.earned,
      possible: summary.possible,
      violations: summary.violations,
      stopped: summary.stopped,
    }),
    path: `/checklists/results?inspection=${inspection.id}`,
  };
}
