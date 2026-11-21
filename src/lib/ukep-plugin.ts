/**
 * КриптоПро ЭЦП Browser plug-in в браузере (спека journal-ukep-signing-2026-11-21):
 * загрузка `cadesplugin_api.js`, список сертификатов с закрытым ключом и
 * откреплённая подпись CAdES-BES. API плагина асинхронный: свойства читаются
 * через `await obj.Prop`, пишутся `await obj.propset_Prop(value)`.
 * Проверено по `cadesplugin_api.js` 21.11.2026: `window.cadesplugin` — промис с
 * константами и `CreateObjectAsync`; без плагина он отклоняется.
 *
 * Модуль без зависимостей от браузера в типах: в тестах подставляется свой плагин.
 */

export const CADES_PLUGIN_SCRIPT_URL = "https://www.cryptopro.ru/sites/default/files/products/cades/cadesplugin_api.js";
export const CRYPTOPRO_PLUGIN_PAGE = "https://cryptopro.ru/products/cades/plugin";
export const CRYPTOPRO_CSP_PAGE = "https://cryptopro.ru/products/csp";
export const GOSUSLUGI_VERIFY_URL = "https://www.gosuslugi.ru/eds";

/* eslint-disable @typescript-eslint/no-explicit-any -- объекты плагина КриптоПро не типизированы */
export type CadesPlugin = {
  CreateObjectAsync(name: string): Promise<any>;
  getLastError?: (error: unknown) => string;
  CAPICOM_CURRENT_USER_STORE?: number;
  CAPICOM_MY_STORE?: string;
  CAPICOM_STORE_OPEN_MAXIMUM_ALLOWED?: number;
  CAPICOM_CERTIFICATE_INCLUDE_END_ENTITY_ONLY?: number;
  CADESCOM_BASE64_TO_BINARY?: number;
  CADESCOM_CADES_BES?: number;
};

export type UkepCertificate = {
  thumbprint: string;
  subjectName: string;
  issuerName: string;
  /** ISO-дата окончания срока. */
  validTo: string;
  /** Объект сертификата плагина — для подписи. */
  handle: any;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Ошибка плагина: `code` — для текста в окне (переводы ru/en/uz), `reason` — что
 * ответил сам плагин (для `sign_failed`). `message` — по-русски, для логов и тестов.
 */
export class UkepPluginError extends Error {
  constructor(
    readonly code: "no_plugin" | "no_certificates" | "sign_failed",
    message: string,
    readonly reason: string = "",
  ) {
    super(message);
    this.name = "UkepPluginError";
  }
}

type PluginWindow = { cadesplugin?: unknown; document?: { createElement(tag: string): unknown; head?: { appendChild(node: unknown): unknown } } };

/** Подключить скрипт плагина один раз. */
export function injectScript(win: PluginWindow, src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = win.document;
    if (!doc?.head) {
      reject(new Error("no document"));
      return;
    }
    const script = doc.createElement("script") as { src: string; async: boolean; onload: () => void; onerror: () => void };
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("script"));
    doc.head.appendChild(script);
  });
}

const withTimeout = <T>(promise: Promise<T>, ms: number) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

/**
 * Готовый плагин или понятная ошибка «поставьте КриптоПро CSP и плагин».
 * `window.cadesplugin` — промис: дожидаемся его и отдаём сам объект (на нём
 * константы и `CreateObjectAsync`).
 */
export async function loadCadesPlugin(
  win: PluginWindow,
  load: (src: string) => Promise<void> = (src) => injectScript(win, src),
  timeoutMs = 20_000,
): Promise<CadesPlugin> {
  const noPlugin = () =>
    new UkepPluginError("no_plugin", "Не найден КриптоПро ЭЦП Browser plug-in — установите КриптоПро CSP и плагин, затем обновите страницу");
  if (!win.cadesplugin) {
    try {
      await load(CADES_PLUGIN_SCRIPT_URL);
    } catch {
      throw noPlugin();
    }
  }
  const plugin = win.cadesplugin as (CadesPlugin & PromiseLike<unknown>) | undefined;
  if (!plugin) throw noPlugin();
  try {
    if (typeof plugin.then === "function") await withTimeout(Promise.resolve(plugin), timeoutMs);
  } catch {
    throw noPlugin();
  }
  if (typeof plugin.CreateObjectAsync !== "function") throw noPlugin();
  // Сам `window.cadesplugin` — промис: вернуть его из async-функции нельзя (вместо
  // объекта придёт результат промиса). Отдаём обычный объект с методами и константами.
  return {
    CreateObjectAsync: (name: string) => plugin.CreateObjectAsync(name),
    getLastError: typeof plugin.getLastError === "function" ? (error: unknown) => plugin.getLastError!(error) : undefined,
    CAPICOM_CURRENT_USER_STORE: plugin.CAPICOM_CURRENT_USER_STORE,
    CAPICOM_MY_STORE: plugin.CAPICOM_MY_STORE,
    CAPICOM_STORE_OPEN_MAXIMUM_ALLOWED: plugin.CAPICOM_STORE_OPEN_MAXIMUM_ALLOWED,
    CAPICOM_CERTIFICATE_INCLUDE_END_ENTITY_ONLY: plugin.CAPICOM_CERTIFICATE_INCLUDE_END_ENTITY_ONLY,
    CADESCOM_BASE64_TO_BINARY: plugin.CADESCOM_BASE64_TO_BINARY,
    CADESCOM_CADES_BES: plugin.CADESCOM_CADES_BES,
  };
}

