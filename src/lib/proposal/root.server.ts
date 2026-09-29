import { z } from "zod";

import { db } from "@/lib/db";
import {
  describeDiscount,
  isValidPromoCodeFormat,
  normalizePromoCode,
  validatePromo,
  type PromoRejectReason,
} from "@/lib/promo/rules";
import { promotionEndLabel } from "@/lib/promo/promotions";
import { PAID_ORDER_STATUSES } from "@/lib/promo/service";

import { buildProposalContent, type ProposalContent } from "./content";
import { loadProposalContext } from "./context.server";
import { renderProposalEmailHtml } from "./email";
import { signProposalToken, proposalPdfUrl } from "./token";
import { isProposalSphere } from "./spheres";
import type { ProposalPromo, ProposalSender, ProposalVars, RenderedProposalEmail } from "./types";
import { normalizeSender } from "./vars";

/**
 * ROOT → «Коммерческие предложения»: разбор формы генератора, промокод из
 * базы или введённый вручную, предупреждения, ссылки и письмо для
 * предпросмотра. Серверный модуль — его зовут маршруты `/api/root/proposals/*`.
 */

export const PROPOSAL_AUDIT_ENTITY = "Proposal";
export const PLATFORM_ORG_ID = process.env.PLATFORM_ORG_ID || "platform";

const senderSchema = z.object({
  name: z.string().trim().max(120),
  phone: z.string().trim().max(120).nullable().optional(),
  email: z.string().trim().max(120).nullable().optional(),
  telegram: z.string().trim().max(120).nullable().optional(),
});

export const proposalFormSchema = z.object({
  sphere: z.string().refine((value) => isProposalSphere(value), "Выберите сферу"),
  companyName: z.string().max(200).nullable().optional(),
  recipientName: z.string().max(120).nullable().optional(),
  /** Код из базы или введённый вручную; пусто — без промокода. */
  promoCode: z.string().max(64).nullable().optional(),
  /** Параметры для кода, которого нет в базе. */
  manualPromo: z
    .object({
      kind: z.enum(["percent", "fixed"]),
      value: z.number().int().min(1).max(1_000_000),
      lifetime: z.boolean(),
      endsAt: z.string().datetime().nullable().optional(),
    })
    .nullable()
    .optional(),
  sender: senderSchema.nullable().optional(),
});

export type ProposalForm = z.infer<typeof proposalFormSchema>;

/** «Промокод X отключён» и т. п. — короче, чем общее сообщение оплаты. */
const PROMO_WARNING: Record<PromoRejectReason, (code: string) => string> = {
  "not-found": (code) => `Промокода ${code} нет`,
  inactive: (code) => `Промокод ${code} отключён`,
  "not-started": (code) => `Промокод ${code} ещё не начал действовать`,
  expired: (code) => `Срок промокода ${code} истёк`,
  exhausted: (code) => `Промокод ${code} уже использован максимальное число раз`,
  "new-clients-only": (code) => `Промокод ${code} — только для новых клиентов`,
  "personal-foreign": (code) => `Промокод ${code} персональный — он выдан другой организации`,
};

export type ProposalPromoOption = {
  code: string;
  kind: "percent" | "fixed";
  value: number;
  lifetime: boolean;
  endsAt: string | null;
  label: string;
};

/** «Навсегда» — `PromoCode.lifetime` (скидка закрепляется за аккаунтом после первой оплаты). */
function lifetimeOf(row: { lifetime: boolean }): boolean {
  return row.lifetime === true;
}

function promoOptionLabel(option: Omit<ProposalPromoOption, "label">): string {
  const discount = describeDiscount(option);
  // Срок — так же, как в самом КП: конец в полночь — «до 31 октября» (последний день целиком).
  const term = option.lifetime ? " навсегда" : option.endsAt ? ` ${promotionEndLabel(option.endsAt)}` : "";
  return `${option.code} · ${discount}${term}`;
}

/** Строка `PromoCode` → вариант списка генератора (подпись — как в самом КП). */
export function proposalPromoOption(row: {
  code: string;
  kind: string;
  value: number;
  lifetime: boolean;
  endsAt: Date | null;
}): ProposalPromoOption {
  const option = {
    code: row.code,
    kind: row.kind === "fixed" ? ("fixed" as const) : ("percent" as const),
    value: row.value,
    lifetime: lifetimeOf(row),
    endsAt: row.endsAt?.toISOString() ?? null,
  };
  return { ...option, label: promoOptionLabel(option) };
}

