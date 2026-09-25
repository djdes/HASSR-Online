// Переменные .env копии → process.env ДО загрузки модулей приложения
// (`src/lib/db.ts` берёт DATABASE_URL из окружения). Импортировать первым.
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const root = path.resolve(here, "..", "..", "..", "..");
for (const line of fs.readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/)) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
}
if (!/@localhost:5432\/wesetup_wt_pdf\b/.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("Отказ: скрипты задачи работают только с localhost:5432/wesetup_wt_pdf");
}
