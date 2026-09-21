import assert from "node:assert/strict";
import test from "node:test";

import {
  getRowEmployeeTitle,
  pickPrimaryManager,
  pickPrimaryStaff,
} from "@/lib/user-roles";

/**
 * Выбор «кого подставить по умолчанию» не должен останавливаться на
 * аккаунте мгновенной регистрации (имя = почта) и на ROOT, пока в
 * организации есть живые сотрудники.
 */

const placeholderOwner = { id: "owner", name: "boss@mail.ru", email: "boss@mail.ru", role: "owner" };
const root = { id: "root", name: "Платформа", role: "owner", isRoot: true };
const head = { id: "head", name: "Анна Заведующая", role: "head_chef" };
const cook = { id: "cook", name: "Борис Повар", role: "cook" };

test("первым управляющим не становится аккаунт «имя = почта» и ROOT", () => {
  assert.equal(pickPrimaryManager([placeholderOwner, root, head, cook])?.id, "head");
  assert.equal(pickPrimaryManager([placeholderOwner, cook])?.id, "cook");
});

test("заглушка остаётся, только если больше некого", () => {
  assert.equal(pickPrimaryManager([placeholderOwner])?.id, "owner");
  assert.equal(pickPrimaryManager([]), null);
});

test("без имён в объекте поведение прежнее: по ролям", () => {
  assert.equal(pickPrimaryManager([{ id: "c", role: "cook" }, { id: "m", role: "manager" }])?.id, "m");
  assert.equal(pickPrimaryStaff([{ id: "m", role: "manager" }, { id: "c", role: "cook" }])?.id, "c");
});

/**
 * Должность под фамилией в строке журнала — всегда должность самого
 * человека. Скриншот-баг: под «Акулининой» стояла должность ответственного
 * документа («Заведующий производством»), сохранённая в строке.
 */
test("getRowEmployeeTitle: должность из карточки важнее копии в строке", () => {
  const akulinina = {
    name: "Акулинина Елена Викторовна",
    role: "cook",
    positionTitle: "Кладовщик",
    jobPosition: { name: "Кладовщик", categoryKey: "staff" },
  };
  assert.equal(getRowEmployeeTitle(akulinina, "Заведующий производством"), "Кладовщик");
});

test("getRowEmployeeTitle: без справочника — positionTitle, затем лейбл роли", () => {
  assert.equal(getRowEmployeeTitle({ role: "cook", positionTitle: "Кондитер" }, "Управляющий"), "Кондитер");
  assert.equal(getRowEmployeeTitle({ role: "manager" }, null), "Управляющий");
});

test("getRowEmployeeTitle: человека нет в списке — сохранённая копия, иначе пусто (не «Повар»)", () => {
  assert.equal(getRowEmployeeTitle(undefined, " Технолог "), "Технолог");
  assert.equal(getRowEmployeeTitle(null, null), "");
  assert.equal(getRowEmployeeTitle(undefined), "");
});
