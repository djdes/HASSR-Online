import assert from "node:assert/strict";
import test from "node:test";
import { SANITATION_MONTHS } from "@/lib/sanitation-day-document";
import {
  sanitationMonthShortLabel,
  sanitationRoleDisplayTitle,
} from "@/lib/sanitation-day-presentation";

test("sanitation month labels follow the selected locale without changing month keys", () => {
  const monthKeys = SANITATION_MONTHS.map(({ key }) => key);
  const english = SANITATION_MONTHS.map((_, index) => sanitationMonthShortLabel(index, "en"));
  const uzbek = SANITATION_MONTHS.map((_, index) => sanitationMonthShortLabel(index, "uz"));

  assert.equal(english.length, 12);
  assert.equal(uzbek.length, 12);
  assert.equal(english.some((label) => /[А-Яа-яЁё]/u.test(label)), false);
  assert.equal(uzbek.some((label) => /[А-Яа-яЁё]/u.test(label)), false);
  assert.deepEqual(monthKeys, [
    "jan", "feb", "mar", "apr", "may", "jun",
    "jul", "aug", "sep", "oct", "nov", "dec",
  ]);
});

test("only the exact default manager title is localized for display", () => {
  assert.equal(sanitationRoleDisplayTitle("Управляющий", "Manager"), "Manager");
  assert.equal(sanitationRoleDisplayTitle("Старший смены", "Manager"), "Старший смены");
  assert.equal(sanitationRoleDisplayTitle("Manager", "Manager"), "Manager");
});
