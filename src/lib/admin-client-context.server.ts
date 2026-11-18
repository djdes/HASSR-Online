/**
 * Где клиент и куда ведёт «Открыть» — для уведомлений продажам о действиях
 * пользователей (спека tg-client-location-2026-11). Место и время — по IP
 * запроса (пояс браузера точнее), без IP — по последнему входу клиента,
 * а без гео — город и пояс организации. Любой сбой — без строки: украшение
 * не мешает уведомлению уйти.
 */

import { Prisma } from "@prisma/client";

import { adminCrmContactUrl, adminOrganizationUrl, type AdminClientInfo } from "@/lib/admin-client-context";
import { clientIp } from "@/lib/client-ip";
import { normalizeEmail, phoneKey } from "@/lib/crm/identity";
import { db } from "@/lib/db";
import { clientLocationLine, lookupIpGeo, type ClientPlace } from "@/lib/ip-geo";
import { isEmptySnapshot, readSignupSnapshot, signupSourceShort, type SignupSourceSnapshot } from "@/lib/signup-channel";
import { visitSourceFromRequest } from "@/lib/visit-source.server";

export type AdminClientContext = {
  /** Запрос самого клиента (не вебхук платёжки): IP и заголовки прокси. */
  request?: Request | null;
  ip?: string | null;
  /** Пояс браузера (IANA), если форма его прислала. */
  timeZone?: string | null;
  organizationId?: string | null;
  userId?: string | null;
  /** Почта/телефон — найти организацию или контакт CRM, когда orgId нет. */
  email?: string | null;
  phone?: string | null;
  /** Снимок источника из формы (если форма его прислала). */
  source?: SignupSourceSnapshot | null;
};

const PLATFORM_ORG_ID = () => process.env.PLATFORM_ORG_ID || "platform";

async function findOrganizationId(ctx: AdminClientContext): Promise<string | null> {
  if (ctx.organizationId && ctx.organizationId !== PLATFORM_ORG_ID()) return ctx.organizationId;
  if (ctx.userId) {
    const user = await db.user.findUnique({ where: { id: ctx.userId }, select: { organizationId: true, isRoot: true } });
    if (user && !user.isRoot && user.organizationId !== PLATFORM_ORG_ID()) return user.organizationId;
  }
  const email = normalizeEmail(ctx.email);
  if (email) {
    const user = await db.user.findFirst({
      where: {
        archivedAt: null,
        isRoot: false,
        organization: { isDemo: false, id: { not: PLATFORM_ORG_ID() } },
        OR: [{ email: { equals: email, mode: "insensitive" } }, { contactEmail: { equals: email, mode: "insensitive" } }],
      },
      orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
      select: { organizationId: true },
    });
    if (user) return user.organizationId;
  }
  return null;
}

async function findCrmContactId(ctx: AdminClientContext): Promise<string | null> {
  const email = normalizeEmail(ctx.email);
  const phone = phoneKey(ctx.phone);
  if (!email && !phone) return null;
  const contact = await db.crmContact.findFirst({
    where: { OR: [...(email ? [{ email }] : []), ...(phone ? [{ phoneKey: phone }] : [])] },
    orderBy: { lastActivityAt: "desc" },
    select: { id: true },
  });
  return contact?.id ?? null;
}

/** IP последнего входа клиента: для событий без запроса (оплата, бот). */
async function lastKnownIp(organizationId: string, userId?: string | null): Promise<string | null> {
  const user = await db.user.findFirst({
    where: userId ? { id: userId } : { organizationId, isRoot: false, archivedAt: null, OR: [{ lastLoginIp: { not: null } }, { registrationIp: { not: null } }] },
    orderBy: userId ? undefined : [{ lastLoginAt: { sort: "desc", nulls: "last" } }],
    select: { lastLoginIp: true, registrationIp: true },
  });
  return user?.lastLoginIp ?? user?.registrationIp ?? null;
}

/**
 * Откуда пришёл клиент (спека visit-source-2026-11): у организации — её
 * первое касание и привязки (партнёр, рекомендация), иначе снимок формы,
 * cookie запроса, источник контакта CRM.
 */
async function resolveSource(ctx: AdminClientContext, organizationId: string | null): Promise<string | null> {
  if (organizationId) {
    const [organization, partnerLinks] = await Promise.all([
      db.organization.findUnique({ where: { id: organizationId }, select: { signupSourceJson: true, referredByOrganizationId: true } }),
      db.partnerClient.count({ where: { organizationId, source: { not: "converted" } } }),
    ]);
    const snapshot = readSignupSnapshot(organization?.signupSourceJson);
    const short = signupSourceShort(isEmptySnapshot(snapshot) ? null : snapshot, {
      partner: partnerLinks > 0,
      clientReferral: Boolean(organization?.referredByOrganizationId),
    });
    if (short) return short;
  }
  const form = ctx.source && !isEmptySnapshot({ ...ctx.source, place: "" }) ? ctx.source : null;
  const fromRequest = form ?? visitSourceFromRequest(ctx.request);
  const short = signupSourceShort(fromRequest);
  if (short) return short;
  const email = normalizeEmail(ctx.email);
  const phone = phoneKey(ctx.phone);
  if (!email && !phone) return null;
  const contact = await db.crmContact.findFirst({
    where: { OR: [...(email ? [{ email }] : []), ...(phone ? [{ phoneKey: phone }] : [])], visitSourceJson: { not: Prisma.DbNull } },
    orderBy: { createdAt: "asc" },
    select: { visitSourceJson: true },
  });
  const stored = readSignupSnapshot(contact?.visitSourceJson);
  return signupSourceShort(isEmptySnapshot(stored) ? null : stored);
}

export async function resolveAdminClientInfo(ctx: AdminClientContext | null | undefined): Promise<AdminClientInfo> {
  const info: AdminClientInfo = { location: null, adminUrl: null, source: null };
  if (!ctx) return info;
  let organizationId: string | null = null;
  try {
    organizationId = await findOrganizationId(ctx);
    info.adminUrl = organizationId
      ? adminOrganizationUrl(organizationId)
      : await findCrmContactId(ctx).then((id) => (id ? adminCrmContactUrl(id) : null));
  } catch (error) {
    console.warn("[admin-client] admin link failed", error instanceof Error ? error.message : error);
  }
  try {
    info.source = await resolveSource(ctx, organizationId);
  } catch (error) {
    console.warn("[admin-client] source failed", error instanceof Error ? error.message : error);
  }
  try {
    const organization = organizationId
      ? await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true, city: true, countryCode: true } })
      : null;
    const fallback: ClientPlace | null = organization
      ? { countryCode: organization.countryCode, city: organization.city, timeZone: organization.timezone }
      : null;
    const requestIp = ctx.ip ?? clientIp(ctx.request ?? undefined);
    const ip = requestIp ?? (organizationId ? await lastKnownIp(organizationId, ctx.userId) : null);
    const geo = await lookupIpGeo(ip, { headers: ctx.request?.headers ?? null }).catch(() => null);
    info.location = clientLocationLine({ geo, timeZone: ctx.timeZone, fallback });
  } catch (error) {
    console.warn("[admin-client] location failed", error instanceof Error ? error.message : error);
  }
  return info;
}
