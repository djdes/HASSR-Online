import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { findInheritedBrand, type BrandOrgRow } from "./inherited-org-brand";

const T0 = new Date("2026-11-01T10:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const NOBODY = { logoUpload: false, logoUrl: false, brandColor: false };

function org(id: string, minutes: number, extra: Partial<BrandOrgRow> = {}): BrandOrgRow {
  return {
    id,
    name: id,
    accountId: "acc",
    createdAt: at(minutes),
    logoUrl: null,
    brandColor: null,
    logoFile: null,
    setByPerson: NOBODY,
    ...extra,
  };
}

/** Донор: логотип и цвет задал человек. */
const donor = org("cafe", 0, {
  logoUrl: "/api/org-assets/cafe/logo?v=1",
  brandColor: "#1f9d3a",
  logoFile: { hash: "H-cafe", version: 1, updatedAt: at(1) },
  setByPerson: { logoUpload: true, logoUrl: false, brandColor: true },
});

test("копия логотипа и цвет донора у организации «как текущая» — унаследованы", () => {
  const gym = org("gym", 60 * 24, {
    logoUrl: "/api/org-assets/gym/logo?v=1",
    brandColor: "#1F9D3A",
    logoFile: { hash: "H-cafe", version: 1, updatedAt: at(60 * 24) },
  });
  assert.deepEqual(findInheritedBrand([gym, donor]), [
    { organizationId: "gym", name: "gym", accountId: "acc", logo: "copied-file", brandColor: true },
  ]);
});

test("донор и организация без стиля не трогаются", () => {
  const bakery = org("bakery", 30);
  assert.deepEqual(findInheritedBrand([donor, bakery]), []);
});

test("тот же логотип, но загруженный человеком в этой организации, остаётся; цвет, заданный человеком, — тоже", () => {
  const canteen = org("canteen", 90, {
    logoUrl: "/api/org-assets/canteen/logo?v=2",
    brandColor: "#1f9d3a",
    logoFile: { hash: "H-cafe", version: 2, updatedAt: at(95) },
    setByPerson: { logoUpload: true, logoUrl: false, brandColor: true },
  });
  assert.deepEqual(findInheritedBrand([donor, canteen]), []);
});

test("адрес файла чужой организации (до 2026-11-01) — унаследован", () => {
  const shared = org("shared", 45, { logoUrl: "/api/org-assets/cafe/logo?v=1" });
  assert.deepEqual(findInheritedBrand([donor, shared]), [
    { organizationId: "shared", name: "shared", accountId: "acc", logo: "shared-file", brandColor: false },
  ]);
});

test("копия, сделанная при создании, хотя донор потом сменил логотип, — унаследована", () => {
  const changedDonor: BrandOrgRow = { ...donor, logoFile: { hash: "H-cafe-new", version: 3, updatedAt: at(500) } };
  const old = org("old", 120, {
    logoUrl: "/api/org-assets/old/logo?v=1",
    logoFile: { hash: "H-cafe", version: 1, updatedAt: at(120) },
  });
  assert.equal(findInheritedBrand([changedDonor, old])[0]?.logo, "copied-file");
});

test("свой файл без загрузки, не похожий на донора и не созданный вместе с организацией, — не трогаем", () => {
  const odd = org("odd", 120, {
    logoUrl: "/api/org-assets/odd/logo?v=2",
    logoFile: { hash: "H-other", version: 2, updatedAt: at(400) },
  });
  assert.deepEqual(findInheritedBrand([donor, odd]), []);
});

test("внешняя ссылка как у донора — унаследована, а заданная человеком — нет", () => {
  const linkDonor = org("cafe", 0, { logoUrl: "https://cdn.example.com/cafe.png", setByPerson: { ...NOBODY, logoUrl: true } });
  const copied = org("copy", 10, { logoUrl: "https://cdn.example.com/cafe.png" });
  const own = org("own", 20, { logoUrl: "https://cdn.example.com/cafe.png", setByPerson: { ...NOBODY, logoUrl: true } });
  assert.deepEqual(
    findInheritedBrand([linkDonor, copied, own]).map((fix) => [fix.organizationId, fix.logo]),
    [["copy", "copied-link"]],
  );
});

test("старшая организация аккаунта никогда не считается наследницей, разные аккаунты не сравниваются", () => {
  const youngerElsewhere = org("x", -60, { accountId: "other", brandColor: "#1f9d3a", logoUrl: "/api/org-assets/x/logo?v=1", logoFile: { hash: "H-cafe", version: 1, updatedAt: at(-60) } });
  const noAccount = org("solo", 5, { accountId: null, brandColor: "#1f9d3a" });
  assert.deepEqual(findInheritedBrand([donor, youngerElsewhere, noAccount]), []);
});

test("цепочка: копия копии наследует от самой старшей", () => {
  const second = org("second", 10, { brandColor: "#1f9d3a" });
  const third = org("third", 20, { brandColor: "#1f9d3a" });
  assert.deepEqual(
    findInheritedBrand([third, second, donor]).map((fix) => fix.organizationId),
    ["second", "third"],
  );
});

test("починка уже созданных организаций идёт сама на выкладке — один раз, без названий в логе", () => {
  const read = (file: string) => readFileSync(file, "utf8");
  const seed = read("prisma/seed-repair-inherited-org-brand-2026-11.ts");
  assert.match(seed, /"once:inherited-org-brand:v1"/);
  assert.match(seed, /findInheritedBrandInDb\(\)/);
  assert.match(seed, /removeInheritedBrand\(/);
  // Лог Actions публичный: в сиде нет названий организаций.
  assert.doesNotMatch(seed, /\.name\b/);
  // Тот же поиск и та же починка, что у ручного скрипта.
  const script = read("scripts/repair-inherited-org-brand.ts");
  assert.match(script, /findInheritedBrandInDb\(\)/);
  assert.match(script, /removeInheritedBrand\(/);

  const deploy = read(".github/workflows/deploy.yml");
  const step = deploy.indexOf("npx tsx prisma/seed-repair-inherited-org-brand-2026-11.ts");
  assert.ok(step > deploy.indexOf("prisma/seed-platform-roles-2026-11.ts"), "после сидов панели платформы");
  assert.ok(step < deploy.indexOf('if [ "${RUN_LEGACY_DATA_SEEDS:-0}" = "1" ]'), "не за флагом legacy-сидов");
});
