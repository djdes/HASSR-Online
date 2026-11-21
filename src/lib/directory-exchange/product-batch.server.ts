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
 *
 * Прочитанные названия могут устареть, пока пачка копится (продукт завели
 * руками), а уникальности названия в таблице нет. Поэтому перед записью
 * каждой части названия её продуктов проверяются в базе ещё раз (один
 * запрос): занятое — «занято», как у создания по одному. Названия с `%`, `_`
 * и `\` создаются по одному (`createEntityRow`): проверка «занято» у
 * `productNameTaken` — `ILIKE`, и для них она шире простого сравнения.
 */

const CHUNK = 200;
/** Сколько продуктов копить до записи: очередь не держит в памяти весь первый обмен. */
const FLUSH_AT = 5 * CHUNK;
/** Сравнение названий без учёта регистра — как `mode: "insensitive"` у `productNameTaken`. */
const nameKey = (name: string) => name.toLowerCase();
/** Знаки шаблона `ILIKE`: с ними «занято» по одному не равно сравнению без регистра. */
const LIKE_SPECIAL = /[%_\\]/;
const orgNameKey = (organizationId: string, name: string) => `${organizationId}\u0000${nameKey(name)}`;

type Queued<T> = { item: T; organizationId: string; source: EntityRow; data: NonNullable<ReturnType<typeof productCreateData>> };

export type ProductBatchResult<T> = { item: T; outcome: CreateOutcome; failed: boolean };

export class ProductCreateBatch<T> {
  private readonly taken = new Map<string, Set<string>>();
  private queued: Array<Queued<T>> = [];

  get size(): number {
    return this.queued.length;
  }

  /** Пора записать накопленное (`flush`). */
  get full(): boolean {
    return this.queued.length >= FLUSH_AT;
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
    // Название со знаками шаблона решит создание по одному (`flush`).
    if (names.has(key) && !LIKE_SPECIAL.test(data.name)) return "conflict";
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
      // По порядку очереди: подряд идущие обычные названия — одной записью, со знаками шаблона — по одному.
      let run: Array<Queued<T>> = [];
      for (const entry of queued.slice(index, index + CHUNK)) {
        if (!LIKE_SPECIAL.test(entry.data.name)) {
          run.push(entry);
          continue;
        }
        results.push(...(await this.writeRun(run)), await this.writeOne(entry));
        run = [];
      }
      results.push(...(await this.writeRun(run)));
    }
    return results;
  }

  /** Создать по одному — правилами `createEntityRow` (проверка «занято» в базе и запись). */
  private async writeOne(entry: Queued<T>): Promise<ProductBatchResult<T>> {
    this.forget(entry.organizationId);
    try {
      return { item: entry.item, outcome: await createEntityRow("product", entry.organizationId, entry.source, null), failed: false };
    } catch (error) {
      console.error("[directory-exchange] create failed", { entity: "product", organizationId: entry.organizationId, error });
      return { item: entry.item, outcome: { status: "conflict" }, failed: true };
    }
  }

  /**
   * Названия, занятые в базе сейчас (активными и выключенными, без учёта
   * регистра): ключи «организация + название». null — ответ базы не
   * сопоставился с названиями пачки (свёртка регистра в базе и здесь
   * разошлась) — такую часть создаём по одному.
   */
  private async takenNow(run: ReadonlyArray<Queued<T>>): Promise<Set<string> | null> {
    const byOrg = new Map<string, string[]>();
    for (const entry of run) byOrg.set(entry.organizationId, [...(byOrg.get(entry.organizationId) ?? []), entry.data.name]);
    const rows = await db.product.findMany({
      where: { OR: [...byOrg].map(([organizationId, names]) => ({ organizationId, name: { in: names, mode: "insensitive" as const } })) },
      select: { organizationId: true, name: true },
    });
    const wanted = new Set(run.map((entry) => orgNameKey(entry.organizationId, entry.data.name)));
    const taken = new Set<string>();
    for (const row of rows) {
      const key = orgNameKey(row.organizationId, row.name);
      if (!wanted.has(key)) return null;
      taken.add(key);
    }
    return taken;
  }

  /** Обычные названия: перепроверка «занято» в базе и одна запись `createManyAndReturn`. */
  private async writeRun(run: ReadonlyArray<Queued<T>>): Promise<Array<ProductBatchResult<T>>> {
    if (run.length === 0) return [];
    try {
      const taken = await this.takenNow(run);
      if (!taken) {
        const results: Array<ProductBatchResult<T>> = [];
        for (const entry of run) results.push(await this.writeOne(entry));
        return results;
      }
      const fresh = run.filter((entry) => !taken.has(orgNameKey(entry.organizationId, entry.data.name)));
      const rows = fresh.length
        ? await db.product.createManyAndReturn({ data: fresh.map((entry) => entry.data), select: { id: true, organizationId: true, name: true } })
        : [];
      // В пачке название у организации одно (проверка в `add`) — по нему и сопоставляем.
      const idOf = new Map(rows.map((row) => [`${row.organizationId}\u0000${row.name}`, row.id]));
      return run.map((entry): ProductBatchResult<T> => {
        // Название заняли, пока пачка копилась, — «занято», как у создания по одному.
        if (taken.has(orgNameKey(entry.organizationId, entry.data.name))) return { item: entry.item, outcome: { status: "conflict" }, failed: false };
        const id = idOf.get(`${entry.organizationId}\u0000${entry.data.name}`);
        return { item: entry.item, outcome: id ? { status: "created", id } : { status: "conflict" }, failed: !id };
      });
    } catch (error) {
      console.error("[directory-exchange] product batch failed — creating one by one", { count: run.length, error });
      const results: Array<ProductBatchResult<T>> = [];
      for (const entry of run) results.push(await this.writeOne(entry));
      return results;
    }
  }
}
