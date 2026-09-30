import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultInviteOrganization,
  groupAccessCandidates,
  isRecommendedForCabinet,
  normalizeCabinetInvite,
  type AccessCandidate,
} from "@/lib/master-cabinet-access-view";

test("рекомендуем руководство и технологов", () => {
  assert.equal(isRecommendedForCabinet("technologist", null), true);
  assert.equal(isRecommendedForCabinet("head_chef", null), true);
  assert.equal(isRecommendedForCabinet("cook", "management"), true);
  assert.equal(isRecommendedForCabinet("cook", "staff"), false);
  assert.equal(isRecommendedForCabinet(null, null), false);
});

const people: AccessCandidate[] = [
  { id: "1", name: "Яковлева Ольга", organizationName: "Школа №1", title: "Повар", recommended: false },
  { id: "2", name: "Андреева Мария", organizationName: "Сад №3", title: "Технолог", recommended: true },
  { id: "3", name: "Борисов Иван", organizationName: "Школа №1", title: "Заведующий производством", recommended: true },
  { id: "4", name: "Власова Анна", organizationName: "Сад №3", title: "Повар", recommended: false },
];

test("группы: рекомендуемые сверху, по алфавиту, без тех, у кого доступ есть", () => {
  const { recommended, other } = groupAccessCandidates(people, ["3"], "");
  assert.deepEqual(recommended.map((p) => p.id), ["2"]);
  assert.deepEqual(other.map((p) => p.id), ["4", "1"]);
});

test("поиск по имени, объекту и должности, без учёта регистра и лишних пробелов", () => {
  assert.deepEqual(groupAccessCandidates(people, [], "  сад   №3 ").other.map((p) => p.id), ["4"]);
  assert.deepEqual(groupAccessCandidates(people, [], "ТЕХНОЛОГ").recommended.map((p) => p.id), ["2"]);
  const none = groupAccessCandidates(people, [], "никого");
  assert.equal(none.recommended.length + none.other.length, 0);
});

test("организация приглашения по умолчанию — подключённая к кабинету", () => {
  const orgs = [
    { id: "cafe", name: "Кафе", code: null },
    { id: "kg", name: "Сад №3", code: "KGKGK-00000" },
    { id: "kg2", name: "Сад №5", code: "KGKGK-00000" },
  ];
  assert.equal(defaultInviteOrganization(orgs, "KGKGK-00000"), "kg");
  assert.equal(defaultInviteOrganization(orgs, "OTHER-00000"), "cafe");
  assert.equal(defaultInviteOrganization(orgs, null), "cafe");
  assert.equal(defaultInviteOrganization([], "KGKGK-00000"), "");
});

test("приглашение: ФИО и email приводятся к виду, неверное — понятная ошибка", () => {
  assert.deepEqual(normalizeCabinetInvite("  Иванова   Мария ", " Maria@School.RU "), {
    ok: true,
    name: "Иванова Мария",
    email: "maria@school.ru",
  });
  assert.deepEqual(normalizeCabinetInvite("И", "a@b.ru"), { ok: false, error: "Укажите ФИО — от 2 до 120 символов" });
  assert.deepEqual(normalizeCabinetInvite("Иванова Мария", "не почта"), { ok: false, error: "Введите корректный email" });
  assert.deepEqual(normalizeCabinetInvite(undefined, undefined), { ok: false, error: "Укажите ФИО — от 2 до 120 символов" });
});
