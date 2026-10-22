import { db } from "@/lib/db";
import { escapeHtml } from "@/lib/html-escape";
import { renderAurora } from "@/lib/mailing/promo-designs/aurora";
import { renderCompare } from "@/lib/mailing/promo-designs/compare";
import { renderCoupon } from "@/lib/mailing/promo-designs/coupon";
import { renderCountdown } from "@/lib/mailing/promo-designs/countdown";
import { renderLetter } from "@/lib/mailing/promo-designs/letter";
import type { PromoMailView } from "@/lib/mailing/promo-designs/shared";
import { PROPOSAL_SITE_ORIGIN } from "@/lib/proposal/cta";
import { ORG_SPHERES } from "@/lib/org-profile";
import {
  createPersonalPromoCodes,
  readPromoForOffer,
  suggestPersonalCode,
  type PersonalCodeOptions,
  type PersonalCodeRequest,
} from "@/lib/promo/personal-codes";
import { computeDiscountRub, normalizePromoCode } from "@/lib/promo/rules";
import { promoEndsAfterDays } from "@/lib/promo/valid-days";
import { readTariffs } from "@/lib/tariffs";

import type { MailingRecipientContext, MailingTemplate, RenderedMailing } from "../templates";
import { readSharedPromoOptions } from "./kp";
import {
  checkPromoPayload,
  coercePromoPayload,
  daysLabel,
  defaultPromoPayload,
  fillPromoText,
  promoPrices,
  rubLabel,
  type PromoDesign,
  type PromoFormData,
  type PromoMailPayload,
  type PromoTextVars,
} from "./promo-shared";

/**
 * Вид рассылки «Акция»: промо-письмо с персональной скидкой на подписку в
 * одном из пяти дизайнов (`src/lib/mailing/promo-designs/*`). Спека:
 * `docs/superpowers/specs/2026-10-22-mailing-promo-templates-design.md`.
 *
 *   • промокод — персональный каждому (`prepare` при старте отправки, как
 *     у «КП») или один общий из «Промокодов»;
 *   • кнопка ведёт на `/promo/<КОД>` через учёт кликов: человек попадает в
 *     оплату со скидкой; отписка — без учёта кликов;
 *   • письмо — свой полный HTML-документ дизайна, колокольчик, push и
 *     Telegram — короткий текст с той же ссылкой.
 */

export type { PromoMailPayload } from "./promo-shared";

type Log = (level: "info" | "debug" | "warn" | "error", message: string, data?: Record<string, unknown>) => void;

type SharedPromo = { code: string; kind: "percent" | "fixed"; value: number; lifetime: boolean; endsAt: Date | null };

export type PromoTemplateDeps = {
  now(): Date;
  /** Данные общего кода; null — нет или не действует (`readPromoForOffer`). */
  readPromo(code: string): Promise<SharedPromo | null>;
  /** Кому выдан код и сколько раз им можно оплатить; null — кода нет. */
  promoAudience(code: string): Promise<{ personal: boolean; maxUses: number | null } | null>;
  createCodes(
    requests: PersonalCodeRequest[],
    options: PersonalCodeOptions
  ): Promise<Map<string, { id: string; code: string }>>;
  formData(now: Date): Promise<PromoFormData>;
  log?: Log;
  /** Сколько держать данные общего кода, мс (по умолчанию минута). */
  promoTtlMs?: number;
};

const defaultLog: Log = (level, message, data) => {
  const line = `[mailing] promo ${message}`;
  if (level === "error") console.error(line, data ?? "");
  else if (level === "warn") console.warn(line, data ?? "");
  else if (level === "debug") console.debug(line, data ?? "");
  else console.info(line, data ?? "");
};

export const defaultPromoDeps: PromoTemplateDeps = {
  now: () => new Date(),
  readPromo: (code) => readPromoForOffer(code),
  async promoAudience(code) {
    const row = await db.promoCode.findUnique({
      where: { code },
      select: { personalEmail: true, organizationId: true, maxUses: true },
    });
    return row ? { personal: Boolean(row.personalEmail || row.organizationId), maxUses: row.maxUses } : null;
  },
  createCodes: (requests, options) => createPersonalPromoCodes(requests, options),
  async formData(now) {
    const [promoOptions, tariffs] = await Promise.all([readSharedPromoOptions(now), readTariffs()]);
    const paid = tariffs.find((t) => t.active && t.priceRub > 0) ?? null;
    return { promoOptions, paidTariff: paid ? { title: paid.title, priceRub: paid.priceRub } : null };
  },
};

