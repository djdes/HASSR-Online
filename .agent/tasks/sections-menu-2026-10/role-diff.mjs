// Сравнение «до/после»: какие адреса каждая роль видит в навигации
// (вкладки, пункты и вкладки меню, карточки). До — снимок с origin/master
// b91388b0 (raw/role-before.json), после — raw/role-after.json.
// Пропасть не должно ничего: missing у каждой роли пустой.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAW = path.join(path.dirname(fileURLToPath(import.meta.url)), "raw");
const before = JSON.parse(fs.readFileSync(path.join(RAW, "role-before.json"), "utf8"));
const after = JSON.parse(fs.readFileSync(path.join(RAW, "role-after.json"), "utf8"));
// Бывшие «Настройки» сотрудников и точек — страницы-хабы карточек. Все их
// карточки стали пунктами меню (сверяет и этот же отчёт: адреса карточек на
// месте), состояние принтера — на «Онлайн-принтере»; сами адреса — редиректы.
const EXPECTED_GONE = new Set(["/settings/sections/staff", "/settings/sections/points"]);
const report = {};
let missingTotal = 0;
for (const key of Object.keys(before)) {
  const was = new Set(before[key]);
  const now = new Set(after[key] ?? []);
  const gone = [...was].filter((href) => !now.has(href));
  const missing = gone.filter((href) => !EXPECTED_GONE.has(href));
  const replacedHubs = gone.filter((href) => EXPECTED_GONE.has(href));
  const added = [...now].filter((href) => !was.has(href));
  missingTotal += missing.length;
  report[key] = { before: was.size, after: now.size, missing, replacedHubs, added };
}
fs.writeFileSync(path.join(RAW, "role-diff.json"), JSON.stringify(report, null, 2));
for (const [key, value] of Object.entries(report)) {
  console.log(`${key}: ${value.before} → ${value.after}; пропало: ${value.missing.join(", ") || "—"}; хабы-редиректы: ${value.replacedHubs.join(", ") || "—"}; добавилось: ${value.added.join(", ") || "—"}`);
}
process.exit(missingTotal ? 1 : 0);
