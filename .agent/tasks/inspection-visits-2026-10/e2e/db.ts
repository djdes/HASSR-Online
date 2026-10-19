// Подключение к ЛОКАЛЬНОЙ базе ветки (wesetup_inspection). Любой другой адрес —
// немедленный отказ: 127.0.0.1:5433 — туннель в боевую базу.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const url = process.env.DATABASE_URL ?? "";
if (!/@localhost:5432\/wesetup_inspection\b/.test(url)) {
  throw new Error(`Отказ: e2e работает только с localhost:5432/wesetup_inspection, получено ${url.replace(/:[^:@/]*@/, ":***@")}`);
}
process.env.DATABASE_URL_DIRECT = url;

export const db = new PrismaClient({ adapter: new PrismaPg(new pg.Pool({ connectionString: url })) });
