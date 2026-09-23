import crypto from "node:crypto";

import { qrHmac, qrHmacEquals } from "@/lib/qr-hmac";

/**
 * Пропуск после ввода PIN на QR-странице: PIN проверяется один раз на своём
 * шаге — ДО формы, дальше действует подписанный пропуск.
 *
 * Пропуск привязан к сотруднику, организации и визиту (`flow`):
 *   • плакаты журналов — `flow` = случайный id в адресе страницы, пропуск в
 *     cookie `wesetup.qr.pass` пути плаката: новый скан — новый визит;
 *   • наклейки объектов (холодильник, склад, УФ-лампа) — `flow: "any"`,
 *     cookie организации `wesetup.qr.pass.<orgId>` на 30 минут (2026-09-23,
 *     «каждое F5 заставляет ввести PIN»): F5 и соседняя наклейка — без PIN.
 *
 * `pinFp` — короткий отпечаток текущего хэша PIN сотрудника (формат `v3`):
 * руководитель сбросил или сменил PIN — отпечаток другой, пропуск погас.
 * Старый формат `v2` без отпечатка — только для плакатов журналов.
 */
export const QR_PASS_TTL_MS = 30 * 60 * 1000;
export const QR_PASS_COOKIE = "wesetup.qr.pass";
export const QR_PASS_MAX_AGE_SEC = QR_PASS_TTL_MS / 1000;

const SCOPE = "qr-pass";

export function newQrFlowId(): string {
  return crypto.randomBytes(12).toString("base64url");
}

/** 8 символов sha256 от хэша PIN; "" — PIN не задан. Без точек (base64url). */
export function qrPinFingerprint(qrPinHash: string | null | undefined): string {
  if (!qrPinHash) return "";
  return crypto.createHash("sha256").update(qrPinHash).digest("base64url").slice(0, 8);
}

export function mintQrPass(params: {
  employeeId: string;
  orgId: string;
  flow: string;
  /** Отпечаток PIN (`qrPinFingerprint`) — пропуск гаснет при смене PIN. */
  pinFp?: string;
  now?: number;
  ttlMs?: number;
}): string {
  const exp = (params.now ?? Date.now()) + (params.ttlMs ?? QR_PASS_TTL_MS);
  const payload = params.pinFp
    ? `v3.${params.employeeId}.${params.orgId}.${params.flow}.${exp}.${params.pinFp}`
    : `v2.${params.employeeId}.${params.orgId}.${params.flow}.${exp}`;
  return `${payload}.${qrHmac(SCOPE, payload)}`;
}

type ParsedQrPass = { employeeId: string; orgId: string; flow: string; exp: number; pinFp: string | null };

/** Разбор и проверка подписи; срок и привязки проверяет вызывающий. */
function parseQrPass(value: string | null | undefined): ParsedQrPass | null {
  if (!value) return null;
  const parts = value.split(".");
  const v3 = parts.length === 7 && parts[0] === "v3";
  const v2 = parts.length === 6 && parts[0] === "v2";
  if (!v2 && !v3) return null;
  const signature = parts[parts.length - 1];
  if (!qrHmacEquals(signature, qrHmac(SCOPE, parts.slice(0, -1).join(".")))) return null;
  const exp = Number(parts[4]);
  if (!Number.isFinite(exp)) return null;
  return { employeeId: parts[1], orgId: parts[2], flow: parts[3], exp, pinFp: v3 ? parts[5] : null };
}

/**
 * `flow: "any"` — наклейки объектов. `pinFp` задан — пропуск обязан нести
 * тот же отпечаток PIN (формат v3).
 */
export function verifyQrPass(
  value: string | null | undefined,
  expected: { employeeId: string; orgId: string; flow: string | "any"; pinFp?: string; now?: number }
): boolean {
  const pass = parseQrPass(value);
  if (!pass) return false;
  if (pass.employeeId !== expected.employeeId || pass.orgId !== expected.orgId) return false;
  if (expected.flow !== "any" && pass.flow !== expected.flow) return false;
  if (pass.exp < (expected.now ?? Date.now())) return false;
  if (expected.pinFp !== undefined && (!expected.pinFp || pass.pinFp !== expected.pinFp)) return false;
  return true;
}

// ---- cookie пропуска наклеек объектов: одна на организацию, путь — весь сайт

export function qrPassCookieName(orgId: string): string {
  return `${QR_PASS_COOKIE}.${orgId}`;
}

export function qrPassSetCookie(orgId: string, value: string, opts: { secure: boolean }): string {
  return `${qrPassCookieName(orgId)}=${value}; Path=/; Max-Age=${QR_PASS_MAX_AGE_SEC}; HttpOnly; SameSite=Lax${opts.secure ? "; Secure" : ""}`;
}

export function qrPassClearCookie(orgId: string, opts: { secure: boolean }): string {
  return `${qrPassCookieName(orgId)}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${opts.secure ? "; Secure" : ""}`;
}

/**
 * Пропуск наклеек из cookie организации: подпись цела, та же организация,
 * `flow: "any"`, в сроке и с отпечатком PIN. Совпадение отпечатка с текущим
 * PIN и блокировку сверяет `qr-object-pass` (нужна БД).
 */
export function readQrPass(
  orgId: string,
  value: string | null | undefined,
  now: number = Date.now()
): { employeeId: string; pinFp: string } | null {
  const pass = parseQrPass(value);
  if (!pass || pass.orgId !== orgId || pass.flow !== "any" || pass.exp < now || !pass.pinFp) return null;
  return { employeeId: pass.employeeId, pinFp: pass.pinFp };
}
