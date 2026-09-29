import { recordAuditLog } from "@/lib/audit-log";
import { db } from "@/lib/db";

import { userMarketingEmail } from "./audience";
import { PLATFORM_ORG_ID } from "./campaigns.server";
import { resolveTrackedLink } from "./links";
import { refreshCampaignCounters } from "./store.server";
import { verifyRecipientToken } from "./tokens";

/**
 * Публичные действия по ссылкам из писем — без входа, по подписанному
 * токену получателя: отписка (страница и one-click POST) и клик. Плюс
 * переключатель «Новости и предложения на почту» в профиле.
 *
 * Отписка касается только рекламы: стоп-лист и `marketingOptOut` читает
 * одна рассылка, служебные письма (коды входа, счета) их не видят.
 */

/** «iv***@mail.ru» — на публичной странице полный адрес не показываем. */
export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const shown = local.length <= 2 ? local[0] : local.slice(0, 2);
  return `${shown}***${email.slice(at)}`;
}

export type UnsubscribeTarget = {
  recipientId: string;
  maskedEmail: string | null;
  alreadyUnsubscribed: boolean;
};

export async function findUnsubscribeTarget(token: string): Promise<UnsubscribeTarget | null> {
  const id = verifyRecipientToken(token);
  if (!id) return null;
  const r = await db.mailingRecipient.findUnique({
    where: { id },
    select: { id: true, email: true, userId: true, unsubscribedAt: true },
  });
  if (!r) return null;
  let already = Boolean(r.unsubscribedAt);
  if (!already && r.email) {
    already = Boolean(await db.emailSuppression.findUnique({ where: { email: r.email }, select: { id: true } }));
  }
  return { recipientId: r.id, maskedEmail: maskEmail(r.email), alreadyUnsubscribed: already };
}

export async function unsubscribeByToken(
  token: string,
  source: "page" | "one-click",
  request?: Request
): Promise<{ ok: true; maskedEmail: string | null } | { ok: false }> {
  const id = verifyRecipientToken(token);
  if (!id) return { ok: false };
  const r = await db.mailingRecipient.findUnique({
    where: { id },
    select: { id: true, email: true, userId: true, contactId: true, campaignId: true, unsubscribedAt: true, isTest: true },
  });
  if (!r) return { ok: false };
  const now = new Date();
  const email = r.email?.toLowerCase() ?? null;
  if (email) {
    await db.emailSuppression.upsert({
      where: { email },
      create: { email, reason: "unsubscribed", campaignId: r.campaignId, note: source === "one-click" ? "one-click из почты" : "страница отписки" },
      // Уже в стоп-листе (отказ сервера, вручную) — причину не переписываем.
      update: {},
    });
    await db.marketingContact.updateMany({ where: { email, status: "active" }, data: { status: "unsubscribed" } });
  }
  if (r.contactId) {
    await db.marketingContact.updateMany({ where: { id: r.contactId, status: "active" }, data: { status: "unsubscribed" } });
  }
  if (r.userId) {
    await db.user.updateMany({ where: { id: r.userId }, data: { marketingOptOut: true } });
  }
  if (!r.unsubscribedAt) {
    await db.mailingRecipient.update({ where: { id: r.id }, data: { unsubscribedAt: now } });
  }
  console.info(`[mailing] unsubscribe (${source})`, { recipient: r.id, campaign: r.campaignId, email, test: r.isTest });
  await recordAuditLog({
    request,
    session: null,
    organizationId: PLATFORM_ORG_ID,
    action: "mailing.unsubscribe",
    entity: "EmailSuppression",
    entityId: r.id,
    details: { email, campaignId: r.campaignId, source, userId: r.userId, contactId: r.contactId },
  });
  return { ok: true, maskedEmail: maskEmail(email) };
}

/**
 * Клик по ссылке письма: отметить и вернуть адрес — только из списка
 * ссылок, сохранённого у получателя при подготовке письма.
 */
export async function registerClick(token: string, indexRaw: string): Promise<string | null> {
  const id = verifyRecipientToken(token);
  if (!id) return null;
  const r = await db.mailingRecipient.findUnique({
    where: { id },
    select: { id: true, links: true, clickedAt: true, campaignId: true, isTest: true },
  });
  if (!r) return null;
  const url = resolveTrackedLink(r.links, indexRaw);
  if (!url) return null;
  await db.mailingRecipient.update({
    where: { id: r.id },
    data: { clickedAt: r.clickedAt ?? new Date(), clickCount: { increment: 1 } },
  });
  if (!r.clickedAt && !r.isTest) await refreshCampaignCounters(r.campaignId).catch(() => null);
  console.info(`[mailing] click`, { recipient: r.id, campaign: r.campaignId, link: Number(indexRaw), first: !r.clickedAt });
  return url;
}

// ---------------------------------------------------------------- profile

export type MarketingSubscription = {
  email: string | null;
  subscribed: boolean;
  /** Адрес в стоп-листе по причине, которую человек сам не снимает. */
  blockedReason: "bounced" | "manual" | null;
};

export async function getMarketingSubscription(userId: string): Promise<MarketingSubscription> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { email: true, contactEmail: true, marketingOptOut: true },
  });
  if (!user) return { email: null, subscribed: false, blockedReason: null };
  const email = userMarketingEmail(user);
  const stop = email ? await db.emailSuppression.findUnique({ where: { email } }) : null;
  const blockedReason = stop && (stop.reason === "bounced" || stop.reason === "manual") ? stop.reason : null;
  return { email, subscribed: !user.marketingOptOut && !stop, blockedReason };
}

/**
 * Переключатель в профиле. Включение — это согласие самого человека:
 * снимаем его отписку и жалобу из стоп-листа. «Адрес не принимает почту»
 * и ручную блокировку ROOT здесь не снять.
 */
export async function setMarketingSubscription(
  userId: string,
  subscribed: boolean,
  request?: Request
): Promise<MarketingSubscription> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, contactEmail: true, organizationId: true },
  });
  if (!user) return { email: null, subscribed: false, blockedReason: null };
  const email = userMarketingEmail(user);
  await db.user.update({ where: { id: userId }, data: { marketingOptOut: !subscribed } });
  if (email) {
    if (subscribed) {
      await db.emailSuppression.deleteMany({ where: { email, reason: { in: ["unsubscribed", "complained"] } } });
    } else {
      await db.emailSuppression.upsert({
        where: { email },
        create: { email, reason: "unsubscribed", note: "в профиле" },
        update: {},
      });
    }
  }
  console.info(`[mailing] profile marketing ${subscribed ? "on" : "off"}`, { user: userId, email });
  await recordAuditLog({
    request,
    session: { user: { id: user.id, name: user.name, email: user.email } },
    organizationId: user.organizationId,
    action: subscribed ? "mailing.optin" : "mailing.optout",
    entity: "User",
    entityId: user.id,
    details: { email },
  });
  return getMarketingSubscription(userId);
}
