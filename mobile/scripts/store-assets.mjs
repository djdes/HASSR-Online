// Паспорт картинок для магазинов: docs/mobile/screenshots/** и
// docs/mobile/store-graphics/* — размер, тип PNG, байты и SHA-256. По нему
// видно, что в карточку загружены именно проверенные файлы, а тест
// (store-assets.test.mjs) ловит забытую пересборку паспорта и картинки не
// того размера или с прозрачностью (App Store такие скриншоты не принимает).
//
// Запуск: node scripts/store-assets.mjs — пересобрать docs/mobile/asset-manifest.json.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DOCS_MOBILE = path.resolve(here, "../../docs/mobile");
export const ASSET_MANIFEST = path.join(DOCS_MOBILE, "asset-manifest.json");

/**
 * Требования магазинов к нашим картинкам (проверено 31.10.2026):
 * App Store — iPhone 6,9" 1320×2868, от 1 до 10, без прозрачности;
 * Google Play — телефон 1080×1920 (9:16), от 2 до 8; значок 512×512;
 * баннер 1024×500 без прозрачности.
 */
export const STORE_RULES = {
  "screenshots/ios": { width: 1320, height: 2868, min: 1, max: 10, alpha: false },
  "screenshots/android": { width: 1080, height: 1920, min: 2, max: 8, alpha: false },
};
export const GRAPHICS_RULES = {
  "store-graphics/icon-512.png": { width: 512, height: 512 },
  "store-graphics/feature-graphic.png": { width: 1024, height: 500, alpha: false },
};

/** Ширина, высота и тип цвета PNG из заголовка (2 — RGB, 6 — RGBA). */
export function pngHeader(bytes) {
  if (bytes.toString("latin1", 1, 4) !== "PNG" || bytes.toString("latin1", 12, 16) !== "IHDR") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colorType: bytes[25] };
}

export function collectStoreAssets() {
  const files = [];
  for (const dir of [...Object.keys(STORE_RULES), "store-graphics"]) {
    for (const name of readdirSync(path.join(DOCS_MOBILE, dir)).filter((n) => n.endsWith(".png")).sort()) {
      files.push(`${dir}/${name}`);
    }
  }
  return files.map((file) => {
    const bytes = readFileSync(path.join(DOCS_MOBILE, file));
    const head = pngHeader(bytes);
    return {
      file,
      width: head?.width ?? null,
      height: head?.height ?? null,
      pngColorType: head?.colorType ?? null,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const assets = collectStoreAssets();
  const checkedAt = new Date().toISOString().slice(0, 10);
  writeFileSync(ASSET_MANIFEST, JSON.stringify({ checkedAt, assets }, null, 2) + "\n");
  for (const a of assets) console.log(`${a.file} ${a.width}×${a.height} ${a.bytes} байт`);
}