const DAY_MS = 86_400_000;

function hasCode(personal: Record<string, unknown>): boolean {
  return typeof personal.promoCode === "string" && personal.promoCode.trim() !== "";
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function sphereLabel(sphere: string | null): string | null {
  if (!sphere) return null;
  return ORG_SPHERES.find((s) => s.value === sphere)?.label ?? null;
}

/** «21 ноября»: срок кончается в 23:59 по Москве; ровно в полночь называем предыдущий день. */
export function promoDateLabel(endsAt: Date): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "Europe/Moscow" }).format(
    new Date(endsAt.getTime() - 1)
  );
}

function shorten(text: string, max: number): string {
  const clean = text.replace(/[ \t\r\n]+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:—-]+$/, "")}…`;
}

function capitalize(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/** Прехедер 20–140 знаков: начало лида, а если лид короткий — заголовок и условия. */
export function promoPreheader(lead: string, headline: string, offer: string): string {
  const base = lead.replace(/[ \t\r\n]+/g, " ").trim();
  const text = base.length >= 20 ? base : `${headline.replace(/[ \t\r\n]+/g, " ").trim()}. ${offer}.`;
  return shorten(text, 130);
}

const RENDERERS: Record<PromoDesign, (view: PromoMailView) => string> = {
  aurora: renderAurora,
  coupon: renderCoupon,
  countdown: renderCountdown,
  compare: renderCompare,
  letter: renderLetter,
};

/** Цены по условиям кода: процентный — как у `applyPromotion`, в рублях — вычет суммы. */
function pricesFor(priceRub: number, promo: { kind: "percent" | "fixed"; value: number } | null, percent: number) {
  if (promo && promo.kind === "fixed") {
    const savingRub = computeDiscountRub(promo, priceRub);
    const oldRub = Math.max(0, Math.round(priceRub));
    return {
      prices: { oldRub, newRub: oldRub - savingRub, savingRub },
      percent: Math.min(90, Math.max(1, Math.round((savingRub / Math.max(1, oldRub)) * 100))),
    };
  }
  const value = promo ? promo.value : percent;
  return { prices: promoPrices(priceRub, value), percent: value };
}

export function createPromoTemplate(deps: PromoTemplateDeps = defaultPromoDeps): MailingTemplate<PromoMailPayload> {
  const log = deps.log ?? defaultLog;
  const promoTtl = deps.promoTtlMs ?? 60_000;
  const promoCache = new Map<string, { value: SharedPromo | null; at: number }>();

  async function sharedPromo(code: string, now: Date): Promise<SharedPromo | null> {
    const hit = promoCache.get(code);
    if (hit && now.getTime() - hit.at <= promoTtl && now.getTime() >= hit.at) return hit.value;
    const value = await deps.readPromo(code);
    promoCache.set(code, { value, at: now.getTime() });
    log("info", `shared code ${code} ${value ? "active" : "not active"}`);
    return value;
  }

  /** Код и условия для получателя; `sample` — пример в предпросмотре и тесте себе. */
  async function codeFor(
    payload: PromoMailPayload,
    ctx: MailingRecipientContext,
    now: Date
  ): Promise<{ code: string; endsAt: Date | null; lifetime: boolean; promo: SharedPromo | null; sample: boolean }> {
    const p = payload.promo;
    if (p.mode === "existing") {
      const code = p.code ? normalizePromoCode(p.code) : "";
      const promo = code ? await sharedPromo(code, now) : null;
      if (!code || !promo) {
        // Скидки по выключенному коду нет — письмо с таким предложением отправлять нельзя.
        throw new Error(`промокод ${code || "—"} сейчас не действует — письмо не отправлено`);
      }
      return { code, endsAt: promo.endsAt, lifetime: promo.lifetime, promo, sample: false };
    }
    const own = ctx.personal;
    if (hasCode(own)) {
      const code = normalizePromoCode(String(own.promoCode));
      let endsAt = parseDate(own.promoEndsAt);
      if (!endsAt && own.promoEndsAt !== null) endsAt = (await sharedPromo(code, now))?.endsAt ?? null;
      return { code, endsAt, lifetime: p.lifetime, promo: null, sample: false };
    }
    if (ctx.mode === "live") {
      // Без кода письмо с «примером» уйти не должно: подготовка не дошла до этого получателя.
      throw new Error("нет персонального промокода — подготовка рассылки не дошла до получателя");
    }
    return {
      code: suggestPersonalCode(ctx.companyName, payload.discountPercent),
      endsAt: promoEndsAfterDays(now, payload.durationDays),
      lifetime: p.lifetime,
      promo: null,
      sample: true,
    };
  }

  return {
    kind: "promo",
    label: "Акция",
    defaultPayload: () => defaultPromoPayload(),

    async validate(raw) {
      const checked = checkPromoPayload(raw);
      if (!checked.ok) return checked;
      const payload = checked.payload;
      if (payload.promo.mode === "existing" && payload.promo.code) {
        const code = payload.promo.code;
        const audience = await deps.promoAudience(code);
        if (!audience) return { ok: false, error: `Промокода ${code} нет в «Промокодах»` };
        if (audience.personal) {
          return {
            ok: false,
            error: `Промокод ${code} персональный — он сработает только у одного клиента. Выберите общий код или «Персональный каждому»`,
          };
        }
        if (audience.maxUses === 1) {
          return {
            ok: false,
            error: `Промокод ${code} одноразовый — оплатить по нему сможет только один получатель. Выберите общий код или «Персональный каждому»`,
          };
        }
        const promo = await deps.readPromo(code);
        if (!promo) {
          return { ok: false, error: `Промокод ${code} сейчас не действует (выключен, не начался, истёк или исчерпан)` };
        }
      }
      return { ok: true, payload };
    },

    async prepare(campaign, recipients) {
      const payload = coercePromoPayload(campaign.payload);
      if (payload.promo.mode !== "personal") {
        log("info", `prepare campaign=${campaign.id} mode=${payload.promo.mode}: персональные коды не нужны`, { recipients: recipients.length });
        return {};
      }
      const todo = recipients.filter((r) => !hasCode(r.personal));
      const kept = recipients.length - todo.length;
      if (todo.length === 0) {
        log("info", `prepare campaign=${campaign.id}: у всех получателей код уже есть`, { kept });
        return {};
      }
      const now = deps.now();
      const endsAt = promoEndsAfterDays(now, payload.durationDays);
      const requests: PersonalCodeRequest[] = todo.map((r) =>
        r.organizationId
          ? { key: r.id, email: null, organizationId: r.organizationId, companyName: r.companyName }
          : // Контакт без организации: код без привязки к почте, одна оплата — как у «КП».
            { key: r.id, email: null, companyName: r.companyName, unlocked: true }
      );
      const title = campaign.title.trim() || "без названия";
      const started = Date.now();
      const created = await deps.createCodes(requests, {
        kind: "percent",
        value: payload.discountPercent,
        lifetime: payload.promo.lifetime,
        endsAt,
        note: `Рассылка «${title}»`,
        campaignId: campaign.id,
      });
      const out: Record<string, Record<string, unknown>> = {};
      for (const r of todo) {
        const c = created.get(r.id);
        if (c) out[r.id] = { promoCode: c.code, promoEndsAt: endsAt.toISOString() };
      }
      log("info", `prepare campaign=${campaign.id}: personal codes ${Object.keys(out).length}`, {
        kept,
        discount: `percent ${payload.discountPercent}${payload.promo.lifetime ? " lifetime" : ""}`,
        endsAt: endsAt.toISOString(),
        ms: Date.now() - started,
      });
      if (Object.keys(out).length !== todo.length) {
        throw new Error(`создано кодов ${Object.keys(out).length} из ${todo.length}`);
      }
      return out;
    },

    async render(raw, ctx) {
      const payload = coercePromoPayload(raw);
      const now = deps.now();
      const { code, endsAt, lifetime, promo, sample } = await codeFor(payload, ctx, now);
      const { prices, percent } = pricesFor(payload.priceRub, promo, payload.discountPercent);
      // Общий код живёт до своей даты, персональный — durationDays; считаем остаток честно.
      const days =
        promo && endsAt
          ? Math.max(1, Math.ceil((endsAt.getTime() - now.getTime()) / DAY_MS))
          : payload.durationDays;
      const endsLabel = endsAt ? promoDateLabel(endsAt) : null;
      const until = endsLabel ? `до ${endsLabel}` : "до конца акции";
      const offer = `−${percent} % на ${daysLabel(days)}`;
      const vars: PromoTextVars = {
        percent,
        tariff: payload.tariffLabel,
        days,
        date: endsLabel ?? "конца акции",
        saving: prices.savingRub,
        offer,
      };
      const values = { name: ctx.name, company: ctx.companyName, sphere: sphereLabel(ctx.sphere) };
      const fill = (text: string, override?: Partial<{ offer: string }>) =>
        fillPromoText(text, { ...vars, ...override }, values, payload.fallbacks);

      const subject = fill(payload.subject).replace(/[ \t\r\n]+/g, " ").trim();
      const headline = capitalize(fill(payload.headline).replace(/[ \t\r\n]+/g, " ").trim());
      const lead = fill(payload.lead).trim();
      const buttonText = fill(payload.buttonText).replace(/[ \t\r\n]+/g, " ").trim();
      const preheader = promoPreheader(lead, headline, offer);
      const sitePath = `/promo/${encodeURIComponent(code)}`;
      const ctaUrl = ctx.trackUrl(`${PROPOSAL_SITE_ORIGIN}${sitePath}`);

      const view: PromoMailView = {
        design: payload.design,
        origin: PROPOSAL_SITE_ORIGIN,
        subject,
        preheader,
        headline,
        lead,
        leadTemplate: payload.lead,
        buttonText,
        tariff: payload.tariffLabel,
        percent,
        durationDays: days,
        benefits: payload.benefits,
        prices,
        code,
        ctaUrl,
        unsubscribeUrl: ctx.unsubscribeUrl,
        endsAt,
        endsLabel,
        until,
        lifetime,
        name: ctx.name?.trim() || null,
        company: ctx.companyName?.trim() || null,
        now,
        fill,
      };
      const html = RENDERERS[payload.design](view);

      const text = [
        headline,
        lead,
        `Промокод: ${code} — применится сам по ссылке (${until}).`,
        `${payload.tariffLabel}: ${rubLabel(prices.oldRub)} → ${rubLabel(prices.newRub)} в месяц.`,
        `${buttonText}: ${ctaUrl}`,
        "—\nWeSetup — электронные журналы СанПиН и ХАССП.",
        `Вы получили письмо, потому что пользуетесь WeSetup или оставляли контакт. Отписаться: ${ctx.unsubscribeUrl}`,
      ].join("\n\n");

      const shortBody = `${shorten(lead || headline, 160)} Промокод ${code}.`;
      const rendered: RenderedMailing = {
        email: { subject, preheader, html, text },
        // Колокольчик и push открываются внутри кабинета — путь сайта; учёт кликов — в письме и Telegram.
        inApp: { title: shorten(headline, 90), body: shortBody, url: sitePath },
        push: { title: shorten(headline, 80), body: shorten(shortBody, 180), url: sitePath },
        telegram: {
          text: `<b>${escapeHtml(headline)}</b>\n\n${escapeHtml(lead)}\n\nПромокод: <code>${escapeHtml(code)}</code> — применится сам по ссылке\n\n<a href="${escapeHtml(ctaUrl)}">${escapeHtml(buttonText)}</a>`,
          url: ctaUrl,
        },
      };
      if (sample) {
        rendered.notes = [`Промокод ${code} — пример: настоящий код создастся при отправке, у каждого получателя свой.`];
      }
      log("debug", `rendered recipient=${ctx.recipientId} mode=${ctx.mode}`, {
        design: payload.design,
        code: `${code}${sample ? " (пример)" : ""}`,
        htmlBytes: html.length,
      });
      return rendered;
    },

    async formData() {
      return deps.formData(deps.now());
    },
  };
}

export const promoTemplate = createPromoTemplate();
