import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { canEditAutomationCell, isCellLocked, type AutomationLockContext } from "@/lib/closed-day";
import {
  AUTOMATION_ALL_ON,
  AUTOMATION_FEATURES,
  AUTOMATION_OFF,
  DEFAULT_PAST_DAYS_LIMIT,
  PAST_DAYS_LIMITS,
  automationOn,
  parseJournalControls,
  pastDaysPolicy,
  readStoredAutomation,
} from "@/lib/journal-controls";
import {
  NOT_TODAY_MESSAGE,
  checkEntryScope,
  pastDayOpen,
  pastDaysWindowMessage,
  shiftDayKey,
  type PastDaysPolicy,
} from "@/lib/journal-entry-scope";
import { checkEntryWrite, type EntryWriteContext } from "@/lib/journal-entry-write";

/*
 * «Правка прошлых дней» спецрежима (владелец, 2026-11-25): по умолчанию прошлые
 * дни закрыты — сотруднику только сегодня, автодокумент — для всех, плюс
 * необязательный запрет организации. Галочка спецрежима открывает дни в окне
 * «за последние N дней»; будущее закрыто всегда.
 */

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

const TODAY = "2026-11-25";
const YESTERDAY = "2026-11-24";
const WEEK_AGO = "2026-11-18";
const EIGHT_DAYS_AGO = "2026-11-17";
const TOMORROW = "2026-11-26";
const NOW = new Date("2026-11-25T09:00:00.000Z");

const OPEN_7: PastDaysPolicy = { allowed: true, limitDays: 7 };
const OPEN_ANY: PastDaysPolicy = { allowed: true, limitDays: null };
const CLOSED: PastDaysPolicy = { allowed: false, limitDays: 7 };

const cook = { id: "cook_1", role: "cook", isRoot: false };
const manager = { id: "mgr_1", role: "manager", isRoot: false, name: "Управляющая" };

test("окно прошлых дней: только прошлое, не старше N дней; без разрешения — закрыто", () => {
  assert.equal(shiftDayKey(TODAY, -7), WEEK_AGO);
  assert.equal(shiftDayKey("2026-03-01", -1), "2026-02-28");
  assert.equal(pastDayOpen(OPEN_7, YESTERDAY, TODAY), true);
  assert.equal(pastDayOpen(OPEN_7, WEEK_AGO, TODAY), true, "граница окна включительно");
  assert.equal(pastDayOpen(OPEN_7, EIGHT_DAYS_AGO, TODAY), false);
  assert.equal(pastDayOpen({ allowed: true, limitDays: 1 }, YESTERDAY, TODAY), true);
  assert.equal(pastDayOpen({ allowed: true, limitDays: 1 }, "2026-11-23", TODAY), false);
  assert.equal(pastDayOpen(OPEN_ANY, "2025-01-01", TODAY), true);
  for (const policy of [OPEN_7, OPEN_ANY]) {
    assert.equal(pastDayOpen(policy, TODAY, TODAY), false, "сегодня открыто и так");
    assert.equal(pastDayOpen(policy, TOMORROW, TODAY), false, "будущее — никогда");
  }
  for (const policy of [CLOSED, null, undefined]) assert.equal(pastDayOpen(policy, YESTERDAY, TODAY), false);
  assert.equal(pastDayOpen(OPEN_7, YESTERDAY, ""), false, "без «сегодня» не открываем");
});

