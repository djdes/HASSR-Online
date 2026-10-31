/**
 * Диадок (Контур) — входящие УПД через HTTP API (`diadoc-api.kontur.ru`).
 *
 * Вход по ключу разработчика (`ddauth_api_client_id`, выдаёт Контур), логину и
 * паролю: `POST /V3/Authenticate?type=password` → токен; дальше каждый
 * запрос несёт `DiadocAuth ddauth_api_client_id=…,ddauth_token=…`. Ответы —
 * JSON (`Accept: application/json`), содержимое документа — байты файла.
 *
 * Чистый модуль: транспорт подменяется (`fetch`), тесты не ходят в сеть.
 * Ни пароль, ни токен не попадают в тексты ошибок.
 */

export const DIADOC_BASE_URL = "https://diadoc-api.kontur.ru";

export type DiadocCredentials = {
  /** Ключ разработчика (`ddauth_api_client_id`). */
  apiClientId: string;
  login: string;
  password: string;
};

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export class DiadocError extends Error {
  constructor(
    readonly code: "auth_failed" | "http" | "bad_response" | "timeout" | "network",
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "DiadocError";
  }
}

export type DiadocBox = { boxId: string; title: string; orgName: string; inn: string | null };

export type DiadocDocumentRef = {
  messageId: string;
  entityId: string;
  number: string | null;
  /** YYYY-MM-DD */
  date: string | null;
  fileName: string | null;
  typeNamedId: string | null;
  indexKey: string | null;
};

const DEFAULT_TIMEOUT_MS = 30_000;
/** Сколько документов за запрос: больше Диадок всё равно не отдаёт. */
export const DIADOC_PAGE_SIZE = 100;

type Json = Record<string, unknown>;
const isJson = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