function pluginMessage(plugin: CadesPlugin, error: unknown): string {
  try {
    const text = plugin.getLastError?.(error);
    if (text) return text;
  } catch {
    // ниже — общий текст
  }
  return error instanceof Error && error.message ? error.message : "неизвестная ошибка";
}

/** Сертификаты из хранилища «Личное» с закрытым ключом, действующие сейчас. */
export async function listCertificates(plugin: CadesPlugin, now: Date = new Date()): Promise<UkepCertificate[]> {
  const store = await plugin.CreateObjectAsync("CAdESCOM.Store");
  await store.Open(plugin.CAPICOM_CURRENT_USER_STORE ?? 2, plugin.CAPICOM_MY_STORE ?? "My", plugin.CAPICOM_STORE_OPEN_MAXIMUM_ALLOWED ?? 2);
  try {
    const certificates = await store.Certificates;
    const count = Number(await certificates.Count);
    const out: UkepCertificate[] = [];
    for (let index = 1; index <= count; index += 1) {
      const cert = await certificates.Item(index);
      if (!(await cert.HasPrivateKey())) continue;
      const validTo = new Date(await cert.ValidToDate);
      if (!Number.isFinite(validTo.getTime()) || validTo < now) continue;
      out.push({
        thumbprint: String(await cert.Thumbprint),
        subjectName: String(await cert.SubjectName),
        issuerName: String(await cert.IssuerName),
        validTo: validTo.toISOString(),
        handle: cert,
      });
    }
    if (out.length === 0) {
      throw new UkepPluginError("no_certificates", "Нет действующих сертификатов с закрытым ключом — подключите токен с УКЭП");
    }
    return out;
  } finally {
    await store.Close();
  }
}

/** Откреплённая подпись CAdES-BES над байтами (base64) — результат в base64. */
export async function signDetached(plugin: CadesPlugin, certificate: UkepCertificate, base64: string): Promise<string> {
  try {
    const signer = await plugin.CreateObjectAsync("CAdESCOM.CPSigner");
    await signer.propset_Certificate(certificate.handle);
    await signer.propset_CheckCertificate(true);
    // В подпись — сертификат подписанта: по нему WeSetup и Госуслуги видят, кто подписал.
    await signer.propset_Options(plugin.CAPICOM_CERTIFICATE_INCLUDE_END_ENTITY_ONLY ?? 2);
    const data = await plugin.CreateObjectAsync("CAdESCOM.CadesSignedData");
    await data.propset_ContentEncoding(plugin.CADESCOM_BASE64_TO_BINARY ?? 1);
    await data.propset_Content(base64);
    const signature = await data.SignCades(signer, plugin.CADESCOM_CADES_BES ?? 1, true);
    return String(signature).replace(/\s+/g, "");
  } catch (error) {
    const reason = pluginMessage(plugin, error);
    throw new UkepPluginError("sign_failed", `Плагин не подписал документ: ${reason}`, reason);
  }
}

/** «CN=Иванов Иван Иванович, O=…» → «Иванов Иван Иванович» для списка сертификатов. */
export function certificateLabel(subjectName: string): string {
  const fields = new Map<string, string>();
  for (const part of subjectName.split(/,(?=\s*[A-Za-z0-9.]+=)/)) {
    const [key, ...rest] = part.split("=");
    if (key && rest.length) fields.set(key.trim().toUpperCase(), rest.join("=").trim().replace(/^"|"$/g, ""));
  }
  const name = [fields.get("SN"), fields.get("G") ?? fields.get("GN")].filter(Boolean).join(" ");
  return name || fields.get("CN") || subjectName;
}
