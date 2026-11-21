/**
 * Poster (joinposter.com) — Web API v3. Документация прочитана 21.11.2026,
 * выдержки — `.agent/tasks/pos-menu-poster-2026-11-21/raw/poster-docs/`:
 * `GET https://joinposter.com/api/{method}?token=…&format=json`; токен личной
 * интеграции («Доступ → Интеграции → Личная интеграция») вида
 * `номер_аккаунта:ключ`, действует два года. Ответ — `{ response }` или
 * `{ error: { code, message } }`. Даты фильтров — `Ymd`, суммы — в копейках.
 *
 * Берём: поставки и их строки, ручные списания с составом, меню (товары,
 * блюда, полуфабрикаты), ингредиенты, склады и поставщиков. Чистый модуль:
 * транспорт подменяется, токен не попадает ни в текст ошибок, ни в логи.
 */

export const POSTER_API_URL = "https://joinposter.com/api";

export type PosterCredentials = { token: string };

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export class PosterError extends Error {
  constructor(
    readonly code: "auth_failed" | "rate_limit" | "no_access" | "api" | "http" | "bad_response" | "timeout" | "network",
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "PosterError";
  }
}

export type PosterSupply = {
  id: string;
  storageId: string | null;
  supplierId: string | null;
  supplierName: string | null;
  /** YYYY-MM-DD */
  date: string;
  deleted: boolean;
};

export type PosterSupplyItem = {
  ingredientId: string | null;
  name: string;
  amount: number | null;
  /** Как в Poster: kg, p (штуки), l. */
  unit: string | null;
  /** Сумма строки в рублях (Poster отдаёт копейки). */
  sumRub: number | null;
};

export type PosterWaste = {
  id: string;
  storageId: string | null;
  /** YYYY-MM-DD */
  date: string;
  reason: string | null;
  deleted: boolean;
};

export type PosterWasteIngredient = { ingredientId: string | null; weight: number | null; unit: string | null; costRub: number | null };

export type PosterWasteElement = {
  /** 1 — товар, 2 — блюдо, 3 — полуфабрикат, 8 — модификатор, 10 — ингредиент. */
  type: number | null;
  productId: string | null;
  count: number | null;
  ingredients: PosterWasteIngredient[];
};

export type PosterWasteDetail = PosterWaste & { elements: PosterWasteElement[] };

/** Тип позиции меню: 1 — полуфабрикат, 2 — блюдо, 3 — товар. */
export type PosterProductType = "semi" | "dish" | "product";

export type PosterProduct = { id: string; name: string; type: PosterProductType | null; unit: string | null; hidden: boolean };
export type PosterIngredient = { id: string; name: string; unit: string | null };
export type PosterStorage = { id: string; name: string; deleted: boolean };
export type PosterSupplier = { id: string; name: string; inn: string | null; deleted: boolean };

const DEFAULT_TIMEOUT_MS = 30_000;

type Json = Record<string, unknown>;
const isJson = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value.trim() ? value.trim() : null;
};
const num = (value: unknown): number | null => {
  const text = str(value);
  if (text === null) return null;
  const parsed = Number(text.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
};
/** Копейки → рубли, с точностью до копейки. */
const rub = (value: unknown): number | null => {
  const minor = num(value);
  return minor === null ? null : Math.round(minor) / 100;
};
const flag = (value: unknown): boolean => str(value) === "1" || value === true;
const dateKey = (value: unknown): string | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(value) ?? "");
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
};
const list = (value: unknown): Json[] => (Array.isArray(value) ? value.filter(isJson) : []);

/** «2026-11-21» → «20261121» — формат дат Poster (`Ymd`). */
export function posterDate(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new PosterError("bad_response", "Дата для Poster — в виде ГГГГ-ММ-ДД");
  return day.replace(/-/g, "");
}

/** Номер аккаунта из токена `687409:…` — его видно в настройках вместо токена. */
export function posterAccountNumber(token: string): string | null {
  const match = /^(\d{1,12}):/.exec(token.trim());
  return match ? match[1] : null;
}

export function parseSupplies(response: unknown): PosterSupply[] {
  return list(response).flatMap((row) => {
    const id = str(row.supply_id);
    const date = dateKey(row.date);
    if (!id || !date) return [];
    return [
      {
        id,
        storageId: str(row.storage_id),
        supplierId: str(row.supplier_id),
        supplierName: str(row.supplier_name),
        date,
        deleted: flag(row.delete),
      },
    ];
  });
}

export function parseSupplyItems(response: unknown): PosterSupplyItem[] {
  return list(response).flatMap((row) => {
    const name = str(row.ingredient_name);
    if (!name) return [];
    return [
      {
        ingredientId: str(row.ingredient_id),
        name,
        amount: num(row.supply_ingredient_num),
        unit: str(row.ingredient_unit),
        sumRub: rub(row.supply_ingredient_sum),
      },
    ];
  });
}

function wasteHeader(row: Json): PosterWaste | null {
  const id = str(row.waste_id);
  const date = dateKey(row.date);
  if (!id || !date) return null;
  return { id, storageId: str(row.storage_id), date, reason: str(row.reason_name), deleted: flag(row.delete) };
}

export function parseWastes(response: unknown): PosterWaste[] {
  return list(response).flatMap((row) => {
    const waste = wasteHeader(row);
    return waste ? [waste] : [];
  });
}

