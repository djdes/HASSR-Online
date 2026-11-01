import { createHmac, timingSafeEqual } from "node:crypto";

import { isValidInn } from "@/lib/inn";
import type { LegalProfile } from "@/lib/org-legal-profile";

/**
 * Счёт по ИНН без регистрации (/order, 2026-11-01): бухгалтерия платит от
 * организации, а заводить кабинет до оплаты никто не хочет. Покупатель —
 * снимок ЕГРЮЛ по ИНН (DaData) или введённые название и ИНН; хранится в
 * заказе (`PaymentOrder.buyerJson`), потому что организации ещё нет. Оплату
 * отмечает ROOT («Счета гостей»), дальше — тот же путь, что у оплаты картой:
 * аккаунт, ссылка на достройку, ИНН и реквизиты переходят в организацию.
 *
 * Модуль серверный (`node:crypto`), без БД: разбор формы, снимок покупателя
 * и подпись ссылки на PDF.
 */

export type GuestBuyer = {
  inn: string;
  /** Как в счёте: полное наименование из ЕГРЮЛ или введённое. */
  name: string;
  kpp: string | null;
  address: string | null;
  /** Полный снимок ЕГРЮЛ, если DaData нашла организацию. */
  legalProfile: LegalProfile | null;
};

export type GuestInvoiceInput = {
  inn: string;
  email: string;
  companyName: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Разбор формы: ИНН с контрольной суммой, почта, название (нужно, если ЕГРЮЛ не ответил). */
export function parseGuestInvoiceInput(raw: unknown): { ok: true; value: GuestInvoiceInput } | { ok: false; error: string } {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const inn = typeof o.inn === "string" ? o.inn.replace(/\D/g, "") : "";
  const email = typeof o.email === "string" ? o.email.trim().toLowerCase() : "";
  const companyName = typeof o.companyName === "string" ? o.companyName.trim().slice(0, 300) : "";
  if (inn.length !== 10 && inn.length !== 12) return { ok: false, error: "ИНН — 10 цифр у организации или 12 у ИП" };
  if (!isValidInn(inn)) return { ok: false, error: "Такого ИНН не бывает — проверьте цифры" };
  if (!EMAIL_RE.test(email) || email.length > 200) return { ok: false, error: "Укажите почту — на неё придёт счёт" };
  return { ok: true, value: { inn, email, companyName } };
}

/** Покупатель счёта: ЕГРЮЛ важнее введённого; без ЕГРЮЛ название обязательно. */
export function guestBuyerFrom(input: GuestInvoiceInput, profile: LegalProfile | null): GuestBuyer | null {
  if (profile) {
    return {
      inn: profile.inn,
      name: profile.nameFull?.trim() || profile.nameShort?.trim() || input.companyName,
      kpp: profile.kpp?.trim() || null,
      address: profile.address?.trim() || null,
      legalProfile: profile,
    };
  }
  if (input.companyName.length < 2) return null;
  return { inn: input.inn, name: input.companyName, kpp: null, address: null, legalProfile: null };
}

/** Снимок покупателя из JSON-колонки заказа (только то, что нужно счёту). */
export function readGuestBuyer(json: unknown): GuestBuyer | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  if (typeof o.inn !== "string" || typeof o.name !== "string") return null;
  return {
    inn: o.inn,
    name: o.name,
    kpp: typeof o.kpp === "string" ? o.kpp : null,
    address: typeof o.address === "string" ? o.address : null,
    legalProfile: o.legalProfile && typeof o.legalProfile === "object" ? (o.legalProfile as LegalProfile) : null,
  };
}

function signatureSecret(): string {
  return process.env.NEXTAUTH_SECRET || process.env.INTEGRATION_KEY_SECRET || "wesetup-dev-secret";
}

/** Подпись ссылки на PDF гостевого счёта: номер заказа и почта покупателя. */
export function signGuestInvoice(orderId: number, email: string, secret = signatureSecret()): string {
  return createHmac("sha256", secret).update(`guest-invoice:${orderId}:${email.trim().toLowerCase()}`).digest("base64url").slice(0, 32);
}

export function verifyGuestInvoice(orderId: number, email: string, signature: string, secret = signatureSecret()): boolean {
  const expected = Buffer.from(signGuestInvoice(orderId, email, secret));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function guestInvoicePdfPath(orderId: number, email: string): string {
  return `/api/payments/invoice/${orderId}/guest-pdf?sig=${signGuestInvoice(orderId, email)}`;
}
