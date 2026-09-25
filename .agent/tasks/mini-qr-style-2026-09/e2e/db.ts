// Подключение к ЛИЧНОЙ базе этой копии (wesetup_wt_pdf). Любая другая база — отказ.
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "..", "..", "..");

function readEnv(key: string): string {
  const text = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
  const line = text.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
  if (!line) throw new Error(`нет ${key} в .env`);
  return line.slice(key.length + 1).trim().replace(/^"|"$/g, "");
}

export const DATABASE_URL = readEnv("DATABASE_URL");
if (!/@localhost:5432\/wesetup_wt_pdf\b/.test(DATABASE_URL)) {
  throw new Error("Отказ: скрипты задачи работают только с localhost:5432/wesetup_wt_pdf");
}
export const BOT_TOKEN = readEnv("TELEGRAM_BOT_TOKEN");

export const db = new PrismaClient({ adapter: new PrismaPg(new pg.Pool({ connectionString: DATABASE_URL })) });
