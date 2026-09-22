import { qrHmac, qrHmacEquals } from "@/lib/qr-hmac";

/**
 * «Запомнить выбор на этом оборудовании»: кто заполняет с этого телефона
 * или планшета. Одна cookie на организацию для всех QR-страниц — журналы
 * (`/journal-fill/<org>`), помещения (`/room-fill`) и холодильники
 * (`/equipment-fill`); у последних в адресе нет организации, поэтому она в
 * имени cookie, а путь — весь сайт.
 *
 * Срок — 400 дней (больше браузеры не хранят) и продление при каждом
 * использовании старше недели: на практике «бесконечно». Значение подписано:
 * подменить сотрудника правкой cookie нельзя (а PIN всё равно спрашивается).
 */
export const REMEMBER_MAX_AGE_SEC = 400 * 24 * 3600;
export const REMEMBER_REFRESH_AFTER_SEC = 7 * 24 * 3600;
/** Старая cookie журналов: сырой id сотрудника, путь `/journal-fill/<org>`. */
export const LEGACY_EMPLOYEE_COOKIE = "wesetup.qr.employee";

const SCOPE = "qr-who";

export function rememberCookieName(orgId: string): string {
  return `wesetup.qr.who.${orgId}`;
}

export function mintRememberValue(orgId: string, employeeId: string, nowSec: number = Math.floor(Date.now() / 1000)): string {
  const payload = `1.${employeeId}.${nowSec}`;
  return `${payload}.${qrHmac(SCOPE, `${orgId}:${payload}`)}`;
}

export function readRememberValue(
  orgId: string,
  value: string | null | undefined
): { employeeId: string; issuedAtSec: number } | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== "1") return null;
  const [, employeeId, iatRaw, signature] = parts;
  const issuedAtSec = Number(iatRaw);
  if (!employeeId || !Number.isFinite(issuedAtSec)) return null;
  if (!qrHmacEquals(signature, qrHmac(SCOPE, `${orgId}:1.${employeeId}.${iatRaw}`))) return null;
  return { employeeId, issuedAtSec };
}

export function shouldRefreshRemember(issuedAtSec: number, nowSec: number = Math.floor(Date.now() / 1000)): boolean {
  return nowSec - issuedAtSec > REMEMBER_REFRESH_AFTER_SEC;
}

export function rememberSetCookie(
  orgId: string,
  employeeId: string,
  opts: { secure: boolean; nowSec?: number }
): string {
  const value = mintRememberValue(orgId, employeeId, opts.nowSec);
  return `${rememberCookieName(orgId)}=${value}; Path=/; Max-Age=${REMEMBER_MAX_AGE_SEC}; HttpOnly; SameSite=Lax${opts.secure ? "; Secure" : ""}`;
}

export function rememberClearCookie(orgId: string, opts: { secure: boolean }): string {
  return `${rememberCookieName(orgId)}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${opts.secure ? "; Secure" : ""}`;
}
