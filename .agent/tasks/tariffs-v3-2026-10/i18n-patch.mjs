// Тарифы 2026-10: правки каталогов src/i18n/messages/{ru,en,uz}.json.
// Запуск: node .agent/tasks/tariffs-v3-2026-10/i18n-patch.mjs && npm run i18n:types
// Идемпотентен: значения задаются целиком, удаления — по пути.
import { readFileSync, writeFileSync } from "node:fs";
import { PATCHES } from "./i18n-patches.mjs";

const root = new URL("../../../src/i18n/messages/", import.meta.url);
for (const locale of ["ru", "en", "uz"]) {
  const file = new URL(`${locale}.json`, root);
  const catalog = JSON.parse(readFileSync(file, "utf8"));
  for (const patch of PATCHES) {
    const parts = patch.path.split(".");
    let node = catalog;
    for (const part of parts.slice(0, -1)) {
      if (patch.delete && !(part in node)) { node = null; break; }
      node[part] ??= {};
      node = node[part];
    }
    if (!node) continue;
    const leaf = parts[parts.length - 1];
    if (patch.delete) {
      delete node[leaf];
      continue;
    }
    const value = patch[locale];
    if (value === undefined) throw new Error(`${patch.path}: нет значения для ${locale}`);
    node[leaf] = value;
  }
  writeFileSync(file, JSON.stringify(catalog, null, 2) + "\n");
  console.log(`${locale}: ${PATCHES.length} правок`);
}
