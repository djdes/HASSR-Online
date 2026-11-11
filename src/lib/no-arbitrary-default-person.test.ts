import assert from "node:assert/strict";
import test from "node:test";

import { defaultCleaningDocumentConfig, getDefaultCleaningResponsibleIds } from "@/lib/cleaning-document";
import { buildProductWriteoffConfigFromData } from "@/lib/product-writeoff-document";
import { pickPrimaryManager, pickPrimaryStaff } from "@/lib/user-roles";

// Тикет 57187T: по умолчанию в журнал не встаёт «первый по списку» рядовой
// сотрудник — только руководство, иначе поле остаётся пустым.
const abd = { id: "abd", name: "Абдулкадирова Индира", role: "cook" };
const boris = { id: "boris", name: "Борисов Пётр", role: "waiter" };
const chief = { id: "chief", name: "Яковлева Ольга", role: "manager" };

test("pickPrimaryManager / pickPrimaryStaff: нет подходящей роли — никого", () => {
  assert.equal(pickPrimaryManager([abd, boris]), null);
  assert.equal(pickPrimaryManager([abd, boris, chief])?.id, "chief");
  assert.equal(pickPrimaryStaff([{ id: "x", name: "Икс", role: "unknown-role" }]), null);
  assert.equal(pickPrimaryStaff([{ id: "x", name: "Икс", role: "unknown-role" }], { fallbackToFirst: true })?.id, "x");
});

test("уборка: исполнителя не угадываем, контроль — только руководство", () => {
  assert.deepEqual(getDefaultCleaningResponsibleIds([abd, boris]), {
    responsibleCleaningUserId: null,
    responsibleControlUserId: null,
  });
  assert.deepEqual(getDefaultCleaningResponsibleIds([abd, boris, chief]), {
    responsibleCleaningUserId: null,
    responsibleControlUserId: "chief",
  });
  const config = defaultCleaningDocumentConfig([abd, boris]);
  assert.deepEqual(config.cleaningResponsibles.map((item) => item.userId), [""]);
  assert.deepEqual(config.controlResponsibles.map((item) => item.userId), [""]);
  const withChief = defaultCleaningDocumentConfig([abd, boris, chief]);
  assert.deepEqual(withChief.cleaningResponsibles.map((item) => item.userId), [""]);
  assert.deepEqual(withChief.controlResponsibles.map((item) => item.userId), ["chief"]);
});

test("акт забраковки: комиссия по умолчанию — руководство, а не первые двое по списку", () => {
  const build = (users: Array<{ id: string; name: string; role: string }>) =>
    buildProductWriteoffConfigFromData({ users, products: [], batches: [] }).commissionMembers;
  assert.equal(build([abd, boris]).length, 0);
  const members = build([abd, boris, chief]);
  assert.equal(members.length, 1);
  assert.match(JSON.stringify(members[0]), /Яковлева Ольга/);
});
