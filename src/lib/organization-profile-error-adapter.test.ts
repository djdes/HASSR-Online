import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mapOrganizationDeletionApiError,
  mapOrganizationProfileApiError,
} from "@/lib/organization-profile-error-adapter";

test("organization profile adapters translate only known legacy API errors", () => {
  assert.deepEqual(mapOrganizationProfileApiError("Название обязательно"), ["nameRequired"]);
  assert.deepEqual(
    mapOrganizationProfileApiError("Телефон в неправильном формате; Email бухгалтера в неправильном формате"),
    ["invalidPhone", "invalidEmail"],
  );
  assert.equal(mapOrganizationProfileApiError("unknown server detail"), null);
  assert.equal(mapOrganizationProfileApiError({ message: "error" }), null);
});

test("deletion adapter preserves existing endpoint compatibility without showing unknown text", () => {
  assert.equal(mapOrganizationDeletionApiError("Удаление уже запланировано"), "alreadyRequested");
  assert.equal(mapOrganizationDeletionApiError("Введите название организации точно как в настройках"), "confirmNameExactly");
  assert.equal(mapOrganizationDeletionApiError("custom server text"), null);
});

test("ошибки КПП и ОГРН переводятся в ключи формы", () => {
  assert.deepEqual(
    mapOrganizationProfileApiError("КПП — 9 знаков, например 770101001; ОГРН — 13 цифр, ОГРНИП — 15 цифр"),
    ["invalidKpp", "invalidOgrn"],
  );
});
