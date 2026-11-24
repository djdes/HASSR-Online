import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { DIRECTORY_ORGANIZATION_KIND, planOfficeOpening, type OfficeOpeningInput } from "@/lib/organization-office";

const base = (patch: Partial<OfficeOpeningInput> = {}): OfficeOpeningInput => ({
  organizationId: "org",
  kind: "regular",
  perLocationJournals: false,
  buildings: [{ id: "p1", kind: "point", name: "Кафе", sortOrder: 0 }],
  platformOrganizationId: "platform",
  ...patch,
});

test("объект есть, офиса нет — открыть: создать офис первым и включить журналы по объектам", () => {
  assert.deepEqual(planOfficeOpening(base()), {
    createOffice: true,
    enableSplit: true,
    officeId: null,
    officeName: "Офис",
    sortOrder: -1,
  });
});

test("офис открыт — ничего; офис есть, а журналы общие — только включить", () => {
  const office = { id: "o", kind: "office", name: "Офис", sortOrder: -1 };
  const point = { id: "p1", kind: "point", name: "Кафе", sortOrder: 0 };
  assert.equal(planOfficeOpening(base({ perLocationJournals: true, buildings: [office, point] })), null);
  assert.deepEqual(planOfficeOpening(base({ buildings: [office, point] })), {
    createOffice: false,
    enableSplit: true,
    officeId: "o",
    officeName: null,
    sortOrder: null,
  });
});

test("объектов нет — офис не открывается: он стал бы единственным зданием", () => {
  assert.equal(planOfficeOpening(base({ buildings: [] })), null);
  assert.equal(planOfficeOpening(base({ buildings: [{ id: "o", kind: "office", name: "Офис", sortOrder: 0 }] })), null);
});

test("служебные организации — без офиса: платформа и мастер-кабинет справочников", async () => {
  assert.equal(planOfficeOpening(base({ organizationId: "platform" })), null);
  assert.equal(planOfficeOpening(base({ kind: DIRECTORY_ORGANIZATION_KIND })), null);
  const { MASTER_ORG_KIND } = await import("@/lib/master-directory");
  assert.equal(DIRECTORY_ORGANIZATION_KIND, MASTER_ORG_KIND);
});

test("название офиса — первое свободное, место — перед всеми зданиями", () => {
  const taken = [
    { id: "a", kind: "point", name: "Офис", sortOrder: 3 },
    { id: "b", kind: "point", name: "Офис компании", sortOrder: 5 },
  ];
  assert.equal(planOfficeOpening(base({ buildings: taken }))?.officeName, "Офис организации");
  assert.equal(planOfficeOpening(base({ buildings: taken }))?.sortOrder, 2);
  const all = [...taken, { id: "c", kind: "point", name: "Офис организации", sortOrder: 7 }];
  assert.equal(planOfficeOpening(base({ buildings: all }))?.officeName, "Офис 2");
});

