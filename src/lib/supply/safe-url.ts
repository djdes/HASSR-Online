import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Адрес сервера, который вводит клиент (iikoServer бывает и своим
 * `http://host:8080`), — сайт сам будет ходить на него. Чтобы такой адрес
 * нельзя было направить во внутреннюю сеть сервера WeSetup, имя
 * разрешается в IP и частные, петлевые и служебные диапазоны отклоняются.
 * Вне продакшена разрешён localhost — для локальных заглушек.
 */

function ipv4ToNumber(ip: string): number {
  return ip.split(".").reduce((acc, part) => acc * 256 + Number(part), 0);
}

const PRIVATE_V4: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

export function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const value = ipv4ToNumber(ip);
    return PRIVATE_V4.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return ((value & mask) >>> 0) === ((ipv4ToNumber(base) & mask) >>> 0);
    });
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPrivateAddress(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(lower);
  }
  return true;
}

export class UnsafeUrlError extends Error {}

/** Нормализованный адрес (`протокол://хост:порт`) или ошибка с понятной причиной. */
export async function assertPublicServerUrl(
  raw: string,
  env: { NODE_ENV?: string } = process.env,
  resolve: (host: string) => Promise<string[]> = async (host) => (await lookup(host, { all: true })).map((entry) => entry.address),
): Promise<string> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UnsafeUrlError("Адрес сервера — вида https://name.iiko.it или http://адрес:8080");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UnsafeUrlError("Адрес сервера должен начинаться с https:// или http://");
  }
  if (url.username || url.password) throw new UnsafeUrlError("Логин и пароль вводятся отдельно, не в адресе");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const local = host === "localhost" || host === "127.0.0.1";
  if (local && env.NODE_ENV !== "production") return url.origin;
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : await resolve(host);
  } catch {
    throw new UnsafeUrlError("Не удалось найти сервер по этому адресу");
  }
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new UnsafeUrlError("Адрес ведёт во внутреннюю сеть — укажите внешний адрес сервера iiko");
  }
  return url.origin;
}

/**
 * Как {@link assertPublicServerUrl}, но с путём: опубликованная база 1С живёт
 * не в корне (`https://host/zup`). Запрос и якорь отбрасываются.
 */
export async function assertPublicBaseUrl(
  raw: string,
  env: { NODE_ENV?: string } = process.env,
  resolve?: (host: string) => Promise<string[]>,
): Promise<string> {
  const origin = await assertPublicServerUrl(raw, env, resolve);
  const path = new URL(raw.trim()).pathname.replace(/\/+$/, "");
  return `${origin}${path}`;
}