test("сотрудник: своя строка за прошлый день в окне — можно; чужая, за окном и будущее — нет", () => {
  const scope = (entryDayKey: string, pastDays?: PastDaysPolicy | null, employeeId = cook.id) =>
    checkEntryScope({ actor: cook, employeeId, entryDayKey, todayKey: TODAY, pastDays });
  assert.deepEqual(scope(YESTERDAY, OPEN_7), { allowed: true });
  assert.deepEqual(scope(WEEK_AGO, OPEN_7), { allowed: true });
  const beyond = scope(EIGHT_DAYS_AGO, OPEN_7);
  assert.equal(beyond.allowed === false && beyond.code, "not_today");
  assert.equal(beyond.allowed === false && beyond.error, "Прошлые записи можно менять только за последние 7 дней.");
  const foreign = scope(YESTERDAY, OPEN_7, "cook_2");
  assert.equal(foreign.allowed === false && foreign.code, "foreign_row");
  const future = scope(TOMORROW, OPEN_ANY);
  assert.equal(future.allowed === false && future.error, NOT_TODAY_MESSAGE);
  // Без спецрежима — как раньше.
  for (const policy of [undefined, null, CLOSED]) {
    const decision = scope(YESTERDAY, policy);
    assert.equal(decision.allowed === false && decision.error, NOT_TODAY_MESSAGE);
  }
  assert.equal(pastDaysWindowMessage(1), "Прошлые записи можно менять только за вчерашний день.");
  assert.equal(pastDaysWindowMessage(3), "Прошлые записи можно менять только за последние 3 дня.");
  assert.equal(pastDaysWindowMessage(14), "Прошлые записи можно менять только за последние 14 дней.");
});

const AUTO: AutomationLockContext = { documentAutoFill: true, automationEnabled: true, shiftEndHour: 0, todayKey: TODAY };

test("автодокумент: день в окне открыт всем, кто правит строку; за окном — как раньше, ROOT — override", () => {
  assert.equal(isCellLocked(YESTERDAY, AUTO, NOW), true, "по умолчанию прошлый день заперт");
  const open = { ...AUTO, pastDays: OPEN_7 };
  assert.equal(isCellLocked(YESTERDAY, open, NOW), false);
  assert.equal(isCellLocked(WEEK_AGO, open, NOW), false);
  assert.equal(isCellLocked(EIGHT_DAYS_AGO, open, NOW), true);
  assert.equal(isCellLocked(TODAY, open, NOW), false);
  for (const role of ["cook", "manager", "owner"]) {
    assert.deepEqual(canEditAutomationCell(YESTERDAY, { role, isRoot: false }, open, NOW), { allowed: true, reason: "ok", isOverride: false });
    assert.equal(canEditAutomationCell(EIGHT_DAYS_AGO, { role, isRoot: false }, open, NOW).allowed, false);
  }
  assert.deepEqual(canEditAutomationCell(EIGHT_DAYS_AGO, { role: "cook", isRoot: true }, open, NOW), { allowed: true, reason: "past_day_locked", isOverride: true });
  assert.equal(isCellLocked(YESTERDAY, { ...AUTO, pastDays: CLOSED }, NOW), true);
});

function context(overrides: Partial<EntryWriteContext> = {}): EntryWriteContext {
  const pastDays = overrides.pastDays ?? { allowed: false, limitDays: 7 };
  return {
    todayKey: TODAY,
    pastDays,
    org: { lockPastDayEdits: true, shiftEndHour: 0 },
    automation: { documentAutoFill: false, automationEnabled: false, shiftEndHour: 0, pastDays, todayKey: TODAY },
    ...overrides,
  };
}

const day = (key: string) => new Date(`${key}T00:00:00.000Z`);

test("запрет организации «Запретить редактирование…» не действует на дни в окне спецрежима", () => {
  const staff = { ...cook, name: "Повар" };
  // Без спецрежима сотруднику вчера закрыто, руководству — с записью override.
  assert.equal(checkEntryWrite(context(), staff, day(YESTERDAY)).allowed, false);
  assert.deepEqual(checkEntryWrite(context(), manager, day(YESTERDAY)), { allowed: true, isOverride: true });
  // Спецрежим открыл неделю: вчера — можно без override; за окном — как раньше.
  const open = context({ pastDays: OPEN_7 });
  assert.deepEqual(checkEntryWrite(open, staff, day(YESTERDAY)), { allowed: true, isOverride: false });
  assert.deepEqual(checkEntryWrite(open, manager, day(WEEK_AGO)), { allowed: true, isOverride: false });
  assert.equal(checkEntryWrite(open, staff, day(EIGHT_DAYS_AGO)).allowed, false);
  assert.deepEqual(checkEntryWrite(open, manager, day(EIGHT_DAYS_AGO)), { allowed: true, isOverride: true });
  // Будущее закрыто всем и при спецрежиме без ограничения.
  const any = context({ pastDays: OPEN_ANY });
  const future = checkEntryWrite(any, manager, day(TOMORROW));
  assert.equal(future.allowed === false && future.code, "future_day_locked");
  // Автодокумент в окне — открыт и сотруднику.
  const auto = context({
    pastDays: OPEN_7,
    org: { lockPastDayEdits: false, shiftEndHour: 0 },
    automation: { ...AUTO, pastDays: OPEN_7 },
  });
  assert.deepEqual(checkEntryWrite(auto, staff, day(YESTERDAY)), { allowed: true, isOverride: false });
});

