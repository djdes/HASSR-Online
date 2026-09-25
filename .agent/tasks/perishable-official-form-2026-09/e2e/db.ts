// Подключение к ЛИЧНОЙ базе этой копии (wesetup_wt_pdf). Любая другая база — отказ.
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

export const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
export const TASK_DIR = path.resolve(HERE, "..");
export const ROOT = path.resolve(TASK_DIR, "..", "..", "..");

export function readEnv(key: string): string {
  const text = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
  const line = text.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
  if (!line) throw new Error(`нет ${key} в .env`);
  return line.slice(key.length + 1).trim().replace(/^"|"$/g, "");
}

export const DATABASE_URL = readEnv("DATABASE_URL");
if (!/@localhost:5432\/wesetup_wt_pdf\b/.test(DATABASE_URL)) {
  throw new Error("Отказ: скрипты задачи работают только с localhost:5432/wesetup_wt_pdf");
}

export const db = new PrismaClient({ adapter: new PrismaPg(new pg.Pool({ connectionString: DATABASE_URL })) });

export const ORG_ID = "mqs-org";
export const PASSWORD = "MiniQr2026!";
export const MANAGER_EMAIL = "mqs-manager@e2e.local";
export const COOK_EMAIL = "mqs-cook@e2e.local";
export const STATE_FILE = path.join(HERE, "state.json");

export function readState(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

export function writeState(next: Record<string, string>) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2));
}
