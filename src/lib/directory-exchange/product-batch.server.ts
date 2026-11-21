import { db } from "@/lib/db";
import { createEntityRow, productCreateData, type CreateOutcome, type EntityRow } from "@/lib/directory-exchange/entities.server";

/**
 * Продукты обмена — пачкой (серия E, Р3: нагрузочная проверка). Правила те же,
 * что у `createEntityRow("product", …)`: продукт не создаётся, если у
 * получателя уже есть продукт с таким названием без учёта регистра —
 * активный или выключенный («занято»). Отличие только в числе запросов:
 * занятые названия получателя читаются один раз, новые продукты пишутся
 * `createManyAndReturn` по 200, а не двумя запросами на продукт (5 000
 * продуктов на 20 организаций — 95 000 созданий за первый обмен). Пачка
 * небольшая: Prisma держит аргументы последних 100 запросов в памяти
 * (`@prisma/debug`), и пачки по 1000 строк держали бы сотни мегабайт.
 *
 * Порядок с правками сохраняется так: перед правкой продукта обмен
 * записывает накопленную пачку (`flush`) и забывает прочитанные названия
 * этой организации (`forget`) — переименование меняет занятые названия, и
 * следующее создание перечитает их из базы. Не записалась часть пачки —
 * каждый её продукт создаётся по одному, как раньше.
 */

const CHUNK = 200;
/** Сравнение названий без учёта регистра — как `mode: "insensitive"` у `productNameTaken`. */
const nameKey = (name: string) => name.toLowerCase();

export type ProductBatchResult<T> = { item: T; outcome: CreateOutcome; failed: boolean };

export class ProductCreateBatch<T> {
  private readonly taken = new Map<string, Set<string>>();
  private queued: Array<{ item: T; organizationId: string; source: EntityRow; data: NonNullable<ReturnType<typeof productCreateData>> }> = [];

  get size(): number {
    return this.queued.length;
  }

  private async namesOf(organizationId: string): Promise<Set<string>> {
    let names = this.taken.get(organizationId);
    if (!names) {
      const rows = await db.product.findMany({ where: { organizationId }, select: { name: true } });
      names = new Set(rows.map((row) => nameKey(row.name)));
      this.taken.set(organizationId, names);
    }
    return names;
  }

  /** Поставить создание в пачку; название пустое или занято — сразу «занято». */
  async add(item: T, organizationId: string, source: EntityRow): Promise<"queued" | "conflict"> {
    const data = productCreateData(organizationId, source);
    if (!data) return "conflict";
    const names = await this.namesOf(organizationId);
    const key = nameKey(data.name);
    if (names.has(key)) return "conflict";
    names.add(key);
    this.queued.push({ item, organizationId, source, data });
    return "queued";
  }

  /** Продукты организации правились: занятые названия перечитаются при следующем создании. */
  forget(organizationId: string): void {
    this.taken.delete(organizationId);
  }

  /** Записать накопленное; `failed` — продукт не создался из-за ошибки (обмен пишет пояснение). */
  async flush(): Promise<Array<ProductBatchResult<T>>> {
    const queued = this.queued;
    this.queued = [];
    const results: Array<ProductBatchResult<T>> = [];
    for (let index = 0; index < queued.length; index += CHUNK) {
      const chunk = queued.slice(index, index + CHUNK);
      try {
        const rows = await db.product.createManyAndReturn({
          data: chunk.map((entry) => entry.data),
          select: { id: true, organizationId: true, name: true },
        });
        // В пачке название у организации одно (проверка выше) — по нему и сопоставляем.
        const idOf = new Map(rows.map((row) => [`${row.organizationId}\u0000${row.name}`, row.id]));
        for (const entry of chunk) {
          const id = idOf.get(`${entry.organizationId}\u0000${entry.data.name}`);
          results.push({ item: entry.item, outcome: id ? { status: "created", id } : { status: "conflict" }, failed: !id });
        }
      } catch (error) {
        console.error("[directory-exchange] product batch failed — creating one by one", { count: chunk.length, error });
        for (const entry of chunk) {
          this.forget(entry.organizationId);
          try {
            results.push({ item: entry.item, outcome: await createEntityRow("product", entry.organizationId, entry.source, null), failed: false });
          } catch (rowError) {
            console.error("[directory-exchange] create failed", { entity: "product", organizationId: entry.organizationId, error: rowError });
            results.push({ item: entry.item, outcome: { status: "conflict" }, failed: true });
          }
        }
      }
    }
    return results;
  }
}
