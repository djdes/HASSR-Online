import test from "node:test";
import assert from "node:assert/strict";
import { IDEA_STATUSES } from "@/lib/ideas/rules";
import { formatIdeaDate, ideaErrorKey, ideaStatusKey } from "./idea-presentation";

test("only the five canonical statuses map to copy, prototype and custom values remain unknown", () => {
  assert.deepEqual(IDEA_STATUSES.map(ideaStatusKey), ["statusNew", "statusPlanned", "statusInProgress", "statusDone", "statusDeclined"]);
  for (const raw of ["constructor", "__proto__", "toString", "Новая", "", "custom"]) assert.equal(ideaStatusKey(raw), undefined);
});

test("failed API messages have a conservative own-key adapter", () => {
  assert.deepEqual(["Неизвестный статус", "Некорректный комментарий", "Нечего менять", "Идея не найдена"].map(ideaErrorKey), ["unknownStatus", "invalidNote", "noChanges", "notFound"]);
  for (const raw of ["constructor", "__proto__", "PRIVATE", null, undefined, 7, {}, ["Нечего менять"]]) assert.equal(ideaErrorKey(raw), "saveFailed");
});

test("dates preserve native Russian and British English, including invalid values", () => {
  for (const value of ["2026-10-16T00:30:01Z", "2024-02-29T23:30:00Z", "0099-01-01T00:00:00Z", "invalid", ""]) {
    assert.equal(formatIdeaDate(value, "ru"), new Date(value).toLocaleDateString("ru-RU"));
    assert.equal(formatIdeaDate(value, "en"), new Date(value).toLocaleDateString("en-GB"));
    assert.equal(formatIdeaDate(value, "uz"), new Date(value).toLocaleDateString("uz-Latn-UZ"));
  }
});
