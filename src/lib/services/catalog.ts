/**
 * Чтение каталога услуг из БД.
 *
 * ТОЛЬКО серверный модуль: импортирует `@/lib/db`, а тот тянет `pg`.
 * Клиентские компоненты (карточки в кабинете, админка ROOT) обязаны
 * брать типы и чистые помощники из `./constants` — иначе Next
 * затаскивает Prisma в браузерный бандл и страница падает на
 * «Module not found: Can't resolve 'tls'».
 */

import { db } from "@/lib/db";
import {
  DEFAULT_SERVICES,
  SERVICE_CATEGORY_ORDER,
  missingLaterServices,
  type PlatformServiceItem,
  type ServiceCategory,
} from "./constants";

export * from "./constants";

function toItem(row: {
  key: string;
  title: string;
  summary: string;
  description: string;
  priceRub: number | null;
  priceFrom: boolean;
  unit: string | null;
  category: string;
  active: boolean;
  sort: number;
}): PlatformServiceItem {
  return {
    ...row,
    category: (SERVICE_CATEGORY_ORDER as string[]).includes(row.category)
      ? (row.category as ServiceCategory)
      : "consult",
  };
}

/**
 * Все услуги в порядке вывода. На пустой таблице засеивает дефолты —
 * тем же приёмом, что `readTariffs`: `skipDuplicates` делает вызов
 * безопасным при гонке двух параллельных запросов после деплоя.
 */
export async function readServices(): Promise<PlatformServiceItem[]> {
  const rows = await db.platformService.findMany({
    orderBy: [{ sort: "asc" }, { key: "asc" }],
  });
  if (rows.length > 0) {
    // Услуги, появившиеся после первого засева, досеиваем в уже непустую таблицу.
    const missing = missingLaterServices(rows.map((row) => row.key));
    if (missing.length === 0) return rows.map(toItem);
    await db.platformService.createMany({ data: missing, skipDuplicates: true });
    const merged = await db.platformService.findMany({
      orderBy: [{ sort: "asc" }, { key: "asc" }],
    });
    return merged.map(toItem);
  }

  await db.platformService.createMany({
    data: DEFAULT_SERVICES,
    skipDuplicates: true,
  });
  const seeded = await db.platformService.findMany({
    orderBy: [{ sort: "asc" }, { key: "asc" }],
  });
  return seeded.map(toItem);
}

/** Только то, что продаётся сейчас. */
export async function readActiveServices(): Promise<PlatformServiceItem[]> {
  const all = await readServices();
  return all.filter((item) => item.active);
}

export async function readService(key: string): Promise<PlatformServiceItem | null> {
  const all = await readServices();
  return all.find((item) => item.key === key && item.active) ?? null;
}

