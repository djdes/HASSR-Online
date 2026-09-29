import { db } from "@/lib/db";
import type { EmailAttachment } from "@/lib/email";
import { escapeHtml } from "@/lib/html-escape";
import { buildProposalContent, type ProposalContent, type ProposalContext } from "@/lib/proposal/content";
import { loadProposalContext, readDefaultProposalSender } from "@/lib/proposal/context.server";
import { renderProposalEmailHtml } from "@/lib/proposal/email";
import { renderProposalPdfDocument } from "@/lib/proposal/pdf";
import { proposalPdfUrl, proposalWebUrl } from "@/lib/proposal/token";
import type { ProposalPromo, ProposalVars } from "@/lib/proposal/types";
import { normalizeProposalVars } from "@/lib/proposal/vars";
import {
  createPersonalPromoCodes,
  readPromoForOffer,
  suggestPersonalCode,
  type PersonalCodeOptions,
  type PersonalCodeRequest,
} from "@/lib/promo/personal-codes";
import { promotionEndLabel } from "@/lib/promo/promotions";
import { describeDiscount, normalizePromoCode } from "@/lib/promo/rules";
import { PAID_ORDER_STATUSES } from "@/lib/promo/service";
import { promoEndsAfterDays } from "@/lib/promo/valid-days";

import type { MailingRecipientContext, MailingTemplate, RenderedMailing } from "../templates";
import {
  checkKpPayload,
  coerceKpPayload,
  defaultKpPayload,
  type KpFormData,
  type KpPayload,
  type KpPromoOption,
} from "./kp-shared";

/**
 * Тип «КП»: коммерческое предложение WeSetup (модуль `src/lib/proposal`)
 * каждому получателю — своей сферы, с его компанией, именем и промокодом.
 *
 *   • сфера — у пользователя по организации, у контакта из колонки
 *     «сфера», иначе `defaultSphere`;
 *   • промокод: без него / один общий из «Промокодов» / персональные коды
 *     (`prepare` при старте отправки: пользователю — код его организации,
 *     загруженному контакту — одноразовый без привязки);
 *   • письмо — то же, что «Отправить мне тестовое письмо» в генераторе КП
 *     (`renderProposalEmailHtml`), ссылки через учёт кликов, отписка;
 *     PDF вложением — по галочке;
 *   • колокольчик, push и Telegram — короткий честный текст из тех же
 *     цифр и ссылка на веб-версию КП.
 *
 * Контекст КП (цена, акция, реквизиты, отправитель) и общий промокод
 * кэшируются на минуту и пять минут: рассылка не читает базу на каждое
 * письмо. Персональный код и его срок лежат у получателя (`prepare`).
 */

export type { KpPayload } from "./kp-shared";

export const KP_CHANNEL_TITLE = "Предложение WeSetup для вашей команды";

type Log = (level: "info" | "debug" | "warn" | "error", message: string, data?: Record<string, unknown>) => void;

export type KpTemplateDeps = {
  now(): Date;
  loadContext(now: Date): Promise<ProposalContext>;
  /** Данные кода для КП; null — нет или не действует (`readPromoForOffer`). */
  readPromo(code: string): Promise<ProposalPromo | null>;
  /** Кому выдан код и сколько раз им можно оплатить; null — кода нет. */
  promoAudience(code: string): Promise<{ personal: boolean; maxUses: number | null } | null>;
  createCodes(
    requests: PersonalCodeRequest[],
    options: PersonalCodeOptions
  ): Promise<Map<string, { id: string; code: string }>>;
  renderPdf(content: ProposalContent): Buffer;
  formData(now: Date): Promise<KpFormData>;
  log?: Log;
  /** Сколько держать контекст КП, мс (по умолчанию минута). */
  contextTtlMs?: number;
  /** Сколько держать данные общего промокода, мс (по умолчанию 5 минут). */
  promoTtlMs?: number;
};

const defaultLog: Log = (level, message, data) => {
  const line = `[mailing] kp ${message}`;
  if (level === "error") console.error(line, data ?? "");
  else if (level === "warn") console.warn(line, data ?? "");
  else if (level === "debug") console.debug(line, data ?? "");
  else console.info(line, data ?? "");
};

