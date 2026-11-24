import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Пилюля места работы в списке сотрудников (владелец, 2026-11-23: «с указанием,
 * какой к какому объекту привязан»). Сотрудник без закрепления работает на всех
 * объектах — пилюля так и называется, как то же состояние в окне правки
 * («Где работает» → «Все объекты»), и не красится как предупреждение
 * (проверка 2026-11-24, AC8).
 */
test("пилюля сотрудника без закрепления — «Все объекты», как в окне правки, во всех языках", () => {
  for (const locale of ["ru", "en", "uz"]) {
    const messages = JSON.parse(readFileSync(`src/i18n/messages/${locale}.json`, "utf8"));
    const staff = messages.staffManagement;
    assert.equal(staff.page.placeNone, staff.buildings.all, locale);
  }
});

test("пилюля «Все объекты» — нейтральная, без янтарного цвета предупреждения", () => {
  const source = readFileSync("src/components/staff/staff-page-client.tsx", "utf8");
  const pill = source.slice(source.indexOf("data-staff-place={e.id}"), source.indexOf("<MapPin", source.indexOf("data-staff-place={e.id}")));
  assert.ok(pill.length > 0);
  assert.doesNotMatch(pill, /#fff8eb|#a16d32/);
});
