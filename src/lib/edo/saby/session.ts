// Сессия Saby: кэш сессии по ключам приложения и вызов методов поверх него.
// На приложение Saby не больше пяти активных сессий, поэтому вход делаем только когда сессии нет в
// хранилище или Saby ответил 401, и не больше одного повторного входа на вызов. Параллельные
// вызовы одного кабинета делят один вход (single-flight).
// Перенесено из DocsFlow (`src/lib/edo/saby/session.ts`). Файл чистый: хранилище сессии
// подставляет вызывающий (`src/lib/edo/cabinet.server.ts`).

import { sabyAppLogin, sabyRpc, SabyRpcError, type FetchLike, type SabyAppCreds, type SabyAppSession } from "./rpc";

/** Боевой контур Saby — адрес по умолчанию. */
export const SABY_DEFAULT_BASE_URL = "https://online.saby.ru";

/** Тестовый контур Saby (свои ключи, документы никуда не уходят). */
export const SABY_TEST_BASE_URL = "https://fix-online.sbis.ru";

/** Допустимые адреса: боевые и тестовый контуры. Защищённый ключ уйдёт именно туда. */
export const SABY_BASE_URLS = [SABY_DEFAULT_BASE_URL, "https://online.sbis.ru", SABY_TEST_BASE_URL] as const;

/** Локальная заглушка Saby для e2e: только http на 127.0.0.1/localhost с явным портом. */
const LOCAL_STUB_URL = /^http:\/\/(?:127\.0\.0\.1|localhost):\d{2,5}$/;

/** Адрес без хвостовых слешей и пробелов. */
export function normalizeSabyBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

/**
 * Можно ли слать ключи по этому адресу. В продакшене — только белый список; вне его
 * (`NODE_ENV !== "production"`) ещё локальная заглушка — для e2e без живого Saby.
 */
export function isAllowedSabyBaseUrl(raw: string, nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  const url = normalizeSabyBaseUrl(raw);
  if ((SABY_BASE_URLS as readonly string[]).includes(url)) return true;
  return nodeEnv !== "production" && LOCAL_STUB_URL.test(url);
}

/** Вызов метода Saby с автоматической сессией. Возвращает `result`; отказ — `SabyRpcError`. */
export type SabyCaller = <T>(method: string, params: unknown) => Promise<T>;

/** Где лежит сессия между вызовами (в продукте — строка EdoCabinet, зашифрованная). */
export interface SabySessionStore {
  load(): Promise<SabyAppSession | null>;
  save(s: SabyAppSession): Promise<void>;
  clear(): Promise<void>;
}

/** Идущие сейчас входы: ключ кабинета → обещание сессии. Модульная, чтобы делиться между вызовами. */
const inflightLogins = new Map<string, Promise<SabyAppSession>>();

export function createSabyCaller(
  creds: SabyAppCreds,
  store: SabySessionStore,
  deps: { fetchImpl?: FetchLike; key?: string } = {},
): SabyCaller {
  const base = normalizeSabyBaseUrl(creds.baseUrl);
  const methodUrl = `${base}/service/?srv=1`;
  const key = deps.key ?? `${base}|${creds.clientId}`;
  const { fetchImpl } = deps;

  /**
   * Свежая сессия. `stale` — сессия, которую Saby только что отклонил (null — сессии не было).
   * Вход выполняется один на всех, кто его ждёт; если хранилище уже обновил сосед — берём его сессию.
   */
  function freshSession(stale: SabyAppSession | null): Promise<SabyAppSession> {
    const running = inflightLogins.get(key);
    if (running) return running;

    const login: Promise<SabyAppSession> = (async () => {
      const current = await store.load();
      if (current && current.accessToken !== stale?.accessToken) return current;
      const fresh = await sabyAppLogin({ ...creds, baseUrl: base }, fetchImpl);
      await store.save(fresh);
      return fresh;
    })().finally(() => {
      if (inflightLogins.get(key) === login) inflightLogins.delete(key);
    });
    inflightLogins.set(key, login);
    return login;
  }

  return async function call<T>(method: string, params: unknown): Promise<T> {
    const cached = await store.load();
    const session = cached ?? (await freshSession(null));
    try {
      return await sabyRpc<T>(methodUrl, method, params, { accessToken: session.accessToken, fetchImpl });
    } catch (e) {
      // Только отказ самого метода по сессии: ошибки входа (freshSession) сюда не попадают.
      if (!(e instanceof SabyRpcError) || e.httpStatus !== 401) throw e;
      const renewed = await freshSession(session);
      // Второй 401 подряд уходит наверх как есть — третьего входа не будет.
      return sabyRpc<T>(methodUrl, method, params, { accessToken: renewed.accessToken, fetchImpl });
    }
  };
}
