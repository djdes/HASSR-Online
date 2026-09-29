import { normalizePromoCode } from "@/lib/promo/rules";

import { isProposalSphere } from "./spheres";
import type { ProposalPromo, ProposalSender, ProposalVars } from "./types";

/**
 * Приведение входных данных КП к безопасному виду — одно для PDF, письма,
 * веб-версии и токена: пробелы, длина строк, код промокода, отправитель.
 * Длинное название компании не отрезается молча в вёрстке — здесь только
 * защитный потолок (в спеке — «до 80 знаков должны влезать»).
 */

export const COMPANY_NAME_MAX = 120;
export const RECIPIENT_NAME_MAX = 80;
export const SENDER_FIELD_MAX = 120;

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** «@name», «name», «https://t.me/name» → «name» (без @). */
export function normalizeTelegram(value: unknown): string | null {
  const raw = clean(value, SENDER_FIELD_MAX);
  if (!raw) return null;
  const handle = raw
    .replace(/^https?:\/\/(www\.)?(t\.me|telegram\.me)\//i, "")
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "")
    .trim();
  return /^[A-Za-z0-9_]{3,64}$/.test(handle) ? handle : null;
}

export function normalizeSender(value: unknown): ProposalSender | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const name = clean(raw.name, SENDER_FIELD_MAX);
  if (!name) return null;
  const email = clean(raw.email, SENDER_FIELD_MAX);
  return {
    name,
    phone: clean(raw.phone, SENDER_FIELD_MAX),
    email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email.toLowerCase() : null,
    telegram: normalizeTelegram(raw.telegram),
  };
}

export function normalizePromo(value: unknown): ProposalPromo | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const code = typeof raw.code === "string" ? normalizePromoCode(raw.code) : "";
  if (!/^[A-Z0-9_-]{3,32}$/.test(code)) return null;
  const kind = raw.kind === "fixed" ? "fixed" : raw.kind === "percent" ? "percent" : null;
  const amount = Number(raw.value);
  if (!kind || !Number.isFinite(amount) || amount <= 0) return null;
  let endsAt: Date | null = null;
  if (raw.endsAt instanceof Date) endsAt = Number.isFinite(raw.endsAt.getTime()) ? raw.endsAt : null;
  else if (typeof raw.endsAt === "string" && raw.endsAt) {
    const parsed = new Date(raw.endsAt);
    endsAt = Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  return {
    code,
    kind,
    value: kind === "percent" ? Math.min(100, Math.round(amount)) : Math.round(amount),
    lifetime: raw.lifetime === true,
    endsAt,
  };
}

/** Полная нормализация; сфера неизвестна → «other». */
export function normalizeProposalVars(vars: ProposalVars): ProposalVars {
  return {
    sphere: isProposalSphere(vars.sphere) ? vars.sphere : "other",
    companyName: clean(vars.companyName, COMPANY_NAME_MAX),
    recipientName: clean(vars.recipientName, RECIPIENT_NAME_MAX),
    promo: normalizePromo(vars.promo),
    ctaUrl: clean(vars.ctaUrl, 2000),
    sender: normalizeSender(vars.sender),
  };
}