/** Действующие промокоды для выбора в генераторе (включены, срок не прошёл). */
export async function listProposalPromoOptions(now: Date = new Date()): Promise<ProposalPromoOption[]> {
  const rows = await db.promoCode.findMany({
    where: { active: true, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows.map(proposalPromoOption);
}

export type ResolvedProposalForm = {
  vars: ProposalVars;
  warnings: string[];
  promoSource: "none" | "database" | "manual";
};

/** Форма → переменные КП; промокод сверяется с базой, всё подозрительное — в предупреждения. */
export async function resolveProposalForm(
  form: ProposalForm,
  defaults: { sender: ProposalSender | null },
  now: Date = new Date(),
): Promise<ResolvedProposalForm> {
  const warnings: string[] = [];
  let promo: ProposalPromo | null = null;
  let promoSource: ResolvedProposalForm["promoSource"] = "none";
  const rawCode = form.promoCode?.trim() ?? "";
  if (rawCode) {
    const code = normalizePromoCode(rawCode);
    if (!isValidPromoCodeFormat(code)) {
      warnings.push("Промокод: латиница, цифры, «-» и «_», от 3 до 32 символов — в КП он не попадёт.");
    } else {
      const row = await db.promoCode.findUnique({ where: { code } });
      if (row) {
        promoSource = "database";
        promo = {
          code: row.code,
          kind: row.kind === "fixed" ? "fixed" : "percent",
          value: row.value,
          lifetime: lifetimeOf(row),
          endsAt: row.endsAt,
        };
        const paidUses = await db.paymentOrder.count({
          where: { promoCode: row.code, status: { in: [...PAID_ORDER_STATUSES] } },
        });
        const verdict = validatePromo(
          {
            code: row.code,
            kind: promo.kind,
            value: row.value,
            active: row.active,
            startsAt: row.startsAt,
            endsAt: row.endsAt,
            maxUses: row.maxUses,
            newClientsOnly: row.newClientsOnly,
          },
          { now, paidUses, organizationHasPaidOrders: false },
        );
        if (!verdict.ok) warnings.push(`${PROMO_WARNING[verdict.reason](row.code)} — клиенту он не даст скидку.`);
        if (row.newClientsOnly) warnings.push(`Промокод ${row.code} — только для новых клиентов.`);
      } else if (form.manualPromo) {
        promoSource = "manual";
        promo = {
          code,
          kind: form.manualPromo.kind,
          value: form.manualPromo.value,
          lifetime: form.manualPromo.lifetime,
          endsAt: form.manualPromo.endsAt ? new Date(form.manualPromo.endsAt) : null,
        };
        warnings.push(
          `Промокода ${code} нет в базе: создайте его в ROOT → «Промокоды» с теми же условиями, иначе на сайте он не сработает.`,
        );
      } else {
        warnings.push(`Промокода ${code} нет в базе — укажите размер скидки или выберите код из списка.`);
      }
    }
  }
  if (promo?.kind === "percent" && promo.value > 100) {
    warnings.push("Скидка в процентах не может быть больше 100.");
    promo = null;
  }

  const sender = form.sender ? normalizeSender(form.sender) : null;
  if (form.sender && !sender) warnings.push("Отправитель без имени — в КП будет отправитель по умолчанию.");
  // Совпадает с сохранённым по умолчанию — в ссылку не зашиваем: веб-версия
  // покажет актуального отправителя, если его поменяют.
  const sameAsDefault =
    sender && defaults.sender && JSON.stringify(sender) === JSON.stringify(normalizeSender(defaults.sender));

  return {
    vars: {
      sphere: form.sphere as ProposalVars["sphere"],
      companyName: form.companyName ?? null,
      recipientName: form.recipientName ?? null,
      promo,
      sender: sameAsDefault ? null : sender,
    },
    warnings,
    promoSource,
  };
}

export type ProposalPreview = {
  vars: ProposalVars;
  webUrl: string;
  pdfUrl: string;
  email: RenderedProposalEmail & { bytes: number };
  content: Pick<ProposalContent, "title" | "addressee" | "sphereLabel" | "subject" | "preheader"> & {
    price: { baseRub: number; priceRub: number; oldRub: number | null; badge: string | null };
    ctaUrl: string;
  };
  warnings: string[];
};

/** Всё для предпросмотра: ссылки на веб-версию и PDF, письмо, предупреждения. */
export async function buildProposalPreview(
  resolved: ResolvedProposalForm,
  origin: string,
  now: Date = new Date(),
): Promise<ProposalPreview> {
  const context = await loadProposalContext(now);
  const content = buildProposalContent(resolved.vars, context);
  const webUrl = `${origin.replace(/\/+$/, "")}/kp/${signProposalToken(resolved.vars)}`;
  const pdfUrl = proposalPdfUrl(webUrl);
  const email = renderProposalEmailHtml(content, { web: webUrl, pdf: pdfUrl, unsubscribe: null });
  const warnings = [...resolved.warnings];
  if (!context.tariffActive) warnings.push("Тариф «Подписка» снят с продажи (ROOT → «Тарифы») — оплатить по КП не получится.");
  if (!content.requisites) warnings.push("Реквизиты не заполнены (ROOT → «Реквизиты») — внизу КП их не будет.");
  if (!context.invoiceReady) warnings.push("Счёт по безналу сейчас не выставляется — в КП только «оплата картой».");
  if (content.price.promoExpired) warnings.push("Срок промокода уже прошёл — КП покажет цену без скидки.");
  return {
    vars: resolved.vars,
    webUrl,
    pdfUrl,
    email: { ...email, bytes: Buffer.byteLength(email.html, "utf8") },
    content: {
      title: content.title,
      addressee: content.addressee,
      sphereLabel: content.sphereLabel,
      subject: content.subject,
      preheader: content.preheader,
      price: {
        baseRub: content.price.baseRub,
        priceRub: content.price.priceRub,
        oldRub: content.price.oldRub,
        badge: content.offer.rows[1].badge,
      },
      ctaUrl: content.offer.ctaUrl,
    },
    warnings,
  };
}

/** Короткая сводка для аудита и логов (без контактов отправителя). */
export function proposalAuditDetails(vars: ProposalVars): Record<string, unknown> {
  return {
    sphere: vars.sphere,
    companyName: vars.companyName ?? null,
    recipientName: vars.recipientName ?? null,
    promo: vars.promo
      ? {
          code: vars.promo.code,
          kind: vars.promo.kind,
          value: vars.promo.value,
          lifetime: vars.promo.lifetime,
          endsAt: vars.promo.endsAt?.toISOString() ?? null,
        }
      : null,
    customSender: vars.sender ? vars.sender.name : null,
  };
}
