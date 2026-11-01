import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { evaluatePointScopeRequest } from "@/lib/point-scope";

/**
 * Общие разделы компании и сессия (аудит изоляции 2026-11-01, вторая волна).
 * Proxy закрывает руководителю точки только изменения общих разделов, поэтому
 * чтение на всю компанию закрывают сами маршруты; тест держит проверки на месте.
 */
const read = (path: string) => readFileSync(path, "utf8");

const COMPANY_READS: Array<[string, RegExp]> = [
  ["src/app/api/settings/organization/export/route.ts", /isPointScoped\(auth\.session\.user\)/],
  ["src/app/api/settings/rpn-appendix/route.ts", /isPointScoped\(auth\.session\.user\)/],
  ["src/app/api/settings/external-token/route.ts", /isPointScoped\(session\.user\)/],
  ["src/app/api/organizations/permissions/route.ts", /isPointScoped\(session\.user\)/],
  ["src/app/api/staff/control-group/route.ts", /isPointScoped\(session\.user\)/],
  ["src/app/api/settings/subscription/transition/route.ts", /isPointScoped\(session\.user\)/],
  ["src/app/api/settings/master-cabinet/route.ts", /isPointScoped\(session\.user\)/],
  ["src/app/api/settings/badge/route.ts", /isPointScoped\(session\.user\)/],
  ["src/app/api/settings/webhooks/subscriptions/route.ts", /isPointScoped\(session\.user\)/],
  ["src/app/api/settings/webhooks/route.ts", /isPointScoped\(auth\.session\.user\)/],
  ["src/app/api/settings/journals/[code]/distribution/route.ts", /isPointScoped\(session\.user\)/],
  ["src/app/api/settings/journals/[code]/bonus/route.ts", /isPointScoped\(auth\.session\.user\)/],
  ["src/app/api/settings/journal-controls/route.ts", /isPointScoped\(auth\.session\.user\) && \(body\.data\.automation \|\| body\.data\.camera\)/],
  ["src/app/api/profile/complete/route.ts", /isPointScoped\(session\.user\)/],
];

test("чтение и запись общих разделов компании закрыты руководителю точки в самих маршрутах", () => {
  for (const [path, pattern] of COMPANY_READS) {
    const source = read(path);
    assert.match(source, pattern, `${path}: нет проверки руководителя точки`);
    assert.match(source, /COMPANY_ONLY_API_ERROR|Анкету компании заполняет руководство компании/, `${path}: нет отказа`);
  }
});

test("бейдж компании — в общих API: proxy закрывает руководителю точки его изменения", () => {
  const verdict = evaluatePointScopeRequest({ method: "PATCH", pathname: "/api/settings/badge", pointScope: ["a"] });
  assert.equal(verdict.action, "deny");
  assert.equal(evaluatePointScopeRequest({ method: "PATCH", pathname: "/api/settings/badge", pointScope: null }).action, "allow");
});

test("клиент не вписывает в токен активную организацию и доступ партнёра через update()", () => {
  const auth = read("src/lib/auth.ts");
  assert.doesNotMatch(auth, /"activeOrganizationId" in session/);
  assert.doesNotMatch(auth, /"partnerAccess" in session/);
  // ROOT по-прежнему переключает «войти как» (и только ROOT).
  assert.match(auth, /"actingAsOrganizationId" in session && token\.isRoot/);
});

test("сервер сверяет запреты руководителя точки по свежим точкам сессии", () => {
  const source = read("src/lib/server-session.ts");
  assert.match(source, /enforcePointScopeGuard\(await enforcePartnerWriteGuard\(resolved\)\)/);
  assert.match(source, /evaluatePointScopeRequest\(\{ method, pathname, pointScope: session\.user\.pointScope \}\)/);
});

test("партнёр «только просмотр» не меняет реквизиты клиента", () => {
  assert.match(read("src/app/api/partner/clients/[orgId]/route.ts"), /link\.accessLevel !== "edit"/);
});

test("ключ внешнего API — не партнёру и не руководителю точки, страница не показывает его партнёру", () => {
  assert.match(read("src/app/api/settings/external-token/route.ts"), /session\.user\.partnerAccess/);
  assert.match(read("src/app/(dashboard)/settings/api/page.tsx"), /session\.user\.partnerAccess \?/);
});

test("руководителю точки «Настройка журналов» не отдаёт людей компании и кнопку «Кто»", () => {
  const page = read("src/app/(dashboard)/settings/journals/page.tsx");
  assert.match(page, /const canEditDistribution = !isPointScoped\(session\.user\)/);
  assert.match(page, /canEditDistribution\s*\?\s*db\.user\.findMany/);
  assert.match(read("src/app/(dashboard)/settings/journals/journals-settings-client.tsx"), /\{canEditDistribution \? \(/);
});
