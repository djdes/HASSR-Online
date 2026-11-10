/**
 * Спец-КП со скидкой из CRM (2026-11-10): форма (zod 4) и текст письма.
 * Чистый модуль — сервер (`offers.server.ts`) проверяет им тело запроса и
 * собирает письмо, `offer.test.ts` — тексты и правила формы.
 */

import { z } from "zod";

import { escapeHtml } from "@/lib/html-escape";
import { pluralRu } from "@/lib/plural-ru";

import { greeting, quoted, rub, type ManagerSignature } from "./emails";

export const OFFER_TIER_NAMES = { standard: "«Стандарт»", premium: "«Премиум»", vip: "«ВИП»" } as const;
export type OfferTier = keyof typeof OFFER_TIER_NAMES;

export const offerSchema = z.object({
  organizationId: z.string().min(1).max(64),
  tier: z.enum(["standard", "premium", "vip"]),
  cycle: z.enum(["month", "year"]),
  points: z.number().int().min(1, "Точек — от 1").max(500, "Точек — до 500"),
  discountPercent: z.number().int().min(0, "Скидка — от 0 до 90 %").max(90, "Скидка — от 0 до 90 %"),
  /** Скидка на все продления (иначе — на первую оплату по коду). */
  lifetime: z.boolean().default(false),
  validDays: z.number().int().min(1, "Срок кода — от 1 до 60 дней").max(60, "Срок кода — от 1 до 60 дней").default(7),
  attachInvoice: z.boolean().default(true),
  toEmail: z.string().trim().email("Почта получателя").max(200),
  note: z.string().trim().max(2000, "Сопроводительный текст — до 2000 знаков").optional().default(""),
  /** Задача, из которой отправляют (закроется «КП отправлено»). */
  taskId: z.string().min(1).max(64).nullable().optional(),
});
export type OfferInput = z.infer<typeof offerSchema>;

/** Согласованные условия: из задачи «Отправить КП» менять тариф, период и точки нельзя. */
export function termsMismatch(terms: { tier?: unknown; cycle?: unknown; points?: unknown }, input: Pick<OfferInput, "tier" | "cycle" | "points">): string | null {
  if (terms.tier === input.tier && terms.cycle === input.cycle && terms.points === input.points) return null;
  const tier = typeof terms.tier === "string" && terms.tier in OFFER_TIER_NAMES ? OFFER_TIER_NAMES[terms.tier as OfferTier] : "—";
  return `Согласовано на ${tier}, ${String(terms.points ?? 1)} точ., ${terms.cycle === "year" ? "за год" : "помесячно"} — другие условия отправьте на новое согласование`;
}

export function discountedRub(fullRub: number, percent: number): number {
  return Math.round((fullRub * (100 - percent)) / 100);
}

/** ««Стандарт» на 2 точки, за год: 47 760 ₽ → 38 208 ₽ (−20 %)». */
export function offerPriceLine(input: { tier: OfferTier; cycle: "month" | "year"; points: number; fullRub: number; discountPercent: number }): string {
  const points = input.points > 1 ? ` на ${input.points} ${pluralRu(input.points, "точку", "точки", "точек")}` : "";
  const period = input.cycle === "year" ? "за год" : "за месяц";
  const price = input.discountPercent ? `${rub(input.fullRub)} → ${rub(discountedRub(input.fullRub, input.discountPercent))} (−${input.discountPercent} %)` : rub(input.fullRub);
  return `${OFFER_TIER_NAMES[input.tier]}${points}, ${period}: ${price}`;
}

export type OfferEmailInput = {
  orgName: string;
  recipientName: string | null;
  tier: OfferTier;
  cycle: "month" | "year";
  points: number;
  fullRub: number;
  discountPercent: number;
  code: string | null;
  /** «24 ноября» — последний день кода. */
  codeEndsLabel: string | null;
  lifetime: boolean;
  invoice: { number: string; amountRub: number } | null;
  links: { pay: string; web: string; pdf: string };
  note: string;
  manager: ManagerSignature | null;
};

const P = 'style="margin:0 0 14px;color:#3f3f46;line-height:1.6"';
const BOX = 'style="background:#f5f6ff;border-radius:8px;padding:14px 18px;margin:0 0 18px;color:#1f2a7a;line-height:1.6"';
const BUTTON =
  'style="display:inline-block;background:#5566f6;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;font-size:14px;margin:0 8px 8px 0"';
const GHOST =
  'style="display:inline-block;background:#fff;color:#3848c7;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;font-size:14px;border:1px solid #c9cff8;margin:0 8px 8px 0"';

const ADVANCE = "Оплатить лучше заранее: бухгалтерии и директору нужно время на согласование, а в выходные платежи не проходят.";

export function renderOfferEmail(input: OfferEmailInput): { subject: string; html: string; text: string } {
  const org = quoted(input.orgName);
  const discounted = discountedRub(input.fullRub, input.discountPercent);
  const price = offerPriceLine(input);
  const monthly = input.cycle === "year" ? ` — ${rub(Math.round((input.discountPercent ? discounted : input.fullRub) / 12))} в месяц` : "";
  const codeText = input.code
    ? `Промокод ${input.code}${input.codeEndsLabel ? ` действует по ${input.codeEndsLabel}` : ""}${input.lifetime ? ", скидка сохранится на все продления" : ", скидка — на эту оплату"}. В кнопке «Оплатить» он уже подставлен.`
    : null;
  const intro = input.note.trim() || `Подготовил для ${org} персональное предложение по тарифу.`;
  const invoiceText = input.invoice ? `Счёт №${input.invoice.number} на ${rub(input.invoice.amountRub)} — во вложении.` : null;
  const lines = input.manager ? [input.manager.name, input.manager.position, input.manager.phone, input.manager.email].map((line) => (line ?? "").trim()).filter(Boolean) : ["Команда WeSetup"];

  const html =
    `<p ${P}>${escapeHtml(greeting(input.recipientName))}</p>` +
    `<p ${P}>${escapeHtml(intro).replace(/\n/g, "<br>")}</p>` +
    `<div ${BOX}><strong>${escapeHtml(price + monthly)}</strong></div>` +
    (codeText ? `<p ${P}>${escapeHtml(codeText)}</p>` : "") +
    (invoiceText ? `<p ${P}><strong>${escapeHtml(invoiceText)}</strong></p>` : "") +
    `<p ${P}>${escapeHtml(ADVANCE)}</p>` +
    `<p style="margin:0 0 6px"><a href="${input.links.pay}" ${BUTTON}>Оплатить</a><a href="${input.links.web}" ${GHOST}>Коммерческое предложение</a></p>` +
    `<p style="margin:0 0 14px;color:#6f7282;font-size:13px">PDF: <a href="${input.links.pdf}" style="color:#3848c7">скачать</a></p>` +
    `<p style="margin:18px 0 0;color:#3f3f46;line-height:1.5">${lines.map(escapeHtml).join("<br>")}<br><span style="color:#9b9fb3">WeSetup — электронные журналы ХАССП</span></p>`;
  const text = [
    greeting(input.recipientName),
    intro,
    price + monthly,
    codeText,
    invoiceText,
    ADVANCE,
    `Оплатить: ${input.links.pay}`,
    `Коммерческое предложение: ${input.links.web}`,
    [...lines, "WeSetup — электронные журналы ХАССП"].join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");
  const subject = input.discountPercent
    ? `${org}: спецпредложение — ${OFFER_TIER_NAMES[input.tier]} со скидкой ${input.discountPercent} %`
    : `${org}: предложение по тарифу ${OFFER_TIER_NAMES[input.tier]}`;
  return { subject, html, text };
}
