import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

/*
 * «Пришла проверка» (S4, 2026-10-18): блоки страницы `/inspection` стали
 * пунктами меню раздела. Блоки не должны ни потеряться, ни задвоиться, права —
 * остаться прежними, а старая ссылка `/inspection#special-mode` из «Реквизитов» —
 * вести к спецрежиму.
 */

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const page = (route: string) => read(`src/app/(dashboard)/inspection${route}/page.tsx`);

test("«Что делать сейчас»: инструкция, QR и архив здесь, остальные блоки — коротко со ссылкой", () => {
  const now = page("");
  for (const kept of ["<InspectionGuide", "<InspectionQr", "<ComplianceBundleCard"]) {
    assert.ok(now.includes(kept), `${kept} пропал с «Что делать сейчас»`);
  }
  // Блоки, ставшие страницами, целиком не повторяются.
  for (const moved of ["<InspectionVisitsCard", "<InspectionNormsCard", "<InspectionExpertsCard", "<InspectionSpecialModeCard"]) {
    assert.ok(!now.includes(moved), `${moved} остался на «Что делать сейчас»`);
  }
  for (const href of ['"/inspection/visits"', '"/inspection/special-mode"', '"/inspection/norms"', '"/inspection/experts"', '"/dashboard/compliance-audit"']) {
    assert.ok(now.includes(href), `нет ссылки ${href}`);
  }
  // Короткие сводки: счётчик посещений, статус спецрежима, балл готовности.
  assert.match(now, /db\.inspectionVisit\.count\(\{ where: \{ organizationId, hiddenAt: null \} \}\)/);
  assert.ok(now.includes("<InspectionSpecialModeStatus"));
  assert.ok(now.includes('t("readinessScore"'));
});

test("якорь #special-mode остаётся на «Что делать сейчас» — ссылка из «Реквизитов» не ломается", () => {
  assert.ok(read("src/components/settings/organization-special-mode-card.tsx").includes('href="/inspection#special-mode"'));
  assert.match(page(""), /<Step id="special-mode"/);
  assert.match(read("src/components/inspection/inspection-guide.tsx"), /\{ n: 5, href: "\/inspection\/special-mode" \}/);
  assert.match(read("src/components/inspection/inspection-guide.tsx"), /\{ n: 3, href: "\/inspection\/visits" \}/);
});

test("права страниц — как у блоков на прежней странице", () => {
  // Отказ — объяснённая панель внутри кабинета (`forbidden()`), а не тихий уход.
  const both = /if \(!hasFullWorkspaceAccess\(session\.user\) && !hasCapability\(session\.user, "tasks\.verify"\)\) forbidden\(\);/;
  for (const route of ["/visits", "/norms", "/special-mode"]) assert.match(page(route), both, route);
  assert.match(page(""), /if \(!fullAccess && !hasCapability\(session\.user, "tasks\.verify"\)\) forbidden\(\);/);
  // Услуги — руководству, как карточка экспертов раньше.
  assert.match(page("/experts"), /if \(!hasFullWorkspaceAccess\(session\.user\)\) forbidden\(\);/);
  // Скрывать посещения и переключать спецрежим — только admin.full; спецрежим —
  // на всю компанию, руководителю точки — нет (аудит 2026-11-01).
  assert.match(page("/visits"), /canHide=\{hasCapability\(session\.user, "admin\.full"\)\}/);
  assert.match(page("/special-mode"), /canManage=\{hasCapability\(session\.user, "admin\.full"\) && !isPointScoped\(session\.user\)\}/);
});

test("«Нормативка» открывает файлы напрямую, без перехода в меню ППК", () => {
  const card = read("src/components/inspection/inspection-norms-card.tsx");
  const hrefs = [...card.matchAll(/(pdf|file): "([^"]+)"/g)].map((match) => match[2]);
  assert.equal(hrefs.length, 4);
  for (const href of hrefs) assert.ok(href.startsWith("/api/production-control/"), href);
  assert.ok(!/href="\/production-control/.test(card));
  assert.match(card, /href=\{doc\.file\} target="_blank"/);
});

test("«Подготовка с экспертом и выезд»: услуги каталога со ссылкой на заказ", () => {
  const card = read("src/components/inspection/inspection-experts-card.tsx");
  assert.match(card, /key: "pre-inspection-audit"/);
  assert.match(card, /key: "site-visit"/);
  assert.match(card, /href=\{`\/settings\/services\?order=\$\{key\}`\}/);
  // Пустое состояние, если услуги выключены в каталоге.
  assert.ok(page("/experts").includes("data-experts-empty"));
});

test("спецрежим наоборот: включение — окно с галочками, выключение — подтверждение с перечнем (AC3.3)", () => {
  const card = read("src/components/inspection/inspection-special-mode-card.tsx");
  assert.ok(card.includes("<Dialog open={dialog !== null}"), "включение открывает окно");
  assert.ok(card.includes("AUTOMATION_FEATURES.map"), "галочки по всем частям автоматики");
  assert.ok(card.includes("<ConfirmDialog"), "выключение — ConfirmDialog");
  assert.match(card, /variant="warn"/);
  assert.ok(card.includes("save({ ...automation, enabled: false })"), "выключение не стирает выбор");
  assert.ok(!card.includes("window.confirm"));
});
