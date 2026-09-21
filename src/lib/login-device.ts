import { createHash } from "node:crypto";

/**
 * Устройство входа — чистые правила поверх User-Agent.
 *
 * «Новое устройство» — это новый ключ устройства у этого человека.
 * Ключ — хеш нормализованного User-Agent: точной версии браузера в нём
 * нет (иначе каждое обновление Chrome было бы «новым устройством»),
 * а семейство браузера и ОС — есть. IP в ключ не входит: домашний
 * Wi-Fi и мобильная сеть меняют его по десять раз на дню.
 */
export type LoginMethod = "password" | "phone" | "telegram" | "pair" | "register" | "magic" | "passkey";

export const LOGIN_METHOD_LABEL: Record<LoginMethod, string> = {
  password: "почта и пароль",
  phone: "телефон и пароль",
  telegram: "Telegram",
  pair: "QR-приглашение",
  register: "регистрация",
  magic: "ссылка из письма",
  passkey: "Face ID / отпечаток (passkey)",
};

export function describeUserAgent(ua: string | null | undefined): string {
  const s = ua ?? "";
  if (!s.trim()) return "Неизвестное устройство";
  const browser = /Telegram/i.test(s)
    ? "Telegram"
    : /YaBrowser/i.test(s)
      ? "Яндекс Браузер"
      : /Edg\//i.test(s)
        ? "Edge"
        : /OPR\/|Opera/i.test(s)
          ? "Opera"
          : /Firefox\//i.test(s)
            ? "Firefox"
            : /Chrome\/|CriOS\//i.test(s)
              ? "Chrome"
              : /Safari\//i.test(s)
                ? "Safari"
                : "Браузер";
  const os = /iPhone/i.test(s)
    ? "iPhone"
    : /iPad/i.test(s)
      ? "iPad"
      : /Android/i.test(s)
        ? "Android"
        : /Windows/i.test(s)
          ? "Windows"
          : /Mac OS X|Macintosh/i.test(s)
            ? "macOS"
            : /Linux/i.test(s)
              ? "Linux"
              : "";
  return os ? `${browser} · ${os}` : browser;
}

/** Хеш семейства (браузер + ОС), а не сырого UA: версии не должны плодить «новые устройства». */
export function deviceKey(ua: string | null | undefined): string {
  return createHash("sha256").update(describeUserAgent(ua)).digest("hex").slice(0, 32);
}

/** Маскируем IP в письме: последний октет — точками, чтобы не светить адрес целиком. */
export function maskIp(ip: string | null | undefined): string {
  if (!ip) return "—";
  const v4 = ip.match(/^(\d+\.\d+\.\d+)\.\d+$/);
  if (v4) return `${v4[1]}.×`;
  const parts = ip.split(":");
  return parts.length > 3 ? `${parts.slice(0, 3).join(":")}:…` : ip;
}
