// Материалы карточек магазинов: картинки и тексты, которые владелец загружает
// в App Store Connect и Play Console. node --test (npm run test:release).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ASSET_MANIFEST, GRAPHICS_RULES, STORE_RULES, collectStoreAssets } from "./store-assets.mjs";
import { LISTING_JSON, listingValues } from "./store-listing.mjs";

test("паспорт картинок совпадает с файлами (после пересъёмки — node scripts/store-assets.mjs)", () => {
  const manifest = JSON.parse(readFileSync(ASSET_MANIFEST, "utf8"));
  assert.match(manifest.checkedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(manifest.assets, collectStoreAssets());
});

test("скриншоты нужного магазину размера, без прозрачности и в допустимом количестве", () => {
  const assets = collectStoreAssets();
  for (const [dir, rule] of Object.entries(STORE_RULES)) {
    const shots = assets.filter((a) => a.file.startsWith(`${dir}/`));
    assert.ok(shots.length >= rule.min && shots.length <= rule.max, `${dir}: ${shots.length} шт.`);
    for (const s of shots) {
      assert.equal(`${s.width}x${s.height}`, `${rule.width}x${rule.height}`, s.file);
      // 2 — RGB без альфа-канала: со скриншотом RGBA App Store Connect отказывает.
      assert.equal(s.pngColorType, 2, `${s.file}: PNG с прозрачностью или палитрой`);
    }
  }
});

test("значок и баннер Google Play нужного размера", () => {
  const assets = collectStoreAssets();
  for (const [file, rule] of Object.entries(GRAPHICS_RULES)) {
    const a = assets.find((x) => x.file === file);
    assert.ok(a, `нет ${file}`);
    assert.equal(`${a.width}x${a.height}`, `${rule.width}x${rule.height}`, file);
    if (rule.alpha === false) assert.notEqual(a.pngColorType, 6, `${file}: баннер с прозрачностью`);
  }
});

test("тексты карточек укладываются в лимиты магазинов", () => {
  const { fields } = listingValues();
  const headings = fields.map((f) => f.heading);
  for (const name of ["Название App Store", "Подзаголовок App Store", "Ключевые слова App Store", "Описание App Store", "Краткое описание Google Play", "Полное описание Google Play"]) {
    assert.ok(headings.some((h) => h.startsWith(name)), `нет поля «${name}»`);
  }
  for (const f of fields) assert.ok(f.size <= f.limit, `${f.heading}: ${f.size} из ${f.limit}`);
  const keywords = fields.find((f) => f.heading.startsWith("Ключевые слова App Store"));
  assert.equal(keywords.unit, "bytes", "у ключевых слов App Store лимит в байтах UTF-8");
  assert.ok(!/,\s/.test(keywords.text), "ключевые слова — через запятую без пробелов");
  const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  assert.ok(headings.some((h) => h.includes(`версии ${version}`)), `нет «Что нового в версии ${version}»`);
});

test("описания App Store и Google Play одинаковые, listing-values.json собран из store-listing.md", () => {
  const { fields } = listingValues();
  const text = (prefix) => fields.find((f) => f.heading.startsWith(prefix))?.text;
  assert.equal(text("Описание App Store"), text("Полное описание Google Play"));
  assert.deepEqual(JSON.parse(readFileSync(LISTING_JSON, "utf8")), listingValues());
});
