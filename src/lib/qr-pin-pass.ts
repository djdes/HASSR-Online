import crypto from "node:crypto";

import { qrHmac, qrHmacEquals } from "@/lib/qr-hmac";

/**
 * Пропуск после ввода PIN на QR-странице: PIN проверяется один раз на своём
 * шаге — ДО формы, дальше действует подписанный пропуск.
 *
 * Пропуск привязан к сотруднику, организации и визиту (`flow` — случайный
 * id в адресе страницы). Новый скан плаката не несёт `flow`, поэтому PIN
 * спрашивается каждый раз; запоминается только сотрудник (`qr-remember`).
 * Ссылка с `flow` без cookie тоже бесполезна — нужны оба.
 */
export const QR_PASS_TTL_MS = 15 * 60 * 1000;
export const QR_PASS_COOKIE = "wesetup.qr.pass";
export const QR_PASS_MAX_AGE_SEC = QR_PASS_TTL_MS / 1000;

const SCOPE = "qr-pass";

export function newQrFlowId(): string {
  return crypto.randomBytes(12).toString("base64url");
}

export function mintQrPass(params: {
  employeeId: string;
  orgId: string;
  flow: string;
  now?: number;
  ttlMs?: number;
}): string {
  const exp = (params.now ?? Date.now()) + (params.ttlMs ?? QR_PASS_TTL_MS);
  const payload = `v2.${params.employeeId}.${params.orgId}.${params.flow}.${exp}`;
  return `${payload}.${qrHmac(SCOPE, payload)}`;
}

/** `flow: "any"` — React-страницы, где пропуск живёт в памяти вкладки. */
export function verifyQrPass(
  value: string | null | undefined,
  expected: { employeeId: string; orgId: string; flow: string | "any"; now?: number }
): boolean {
  if (!value) return false;
  const parts = value.split(".");
  if (parts.length !== 6 || parts[0] !== "v2") return false;
  const [, employeeId, orgId, flow, expRaw, signature] = parts;
  const exp = Number(expRaw);
  if (employeeId !== expected.employeeId || orgId !== expected.orgId) return false;
  if (expected.flow !== "any" && flow !== expected.flow) return false;
  if (!Number.isFinite(exp) || exp < (expected.now ?? Date.now())) return false;
  return qrHmacEquals(signature, qrHmac(SCOPE, parts.slice(0, 5).join(".")));
}

