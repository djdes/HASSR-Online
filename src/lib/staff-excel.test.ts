import assert from "node:assert/strict";
import test from "node:test";

import {
  INHERIT_JOURNALS_LABEL,
  STAFF_COLUMNS,
  buildStaffExportRow,
  isSyntheticLogin,
  parseStaffSheet,
} from "@/lib/staff-excel";

const HEADER = STAFF_COLUMNS.map((column) => column.header);

function sheet(...rows: unknown[][]) {
  return [HEADER, ...rows];
}

test("шаблон и импорт говорят на одном языке колонок", () => {
  // Если это упало — разошлись выгрузка и загрузка, и человек получит
  // «файл не подходит» на файле, который выдали мы сами.
  const { rows, errors } = parseStaffSheet(
    sheet(["Иванова Мария", "Повар", "+79991234567", "m@x.ru", "Сб, Вс", INHERIT_JOURNALS_LABEL])
  );
  assert.equal(errors.length, 0);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].fullName, "Иванова Мария");
  assert.equal(rows[0].positionName, "Повар");
  assert.deepEqual(rows[0].weeklyDaysOff, [5, 6]);
  assert.equal(rows[0].journalNames, null, "«по должности» = наследование");
});

test("колонки можно переставить местами", () => {
  const { rows, errors } = parseStaffSheet([
    ["Должность", "ФИО"],
    ["Повар", "Иванова Мария"],
  ]);
  assert.equal(errors.length, 0);
  assert.equal(rows[0].fullName, "Иванова Мария");
  assert.equal(rows[0].positionName, "Повар");
});

test("файл без обязательных колонок отвергается с понятной причиной", () => {
  const { rows, errors } = parseStaffSheet([
    ["Имя", "Телефон"],
    ["Иванова", "+79991234567"],
  ]);
  assert.equal(rows.length, 0);
  assert.match(errors[0].message, /ФИО/);
});

test("пустые строки в конце файла не считаются ошибками", () => {
  const { rows, errors } = parseStaffSheet(
    sheet(["Иванова Мария", "Повар"], [], ["", "", "", "", "", ""])
  );
  assert.equal(rows.length, 1);
  assert.equal(errors.length, 0);
});

test("строка без должности объясняет, о ком речь", () => {
  const { rows, errors } = parseStaffSheet(sheet(["Иванова Мария", ""]));
  assert.equal(rows.length, 0);
  assert.equal(errors[0].code, "missingPosition");
  assert.deepEqual(errors[0].params, { name: "Иванова Мария" });
  assert.match(errors[0].message, /Иванова Мария/);
});

test("явный список журналов разбирается по «;»", () => {
  const { rows } = parseStaffSheet(
    sheet([
      "Иванова",
      "Повар",
      "",
      "",
      "",
      "Гигиенический журнал; Журнал здоровья",
    ])
  );
  assert.deepEqual(rows[0].journalNames, [
    "Гигиенический журнал",
    "Журнал здоровья",
  ]);
});

test("синтетический логин в выгрузку не попадает", () => {
  assert.equal(isSyntheticLogin("staff-ab12@org.local.haccp"), true);
  assert.equal(isSyntheticLogin("masha@mail.ru"), false);

  const row = buildStaffExportRow({
    name: "Иванова Мария",
    positionTitle: "Повар",
    jobPositionName: "Повар",
    phone: "+79991234567",
    contactEmail: null,
    email: "staff-ab12@org.local.haccp",
    weeklyDaysOff: [5, 6],
    telegramChatId: null,
    isActive: true,
    archivedAt: null,
    journalAccessMigrated: false,
    journalNames: [],
  });

  assert.equal(row.login, "", "синтетический логин показывать незачем");
  assert.equal(row.daysOff, "Сб, Вс");
  assert.equal(
    row.journals,
    INHERIT_JOURNALS_LABEL,
    "ненастроенный доступ — словами: пустая ячейка при обратной загрузке означала бы «отобрать всё»"
  );
  assert.equal(row.telegram, "—");
  assert.equal(row.status, "Активен");
});

test("выгрузка и загрузка сходятся: что выгрузили — то и прочитали", () => {
  const exported = buildStaffExportRow({
    name: "Сидоров Пётр",
    positionTitle: "Уборщица",
    jobPositionName: "Уборщица",
    phone: "+79990000000",
    contactEmail: "p@x.ru",
    email: "p@x.ru",
    weeklyDaysOff: [6],
    telegramChatId: "123",
    isActive: true,
    archivedAt: null,
    journalAccessMigrated: true,
    journalNames: ["Журнал уборки"],
  });

  const { rows, errors } = parseStaffSheet(
    sheet([
      exported.fullName,
      exported.position,
      exported.phone,
      exported.contactEmail,
      exported.daysOff,
      exported.journals,
      exported.login,
      exported.telegram,
      exported.status,
    ])
  );

  assert.equal(errors.length, 0);
  assert.equal(rows[0].fullName, "Сидоров Пётр");
  assert.deepEqual(rows[0].weeklyDaysOff, [6]);
  assert.deepEqual(rows[0].journalNames, ["Журнал уборки"]);
});
