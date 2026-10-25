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
import { PPK_INDIVIDUAL_FROM_RUB } from "@/lib/tariff-plans";
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

/** Услуга «Разработка программы производственного контроля». */
export const PPK_SERVICE_KEY = "ppk-development";

/** Прежняя цена ППК по умолчанию и запуск тарифов 2026-10. */
const PPK_OLD_DEFAULT_RUB = 12000;
const PPK_PRICE_CHANGED_BEFORE = new Date("2026-10-25T21:00:00.000Z");

/**
 * Тарифы 2026-10: «ППК индивидуально — от 10 000 ₽». Цену 12 000 ₽ из
 * первого засева однократно меняем на 10 000 ₽ — только если её никто не
 * правил после запуска тарифов (поправленную ROOT'ом не трогаем: после
 * этой правки `updatedAt` свежий, и условие больше не сработает).
 */
async function migratePpkPrice<T extends { key: string; priceRub: number | null; priceFrom: boolean; updatedAt: Date }>(
  rows: T[],
): Promise<boolean> {
  const row = rows.find((item) => item.key === PPK_SERVICE_KEY);
  if (!row || row.priceRub !== PPK_OLD_DEFAULT_RUB || !row.priceFrom) return false;
  if (row.updatedAt.getTime() >= PPK_PRICE_CHANGED_BEFORE.getTime()) return false;
  const updated = await db.platformService.updateMany({
    where: { key: PPK_SERVICE_KEY, priceRub: PPK_OLD_DEFAULT_RUB, updatedAt: { lt: PPK_PRICE_CHANGED_BEFORE } },
    data: { priceRub: PPK_INDIVIDUAL_FROM_RUB },
  });
  if (updated.count > 0) console.info("[services] ppk-development price → 10 000 ₽ (tariffs 2026-10)");
  return updated.count > 0;
}

/**
 * Все услуги в порядке вывода. На пустой таблице засеивает дефолты —
 * тем же приёмом, что `readTariffs`: `skipDuplicates` делает вызов
 * безопасным при гонке двух параллельных запросов после деплоя.
 */
export async function readServices(): Promise<PlatformServiceItem[]> {
  let rows = await db.platformService.findMany({
    orderBy: [{ sort: "asc" }, { key: "asc" }],
  });
  if (rows.length > 0 && (await migratePpkPrice(rows).catch(() => false))) {
    rows = await db.platformService.findMany({ orderBy: [{ sort: "asc" }, { key: "asc" }] });
  }
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

/** Цена «от» для кнопки «Заказать индивидуально» в ППК и витрине тарифов. */
export async function readPpkIndividualPrice(): Promise<number> {
  const service = await readService(PPK_SERVICE_KEY).catch((error) => {
    console.error("[services] ppk price read failed — default", error);
    return null;
  });
  return service?.priceRub ?? PPK_INDIVIDUAL_FROM_RUB;
}

