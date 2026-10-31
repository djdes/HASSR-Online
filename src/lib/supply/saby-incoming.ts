/**
 * СБИС (Saby) — входящие документы реализации (УПД поставщиков).
 *
 * Поверх общего JSON-RPC клиента (`@/lib/edo/saby/*`, вход по ключам
 * приложения): `СБИС.СписокДокументов` с типом `ДокОтгрВх` — входящие
 * накладные за период, `СБИС.ПрочитатьДокумент` — вложения, если список их
 * не вернул. Файл вложения скачивается по его ссылке с токеном сессии; ссылка
 * принимается только на домены Saby (не ходим по чужим адресам из ответа).
 */
import type { SabyCaller } from "@/lib/edo/saby/session";

export type SabyAttachment = {
  name: string | null;
  url: string | null;
  type: string | null;
  /** Служебные вложения (извещения, подписи) — не УПД. */
  service: boolean;
};

export type SabyIncomingDoc = {
  id: string;
  number: string | null;
  /** YYYY-MM-DD */
  date: string | null;
  attachments: SabyAttachment[];
};

type Json = Record<string, unknown>;
const isJson = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

function dateKey(value: unknown): string | null {
  const text = str(value);
  const ru = text ? /^(\d{2})\.(\d{2})\.(\d{4})/.exec(text) : null;
  return ru ? `${ru[3]}-${ru[2]}-${ru[1]}` : null;
}

function ruDate(key: string): string {
  const [y, m, d] = key.split("-");
  return `${d}.${m}.${y}`;
}

function readAttachment(raw: unknown): SabyAttachment | null {
  if (!isJson(raw)) return null;
  const file = isJson(raw.Файл) ? raw.Файл : {};
  return {
    name: str(file.Имя) ?? str(raw.Название),
    url: str(file.Ссылка),
    type: str(raw.Тип),
    service: str(raw.Служебный) === "Да",
  };
}

export function readSabyDocument(raw: unknown): SabyIncomingDoc | null {
  if (!isJson(raw)) return null;
  const id = str(raw.Идентификатор);
  if (!id) return null;
  const attachments = (Array.isArray(raw.Вложение) ? raw.Вложение : [])
    .map(readAttachment)
    .filter((item): item is SabyAttachment => item !== null);
  return { id, number: str(raw.Номер), date: dateKey(raw.Дата), attachments };
}

/** Вложение-УПД: не служебное, файл формата ФНС или тип «УПД». */
export function pickUpdAttachment(attachments: SabyAttachment[]): SabyAttachment | null {
  const candidates = attachments.filter((item) => !item.service && item.url);
  return (
    candidates.find((item) => item.name && /^ON_N?SCHFDOPPR/i.test(item.name)) ??
    candidates.find((item) => item.type && /упд|счфдоп|документ об отгрузке/i.test(item.type)) ??
    null
  );
}

/** Скачивать вложения можно только с доменов Saby; локальная заглушка — вне продакшена. */
export function isAllowedSabyFileUrl(url: string, nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === "https:") {
    const host = parsed.hostname.toLowerCase();
    return ["sbis.ru", "saby.ru"].some((domain) => host === domain || host.endsWith(`.${domain}`));
  }
  return nodeEnv !== "production" && parsed.protocol === "http:" && ["127.0.0.1", "localhost"].includes(parsed.hostname);
}

export function createSabyIncomingApi(call: SabyCaller) {
  return {
    /** Входящие документы реализации за период, страница `page` (с нуля). */
    async listIncoming(
      fromDate: string,
      toDate: string,
      page: number,
    ): Promise<{ documents: SabyIncomingDoc[]; hasMore: boolean }> {
      const result = await call<unknown>("СБИС.СписокДокументов", {
        Фильтр: {
          Тип: "ДокОтгрВх",
          ДатаС: ruDate(fromDate),
          ДатаПо: ruDate(toDate),
          Навигация: { РазмерСтраницы: "50", Страница: String(page) },
        },
      });
      const body = isJson(result) ? result : {};
      const documents = (Array.isArray(body.Документ) ? body.Документ : [])
        .map(readSabyDocument)
        .filter((doc): doc is SabyIncomingDoc => doc !== null);
      const navigation = isJson(body.Навигация) ? body.Навигация : {};
      return { documents, hasMore: str(navigation.ЕстьЕще) === "Да" };
    },

    /** Документ целиком — когда список не вернул вложения. */
    async readDocument(id: string): Promise<SabyIncomingDoc | null> {
      const result = await call<unknown>("СБИС.ПрочитатьДокумент", { Документ: { Идентификатор: id } });
      return readSabyDocument(result);
    },
  };
}

export type SabyIncomingApi = ReturnType<typeof createSabyIncomingApi>;
