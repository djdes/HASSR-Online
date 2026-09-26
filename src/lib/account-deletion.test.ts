import assert from "node:assert/strict";
import test from "node:test";

import {
  ACCOUNT_DELETE_CONFIRM_WORD,
  anonymizedUserData,
  isAccountDeleteConfirmed,
  isOrganizationOwner,
  planAccountDeletion,
} from "@/lib/account-deletion";

const employee = {
  isRoot: false,
  isOwnerOfOrganization: false,
  isManagement: false,
  otherManagersCount: 0,
  isDemoOrganization: false,
};

test("сотрудник обезличивается, владелец идёт в удаление компании, ROOT — нельзя", () => {
  assert.deepEqual(planAccountDeletion(employee), { kind: "anonymize" });
  assert.deepEqual(
    planAccountDeletion({ ...employee, isManagement: true, isOwnerOfOrganization: true, otherManagersCount: 3 }),
    { kind: "organization", href: "/settings/organization#delete" },
  );
  const root = planAccountDeletion({ ...employee, isRoot: true });
  assert.equal(root.kind, "forbidden");
});

test("последний руководитель без владельца не оставляет компанию без руководства", () => {
  assert.deepEqual(
    planAccountDeletion({ ...employee, isManagement: true, otherManagersCount: 0 }),
    { kind: "organization", href: "/settings/organization#delete" },
  );
  // Есть ещё руководитель — обычное обезличивание.
  assert.deepEqual(
    planAccountDeletion({ ...employee, isManagement: true, otherManagersCount: 1 }),
    { kind: "anonymize" },
  );
});

test("демо-кабинет владельца не удаляется через аккаунт", () => {
  const plan = planAccountDeletion({
    ...employee,
    isManagement: true,
    isOwnerOfOrganization: true,
    isDemoOrganization: true,
  });
  assert.equal(plan.kind, "forbidden");
  // Сотрудник демо-кабинета удаляется как обычно.
  assert.deepEqual(planAccountDeletion({ ...employee, isDemoOrganization: true }), { kind: "anonymize" });
});

test("обезличенные данные не содержат личного и не дают войти", () => {
  const now = new Date("2026-09-26T10:00:00Z");
  const data = anonymizedUserData("user123", now);
  // Имя остаётся: журналы СанПиН и ХАССП хранят автора записи, и компания
  // обязана показывать его проверяющему. Стираются контакты и вход.
  assert.equal("name" in data, false);
  assert.equal(data.email, "deleted-user123@deleted.wesetup.local");
  assert.equal(data.contactEmail, null);
  assert.equal(data.phone, null);
  assert.equal(data.telegramChatId, null);
  assert.equal(data.qrPinHash, null);
  assert.equal(data.qrPinEncrypted, null);
  assert.equal(data.calendarToken, null);
  assert.equal(data.registrationIp, null);
  assert.equal(data.lastLoginIp, null);
  assert.equal(data.kioskPhotoConsentAt, null);
  assert.equal(data.emailVerifiedAt, null);
  assert.equal(data.twoFactorTelegram, false);
  assert.equal(data.isActive, false);
  assert.equal(data.archivedAt, now);
  // Случайный «хэш» — не bcrypt: ни один пароль к нему не подойдёт.
  assert.ok(data.passwordHash.length >= 32);
  assert.notEqual(anonymizedUserData("user123", now).passwordHash, data.passwordHash);
});

test("подтверждение — только слово УДАЛИТЬ", () => {
  assert.equal(ACCOUNT_DELETE_CONFIRM_WORD, "УДАЛИТЬ");
  assert.equal(isAccountDeleteConfirmed({ confirm: "УДАЛИТЬ" }), true);
  assert.equal(isAccountDeleteConfirmed({ confirm: " удалить " }), true);
  assert.equal(isAccountDeleteConfirmed({ confirm: "удали" }), false);
  assert.equal(isAccountDeleteConfirmed({}), false);
  assert.equal(isAccountDeleteConfirmed(null), false);
  assert.equal(isAccountDeleteConfirmed("УДАЛИТЬ"), false);
});

test("владелец — аккаунт-подписка, членство owner или legacy-роль owner", () => {
  assert.equal(isOrganizationOwner({ role: "manager", ownsAccount: true, hasOwnerMembership: false }), true);
  assert.equal(isOrganizationOwner({ role: "manager", ownsAccount: false, hasOwnerMembership: true }), true);
  // В старых компаниях владелец — это просто роль "owner" без Account.
  assert.equal(isOrganizationOwner({ role: "owner", ownsAccount: false, hasOwnerMembership: false }), true);
  assert.equal(isOrganizationOwner({ role: "manager", ownsAccount: false, hasOwnerMembership: false }), false);
  assert.equal(isOrganizationOwner({ role: "cook", ownsAccount: false, hasOwnerMembership: false }), false);
});
