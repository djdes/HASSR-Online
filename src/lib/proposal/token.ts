import crypto from "node:crypto";

import type { ProposalVars } from "./types";
import { normalizeProposalVars } from "./vars";

/**
 * Подписанная ссылка на веб-версию КП: `/kp/<токен>`.
 *
 * Токен — `<base64url(JSON)>.<base64url(HMAC-SHA256)>`: переменные КП и
 * подпись на секрете приложения (`NEXTAUTH_SECRET`) с контекстом `kp:` —
 * подпись КП нельзя выдать за подпись любого другого токена сайта и
 * наоборот. Срока нет намеренно: КП открывают через недели, а срок
 * скидки живёт в самом промокоде. Времени выпуска в токене тоже нет —
 * одни и те же данные дают одну и ту же ссылку.
 */

export const PROPOSAL_TOKEN_CONTEXT = "kp:";
/** Защитный потолок длины: длиннее токен не выпускаем и не разбираем. */
export const PROPOSAL_TOKEN_MAX_LENGTH = 4000;

type Claims = {
  v: 1;
  s: string;
  c?: string;
  r?: string;
  p?: { c: string; k: "p" | "f"; v: number; l?: 1; e?: string };
  u?: string;
  d?: { n: string; p?: string; e?: string; t?: string };
};

function secret(): string {
  const raw = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
  if (!raw || raw.length < 16) {
    throw new Error("NEXTAUTH_SECRET не настроен — ссылку на КП подписать нечем");
  }
  return raw;
}

function sign(body: string): string {
  return crypto.createHmac("sha256", secret()).update(`${PROPOSAL_TOKEN_CONTEXT}${body}`).digest("base64url");
}

function toClaims(vars: ProposalVars): Claims {
  const v = normalizeProposalVars(vars);
  const claims: Claims = { v: 1, s: v.sphere };
  if (v.companyName) claims.c = v.companyName;
  if (v.recipientName) claims.r = v.recipientName;
  if (v.promo) {
    claims.p = { c: v.promo.code, k: v.promo.kind === "fixed" ? "f" : "p", v: v.promo.value };
    if (v.promo.lifetime) claims.p.l = 1;
    if (v.promo.endsAt) claims.p.e = v.promo.endsAt.toISOString();
  }
  if (v.ctaUrl) claims.u = v.ctaUrl;
  if (v.sender) {
    claims.d = { n: v.sender.name };
    if (v.sender.phone) claims.d.p = v.sender.phone;
    if (v.sender.email) claims.d.e = v.sender.email;
    if (v.sender.telegram) claims.d.t = v.sender.telegram;
  }
  return claims;
}

function fromClaims(claims: Claims): ProposalVars {
  return normalizeProposalVars({
    // Неизвестная сфера станет «other» в normalizeProposalVars.
    sphere: claims.s as ProposalVars["sphere"],
    companyName: claims.c ?? null,
    recipientName: claims.r ?? null,
    promo: claims.p
      ? {
          code: claims.p.c,
          kind: claims.p.k === "f" ? "fixed" : "percent",
          value: claims.p.v,
          lifetime: claims.p.l === 1,
          endsAt: claims.p.e ? new Date(claims.p.e) : null,
        }
      : null,
    ctaUrl: claims.u ?? null,
    sender: claims.d
      ? { name: claims.d.n, phone: claims.d.p ?? null, email: claims.d.e ?? null, telegram: claims.d.t ?? null }
      : null,
  });
}

export function signProposalToken(vars: ProposalVars): string {
  const body = Buffer.from(JSON.stringify(toClaims(vars)), "utf8").toString("base64url");
  const token = `${body}.${sign(body)}`;
  if (token.length > PROPOSAL_TOKEN_MAX_LENGTH) {
    throw new Error("Слишком длинные данные КП для ссылки");
  }
  return token;
}

export type ProposalTokenCheck =
  | { ok: true; vars: ProposalVars }
  | { ok: false; reason: "missing" | "bad-format" | "bad-sig" };

function sameString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function verifyProposalToken(token: string | null | undefined): ProposalTokenCheck {
  if (!token) return { ok: false, reason: "missing" };
  // Next 16 может отдать параметр маршрута нераскодированным.
  let raw = token;
  try {
    raw = decodeURIComponent(token);
  } catch {
    return { ok: false, reason: "bad-format" };
  }
  if (raw.length > PROPOSAL_TOKEN_MAX_LENGTH) return { ok: false, reason: "bad-format" };
  const parts = raw.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "bad-format" };
  const [body, signature] = parts;
  if (!/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]+$/.test(signature)) {
    return { ok: false, reason: "bad-format" };
  }
  if (!sameString(signature, sign(body))) return { ok: false, reason: "bad-sig" };
  let claims: Partial<Claims>;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<Claims>;
  } catch {
    return { ok: false, reason: "bad-format" };
  }
  if (!claims || claims.v !== 1 || typeof claims.s !== "string") return { ok: false, reason: "bad-format" };
  return { ok: true, vars: fromClaims(claims as Claims) };
}

/** Адрес сайта для ссылок КП: боевой домен на проде, localhost в рабочей копии. */
export function proposalAppOrigin(): string {
  const raw = process.env.NEXTAUTH_URL || process.env.APP_URL || "https://wesetup.ru";
  return raw.replace(/\/+$/, "");
}

/** Веб-версия КП: `<база>/kp/<подписанный токен>`; база по умолчанию — адрес сайта (`NEXTAUTH_URL`). */
export function proposalWebUrl(vars: ProposalVars, baseUrl?: string): string {
  const base = (baseUrl || proposalAppOrigin()).replace(/\/+$/, "");
  return `${base}/kp/${signProposalToken(vars)}`;
}

/** PDF веб-версии: тот же токен + `/pdf`. */
export function proposalPdfUrl(webUrl: string): string {
  return `${webUrl.replace(/\/+$/, "")}/pdf`;
}
