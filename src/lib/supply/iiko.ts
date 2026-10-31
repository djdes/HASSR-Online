import { createHash } from "node:crypto";

import { XMLParser } from "fast-xml-parser";

/**
 * iikoServer (iiko RMS / Chain) — REST API сервера ресторана:
 * `GET /resto/api/auth?login=…&pass=<sha1(пароль)>` → ключ сессии, дальше
 * `?key=…` у каждого запроса и обязательный `GET /resto/api/logout` —
 * сессия занимает лицензию сервера, поэтому работаем только через
 * {@link IikoClient.withSession}, который выходит и при ошибке.
 *
 * Берём: приходные накладные (XML `documents/export/incomingInvoice`),
 * акты списания (JSON `v2/documents/writeoff`), номенклатуру
 * (`v2/entities/products/list`), единицы измерения и поставщиков. Чистый
 * модуль: транспорт подменяется, пароль в текст ошибок не попадает.
 */

export type IikoCredentials = {
  /** Адрес сервера: `https://name.iiko.it:443` или свой `http://host:8080`. */
  serverUrl: string;
  login: string;
  password: string;
};

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export class IikoError extends Error {
  constructor(
    readonly code: "auth_failed" | "http" | "bad_response" | "timeout" | "network" | "license",
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "IikoError";
  }
}

export type IikoInvoiceItem = {
  num: number;
  productId: string | null;
  article: string | null;
  amount: number | null;
  unitId: string | null;
  price: number | null;
  sum: number | null;
};

export type IikoInvoice = {
  id: string;
  /** Номер документа поставщика (входящий), иначе внутренний. */
  number: string;
  /** YYYY-MM-DD */
  date: string;
  supplierId: string | null;
  status: string | null;
  items: IikoInvoiceItem[];
};

export type IikoWriteoff = {
  id: string;
  number: string | null;
  /** YYYY-MM-DD */
  date: string;
  status: string | null;
  comment: string | null;
  items: Array<{ productId: string | null; amount: number | null; unitId: string | null; cost: number | null }>;
};

export type IikoProduct = { id: string; name: string; type: string | null; unitId: string | null; deleted: boolean };
export type IikoSupplier = { id: string; name: string; inn: string | null };

const DEFAULT_TIMEOUT_MS = 60_000;

const xml = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => ["document", "item", "employee"].includes(name),
});

