import { isTechnicalEmail } from "@/lib/technical-email";

import type { ContractRecipient, ContractRecipientSource } from "./types";

/**
 * Кому предложить договор письмом. Порядок — от самого надёжного адреса:
 * почта владельца (логин, если не служебный), его контактная почта,
 * почта бухгалтера организации, почты из ЕГРЮЛ (DaData). Служебные адреса
 * сотрудников (`…@….staff.local`, `…local.haccp`) человек не читает —
 * их не предлагаем. Дубли (без учёта регистра) убираются.
 */

const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]{2,}$/;

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

/** Почта, на которую можно отправлять договор: валидная и не служебная. */
export function isDeliverableEmail(value: unknown): boolean {
  const email = normalizeEmail(value);
  return email !== null && !isTechnicalEmail(email);
}

function registryEmails(legalProfileJson: unknown): string[] {
  if (!legalProfileJson || typeof legalProfileJson !== "object" || Array.isArray(legalProfileJson)) return [];
  const emails = (legalProfileJson as { emails?: unknown }).emails;
  if (!Array.isArray(emails)) return [];
  return emails.filter((item): item is string => typeof item === "string");
}

export function contractRecipientSuggestions(input: {
  ownerEmail?: string | null;
  ownerContactEmail?: string | null;
  accountantEmail?: string | null;
  legalProfileJson?: unknown;
}): ContractRecipient[] {
  const candidates: Array<[unknown, ContractRecipientSource]> = [
    [input.ownerEmail, "owner"],
    [input.ownerContactEmail, "ownerContact"],
    [input.accountantEmail, "accountant"],
    ...registryEmails(input.legalProfileJson).map((email): [unknown, ContractRecipientSource] => [email, "registry"]),
  ];
  const seen = new Set<string>();
  const result: ContractRecipient[] = [];
  for (const [raw, source] of candidates) {
    const email = normalizeEmail(raw);
    if (!email || isTechnicalEmail(email) || seen.has(email)) continue;
    seen.add(email);
    result.push({ email, source });
  }
  return result;
}

/** Список адресов из формы: нормализует, убирает дубли, отбрасывает служебные. */
export function cleanRecipientList(values: readonly string[]): { valid: string[]; rejected: string[] } {
  const valid: string[] = [];
  const rejected: string[] = [];
  for (const raw of values) {
    const email = normalizeEmail(raw);
    if (!email || isTechnicalEmail(email)) {
      rejected.push(raw);
      continue;
    }
    if (!valid.includes(email)) valid.push(email);
  }
  return { valid, rejected };
}
