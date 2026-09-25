import crypto from "node:crypto";
import { NextResponse } from "next/server";

import {
  blankFilePath,
  blankPagePath,
  blankTargetKey,
  normalizeBlankEmail,
  type BlankFormat,
  type BlankTarget,
} from "@/lib/blank-download";
import { relativeRedirect } from "@/lib/relative-redirect";

/**
 * Подписанная ссылка на скачивание шаблона (HMAC-SHA256, срок 7 дней).
 *
 * Выдаёт её POST /api/public/blank-download после email и согласия; без
 * неё роуты `/api/journal-samples/*` файл «вложением» не отдают. В токене —
 * почта, цель (журнал или бумажный бланк) и формат: ссылка на гигиенический
 * PDF не откроет ни Word, ни другой журнал. Почта нужна роуту, чтобы
 * зашить её (зашифрованной) в QR скачанного файла.
 *
 * Формат: `<base64url(JSON)>.<base64url(HMAC)>`. Ключ выводится из
 * NEXTAUTH_SECRET с отдельной меткой — токен шаблона нельзя подменить
 * никаким другим токеном сайта.
 */

export const BLANK_DOWNLOAD_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function serverSecret(): string {
  const raw = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
  if (!raw || raw.length < 16) {
    throw new Error("NEXTAUTH_SECRET не настроен — ссылки на шаблоны подписать нечем");
  }
  return raw;
}

/** Ключ под одну задачу: подпись ссылок или шифрование QR. */
export function deriveBlankKey(purpose: "download" | "qr"): Buffer {
  return crypto.createHmac("sha256", serverSecret()).update(`wesetup:blank-${purpose}:v1`).digest();
}

type Claims = { v: 1; e: string; t: string; f: BlankFormat; x: number };

function sign(body: string): string {
  return crypto.createHmac("sha256", deriveBlankKey("download")).update(body).digest("base64url");
}

export function signBlankDownloadToken(
  params: { email: string; target: BlankTarget; format: BlankFormat },
  now: number = Date.now(),
): string {
  const claims: Claims = {
    v: 1,
    e: params.email,
    t: blankTargetKey(params.target),
    f: params.format,
    x: Math.floor((now + BLANK_DOWNLOAD_TTL_MS) / 1000),
  };
  const body = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${body}.${sign(body)}`;
}

export type BlankDownloadCheck =
  | { ok: true; email: string; expiresAt: Date }
  | { ok: false; reason: "missing" | "bad-format" | "bad-sig" | "expired" | "mismatch" };

function sameString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function verifyBlankDownloadToken(
  token: string | null | undefined,
  expect: { target: BlankTarget; format: BlankFormat },
  now: number = Date.now(),
): BlankDownloadCheck {
  if (!token) return { ok: false, reason: "missing" };
  if (token.length > 2000) return { ok: false, reason: "bad-format" };
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "bad-format" };
  const [body, sig] = parts;
  if (!sameString(sig, sign(body))) return { ok: false, reason: "bad-sig" };

  let claims: Partial<Claims>;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<Claims>;
  } catch {
    return { ok: false, reason: "bad-format" };
  }
  const email = normalizeBlankEmail(claims.e);
  if (claims.v !== 1 || !email || typeof claims.t !== "string" || typeof claims.x !== "number") {
    return { ok: false, reason: "bad-format" };
  }
  if (claims.t !== blankTargetKey(expect.target) || claims.f !== expect.format) {
    return { ok: false, reason: "mismatch" };
  }
  if (claims.x * 1000 < now) return { ok: false, reason: "expired" };
  return { ok: true, email, expiresAt: new Date(claims.x * 1000) };
}

/** Относительная ссылка на файл с токеном. */
export function blankDownloadHref(target: BlankTarget, format: BlankFormat, token: string): string {
  return `${blankFilePath(target, format)}?t=${encodeURIComponent(token)}`;
}

/**
 * Запрос пришёл из адресной строки / по клику на ссылку (а не от
 * скрипта, краулера или curl). Современные браузеры шлют Sec-Fetch-Mode,
 * старые — Accept с text/html.
 */
export function isBrowserNavigation(request: Request): boolean {
  const mode = request.headers.get("sec-fetch-mode");
  if (mode) return mode === "navigate";
  return (request.headers.get("accept") ?? "").includes("text/html");
}

/**
 * Ответ на файл без действующего токена. Браузер — на страницу журнала с
 * открытым окном email (старые ссылки из блога и поиска не ломаются,
 * протухшая ссылка из письма тоже приводит туда же); остальным — 403 с
 * понятным текстом.
 */
export function blankDownloadDenied(
  request: Request,
  target: BlankTarget,
  format: BlankFormat,
  reason: Exclude<BlankDownloadCheck, { ok: true }>["reason"],
): Response {
  const page = blankPagePath(target, format);
  if (isBrowserNavigation(request)) {
    const response = relativeRedirect(reason === "expired" ? `${page}&expired=1` : page, 307);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
  return NextResponse.json(
    {
      error:
        reason === "expired"
          ? "Ссылка на шаблон устарела. Откройте страницу журнала и скачайте шаблон заново."
          : "Шаблон скачивается после ввода email на странице журнала.",
      page,
    },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}
