import { db } from "@/lib/db";
import {
  buildHelperCatalog,
  FINISHED_PRODUCT_CODE,
  PERISHABLE_REJECTION_CODE,
  type HelperCatalog,
} from "@/lib/setup-helper-catalog";
import {
  documentWorkerScopeWhere,
  loadWorkerPointScope,
  personInWorkerScope,
  type WorkerPointScope,
} from "@/lib/worker-point-scope";

/**
 * Справочники «Сетап помощника» из БД одной организации: активные продукты,
 * списки действующих (на сегодня) документов бракеража и работающие
 * сотрудники. Документов берём немного и только действующие: в `config`
 * бракеража лежат и все строки журнала, читать архив незачем.
 *
 * Телефон сотрудника, закреплённого за точками (`userId` ключа), получает
 * сотрудников только своих точек (и без точек) и блюда только из документов
 * своих точек и общих — точка не видит чужое (2026-10-31). Продукты общие:
 * у `Product` нет точки.
 */
export async function loadHelperCatalog(
  organizationId: string,
  now: Date = new Date(),
  options: { userId?: string | null } = {},
): Promise<HelperCatalog> {
  const scope: WorkerPointScope = options.userId ? await loadWorkerPointScope(organizationId, options.userId) : null;
  const [products, documents, staff] = await Promise.all([
    db.product.findMany({
      where: { organizationId, isActive: true },
      orderBy: { name: "asc" },
      take: 5000,
      select: { name: true, shelfLifeDays: true, storageTemp: true, supplier: true },
    }),
    db.journalDocument.findMany({
      where: {
        organizationId,
        status: "active",
        template: { code: { in: [FINISHED_PRODUCT_CODE, PERISHABLE_REJECTION_CODE] } },
        dateFrom: { lte: now },
        // dateTo — полночь UTC последнего дня периода: сутки запаса, чтобы
        // документ не выпадал в свой последний день (и в любом поясе).
        dateTo: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
        ...documentWorkerScopeWhere(scope),
      },
      orderBy: { dateFrom: "desc" },
      take: 30,
      select: { config: true, template: { select: { code: true } } },
    }),
    db.user.findMany({
      where: { organizationId, isActive: true, archivedAt: null },
      take: 2000,
      select: { name: true, buildingIds: true },
    }),
  ]);
  return buildHelperCatalog({
    products,
    documents: documents.map((doc) => ({ code: doc.template.code, config: doc.config })),
    staff: staff.filter((person) => personInWorkerScope(scope, person.buildingIds)).map((person) => ({ name: person.name })),
  });
}
