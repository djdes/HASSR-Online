import test from "node:test";
import assert from "node:assert/strict";

import {
  CHECKLIST_REMINDER_LEAD_MINUTES,
  assignmentRecipients,
  checklistAssignmentInputSchema,
  checklistReminderMessage,
  checklistReviewMessage,
  currentPeriod,
  isDayKey,
  isoWeekday,
  localClock,
  nextScheduledDay,
  onceDueInPast,
  periodState,
  reminderMinutes,
  reminderPlan,
  type ChecklistSchedule,
  type RecipientCandidate,
} from "./checklist-assignments";

const daily: ChecklistSchedule = { frequency: "daily", onceDate: null, weekday: null, monthDay: null, dueTime: "12:00" };
const weeklyMonday: ChecklistSchedule = { ...daily, frequency: "weekly", weekday: 1, dueTime: "18:00" };
const monthly31: ChecklistSchedule = { ...daily, frequency: "monthly", monthDay: 31 };
const once: ChecklistSchedule = { ...daily, frequency: "once", onceDate: "2026-10-21", dueTime: "15:30" };
const at = (dayKey: string, time: string) => {
  const [h, m] = time.split(":").map(Number);
  return { dayKey, minutes: h * 60 + m };
};

test("форма: обязательные поля периодичности, лишние обнуляются", () => {
  const ok = checklistAssignmentInputSchema.parse({
    templateId: "t1",
    targetKind: "position",
    targetId: "p1",
    frequency: "weekly",
    weekday: 3,
    monthDay: 15,
    onceDate: "2026-10-30",
    dueTime: "09:30",
  });
  assert.equal(ok.weekday, 3);
  assert.equal(ok.monthDay, null);
  assert.equal(ok.onceDate, null);
  assert.equal(ok.verifierUserId, null);
  assert.equal(ok.remindTelegram, true);
  const base = { templateId: "t1", targetKind: "user", targetId: "u1", dueTime: "10:00" };
  assert.equal(checklistAssignmentInputSchema.safeParse({ ...base, frequency: "weekly" }).success, false);
  assert.equal(checklistAssignmentInputSchema.safeParse({ ...base, frequency: "monthly" }).success, false);
  assert.equal(checklistAssignmentInputSchema.safeParse({ ...base, frequency: "once", onceDate: "2026-02-30" }).success, false);
  assert.equal(checklistAssignmentInputSchema.safeParse({ ...base, frequency: "once", onceDate: "2026-02-28" }).success, true);
  assert.equal(checklistAssignmentInputSchema.safeParse({ ...base, frequency: "daily", dueTime: "24:00" }).success, false);
  assert.equal(checklistAssignmentInputSchema.safeParse({ ...base, frequency: "daily", targetKind: "team" }).success, false);
  assert.equal(checklistAssignmentInputSchema.safeParse({ ...base, frequency: "daily", extra: 1 }).success, false);
  assert.equal(checklistAssignmentInputSchema.safeParse({ ...base, frequency: "daily", verifierUserId: null }).success, true);
});

test("день календаря и день недели", () => {
  assert.ok(isDayKey("2024-02-29"));
  assert.ok(!isDayKey("2026-02-29"));
  assert.ok(!isDayKey("2026-1-01"));
  assert.equal(isoWeekday("2026-10-19"), 1); // понедельник
  assert.equal(isoWeekday("2026-10-25"), 7); // воскресенье
});

test("местные часы организации не зависят от пояса сервера", () => {
  const instant = new Date("2026-10-18T22:30:00Z");
  assert.deepEqual(localClock(instant, "Europe/Moscow"), { dayKey: "2026-10-19", minutes: 90 });
  assert.deepEqual(localClock(instant, "Asia/Vladivostok"), { dayKey: "2026-10-19", minutes: 8 * 60 + 30 });
  assert.deepEqual(localClock(instant, "Europe/Kaliningrad"), { dayKey: "2026-10-19", minutes: 30 });
  // Неверный пояс — Москва, а не падение.
  assert.deepEqual(localClock(instant, "Mars/Base"), { dayKey: "2026-10-19", minutes: 90 });
});

test("текущий период и его ключ", () => {
  assert.deepEqual(currentPeriod(daily, "2026-10-19"), { key: "daily:2026-10-19", dayKey: "2026-10-19", dueMinutes: 720 });
  assert.equal(currentPeriod(weeklyMonday, "2026-10-19")?.key, "weekly:2026-10-19");
  assert.equal(currentPeriod(weeklyMonday, "2026-10-20"), null);
  // 31-е в ноябре — 30-е, в феврале — 28-е.
  assert.equal(currentPeriod(monthly31, "2026-11-30")?.key, "monthly:2026-11-30");
  assert.equal(currentPeriod(monthly31, "2026-11-29"), null);
  assert.equal(currentPeriod(monthly31, "2027-02-28")?.dayKey, "2027-02-28");
  assert.equal(currentPeriod(monthly31, "2026-10-31")?.dayKey, "2026-10-31");
  // Разовое: до даты — нет, в дату и после — его период.
  assert.equal(currentPeriod(once, "2026-10-20"), null);
  assert.equal(currentPeriod(once, "2026-10-21")?.key, "once:2026-10-21");
  assert.equal(currentPeriod(once, "2026-10-25")?.key, "once:2026-10-21");
});

