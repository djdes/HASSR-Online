import assert from "node:assert/strict";
import test from "node:test";

import { approverFor, checkApproval, discountLimitFor, pickAssignee, type StaffPerson } from "./staff";

const person = (id: string, overrides: Partial<StaffPerson> = {}): StaffPerson => ({
  id,
  name: id,
  email: `${id}@wesetup.ru`,
  telegramChatId: null,
  isRoot: false,
  salesHead: false,
  roleKey: "sales_manager",
  limit: 10,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
});

const owner = person("owner", { isRoot: true, roleKey: null, limit: 90 });
const director = person("director", { roleKey: "commercial_director", limit: 25, salesHead: true });
const rop = person("rop", { roleKey: "sales_head", limit: 15, salesHead: true });
const alexey = person("alexey");
const staff = [owner, director, rop, alexey];

test("лимит роли: свой — если задан, иначе по ключу встроенной роли", () => {
  assert.equal(discountLimitFor({ isRoot: true, roleKey: null, roleLimit: null }), 90);
  assert.equal(discountLimitFor({ isRoot: false, roleKey: "commercial_director", roleLimit: null }), 25);
  assert.equal(discountLimitFor({ isRoot: false, roleKey: "sales_head", roleLimit: null }), 15);
  assert.equal(discountLimitFor({ isRoot: false, roleKey: "sales_manager", roleLimit: null }), 10);
  assert.equal(discountLimitFor({ isRoot: false, roleKey: "sales_manager", roleLimit: 12 }), 12);
  assert.equal(discountLimitFor({ isRoot: false, roleKey: "support", roleLimit: null }), 0);
  assert.equal(discountLimitFor({ isRoot: false, roleKey: null, roleLimit: 500 }), 90);
});

test("ответственный: закреплённый → по умолчанию → РОП; чужих и уволенных пропускаем", () => {
  assert.equal(pickAssignee(staff, ["alexey", "rop"]), "alexey");
  assert.equal(pickAssignee(staff, ["client-user", "rop"]), "rop");
  assert.equal(pickAssignee(staff, [null, null]), "director");
  assert.equal(pickAssignee([owner, alexey], [null]), null);
});

test("кто согласует: не просящий, лимит покрывает; назначенный — первым, владелец — последним", () => {
  assert.equal(approverFor(staff, 20, "alexey")?.id, "director");
  assert.equal(approverFor(staff, 20, "alexey", "rop")?.id, "director"); // у РОП лимит 15 — не может
  assert.equal(approverFor(staff, 15, "alexey", "rop")?.id, "rop");
  assert.equal(approverFor(staff, 30, "alexey")?.id, "owner");
  assert.equal(approverFor(staff, 20, "director")?.id, "owner");
  assert.equal(approverFor([alexey], 20, "alexey"), null);
});

test("решение по скидке: свою — нельзя, больше запрошенного — нельзя, сверх лимита — нельзя", () => {
  const base = { actorId: "rop", actorLimit: 15, requestedById: "alexey", requestedPercent: 15, percent: 15, approve: true };
  assert.equal(checkApproval(base), null);
  assert.match(checkApproval({ ...base, actorId: "alexey" }) ?? "", /Свою заявку/);
  assert.match(checkApproval({ ...base, percent: 20 }) ?? "", /Запрошено 15 %/);
  assert.match(checkApproval({ ...base, requestedPercent: 20, percent: 20 }) ?? "", /лимит скидки — 15 %/);
  assert.equal(checkApproval({ ...base, actorId: "owner", actorLimit: 90, requestedPercent: 30, percent: 30 }), null);
  assert.equal(checkApproval({ ...base, percent: 25, requestedPercent: 30, approve: false }), null);
});
