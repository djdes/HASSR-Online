import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { SECTION_JUMPS, SECTION_JUMP_KINDS } from "./section-jumps";

const fromSrc = (path: string) => new URL(`../${path}`, import.meta.url);

test("каждая ссылка «в раздел» ведёт на существующую страницу кабинета", () => {
  for (const kind of SECTION_JUMP_KINDS) {
    const href = SECTION_JUMPS[kind];
    assert.match(href, /^\/settings\/[a-z-]+$/, kind);
    assert.ok(existsSync(fromSrc(`app/(dashboard)${href}/page.tsx`)), `${kind}: нет страницы ${href}`);
  }
});

test("подписи ссылок «в раздел» — на трёх языках, по одной на каждый вид", () => {
  for (const locale of ["ru", "en", "uz"]) {
    const messages = JSON.parse(readFileSync(fromSrc(`i18n/messages/${locale}.json`), "utf8")) as {
      sharedUi: { sectionJump: Record<string, string> };
    };
    assert.deepEqual(Object.keys(messages.sharedUi.sectionJump).sort(), [...SECTION_JUMP_KINDS].sort(), locale);
    for (const kind of SECTION_JUMP_KINDS) assert.ok(messages.sharedUi.sectionJump[kind].trim(), `${locale}: ${kind}`);
    if (locale !== "ru") assert.doesNotMatch(Object.values(messages.sharedUi.sectionJump).join(" "), /\p{Script=Cyrillic}/u, locale);
  }
});

test("пустые списки выбора ведут в раздел: общие списки, окна и страницы настроек", () => {
  // Где ссылка обязана стоять: место → вид справочника.
  const places: Array<[string, string]> = [
    ["components/shared/multi-user-picker.tsx", "staff"],
    ["components/shared/staff-picker.tsx", "staff"],
    ["components/charts/temperature-chart.tsx", "equipment"],
    ["components/settings/equipment-dialog.tsx", "buildings"],
    ["components/cleaning/room-directory-picker-dialog.tsx", "buildings"],
    ["components/journals/org-directory-dialog.tsx", "products"],
    ["components/journals/brakerage-setup-prompt.tsx", "staff"],
    ["components/production-control/ack-summary.tsx", "staff"],
    ["components/settings/position-staff-visibility-client.tsx", "staff"],
    ["components/settings/staff-hierarchy-client.tsx", "staff"],
    ["components/settings/schedule-editor.tsx", "staff"],
    ["components/settings/permissions-editor.tsx", "positions"],
    ["components/settings/journal-responsibles-client.tsx", "staff"],
    ["app/(dashboard)/settings/journals/journals-settings-client.tsx", "positions"],
    ["app/(dashboard)/settings/integrations/tasksflow/tasksflow-settings-client.tsx", "staff"],
    ["app/(dashboard)/settings/areas/page.tsx", "buildings"],
    ["app/(dashboard)/settings/workload-balance/page.tsx", "staff"],
    ["app/(dashboard)/competencies/page.tsx", "staff"],
  ];
  for (const [path, kind] of places) {
    const source = readFileSync(fromSrc(path), "utf8");
    assert.ok(source.includes(`<SectionJump to="${kind}"`), `${path}: нет ссылки в раздел «${kind}»`);
  }
  // Адрес раздела сырым текстом в подсказке больше не показываем.
  for (const locale of ["ru", "en", "uz"]) {
    const raw = readFileSync(fromSrc(`i18n/messages/${locale}.json`), "utf8");
    assert.ok(!/"slotNoEmployeesHint": "[^"]*\/settings\//.test(raw), locale);
  }
});
