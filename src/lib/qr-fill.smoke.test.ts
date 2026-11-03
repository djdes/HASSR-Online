import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * Гварды QR-ввода без входа: оба публичных маршрута записи ограничены
 * лимитером, пишут журнал действий и отвечают 409, когда писать некуда.
 * Юнит-тесты токена и слияния замеров этого не поймают: поломка, которая
 * случается, — новый маршрут без лимита или удалённый вызов аудита.
 */

const ROUTES = [
  "src/app/api/room-fill/[roomId]/route.ts",
  "src/app/api/equipment-fill/[equipmentId]/route.ts",
];

for (const relative of ROUTES) {
  test(`QR-маршрут защищён и аудируется: ${relative}`, () => {
    const source = fs.readFileSync(path.join(process.cwd(), relative), "utf8");
    assert.match(source, /qrFillRateLimiter\.consume\(/, "нет лимитера");
    assert.match(source, /recordQrFillAudit\(/, "нет записи в журнал действий");
    assert.match(source, /no-active-document/, "нет ответа 409 без активного документа");
    assert.match(source, /ORG_ROSTER_WHERE/, "сотрудник не проверяется по ростеру организации");
  });
}

test("аудит QR-замера пишет действие journal.qr_fill", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src/lib/qr-fill-audit.ts"), "utf8");
  assert.match(source, /recordAuditLog\(/);
  assert.match(source, /"journal\.qr_fill"/);
});

test("публичные страницы QR закрыты от индексации и баннера cookies", () => {
  const robots = fs.readFileSync(path.join(process.cwd(), "src/lib/robots-txt.ts"), "utf8");
  const cookies = fs.readFileSync(path.join(process.cwd(), "src/components/public/cookie-consent.tsx"), "utf8");
  for (const route of ["/room-fill", "/equipment-fill"]) {
    assert.ok(robots.includes(`"${route}"`), `robots-txt.ts без ${route}`);
    assert.ok(cookies.includes(`"${route}"`), `cookie-consent без ${route}`);
  }
});
