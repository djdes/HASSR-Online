import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { checkEntryScope } from "@/lib/journal-entry-scope";

/**
 * Смоук-проверка ограничений доступа.
 *
 * Здесь не проверяется, что «функция работает» — это делают точечные
 * тесты рядом. Здесь проверяется, что ПРАВИЛО ЦЕЛИКОМ не разъехалось:
 * матрица «кто × что правит» и то, что охрана вообще вызывается в
 * роутах записи. Второе важнее первого: за время жизни проекта проверка
 * скорее выпадет при рефакторинге, чем сломается изнутри.
 *
 * Базы данных тут нет и не нужно: правила — чистые функции, а вызовы в
 * роутах проверяются чтением исходников.
 */

const TODAY = "2026-09-01";
const YESTERDAY = "2026-08-31";
const RESPONSIBLE = "user_responsible";

type Actor = { id: string; role: string; isRoot: boolean };

const cook: Actor = { id: "cook_1", role: "cook", isRoot: false };
const waiter: Actor = { id: "waiter_1", role: "waiter", isRoot: false };
const manager: Actor = { id: "mgr_1", role: "manager", isRoot: false };
const headChef: Actor = { id: "chef_1", role: "head_chef", isRoot: false };
const owner: Actor = { id: "own_1", role: "owner", isRoot: false };
const root: Actor = { id: "root_1", role: "cook", isRoot: true };
const responsibleCook: Actor = {
  id: RESPONSIBLE,
  role: "cook",
  isRoot: false,
};

/**
 * Матрица покрывает сценарий владельца дословно: «начался сентябрь,
 * авторизовался повар и не может внести свои данные за прошлый месяц, а
 * управляющий может внести все данные».
 */
const CASES: Array<{
  name: string;
  actor: Actor;
  employeeId: string;
  day: string;
  allowed: boolean;
  code?: "foreign_row" | "not_today";
}> = [
  // Рядовой сотрудник.
  { name: "повар, своя строка, сегодня", actor: cook, employeeId: cook.id, day: TODAY, allowed: true },
  { name: "повар, своя строка, вчера", actor: cook, employeeId: cook.id, day: YESTERDAY, allowed: false, code: "not_today" },
  { name: "повар, чужая строка, сегодня", actor: cook, employeeId: "cook_2", day: TODAY, allowed: false, code: "foreign_row" },
  { name: "повар, чужая строка, вчера", actor: cook, employeeId: "cook_2", day: YESTERDAY, allowed: false, code: "foreign_row" },
  { name: "официант, своя строка, вчера", actor: waiter, employeeId: waiter.id, day: YESTERDAY, allowed: false, code: "not_today" },

  // Руководство — полный доступ независимо от дня и строки.
  { name: "управляющий, чужая строка, вчера", actor: manager, employeeId: "cook_2", day: YESTERDAY, allowed: true },
  { name: "управляющий, чужая строка, сегодня", actor: manager, employeeId: "cook_2", day: TODAY, allowed: true },
  { name: "шеф-повар, чужая строка, вчера", actor: headChef, employeeId: "cook_2", day: YESTERDAY, allowed: true },
  { name: "root, чужая строка, вчера", actor: root, employeeId: "cook_2", day: YESTERDAY, allowed: true },

  // Ответственный за журнал — тоже полный доступ, даже будучи поваром.
  { name: "ответственный повар, чужая строка, вчера", actor: responsibleCook, employeeId: "cook_2", day: YESTERDAY, allowed: true },
  { name: "ответственный повар, чужая строка, сегодня", actor: responsibleCook, employeeId: "cook_2", day: TODAY, allowed: true },
];

for (const item of CASES) {
  test(`область правки: ${item.name}`, () => {
    const decision = checkEntryScope({
      actor: item.actor,
      responsibleUserId: RESPONSIBLE,
      employeeId: item.employeeId,
      entryDayKey: item.day,
      todayKey: TODAY,
    });

    assert.equal(decision.allowed, item.allowed, item.name);
    if (!item.allowed && decision.allowed === false) {
      assert.equal(decision.code, item.code);
      assert.ok(decision.error.length > 0, "отказ обязан объяснять причину");
    }
  });
}

test("роль owner из старой схемы всё ещё считается руководством", () => {
  // Легаси-роль осталась у организаций, заведённых до переименования
  // ролей. Если она перестанет проходить, владелец потеряет доступ к
  // правке чужих строк и узнает об этом от проверяющего, а не от нас.
  const decision = checkEntryScope({
    actor: owner,
    responsibleUserId: RESPONSIBLE,
    employeeId: "cook_2",
    entryDayKey: YESTERDAY,
    todayKey: TODAY,
  });

  assert.equal(decision.allowed, true);
});

test("без назначенного ответственного сотрудник ограничен так же", () => {
  const decision = checkEntryScope({
    actor: cook,
    responsibleUserId: null,
    employeeId: "cook_2",
    entryDayKey: TODAY,
    todayKey: TODAY,
  });

  assert.equal(decision.allowed, false);
});

/* ------------------------------------------------------------------ *
 * Охрана на месте
 *
 * Тест читает исходники роутов записи и убеждается, что проверка вообще
 * вызывается. Грубо — но ловит ровно ту поломку, которая реально
 * случается: guard удалили или забыли добавить в новый роут, а все
 * юнит-тесты правил при этом остались зелёными.
 * ------------------------------------------------------------------ */

const GUARDED_ROUTES = [
  "src/app/api/journal-documents/[id]/entries/route.ts",
  "src/app/api/journal-documents/[id]/entries/bulk/route.ts",
];

for (const relative of GUARDED_ROUTES) {
  test(`охрана области правки вызывается: ${relative}`, () => {
    const file = path.join(process.cwd(), relative);
    assert.ok(fs.existsSync(file), `роут не найден: ${relative}`);
    const source = fs.readFileSync(file, "utf8");
    assert.match(
      source,
      /checkEntryScope\(/,
      `в ${relative} нет вызова checkEntryScope — запись открыта всем`
    );
  });
}