function hasCode(personal: Record<string, unknown>): boolean {
  return typeof personal.promoCode === "string" && personal.promoCode.trim() !== "";
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** «КП WeSetup — Кафе «Ромашка».pdf»: без символов, запрещённых в именах файлов. */
export function kpPdfFilename(content: Pick<ProposalContent, "companyName" | "sphereLabel">): string {
  const name = (content.companyName || content.sphereLabel || "WeSetup")
    .replace(/\s*\/\s*/g, ", ")
    .replace(/[\\:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .trim();
  return `КП WeSetup — ${name || "предложение"}.pdf`;
}

/**
 * Текст колокольчика, push и Telegram — строки предложения КП:
 * «Команда до 10 сотрудников — 1 791 ₽/мес со скидкой 10 % навсегда по
 * промокоду ROMASHKA10 (код действует до 13 октября). Бесплатно — все …
 * для 1 сотрудника.»
 */
export function kpChannelText(content: ProposalContent): string {
  const [free, team] = content.offer.rows;
  const price = content.price;
  let line = `${team.title} — ${team.price}${team.unit}`;
  if (price.promo && price.discountLabel) {
    const discount = price.discountLabel.replace(/^−/, "");
    line += ` со скидкой ${discount}${price.promoTerm ? ` ${price.promoTerm}` : ""} по промокоду ${price.promo.code}`;
    if (price.promo.lifetime && price.promo.endsAt) line += ` (код действует ${promotionEndLabel(price.promo.endsAt)})`;
  } else if (price.promotion) {
    line += ` со скидкой ${price.promotion.percent}\u00a0% по акции ${promotionEndLabel(price.promotion.endsAt)}`;
  }
  return `${line}. ${free.title}.`;
}

function promoOptionLabel(option: Omit<KpPromoOption, "label">): string {
  const parts = [`${option.code} · ${describeDiscount(option)}`];
  if (option.lifetime) parts[0] += " навсегда";
  else if (option.endsAt) parts[0] += ` ${promotionEndLabel(option.endsAt)}`;
  if (option.usesLeft !== null) parts.push(`ещё ${option.usesLeft} опл.`);
  if (option.newClientsOnly) parts.push("только новым");
  return parts.join(" · ");
}

/** Действующие общие коды для «Выбрать код»: не персональные, не одноразовые, не исчерпанные. */
async function readKpFormData(now: Date): Promise<KpFormData> {
  const rows = await db.promoCode.findMany({
    where: {
      active: true,
      personalEmail: null,
      organizationId: null,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        { OR: [{ maxUses: null }, { maxUses: { gt: 1 } }] },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const limited = rows.filter((row) => row.maxUses !== null).map((row) => row.code);
  const uses = new Map<string, number>();
  if (limited.length > 0) {
    const grouped = await db.paymentOrder.groupBy({
      by: ["promoCode"],
      where: { promoCode: { in: limited }, status: { in: [...PAID_ORDER_STATUSES] }, lifetimeDiscountId: null },
      _count: { _all: true },
    });
    for (const g of grouped) if (g.promoCode) uses.set(g.promoCode, g._count._all);
  }
  const promoOptions: KpPromoOption[] = [];
  for (const row of rows) {
    const usesLeft = row.maxUses !== null ? Math.max(0, row.maxUses - (uses.get(row.code) ?? 0)) : null;
    if (usesLeft === 0) continue;
    const option = {
      code: row.code,
      kind: row.kind === "fixed" ? ("fixed" as const) : ("percent" as const),
      value: row.value,
      lifetime: row.lifetime === true,
      endsAt: row.endsAt?.toISOString() ?? null,
      usesLeft,
      newClientsOnly: row.newClientsOnly,
    };
    promoOptions.push({ ...option, label: promoOptionLabel(option) });
  }
  const sender = await readDefaultProposalSender();
  return { promoOptions, senderName: sender?.name ?? null };
}

export const defaultKpDeps: KpTemplateDeps = {
  now: () => new Date(),
  loadContext: (now) => loadProposalContext(now),
  readPromo: (code) => readPromoForOffer(code),
  async promoAudience(code) {
    const row = await db.promoCode.findUnique({
      where: { code },
      select: { personalEmail: true, organizationId: true, maxUses: true },
    });
    return row ? { personal: Boolean(row.personalEmail || row.organizationId), maxUses: row.maxUses } : null;
  },
  createCodes: (requests, options) => createPersonalPromoCodes(requests, options),
  renderPdf: (content) => renderProposalPdfDocument(content).buffer,
  formData: (now) => readKpFormData(now),
};

export function createKpTemplate(deps: KpTemplateDeps = defaultKpDeps): MailingTemplate<KpPayload> {
  const log = deps.log ?? defaultLog;
  const contextTtl = deps.contextTtlMs ?? 60_000;
  const promoTtl = deps.promoTtlMs ?? 5 * 60_000;
  let contextCache: { value: ProposalContext; at: number } | null = null;
  const promoCache = new Map<string, { value: ProposalPromo | null; at: number }>();

  async function proposalContext(now: Date): Promise<ProposalContext> {
    if (!contextCache || now.getTime() - contextCache.at > contextTtl || now.getTime() < contextCache.at) {
      const started = Date.now();
      const value = await deps.loadContext(now);
      contextCache = { value, at: now.getTime() };
      log("info", "context loaded", {
        tariffRub: value.tariffPriceRub,
        promotion: value.promotion ? `${value.promotion.percent}%` : null,
        sender: value.defaultSender?.name ?? null,
        ms: Date.now() - started,
      });
    }
    return { ...contextCache.value, now };
  }

  async function sharedPromo(code: string, now: Date): Promise<ProposalPromo | null> {
    const hit = promoCache.get(code);
    if (hit && now.getTime() - hit.at <= promoTtl && now.getTime() >= hit.at) return hit.value;
    const value = await deps.readPromo(code);
    promoCache.set(code, { value, at: now.getTime() });
    log("info", `shared code ${code} ${value ? "active" : "not active"}`);
    return value;
  }

  /** Промокод для этого получателя; `sample` — пример в предпросмотре и тесте себе. */
  async function promoFor(
    payload: KpPayload,
    ctx: MailingRecipientContext,
    now: Date
  ): Promise<{ promo: ProposalPromo | null; sample: boolean }> {
    const p = payload.promo;
    if (p.mode === "none") return { promo: null, sample: false };
    if (p.mode === "existing") {
      const code = p.code ? normalizePromoCode(p.code) : "";
      const promo = code ? await sharedPromo(code, now) : null;
      if (code && !promo) {
        // Код выключили или он кончился уже после запуска — КП без скидки, честные цены.
        log("warn", `shared code ${code} is no longer active — recipient=${ctx.recipientId} gets the offer without promo`);
      }
      return { promo, sample: false };
    }
    const own = ctx.personal;
    if (hasCode(own)) {
      const code = normalizePromoCode(String(own.promoCode));
      let endsAt = parseDate(own.promoEndsAt);
      if (!endsAt && own.promoEndsAt !== null) {
        // Старые данные без срока — сверимся с базой (один раз на код).
        endsAt = (await sharedPromo(code, now))?.endsAt ?? null;
      }
      return { promo: { code, kind: p.kind, value: p.value, lifetime: p.lifetime, endsAt }, sample: false };
    }
    if (ctx.mode === "live") {
      // Без кода письмо с «примером» уйти не должно: подготовка не дошла до этого получателя.
      throw new Error("нет персонального промокода — подготовка рассылки не дошла до получателя");
    }
    const code = suggestPersonalCode(ctx.companyName, p.value);
    return {
      promo: { code, kind: p.kind, value: p.value, lifetime: p.lifetime, endsAt: promoEndsAfterDays(now, p.validDays) },
      sample: true,
    };
  }

  return {
    kind: "kp",
    label: "КП",
    defaultPayload: defaultKpPayload,

    async validate(raw) {
      const checked = checkKpPayload(raw);
      if (!checked.ok) return checked;
      const payload = checked.payload;
      if (payload.promo.mode === "existing" && payload.promo.code) {
        const code = payload.promo.code;
        const audience = await deps.promoAudience(code);
        if (!audience) return { ok: false, error: `Промокода ${code} нет в «Промокодах»` };
        if (audience.personal) {
          return {
            ok: false,
            error: `Промокод ${code} персональный — он сработает только у одного клиента. Выберите общий код или «Персональные коды»`,
          };
        }
        if (audience.maxUses === 1) {
          return {
            ok: false,
            error: `Промокод ${code} одноразовый — оплатить по нему сможет только один получатель. Выберите общий код или «Персональные коды»`,
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
      const payload = coerceKpPayload(campaign.payload);
      const p = payload.promo;
      if (p.mode !== "personal") {
        log("info", `prepare campaign=${campaign.id} mode=${p.mode}: персональные коды не нужны`, { recipients: recipients.length });
        return {};
      }
      const todo = recipients.filter((r) => !hasCode(r.personal));
      const kept = recipients.length - todo.length;
      if (todo.length === 0) {
        log("info", `prepare campaign=${campaign.id}: у всех получателей код уже есть`, { kept });
        return {};
      }
      const now = deps.now();
      const endsAt = promoEndsAfterDays(now, p.validDays);
      const requests: PersonalCodeRequest[] = todo.map((r) =>
        r.organizationId
          ? { key: r.id, email: null, organizationId: r.organizationId, companyName: r.companyName }
          : // Контакт: КП уходит на info@…, платит другой человек — код без привязки, одна оплата.
            // Почта в запросе не нужна (код её не хранит) — и не валит всю пачку из-за редкого адреса.
            { key: r.id, email: null, companyName: r.companyName, unlocked: true }
      );
      const title = campaign.title.trim() || "без названия";
      const started = Date.now();
      const created = await deps.createCodes(requests, {
        kind: p.kind,
        value: p.value,
        lifetime: p.lifetime,
        endsAt,
        note: `Рассылка «${title}»`,
        campaignId: campaign.id,
      });
      const out: Record<string, Record<string, unknown>> = {};
      for (const r of todo) {
        const c = created.get(r.id);
        if (c) out[r.id] = { promoCode: c.code, promoEndsAt: endsAt.toISOString() };
      }
      const organizations = requests.filter((r) => !r.unlocked).length;
      log("info", `prepare campaign=${campaign.id}: personal codes ${Object.keys(out).length}`, {
        organizations,
        unlocked: requests.length - organizations,
        kept,
        discount: `${p.kind} ${p.value}${p.lifetime ? " lifetime" : ""}`,
        endsAt: endsAt.toISOString(),
        ms: Date.now() - started,
      });
      if (Object.keys(out).length !== todo.length) {
        throw new Error(`создано кодов ${Object.keys(out).length} из ${todo.length}`);
      }
      return out;
    },

    async render(raw, ctx) {
      const payload = coerceKpPayload(raw);
      const now = deps.now();
      const { promo, sample } = await promoFor(payload, ctx, now);
      const vars: ProposalVars = normalizeProposalVars({
        sphere: ctx.sphere ?? payload.defaultSphere,
        companyName: ctx.companyName,
        recipientName: ctx.name,
        promo,
      });
      const content = buildProposalContent(vars, await proposalContext(now));
      const webUrl = proposalWebUrl(vars);
      const email = renderProposalEmailHtml(content, {
        web: webUrl,
        pdf: proposalPdfUrl(webUrl),
        unsubscribe: ctx.unsubscribeUrl,
        trackUrl: ctx.trackUrl,
      });
      let attachments: EmailAttachment[] | undefined;
      if (payload.attachPdf) {
        attachments = [{ filename: kpPdfFilename(content), content: deps.renderPdf(content), contentType: "application/pdf" }];
      }
      const link = ctx.trackUrl(webUrl);
      const body = kpChannelText(content);
      const rendered: RenderedMailing = {
        email: { subject: email.subject, preheader: email.preheader, html: email.html, text: email.text, attachments },
        inApp: { title: KP_CHANNEL_TITLE, body, url: link },
        push: { title: KP_CHANNEL_TITLE, body, url: link },
        telegram: {
          text: `<b>${escapeHtml(KP_CHANNEL_TITLE)}</b>\n\n${escapeHtml(body)}\n\n<a href="${escapeHtml(link)}">Открыть предложение</a>`,
          url: link,
        },
      };
      if (sample && promo) {
        rendered.notes = [`Промокод ${promo.code} — пример: настоящий код создастся при отправке, у каждого получателя свой.`];
      }
      log("debug", `rendered recipient=${ctx.recipientId} mode=${ctx.mode}`, {
        sphere: content.sphere,
        promo: promo ? `${promo.code}${sample ? " (пример)" : ""}` : null,
        cta: content.offer.ctaKind,
        pdf: attachments ? attachments[0].content?.length ?? 0 : null,
      });
      return rendered;
    },

    async formData() {
      return deps.formData(deps.now());
    },
  };
}

export const kpTemplate = createKpTemplate();