test("следующий день срока", () => {
  assert.equal(nextScheduledDay(weeklyMonday, "2026-10-20"), "2026-10-26");
  assert.equal(nextScheduledDay(weeklyMonday, "2026-10-19"), "2026-10-19");
  assert.equal(nextScheduledDay(monthly31, "2026-11-01"), "2026-11-30");
  assert.equal(nextScheduledDay(once, "2026-10-01"), "2026-10-21");
  assert.equal(nextScheduledDay(once, "2026-10-22"), null);
});

test("статус: ожидает / выполнено / просрочено / не в этот день", () => {
  assert.equal(periodState(daily, at("2026-10-19", "11:59"), []).status, "pending");
  assert.equal(periodState(daily, at("2026-10-19", "12:00"), []).status, "pending");
  assert.equal(periodState(daily, at("2026-10-19", "12:01"), []).status, "overdue");
  assert.equal(periodState(daily, at("2026-10-19", "15:00"), ["2026-10-19"]).status, "done");
  // Вчерашняя проверка сегодняшний период не закрывает.
  assert.equal(periodState(daily, at("2026-10-19", "10:00"), ["2026-10-18"]).status, "pending");
  const off = periodState(weeklyMonday, at("2026-10-21", "10:00"), []);
  assert.equal(off.status, "off");
  assert.equal(off.nextDayKey, "2026-10-26");
  // Разовое после даты — просрочено, пока не проведут; проведённое позже — выполнено.
  assert.equal(periodState(once, at("2026-10-23", "09:00"), []).status, "overdue");
  assert.equal(periodState(once, at("2026-10-23", "09:00"), ["2026-10-22"]).status, "done");
  assert.equal(periodState(once, at("2026-10-20", "09:00"), []).status, "off");
});

test("назначили после срока — первый период завтра, а не «просрочено» сразу", () => {
  const created = at("2026-10-19", "13:00");
  const today = periodState(daily, at("2026-10-19", "13:05"), [], created);
  assert.equal(today.status, "off");
  assert.equal(today.nextDayKey, "2026-10-20");
  assert.equal(periodState(daily, at("2026-10-20", "09:00"), [], created).status, "pending");
  // До срока в тот же день — период сегодняшний.
  assert.equal(periodState(daily, at("2026-10-19", "11:00"), [], at("2026-10-19", "10:00")).status, "pending");
});

const people: (RecipientCandidate & { name: string; telegramChatId: string | null })[] = [
  { id: "cook-1", name: "Повар 1", isActive: true, archivedAt: null, jobPositionId: "cook", buildingIds: [], telegramChatId: "111" },
  { id: "cook-2", name: "Повар 2", isActive: true, archivedAt: null, jobPositionId: "cook", buildingIds: ["mira"], telegramChatId: null },
  { id: "cook-3", name: "Уволен", isActive: true, archivedAt: new Date(), jobPositionId: "cook", buildingIds: [], telegramChatId: "333" },
  { id: "cook-4", name: "Неактивен", isActive: false, archivedAt: null, jobPositionId: "cook", buildingIds: [], telegramChatId: "444" },
  { id: "chef", name: "Шеф", isActive: true, archivedAt: null, jobPositionId: "chef", buildingIds: ["lenina"], telegramChatId: "555" },
  { id: "stale", name: "Точка удалена", isActive: true, archivedAt: null, jobPositionId: null, buildingIds: ["gone"], telegramChatId: null },
  { id: "root", name: "ROOT", isActive: true, archivedAt: null, isRoot: true, jobPositionId: "cook", buildingIds: [], telegramChatId: "999" },
];
const buildings = ["lenina", "mira"];
const ids = (list: { id: string }[]) => list.map((item) => item.id);

test("кому: люди точки, должности, человек — только активные", () => {
  assert.deepEqual(ids(assignmentRecipients({ kind: "position", id: "cook" }, people, buildings)), ["cook-1", "cook-2"]);
  // Точка: пустой список точек — все точки; удалённая точка в списке не считается.
  assert.deepEqual(ids(assignmentRecipients({ kind: "building", id: "lenina" }, people, buildings)), ["cook-1", "chef", "stale"]);
  assert.deepEqual(ids(assignmentRecipients({ kind: "building", id: "mira" }, people, buildings)), ["cook-1", "cook-2", "stale"]);
  assert.deepEqual(ids(assignmentRecipients({ kind: "building", id: "gone" }, people, buildings)), []);
  assert.deepEqual(ids(assignmentRecipients({ kind: "user", id: "chef" }, people, buildings)), ["chef"]);
  assert.deepEqual(ids(assignmentRecipients({ kind: "user", id: "cook-3" }, people, buildings)), []);
});