/** «31.10.2026» или ISO → «2026-10-31». */
function dateKey(value: unknown): string | null {
  const text = str(value);
  if (!text) return null;
  const ru = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(text);
  if (ru) return `${ru[3]}-${ru[2]}-${ru[1]}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

/** УПД: по типу документа или по имени файла формата ФНС. */
export function isUpdDocument(doc: DiadocDocumentRef): boolean {
  if (doc.typeNamedId && /UniversalTransferDocument|Utd|Upd/i.test(doc.typeNamedId)) return true;
  return Boolean(doc.fileName && /^ON_N?SCHFDOPPR/i.test(doc.fileName));
}

export function readDiadocDocument(raw: unknown): DiadocDocumentRef | null {
  if (!isJson(raw)) return null;
  const messageId = str(raw.MessageId);
  const entityId = str(raw.EntityId);
  if (!messageId || !entityId) return null;
  return {
    messageId,
    entityId,
    number: str(raw.DocumentNumber),
    date: dateKey(raw.DocumentDate),
    fileName: str(raw.FileName),
    typeNamedId: str(raw.TypeNamedId) ?? str(raw.DocumentType),
    indexKey: str(raw.IndexKey),
  };
}

function ruDate(dateKeyValue: string): string {
  const [y, m, d] = dateKeyValue.split("-");
  return `${d}.${m}.${y}`;
}

export function createDiadocClient(
  creds: DiadocCredentials,
  options: { fetch?: FetchLike; baseUrl?: string; timeoutMs?: number } = {},
) {
  const base = (options.baseUrl ?? DIADOC_BASE_URL).replace(/\/+$/, "");
  const fetchImpl: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let token: string | null = null;

  async function send(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(`${base}${path}`, { ...init, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) throw new DiadocError("timeout", "Диадок не ответил вовремя");
      throw new DiadocError("network", `Нет связи с Диадоком: ${error instanceof Error ? error.message : "сеть"}`);
    } finally {
      clearTimeout(timer);
    }
  }

  async function authenticate(): Promise<string> {
    const res = await send("/V3/Authenticate?type=password", {
      method: "POST",
      headers: {
        Authorization: `DiadocAuth ddauth_api_client_id=${creds.apiClientId}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ login: creds.login, password: creds.password }),
    });
    if (res.status === 401 || res.status === 403 || res.status === 400) {
      throw new DiadocError("auth_failed", "Диадок не пустил: проверьте ключ разработчика, логин и пароль", res.status);
    }
    if (!res.ok) throw new DiadocError("http", `Диадок ответил HTTP ${res.status} на вход`, res.status);
    const text = (await res.text()).trim().replace(/^"|"$/g, "");
    if (!text) throw new DiadocError("auth_failed", "Диадок не выдал токен");
    token = text;
    return text;
  }

  async function request(path: string): Promise<Response> {
    const authorize = (value: string) => ({
      Authorization: `DiadocAuth ddauth_api_client_id=${creds.apiClientId},ddauth_token=${value}`,
      Accept: "application/json",
    });
    let res = await send(path, { method: "GET", headers: authorize(token ?? (await authenticate())) });
    // Токен истёк — один повторный вход.
    if (res.status === 401) res = await send(path, { method: "GET", headers: authorize(await authenticate()) });
    if (!res.ok) throw new DiadocError("http", `Диадок ответил HTTP ${res.status}`, res.status);
    return res;
  }

  async function json(path: string): Promise<Json> {
    const res = await request(path);
    const body: unknown = await res.json().catch(() => null);
    if (!isJson(body)) throw new DiadocError("bad_response", "Диадок прислал ответ не в JSON");
    return body;
  }

  return {
    authenticate,

    /** Ящики организаций, к которым есть доступ у этого логина. */
    async listBoxes(): Promise<DiadocBox[]> {
      const body = await json("/GetMyOrganizations");
      const orgs = Array.isArray(body.Organizations) ? body.Organizations : [];
      return orgs.flatMap((org) => {
        if (!isJson(org)) return [];
        const boxes = Array.isArray(org.Boxes) ? org.Boxes : [];
        const orgName = str(org.FullName) ?? str(org.ShortName) ?? "";
        return boxes.flatMap((box) => {
          if (!isJson(box)) return [];
          const boxId = str(box.BoxId) ?? str(box.BoxIdGuid);
          return boxId ? [{ boxId, title: str(box.Title) ?? orgName, orgName, inn: str(org.Inn) }] : [];
        });
      });
    },

    /** Входящие документы ящика с даты документа; страницами по `IndexKey`. */
    async listIncoming(
      boxId: string,
      fromDate: string,
      afterIndexKey?: string | null,
    ): Promise<{ documents: DiadocDocumentRef[]; nextIndexKey: string | null }> {
      const query = new URLSearchParams({
        boxId,
        filterCategory: "Any.Inbound",
        fromDocumentDate: ruDate(fromDate),
        count: String(DIADOC_PAGE_SIZE),
      });
      if (afterIndexKey) query.set("afterIndexKey", afterIndexKey);
      const body = await json(`/V3/GetDocuments?${query.toString()}`);
      const raw = Array.isArray(body.Documents) ? body.Documents : [];
      const documents = raw.map(readDiadocDocument).filter((doc): doc is DiadocDocumentRef => doc !== null);
      const more = body.HasMoreResults === true || documents.length >= DIADOC_PAGE_SIZE;
      const last = documents[documents.length - 1];
      return { documents, nextIndexKey: more && last?.indexKey ? last.indexKey : null };
    },

    /** Файл документа (XML УПД) байтами. */
    async downloadContent(boxId: string, doc: Pick<DiadocDocumentRef, "messageId" | "entityId">): Promise<Uint8Array> {
      const query = new URLSearchParams({ boxId, messageId: doc.messageId, entityId: doc.entityId });
      const res = await request(`/V4/GetEntityContent?${query.toString()}`);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}

export type DiadocClient = ReturnType<typeof createDiadocClient>;
