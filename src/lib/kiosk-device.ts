import crypto from "node:crypto";

/**
 * Device-токен общего планшета (киоска).
 *
 * Планшет один раз привязывается к организации (enroll), после чего живёт
 * под httpOnly-cookie `wesetup.kiosk` со значением `<deviceId>.<sig>`, где
 * `sig` = HMAC-SHA256 от `deviceId`. Сам по себе токен не даёт доступа к
 * данным — только к списку сотрудников киоска и вводу ПИН; запись в журнал
 * делает уже короткая сессия сотрудника, выданная после проверки ПИН.
 *
 * Модуль намеренно чистый (только `node:crypto` + env), чтобы покрываться
 * юнит-тестом без БД и сети — как `qr-fill-token.ts`.
 */

export const KIOSK_DEVICE_COOKIE = "wesetup.kiosk";
/** 180 дней: планшет привязывают один раз и надолго. */
export const KIOSK_DEVICE_COOKIE_MAX_AGE = 180 * 24 * 60 * 60;

function getSecret(): string {
  const raw = process.env.KIOSK_DEVICE_SECRET || process.env.NEXTAUTH_SECRET;
  if (!raw || raw.length < 16) {
    throw new Error("KIOSK_DEVICE_SECRET не настроен (или слишком короткий).");
  }
  return raw;
}

function sign(deviceId: string): string {
  return crypto.createHmac("sha256", getSecret()).update(deviceId).digest("base64url");
}

/** Токен для cookie планшета: `<deviceId>.<sig>`. */
export function mintKioskDeviceToken(deviceId: string): string {
  if (!deviceId || deviceId.includes(".")) {
    throw new Error("Некорректный id устройства для киоск-токена");
  }
  return `${deviceId}.${sign(deviceId)}`;
}

export type KioskTokenResult =
  | { ok: true; deviceId: string }
  | { ok: false };

/** Проверка токена из cookie. Возвращает deviceId только при верной подписи. */
export function verifyKioskDeviceToken(token: string | null | undefined): KioskTokenResult {
  if (!token) return { ok: false };
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return { ok: false };
  const deviceId = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(deviceId);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false };
  return { ok: true, deviceId };
}