test("настройка: галочка и «Насколько назад» по умолчанию выключены и 7 дней; мусор — по умолчанию", () => {
  assert.ok(AUTOMATION_FEATURES.includes("pastDays"));
  assert.deepEqual([...PAST_DAYS_LIMITS], [1, 3, 7, 14, 30, 0]);
  assert.equal(DEFAULT_PAST_DAYS_LIMIT, 7);
  for (const automation of [AUTOMATION_OFF, AUTOMATION_ALL_ON]) {
    assert.equal(automation.pastDays, false, "и у организаций «как до 2026-10-28»");
    assert.equal(automation.pastDaysLimit, 7);
  }
  const parsed = parseJournalControls({ automation: { enabled: true, pastDays: true, pastDaysLimit: 14 } });
  assert.equal(automationOn(parsed, "pastDays"), true);
  assert.deepEqual(pastDaysPolicy(parsed), { allowed: true, limitDays: 14 });
  assert.deepEqual(pastDaysPolicy(parseJournalControls({ automation: { enabled: true, pastDays: true, pastDaysLimit: 0 } })), { allowed: true, limitDays: null });
  for (const bad of [5, "7", -1, null, 1.5]) {
    assert.equal(parseJournalControls({ automation: { enabled: true, pastDays: true, pastDaysLimit: bad } }).automation.pastDaysLimit, 7, String(bad));
  }
  // Спецрежим выключен — разрешения нет, выбор сохраняется.
  const off = parseJournalControls({ automation: { enabled: false, pastDays: true, pastDaysLimit: 30 } });
  assert.deepEqual(pastDaysPolicy(off), { allowed: false, limitDays: 30 });
  // Сохранённый выбор без новой галочки дополняется сервером — выключенной.
  const before = { enabled: true, autoFill: true, autoCreate: true, copyYesterday: true, closeDayAutofill: true, catchUp: true };
  assert.deepEqual(readStoredAutomation({ automation: before }).missing, ["pastDays"]);
  assert.match(read("src/lib/journal-controls.server.ts"), /case "pastDays":[\s\S]*?return false;/);
  // API принимает галочку и глубину, отсеивает чужие значения.
  const api = read("src/app/api/settings/journal-controls/route.ts");
  assert.match(api, /pastDays: z\.boolean\(\)\.optional\(\)/);
  assert.match(api, /pastDaysLimit: z\.custom<PastDaysLimit>\(isPastDaysLimit\)\.optional\(\)/);
});

test("правило одно для всех путей записи и для сеток журналов", () => {
  for (const file of [
    "src/app/api/journal-documents/[id]/entries/route.ts",
    "src/app/api/journal-documents/[id]/entries/bulk/route.ts",
    "src/lib/ai-assistant/actions.ts",
  ]) {
    assert.match(read(file), /pastDays: writeCtx\.pastDays/, file);
  }
  const page = read("src/app/(dashboard)/journals/[code]/documents/[docId]/page.tsx");
  assert.ok((page.match(/pastDays=\{pastDays\}/g) ?? []).length >= 4, "страница документа передаёт правило сеткам");
  for (const client of ["hygiene", "health", "cold-equipment", "climate"]) {
    assert.match(read(`src/components/journals/${client}-document-client.tsx`), /pastDayOpen\(pastDays, dateKey, todayKey\)/, client);
  }
});