/** Все места, где в организации появляется объект: каждое открывает офис (AC4). */
test("каждое создание объекта открывает офис", () => {
  const SRC = path.join(process.cwd(), "src");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name) && !name.includes(".test.")) files.push(full);
    }
  };
  walk(SRC);
  const creators = files.filter((file) => /\b(?:db|tx)\.building\.create\(/.test(readFileSync(file, "utf8")));
  const relative = creators.map((file) => path.relative(process.cwd(), file)).sort();
  // Сам офис создаёт только открытие офиса.
  assert.deepEqual(relative, [
    "src/app/api/settings/buildings/route.ts",
    "src/app/api/settings/onboarding-template/route.ts",
    "src/lib/demo-organization.ts",
    "src/lib/directory-exchange/entities.server.ts",
    "src/lib/location-buildings.ts",
    "src/lib/organization-office.server.ts",
  ]);
  for (const file of creators) {
    if (file.endsWith("organization-office.server.ts")) continue;
    const source = readFileSync(file, "utf8");
    // Обмен справочниками — синхронизация между компаниями сети с отменой: структуру
    // компании-получателя (офис, журналы по объектам) он не меняет — отмена её не
    // вернула бы. Её офис откроет страница «Офис» или свой первый объект.
    if (file.endsWith(path.join("directory-exchange", "entities.server.ts"))) {
      assert.doesNotMatch(source, /openOrganizationOffice\(/, "обмен справочниками не открывает офис получателя");
      continue;
    }
    assert.match(source, /openOrganizationOffice\(/, path.relative(process.cwd(), file));
  }
});

test("выкладка: открыть офис организациям с объектами — подсчёт, затем открытие, после проверки сборки (AC5)", () => {
  const deploy = readFileSync(".github/workflows/deploy.yml", "utf8");
  const legacyGate = deploy.indexOf('if [ "${RUN_LEGACY_DATA_SEEDS:-0}" = "1" ]');
  const checked = deploy.indexOf("bash scripts/post-deploy-check.sh");
  const dryRun = deploy.indexOf("npx tsx prisma/seed-open-office-2026-11.ts --dry-run");
  const realRun = deploy.indexOf("npx tsx prisma/seed-open-office-2026-11.ts 2>&1");
  const complete = deploy.indexOf('echo "=== Deploy complete ==="');
  assert.ok(checked > 0 && dryRun > checked && dryRun < complete, "подсчёт — после проверки новой сборки");
  assert.ok(realRun > dryRun && realRun < complete, "открытие — сразу за подсчётом");
  assert.ok(legacyGate < checked, "не внутри блока legacy-досевов");
  assert.equal(deploy.split("seed-open-office-2026-11.ts").length - 1, 2, "ровно два запуска: подсчёт и открытие");
  assert.match(deploy.slice(dryRun - 200, realRun + 200), /\|\| echo "\[warn\]/, "сбой не роняет выкатку");
  const seed = readFileSync("prisma/seed-open-office-2026-11.ts", "utf8");
  assert.match(seed, /once:open-office:v1/);
  assert.match(seed, /dryRun: DRY_RUN/);
  // Лог Actions публичный: только итоги.
  assert.doesNotMatch(seed, /console\.log\([^)]*\b(id|name)\b/);
});

test("«Выделить офис» больше нет: ни кнопки, ни текстов, ни маршрута (AC3)", async () => {
  const page = readFileSync("src/app/(dashboard)/settings/organization/office/page.tsx", "utf8");
  assert.doesNotMatch(page, /OfficeCreateButton|officeSetupState|create\.title|disabled\.title/);
  assert.match(page, /openOrganizationOffice\(/, "страница открывает офис компании с объектами");
  const { existsSync } = await import("node:fs");
  assert.equal(existsSync("src/app/api/settings/office/route.ts"), false);
  assert.equal(existsSync("src/components/settings/office-create-button.tsx"), false);
  for (const locale of ["ru", "en", "uz"]) {
    const office = JSON.parse(readFileSync(`src/i18n/messages/${locale}.json`, "utf8")).settingsManagement.office;
    assert.equal(office.create, undefined, locale);
    assert.equal(office.disabled, undefined, locale);
  }
});

test("при офисе журналы по объектам не выключаются: тумблера нет, API отвечает 400 (AC8)", () => {
  const route = readFileSync("src/app/api/settings/buildings/route.ts", "utf8");
  const patch = route.slice(route.indexOf("export async function PATCH"));
  assert.match(patch, /!body\.perLocationJournals && \(await db\.building\.count\(\{ where: \{ organizationId: orgId, kind: OFFICE_BUILDING_KIND \} \}\)\)/);
  const page = readFileSync("src/app/(dashboard)/settings/buildings/page.tsx", "utf8");
  assert.match(page, /canSplitJournals=\{allBuildings\.length >= 2 && !allBuildings\.some\(isOfficeBuilding\)\}/);
});
