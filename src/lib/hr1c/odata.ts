/**
 * 1С:ЗУП 3.x через стандартный интерфейс OData (база опубликована на
 * веб-сервере, объекты включены в состав OData): сотрудники, их текущие
 * кадровые данные (приём, увольнение, должность) и справочник должностей.
 * Basic-авторизация, ответы `$format=json` → `{ value: [...] }`, выборка
 * страницами. Чистый модуль: транспорт подменяется, пароль в ошибки не попадает.
 */
import type { HrEmployee } from "./plan";

export type ZupCredentials = { baseUrl: string; login: string; password: string };
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export class ZupError extends Error {
  constructor(
    readonly code: "auth_failed" | "not_published" | "http" | "bad_response" | "timeout" | "network",
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ZupError";
  }
}

export const ZUP_PAGE_SIZE = 1000;
const MAX_PAGES = 20;
const DEFAULT_TIMEOUT_MS = 60_000;

type Json = Record<string, unknown>;
const isJson = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

/** Пустая дата 1С — «0001-01-01T00:00:00». */
export function zupDate(value: unknown): string | null {
  const text = str(value);
  const match = text ? /^(\d{4})-(\d{2})-(\d{2})/.exec(text) : null;
  if (!match || match[1] === "0001") return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

const EMPTY_REF = "00000000-0000-0000-0000-000000000000";

/** Сотрудники + кадровые данные + должности → единый список для правила синхронизации. */
export function mergeZupEmployees(employees: unknown[], hrData: unknown[], positions: unknown[]): HrEmployee[] {
  const positionNames = new Map<string, string>();
  for (const raw of positions) {
    if (!isJson(raw)) continue;
    const id = str(raw.Ref_Key);
    const name = str(raw.Description);
    if (id && name) positionNames.set(id, name);
  }
  const hrByEmployee = new Map<string, Json>();
  for (const raw of hrData) {
    if (!isJson(raw)) continue;
    const id = str(raw.Сотрудник_Key);
    if (id) hrByEmployee.set(id, raw);
  }
  return employees.flatMap((raw) => {
    if (!isJson(raw) || raw.DeletionMark === true) return [];
    const externalId = str(raw.Ref_Key);
    const fullName = str(raw.Description);
    if (!externalId || !fullName || externalId === EMPTY_REF) return [];
    const hr = hrByEmployee.get(externalId);
    const positionId = hr ? str(hr.ТекущаяДолжность_Key) : null;
    return [
      {
        externalId,
        fullName: fullName.replace(/\s+/g, " "),
        position: positionId ? positionNames.get(positionId) ?? null : null,
        hiredAt: hr ? zupDate(hr.ДатаПриема) : null,
        dismissedAt: hr ? zupDate(hr.ДатаУвольнения) : null,
        archived: raw.ВАрхиве === true,
        phone: null,
      },
    ];
  });
}

export function createZupClient(creds: ZupCredentials, options: { fetch?: FetchLike; timeoutMs?: number } = {}) {
  const base = `${creds.baseUrl.replace(/\/+$/, "")}/odata/standard.odata`;
  const fetchImpl: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const auth = `Basic ${Buffer.from(`${creds.login}:${creds.password}`, "utf8").toString("base64")}`;

  async function page(entity: string, select: string, skip: number): Promise<unknown[]> {
    const url = `${base}/${encodeURIComponent(entity)}?$format=json&$select=${encodeURIComponent(select)}&$top=${ZUP_PAGE_SIZE}&$skip=${skip}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(url, { method: "GET", headers: { Authorization: auth, Accept: "application/json" }, signal: controller.signal });
    } catch {
      if (controller.signal.aborted) throw new ZupError("timeout", "1С не ответила вовремя");
      throw new ZupError("network", "Нет связи с базой 1С — проверьте адрес публикации");
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401 || res.status === 403) throw new ZupError("auth_failed", "1С не пустила: проверьте логин и пароль пользователя OData", res.status);
    if (res.status === 404) {
      throw new ZupError("not_published", `В публикации нет «${entity}» — включите стандартный интерфейс OData и добавьте объект в его состав`, 404);
    }
    if (!res.ok) throw new ZupError("http", `1С ответила HTTP ${res.status}`, res.status);
    const body: unknown = await res.json().catch(() => null);
    if (!isJson(body) || !Array.isArray(body.value)) throw new ZupError("bad_response", "1С прислала ответ не в формате OData");
    return body.value;
  }

  async function all(entity: string, select: string): Promise<unknown[]> {
    const rows: unknown[] = [];
    for (let index = 0; index < MAX_PAGES; index += 1) {
      const batch = await page(entity, select, index * ZUP_PAGE_SIZE);
      rows.push(...batch);
      if (batch.length < ZUP_PAGE_SIZE) break;
    }
    return rows;
  }

  return {
    /** Только должности — дешёвая проверка подключения. */
    positions: () => all("Catalog_Должности", "Ref_Key,Description"),
    async employees(): Promise<HrEmployee[]> {
      const employees = await all("Catalog_Сотрудники", "Ref_Key,Description,DeletionMark,ВАрхиве");
      const hrData = await all(
        "InformationRegister_ТекущиеКадровыеДанныеСотрудников",
        "Сотрудник_Key,ДатаПриема,ДатаУвольнения,ТекущаяДолжность_Key",
      );
      const positions = await all("Catalog_Должности", "Ref_Key,Description");
      return mergeZupEmployees(employees, hrData, positions);
    },
  };
}
