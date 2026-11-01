// Режим «Вся организация» (правило 5): владелец без выбранной точки должен видеть
// обе точки. Ищем ответы, где есть метки только одной точки (локальная wesetup_iso).
// node .agent/tasks/point-isolation-audit-2026-11-01/raw/org-view-scan.mjs [out-file]
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { fx, login, req, withPoint } from "./http-lib.mjs";

const outFile = process.argv[2] ?? "org-view-scan.txt";
const SKIP = [
  "/api/cron", "/api/auth", "/api/payments", "/api/webhooks", "/api/dev", "/api/telegram", "/api/tuya",
  "/api/mailing", "/api/root", "/api/health", "/api/healthz", "/api/build-info", "/api/runtime-probe",
  "/api/status", "/api/legal", "/api/kp", "/api/promo", "/api/live", "/api/notifications/telegram", "/api/max/webhook",
];
function walk(dir, file, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, file, acc);
    else if (name === file) acc.push(full);
  }
  return acc;
}
const toUrl = (file, root) => file.replace(root, "").replace(/\/(route\.ts|page\.tsx)$/, "").replace(/\/\([^)]*\)/g, "") || "/";
const urls = [
  ...walk("src/app/api", "route.ts")
    .filter((file) => /export (async function|const) GET\b|export \{[^}]*\bGET\b/.test(readFileSync(file, "utf8")))
    .map((file) => toUrl(file, "src/app")),
  ...walk("src/app/(dashboard)", "page.tsx").map((file) => toUrl(file, "src/app/(dashboard)")),
  "/journals/hygiene", "/journals/cold_equipment_control", "/journals/cleaning", "/journals/health_check",
].filter((url) => !url.includes("[") && !SKIP.some((prefix) => url === prefix || url.startsWith(`${prefix}/`)));

const tags = (tag) => [
  `ШХ ${tag}`, `Цех ${tag}`, `Зал ${tag}`, `Повар ${tag}`, `Руководитель ${tag}`, `CAPA ${tag}`, `Партия ${tag}`,
  `Списание ${tag}`, `НАКЛ-${tag}`, `Поставщик ${tag}`, `Этикетка ${tag}`, `Продукт ${tag}`, `Принтер ${tag}`,
  `Печать ${tag}`, `Проверяющий ${tag}`, `Навык ${tag}`, `Уведомление ${tag}`, `Гигиена ${tag}`, `Здоровье ${tag}`, `Запись ${tag}`,
];
const A = tags("Альфа");
const B = tags("Бета");
const owner = withPoint(await login(fx.users.owner.email), "organization");
const lines = [];
let i = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (i < urls.length) {
    const url = urls[i++];
    const res = await req("GET", url, owner).catch(() => null);
    if (!res) continue;
    const text = res.text ?? "";
    // Пара «объект Альфа ↔ объект Бета» одного вида: виден один — второй пропал.
    const lost = A.map((a, k) => [a, B[k]]).filter(([a, b]) => text.includes(a) !== text.includes(b));
    if (lost.length > 0) {
      const line = `ONESIDED ${res.status} ${url} :: ${lost.map(([a, b]) => (text.includes(a) ? `${a} без ${b}` : `${b} без ${a}`)).join("; ")}`;
      lines.push(line);
      console.log(line);
    }
  }
}));
writeFileSync(`.agent/tasks/point-isolation-audit-2026-11-01/raw/${outFile}`, `${lines.sort().join("\n")}\n`);
console.log("done", lines.length, "of", urls.length);