export function parseWaste(response: unknown): PosterWasteDetail {
  const header = isJson(response) ? wasteHeader(response) : null;
  if (!header || !isJson(response)) throw new PosterError("bad_response", "Poster прислал списание без номера или даты");
  const elements = list(response.elements).map((element) => ({
    type: num(element.type),
    productId: str(element.product_id),
    count: num(element.count),
    ingredients: list(element.ingredients).map((ingredient) => ({
      ingredientId: str(ingredient.ingredient_id),
      weight: num(ingredient.weight),
      unit: str(ingredient.unit),
      costRub: rub(ingredient.cost),
    })),
  }));
  return { ...header, elements };
}

const PRODUCT_TYPES: Readonly<Record<string, PosterProductType>> = { "1": "semi", "2": "dish", "3": "product" };

export function parseProducts(response: unknown): PosterProduct[] {
  return list(response).flatMap((row) => {
    const id = str(row.product_id);
    const name = str(row.product_name);
    if (!id || !name) return [];
    return [{ id, name, type: PRODUCT_TYPES[str(row.type) ?? ""] ?? null, unit: str(row.unit), hidden: flag(row.hidden) }];
  });
}

export function parseIngredients(response: unknown): PosterIngredient[] {
  return list(response).flatMap((row) => {
    const id = str(row.ingredient_id);
    const name = str(row.ingredient_name);
    return id && name ? [{ id, name, unit: str(row.ingredient_unit) }] : [];
  });
}

export function parseStorages(response: unknown): PosterStorage[] {
  return list(response).flatMap((row) => {
    const id = str(row.storage_id);
    const name = str(row.storage_name);
    return id && name ? [{ id, name, deleted: flag(row.delete) }] : [];
  });
}

export function parseSuppliers(response: unknown): PosterSupplier[] {
  return list(response).flatMap((row) => {
    const id = str(row.supplier_id);
    const name = str(row.supplier_name);
    return id && name ? [{ id, name, inn: str(row.supplier_tin), deleted: flag(row.delete) }] : [];
  });
}

/** Ошибка из ответа Poster — понятным текстом (коды — из документации, `web/errors`). */
export function posterApiError(raw: unknown): PosterError {
  const code = isJson(raw) ? num(raw.code) : num(raw);
  if (code === 10 || code === 11) {
    return new PosterError("auth_failed", "Poster не принял токен — проверьте ключ личной интеграции (Доступ → Интеграции)");
  }
  if (code === 12) return new PosterError("auth_failed", "Срок токена Poster истёк — выпустите новый в «Доступ → Интеграции»");
  if (code === 700) return new PosterError("rate_limit", "Poster ограничил частоту запросов — повторим при следующей проверке");
  if (code === 20 || code === 54) return new PosterError("no_access", "У токена Poster нет доступа к складу или меню");
  return new PosterError("api", code === null ? "Poster ответил ошибкой" : `Poster ответил ошибкой ${code}`);
}

export type PosterClient = ReturnType<typeof createPosterClient>;

export function createPosterClient(
  creds: PosterCredentials,
  deps: { fetch?: FetchLike; timeoutMs?: number; baseUrl?: string } = {},
) {
  const fetchImpl: FetchLike = deps.fetch ?? ((url, init) => fetch(url, init));
  const base = deps.baseUrl ?? POSTER_API_URL;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function call(method: string, params: Record<string, string> = {}): Promise<unknown> {
    const url = new URL(`${base}/${method}`);
    url.searchParams.set("token", creds.token);
    url.searchParams.set("format", "json");
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(url.toString(), { method: "GET", headers: { Accept: "application/json" }, signal: controller.signal });
    } catch {
      // Адрес запроса с токеном в текст ошибки не попадает.
      throw controller.signal.aborted
        ? new PosterError("timeout", "Poster не ответил вовремя — повторим при следующей проверке")
        : new PosterError("network", "Не удалось связаться с Poster — повторим при следующей проверке");
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new PosterError("http", `Poster ответил HTTP ${res.status}`, res.status);
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new PosterError("bad_response", "Poster прислал ответ не в JSON");
    }
    if (isJson(body) && body.error !== undefined && body.error !== null && body.error !== 0) throw posterApiError(body.error);
    if (!isJson(body) || !("response" in body)) throw new PosterError("bad_response", "Poster прислал ответ без данных");
    return body.response;
  }

  return {
    supplies: async (fromDate: string, toDate: string) =>
      parseSupplies(await call("storage.getSupplies", { dateFrom: posterDate(fromDate), dateTo: posterDate(toDate) })),
    supplyItems: async (supplyId: string) => parseSupplyItems(await call("storage.getSupplyIngredients", { supply_id: supplyId })),
    wastes: async (fromDate: string, toDate: string) =>
      parseWastes(await call("storage.getWastes", { dateFrom: posterDate(fromDate), dateTo: posterDate(toDate) })),
    waste: async (wasteId: string) => parseWaste(await call("storage.getWaste", { waste_id: wasteId })),
    products: async () => parseProducts(await call("menu.getProducts")),
    ingredients: async () => parseIngredients(await call("menu.getIngredients")),
    storages: async () => parseStorages(await call("storage.getStorages")),
    suppliers: async () => parseSuppliers(await call("storage.getSuppliers")),
  };
}
