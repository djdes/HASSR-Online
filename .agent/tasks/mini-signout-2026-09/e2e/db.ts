// Подключение к ЛИЧНОЙ базе этой копии (wesetup_wt_fix). Любая другая база — отказ.
// Скрипты задачи запускаются из корня копии: cd C:/wt/fix && npx tsx .agent/tasks/mini-signout-2026-09/e2e/<файл>.ts
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

export const ROOT = process.cwd();
if (!fs.existsSync(path.join(ROOT, "prisma", "schema.prisma")) || !fs.existsSync(path.join(ROOT, ".env"))) {
  throw new Error("Запускать из корня копии (C:/wt/fix): нет prisma/schema.prisma или .env");
}

function readEnv(key: string): string {
  const text = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
  const line = text.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
  if (!line) throw new Error(`нет ${key} в .env`);
  return line.slice(key.length + 1).trim().replace(/^"|"$/g, "");
}

export const DATABASE_URL = readEnv("DATABASE_URL");
if (!/@localhost:5432\/wesetup_wt_fix\b/.test(DATABASE_URL)) {
  throw new Error("Отказ: скрипты задачи работают только с localhost:5432/wesetup_wt_fix");
}
// Токен бота в .env стенда — выдуманный: им только подписываем initData.
export const BOT_TOKEN = readEnv("TELEGRAM_BOT_TOKEN");

export const db = new PrismaClient({ adapter: new PrismaPg(new pg.Pool({ connectionString: DATABASE_URL })) });