const assignment = {
  active: true,
  remindTelegram: true,
  lastReminderPeriodKey: null as string | null,
  schedule: daily,
  startedAt: at("2026-10-01", "09:00"),
};
const cooks = assignmentRecipients({ kind: "position", id: "cook" }, people, buildings);

test("напоминание: в день срока за 2 часа, только с Telegram", () => {
  assert.equal(CHECKLIST_REMINDER_LEAD_MINUTES, 120);
  assert.equal(reminderMinutes("12:00"), 600);
  assert.equal(reminderMinutes("01:00"), 0);
  assert.equal(reminderPlan({ assignment, clock: at("2026-10-19", "09:59"), completedDayKeys: [], recipients: cooks }), null);
  const plan = reminderPlan({ assignment, clock: at("2026-10-19", "10:00"), completedDayKeys: [], recipients: cooks });
  assert.deepEqual(plan, { periodKey: "daily:2026-10-19", dueMinutes: 720, overdue: false, send: [{ userId: "cook-1", chatId: "111" }] });
  // Крон опоздал — после срока в тот же день напоминание всё равно одно, с пометкой «просрочено».
  assert.equal(reminderPlan({ assignment, clock: at("2026-10-19", "20:00"), completedDayKeys: [], recipients: cooks })?.overdue, true);
});

test("напоминание: повтор за период не дублируется, выполненным и выключенным — нет", () => {
  const sent = { ...assignment, lastReminderPeriodKey: "daily:2026-10-19" };
  assert.equal(reminderPlan({ assignment: sent, clock: at("2026-10-19", "11:00"), completedDayKeys: [], recipients: cooks }), null);
  // Следующий период — снова одно.
  assert.equal(reminderPlan({ assignment: sent, clock: at("2026-10-20", "11:00"), completedDayKeys: [], recipients: cooks })?.periodKey, "daily:2026-10-20");
  assert.equal(reminderPlan({ assignment, clock: at("2026-10-19", "11:00"), completedDayKeys: ["2026-10-19"], recipients: cooks }), null);
  assert.equal(reminderPlan({ assignment: { ...assignment, active: false }, clock: at("2026-10-19", "11:00"), completedDayKeys: [], recipients: cooks }), null);
  assert.equal(reminderPlan({ assignment: { ...assignment, remindTelegram: false }, clock: at("2026-10-19", "11:00"), completedDayKeys: [], recipients: cooks }), null);
  // Еженедельное — только в свой день.
  const weekly = { ...assignment, schedule: weeklyMonday };
  assert.equal(reminderPlan({ assignment: weekly, clock: at("2026-10-20", "17:00"), completedDayKeys: [], recipients: cooks }), null);
  assert.equal(reminderPlan({ assignment: weekly, clock: at("2026-10-19", "17:00"), completedDayKeys: [], recipients: cooks })?.periodKey, "weekly:2026-10-19");
  // Разовое просроченное на следующий день не напоминает повторно.
  const single = { ...assignment, schedule: once };
  assert.equal(reminderPlan({ assignment: single, clock: at("2026-10-22", "14:00"), completedDayKeys: [], recipients: cooks }), null);
  assert.equal(reminderPlan({ assignment: single, clock: at("2026-10-21", "14:00"), completedDayKeys: [], recipients: cooks })?.periodKey, "once:2026-10-21");
});

test("напоминание: получателей с Telegram нет — план пустой, но период отмечается", () => {
  const plan = reminderPlan({ assignment, clock: at("2026-10-19", "11:00"), completedDayKeys: [], recipients: [{ id: "x", telegramChatId: null }, { id: "y", telegramChatId: "  " }] });
  assert.deepEqual(plan?.send, []);
  assert.equal(plan?.periodKey, "daily:2026-10-19");
});

test("разовое в прошлом не ставится", () => {
  const clock = at("2026-10-19", "12:00");
  assert.equal(onceDueInPast({ frequency: "once", onceDate: "2026-10-18", dueTime: "23:00" }, clock), true);
  assert.equal(onceDueInPast({ frequency: "once", onceDate: "2026-10-19", dueTime: "11:59" }, clock), true);
  assert.equal(onceDueInPast({ frequency: "once", onceDate: "2026-10-19", dueTime: "12:00" }, clock), false);
  assert.equal(onceDueInPast({ frequency: "daily", onceDate: null, dueTime: "08:00" }, clock), false);
});

test("тексты Telegram экранируют название шаблона", () => {
  const text = checklistReminderMessage({ templateTitle: "СанПиН <b>&", dueTime: "12:00", overdue: false });
  assert.match(text, /СанПиН &lt;b&gt;&amp;/);
  assert.match(text, /до 12:00/);
  assert.match(checklistReminderMessage({ templateTitle: "X", dueTime: "12:00", overdue: true }), /ещё не провели/);
  const review = checklistReviewMessage({ templateTitle: "ХАССП", completedByName: "Волкова", earned: 8, possible: 10, violations: 2, stopped: true });
  assert.match(review, /8 из 10 \(80%\)/);
  assert.match(review, /нарушений: 2/);
  assert.match(review, /Критическое нарушение/);
});