type Json = Record<string, unknown>;
const isJson = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => {
  if (typeof value === "number") return String(value);
  return typeof value === "string" && value.trim() ? value.trim() : null;
};
const num = (value: unknown): number | null => {
  const text = str(value);
  if (text === null) return null;
  const parsed = Number(text.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
};
const dateKey = (value: unknown): string | null => {
  const text = str(value);
  const match = text ? /^(\d{4})-(\d{2})-(\d{2})/.exec(text) : null;
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
};

export function sha1(text: string): string {
  return createHash("sha1").update(text, "utf8").digest("hex");
}

export function parseIncomingInvoices(text: string): IikoInvoice[] {
  let parsed: unknown;
  try {
    parsed = xml.parse(text);
  } catch {
    throw new IikoError("bad_response", "iiko прислал накладные не в XML");
  }
  const root = isJson(parsed) && isJson(parsed.incomingInvoiceDtoes) ? parsed.incomingInvoiceDtoes : {};
  const documents = Array.isArray(root.document) ? root.document : [];
  return documents.flatMap((raw) => {
    if (!isJson(raw)) return [];
    const id = str(raw.id);
    const date = dateKey(raw.incomingDate) ?? dateKey(raw.dateIncoming);
    if (!id || !date) return [];
    const itemsNode = isJson(raw.items) ? raw.items : {};
    const items = (Array.isArray(itemsNode.item) ? itemsNode.item : []).flatMap((item, index) => {
      if (!isJson(item)) return [];
      return [
        {
          num: num(item.num) ?? index + 1,
          productId: str(item.product),
          article: str(item.productArticle) ?? str(item.code),
          amount: num(item.amount) ?? num(item.actualAmount),
          unitId: str(item.amountUnit),
          price: num(item.price),
          sum: num(item.sum),
        },
      ];
    });
    return [
      {
        id,
        number: str(raw.incomingDocumentNumber) ?? str(raw.documentNumber) ?? id.slice(0, 8),
        date,
        supplierId: str(raw.supplier),
        status: str(raw.status),
        items,
      },
    ];
  });
}

export function parseSuppliers(text: string): IikoSupplier[] {
  let parsed: unknown;
  try {
    parsed = xml.parse(text);
  } catch {
    throw new IikoError("bad_response", "iiko прислал поставщиков не в XML");
  }
  const root = isJson(parsed) && isJson(parsed.employees) ? parsed.employees : {};
  return (Array.isArray(root.employee) ? root.employee : []).flatMap((raw) => {
    if (!isJson(raw)) return [];
    const id = str(raw.id);
    const name = str(raw.name);
    return id && name ? [{ id, name, inn: str(raw.taxpayerIdNumber) }] : [];
  });
}

/** Списания: v2 отдаёт `{ result, response: [...] }`, старые серверы — массив. */
export function parseWriteoffs(body: unknown): IikoWriteoff[] {
  const list = Array.isArray(body) ? body : isJson(body) && Array.isArray(body.response) ? body.response : [];
  return list.flatMap((raw) => {
    if (!isJson(raw)) return [];
    const id = str(raw.id);
    const date = dateKey(raw.dateIncoming);
    if (!id || !date) return [];
    const items = (Array.isArray(raw.items) ? raw.items : []).flatMap((item) =>
      isJson(item)
        ? [{ productId: str(item.productId), amount: num(item.amount), unitId: str(item.measureUnitId), cost: num(item.cost) }]
        : [],
    );
    return [{ id, number: str(raw.documentNumber), date, status: str(raw.status), comment: str(raw.comment), items }];
  });
}

export function parseProducts(body: unknown): IikoProduct[] {
  const list = Array.isArray(body) ? body : [];
  return list.flatMap((raw) => {
    if (!isJson(raw)) return [];
    const id = str(raw.id);
    const name = str(raw.name);
    return id && name ? [{ id, name, type: str(raw.type), unitId: str(raw.mainUnit), deleted: raw.deleted === true }] : [];
  });
}

/** Единицы измерения: `[{ id, name }]` из `v2/entities/list?rootType=MeasureUnit`. */
export function parseUnits(body: unknown): Map<string, string> {
  const list = Array.isArray(body) ? body : [];
  const units = new Map<string, string>();
  for (const raw of list) {
    if (!isJson(raw)) continue;
    const id = str(raw.id);
    const name = str(raw.name);
    if (id && name) units.set(id, name);
  }
  return units;
}

export function createIikoClient(creds: IikoCredentials, options: { fetch?: FetchLike; timeoutMs?: number } = {}) {
  const base = creds.serverUrl.replace(/\/+$/, "");
  const fetchImpl: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function get(path: string, query: Record<string, string>): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const url = `${base}${path}?${new URLSearchParams(query).toString()}`;
    try {
      return await fetchImpl(url, { method: "GET", headers: { Accept: "application/json, application/xml, text/plain" }, signal: controller.signal });
    } catch {
      if (controller.signal.aborted) throw new IikoError("timeout", "Сервер iiko не ответил вовремя");
      throw new IikoError("network", "Нет связи с сервером iiko — проверьте адрес и порт");
    } finally {
      clearTimeout(timer);
    }
  }

  async function text(path: string, query: Record<string, string>): Promise<string> {
    const res = await get(path, query);
    if (!res.ok) throw new IikoError("http", `Сервер iiko ответил HTTP ${res.status}`, res.status);
    return res.text();
  }

  async function json(path: string, query: Record<string, string>): Promise<unknown> {
    const body = await text(path, query);
    try {
      return JSON.parse(body);
    } catch {
      throw new IikoError("bad_response", "Сервер iiko прислал ответ не в JSON");
    }
  }

  async function login(): Promise<string> {
    const res = await get("/resto/api/auth", { login: creds.login, pass: sha1(creds.password) });
    const body = (await res.text()).trim();
    if (res.status === 401 || res.status === 403 || res.status === 400) {
      throw new IikoError("auth_failed", "iiko не пустил: проверьте логин и пароль", res.status);
    }
    if (!res.ok) {
      // Занятые лицензии сервер отдаёт текстом при 5xx.
      if (/licen|лиценз/i.test(body)) throw new IikoError("license", "На сервере iiko нет свободной лицензии для входа по API");
      throw new IikoError("http", `Сервер iiko ответил HTTP ${res.status} на вход`, res.status);
    }
    if (!body || body.length > 200) throw new IikoError("auth_failed", "iiko не выдал ключ сессии");
    return body;
  }

  async function logout(key: string): Promise<void> {
    try {
      await get("/resto/api/logout", { key });
    } catch {
      // Сессия истечёт сама; выход не должен ронять загрузку.
    }
  }

  const api = (key: string) => ({
    incomingInvoices: async (from: string, to: string) =>
      parseIncomingInvoices(await text("/resto/api/documents/export/incomingInvoice", { key, from, to })),
    writeoffs: async (from: string, to: string) =>
      parseWriteoffs(await json("/resto/api/v2/documents/writeoff", { key, dateFrom: from, dateTo: to })),
    products: async () => parseProducts(await json("/resto/api/v2/entities/products/list", { key, includeDeleted: "false" })),
    units: async () => parseUnits(await json("/resto/api/v2/entities/list", { key, rootType: "MeasureUnit" })),
    suppliers: async () => parseSuppliers(await text("/resto/api/suppliers", { key })),
  });

  return {
    /** Войти, сделать работу и выйти — даже если работа упала. */
    async withSession<T>(work: (session: ReturnType<typeof api>) => Promise<T>): Promise<T> {
      const key = await login();
      try {
        return await work(api(key));
      } finally {
        await logout(key);
      }
    },
  };
}

export type IikoClient = ReturnType<typeof createIikoClient>;
export type IikoSession = Parameters<Parameters<IikoClient["withSession"]>[0]>[0];
