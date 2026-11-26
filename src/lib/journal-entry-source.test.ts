import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import type { AutomationLockContext } from "@/lib/closed-day";
import { checkEntrySourceWrite, checkEntryWrite, type EntryWriteContext } from "@/lib/journal-entry-write";

/*
 * Клетка, откуда уходит строка при переносе (PUT с entryId). С 2026-11-25 она
 * проходит те же запреты прошлых дней, что и цель, но правило «будущее никто не
 * заполняет» — о том, КУДА пишут: убрать строку с будущего дня руководство
 * могло и до спецрежима (проверка спецрежима, MV-12).
 */

const TODAY = "2026-11-25";
const day = (key: string) => new Date(`${key}T00:00:00.000Z`);
const manager = { id: "mgr_1", role: "manager", isRoot: false, name: "Управляющая" };
const cook = { id: "cook_1", role: "cook", isRoot: false, name: "Повар" };
const CLOSED = { allowed: false, limitDays: 7 };
const AUTO: AutomationLockContext = { documentAutoFill: true, automationEnabled: true, shiftEndHour: 0, todayKey: TODAY, pastDays: CLOSED };

function context(overrides: Partial<EntryWriteContext> = {}): EntryWriteContext {
  return {
    todayKey: TODAY,
    pastDays: CLOSED,
    org: { lockPastDayEdits: true, shiftEndHour: 0 },
    automation: { documentAutoFill: false, automationEnabled: false, shiftEndHour: 0, pastDays: CLOSED, todayKey: TODAY },
    ...overrides,
  };
}

test("строку с будущего дня руководство переносит; запись В будущий день — по-прежнему нет", () => {
  assert.deepEqual(checkEntrySourceWrite(context(), manager, day("2026-11-27")), { allowed: true, isOverride: false });
  const target = checkEntryWrite(context(), manager, day("2026-11-27"));
  assert.equal(target.allowed === false && target.code, "future_day_locked");
});

test("прошлые дни источника — те же запреты, что у цели", () => {
  // Запрет организации: сотруднику закрыто, руководству — с записью override.
  assert.deepEqual(checkEntrySourceWrite(context(), cook, day("2026-11-20")), checkEntryWrite(context(), cook, day("2026-11-20")));
  assert.equal(checkEntrySourceWrite(context(), cook, day("2026-11-20")).allowed, false);
  assert.deepEqual(checkEntrySourceWrite(context(), manager, day("2026-11-20")), { allowed: true, isOverride: true });
  // Документ автоматики: прошлый день заперт и руководству.
  const auto = context({ org: null, automation: AUTO });
  assert.equal(checkEntrySourceWrite(auto, manager, day("2026-11-20")).allowed, false);
  assert.deepEqual(checkEntrySourceWrite(auto, manager, day(TODAY)), { allowed: true, isOverride: false });
});

test("роут переноса проверяет источник без правила будущего", () => {
  const route = readFileSync(path.join(process.cwd(), "src/app/api/journal-documents/[id]/entries/route.ts"), "utf8");
  assert.match(route, /const sourceDecision = checkEntrySourceWrite\(writeCtx, actor, editedEntry\.date\);/);
  assert.doesNotMatch(route, /checkEntryWrite\(writeCtx, actor, editedEntry\.date\)/);
});
