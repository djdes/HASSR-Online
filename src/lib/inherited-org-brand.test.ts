import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { LOGO_UPLOAD_AUDIT_COMPLETE_UNTIL, brandCensus, findInheritedBrand, type BrandOrgRow } from "./inherited-org-brand";

const T0 = new Date("2026-11-01T10:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const NOBODY = { logoUpload: false, logoUrl: false, brandColor: false };
const IN_AUDIT_WINDOW = new Date("2026-11-21T19:00:00Z");
const AFTER_AUDIT_WINDOW = new Date("2027-02-01T00:00:00Z");

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

test("после 14.01.2027 (журнал загрузок неполный): свой файл без записи о загрузке, не похожий на донора и не созданный вместе с организацией, — не трогаем", () => {
  const odd = org("odd", 120, {
    logoUrl: "/api/org-assets/odd/logo?v=2",
    logoFile: { hash: "H-other", version: 2, updatedAt: at(400) },
  });
  assert.deepEqual(findInheritedBrand([donor, odd], { now: AFTER_AUDIT_WINDOW }), []);
});

test("пока журнал хранит все загрузки: свой файл без записи о загрузке — копия, даже если донор потом сменил логотип", () => {
  // Копия скрипта 01.11 (не в момент создания), донор позже загрузил другой файл.
  const changedDonor: BrandOrgRow = { ...donor, logoFile: { hash: "H-cafe-new", version: 3, updatedAt: at(900) } };
  const stale = org("stale", 120, {
    logoUrl: "/api/org-assets/stale/logo?v=1",
    logoFile: { hash: "H-cafe-old", version: 1, updatedAt: at(600) },
  });
  assert.equal(findInheritedBrand([changedDonor, stale], { now: IN_AUDIT_WINDOW })[0]?.logo, "copied-file");
  // Загрузил человек — не трогаем и в этом случае.
  const own: BrandOrgRow = { ...stale, setByPerson: { ...NOBODY, logoUpload: true } };
  assert.deepEqual(findInheritedBrand([changedDonor, own], { now: IN_AUDIT_WINDOW }), []);
  assert.ok(LOGO_UPLOAD_AUDIT_COMPLETE_UNTIL > IN_AUDIT_WINDOW && LOGO_UPLOAD_AUDIT_COMPLETE_UNTIL <= AFTER_AUDIT_WINDOW);
});

test("адрес файла другой организации убирается у любой организации — и у старшей, и у одиночной, и без аккаунта", () => {
  const oldestPointer = org("first", -10, { accountId: "solo", logoUrl: "/api/org-assets/cafe/logo?v=4" });
  const noAccount = org("loose", 5, { accountId: null, logoUrl: "/api/org-assets/cafe/logo?v=4" });
  assert.deepEqual(
    findInheritedBrand([donor, oldestPointer, noAccount]).map((fix) => [fix.organizationId, fix.logo, fix.accountId]),
    [["first", "shared-file", "solo"], ["loose", "shared-file", null]],
  );
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
  // v1 на выкладке #296 нашёл 0 при узких правилах; v2 — правила шире и перепись логотипов.
  assert.match(seed, /"once:inherited-org-brand:v2"/);
  assert.match(seed, /brandCensus\(/);
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

test("перепись логотипов: чужие адреса, файлы без загрузки, одинаковые файлы и ссылки — только id", () => {
  const copy = org("copy", 10, { logoUrl: "/api/org-assets/copy/logo?v=1", logoFile: { hash: "H-cafe", version: 1, updatedAt: at(10) } });
  const pointer = org("pointer", 20, { logoUrl: "/api/org-assets/cafe/logo?v=1" });
  const linkA = org("linkA", 30, { accountId: "a2", logoUrl: "https://cdn.example.com/x.png" });
  const linkB = org("linkB", 40, { accountId: "a3", logoUrl: "https://cdn.example.com/x.png" });
  const census = brandCensus([donor, copy, pointer, linkA, linkB, org("empty", 50)]);
  assert.deepEqual(census, {
    organizations: 6,
    withLogo: 5,
    ownFiles: 2,
    externalLinks: 2,
    foreignPointers: ["pointer"],
    filesWithoutUpload: ["copy"],
    sameFileGroups: [{ ids: ["cafe", "copy"], sameAccount: true, uploaded: 1 }],
    sameLinkGroups: [{ ids: ["linkA", "linkB"], sameAccount: false }],
  });
});
