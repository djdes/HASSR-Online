import { db } from "@/lib/db";

import { invalidatePartnerBrandCache } from "./audit-marker";
import { isPartnerAccessLevel, type PartnerAccessLevel } from "./access-guard";
import { DEFAULT_ACCENT, PLATFORM_BADGE_TEXT, checkAccent, darkenHex } from "./validation";

export { PLATFORM_BADGE_TEXT };

/**
 * Брендинг партнёра, применённый к организации клиента. Кэш 5 минут —
 * ровно столько ТЗ отводит на распространение правок; смена настроек
 * партнёром или клиентом сбрасывает кэш сразу (в рамках процесса).
 */
export const BRANDING_TTL_MS = 5 * 60 * 1000;

export type PartnerBrandView = {
  partnerId: string;
  slug: string;
  brandName: string;
  /** Есть ли загруженный логотип (светлый/тёмный). */
  hasLogoLight: boolean;
  hasLogoDark: boolean;
  /** Версия брендинга — для cache-busting URL логотипа. */
  version: number;
  /** Эффективный акцент (после проверки контраста) или null = стандартный. */
  accentColor: string | null;
  accentHover: string | null;
  supportPhone: string | null;
  supportTelegram: string | null;
  supportEmail: string | null;
  pdfSignature: string | null;
  loginGreeting: string | null;
  /**
   * Партнёр скрыл себя от клиентов («Не показывать клиентам информацию о
   * консультанте»): в интерфейсе, письмах, PDF и Telegram клиента его нет,
   * а где без упоминания не обойтись — «Служба сопровождения WeSetup».
   */
  hiddenFromClients: boolean;
};

export type OrgBranding = PartnerBrandView & {
  organizationId: string;
  accessLevel: PartnerAccessLevel;
  /** Клиент включил «стандартный интерфейс WeSetup» — брендинг не рисуем. */
  clientHidesBranding: boolean;
  attachedAt: Date;
};

type CacheEntry = { value: OrgBranding | null; expires: number };
// Кэш — один на процесс (globalThis): страницы и API-маршруты Next грузят
// модуль отдельными копиями, и сброс из API иначе не доходил до страниц —
// скрытие консультанта применялось бы только через 5 минут.
const cacheHost = globalThis as typeof globalThis & {
  __wesetupOrgBrandingCache?: Map<string, CacheEntry>;
  __wesetupPartnerOrgs?: Map<string, Set<string>>;
};
const orgCache = (cacheHost.__wesetupOrgBrandingCache ??= new Map<string, CacheEntry>());
const partnerOrgs = (cacheHost.__wesetupPartnerOrgs ??= new Map<string, Set<string>>());

export function invalidateOrgBranding(organizationId: string) {
  orgCache.delete(organizationId);
}

export function invalidatePartnerBranding(partnerId: string) {
  invalidatePartnerBrandCache(partnerId);
  const orgs = partnerOrgs.get(partnerId);
  if (orgs) {
    for (const orgId of orgs) orgCache.delete(orgId);
    partnerOrgs.delete(partnerId);
  }
  for (const [orgId, entry] of orgCache) {
    if (entry.value?.partnerId === partnerId) orgCache.delete(orgId);
  }
}

export function logoUrlFor(brand: Pick<PartnerBrandView, "partnerId" | "version">, variant: "light" | "dark") {
  return `/api/partner-assets/${brand.partnerId}/logo?variant=${variant}&v=${brand.version}`;
}

type PartnerRow = {
  id: string;
  slug: string;
  companyName: string;
  hideFromClients: boolean;
  branding: {
    brandName: string;
    logoLightMime: string | null;
    logoDarkMime: string | null;
    version: number;
    accentColor: string | null;
    supportPhone: string | null;
    supportTelegram: string | null;
    supportEmail: string | null;
    pdfSignature: string | null;
    loginGreeting: string | null;
  } | null;
};

const PARTNER_SELECT = {
  id: true,
  slug: true,
  companyName: true,
  hideFromClients: true,
  branding: {
    select: {
      brandName: true,
      logoLightMime: true,
      logoDarkMime: true,
      version: true,
      accentColor: true,
      supportPhone: true,
      supportTelegram: true,
      supportEmail: true,
      pdfSignature: true,
      loginGreeting: true,
    },
  },
} as const;

export function toBrandView(partner: PartnerRow): PartnerBrandView {
  const b = partner.branding;
  const accent = b?.accentColor ? checkAccent(b.accentColor) : null;
  const effective = accent && accent.ok && accent.effective !== DEFAULT_ACCENT ? accent.effective : null;
  return {
    partnerId: partner.id,
    slug: partner.slug,
    brandName: b?.brandName?.trim() || partner.companyName,
    hasLogoLight: Boolean(b?.logoLightMime),
    hasLogoDark: Boolean(b?.logoDarkMime),
    version: b?.version ?? 1,
    accentColor: effective,
    accentHover: effective ? darkenHex(effective) : null,
    supportPhone: b?.supportPhone?.trim() || null,
    supportTelegram: b?.supportTelegram?.trim() || null,
    supportEmail: b?.supportEmail?.trim() || null,
    pdfSignature: b?.pdfSignature?.trim() || null,
    loginGreeting: b?.loginGreeting?.trim() || null,
    hiddenFromClients: partner.hideFromClients,
  };
}

/** Как скрытый партнёр называется там, где клиенту нужно знать, кто имеет доступ. */
export const NEUTRAL_SUPPORT_NAME = "Служба сопровождения WeSetup";

/**
 * Брендинг для глаз клиента: у скрытого партнёра — нейтральный, без
 * названия, логотипа, цвета и контактов. Кабинет самого партнёра берёт
 * настоящий брендинг напрямую.
 */
export function clientFacingBrand<T extends PartnerBrandView>(brand: T): T {
  if (!brand.hiddenFromClients) return brand;
  return {
    ...brand,
    brandName: NEUTRAL_SUPPORT_NAME,
    hasLogoLight: false,
    hasLogoDark: false,
    accentColor: null,
    accentHover: null,
    supportPhone: null,
    supportTelegram: null,
    supportEmail: null,
    pdfSignature: null,
    loginGreeting: "Добро пожаловать в электронные журналы WeSetup",
  };
}

/**
 * Брендинг активного партнёра организации без учёта переключателя
 * клиента — для настроек «Консультант». Для интерфейса используйте
 * `getVisibleOrgBranding`.
 */
export async function resolveOrgBranding(organizationId: string): Promise<OrgBranding | null> {
  const cached = orgCache.get(organizationId);
  if (cached && cached.expires > Date.now()) return cached.value;
  const link = await db.partnerClient.findFirst({
    where: { organizationId, detachedAt: null, partner: { status: "active" } },
    select: {
      accessLevel: true,
      clientHidesBranding: true,
      attachedAt: true,
      partner: { select: PARTNER_SELECT },
    },
  });
  const value: OrgBranding | null = link
    ? {
        ...toBrandView(link.partner),
        organizationId,
        accessLevel: isPartnerAccessLevel(link.accessLevel) ? link.accessLevel : "view",
        clientHidesBranding: link.clientHidesBranding,
        attachedAt: link.attachedAt,
      }
    : null;
  orgCache.set(organizationId, { value, expires: Date.now() + BRANDING_TTL_MS });
  if (value) {
    const set = partnerOrgs.get(value.partnerId) ?? new Set<string>();
    set.add(organizationId);
    partnerOrgs.set(value.partnerId, set);
  }
  return value;
}

/** Брендинг, который реально надо показать клиенту (учитывает его переключатель). */
export async function getVisibleOrgBranding(organizationId: string | null | undefined): Promise<OrgBranding | null> {
  if (!organizationId) return null;
  try {
    const branding = await resolveOrgBranding(organizationId);
    return branding && !branding.clientHidesBranding && !branding.hiddenFromClients ? branding : null;
  } catch {
    return null;
  }
}

/** Партнёр организации скрыт от клиента — подписи и уведомления без него. */
export async function isPartnerHiddenForOrg(organizationId: string | null | undefined): Promise<boolean> {
  if (!organizationId) return false;
  try {
    return (await resolveOrgBranding(organizationId))?.hiddenFromClients === true;
  } catch {
    return false;
  }
}

/** Публичный брендинг партнёра по slug — для `/p/<slug>` и писем. Только активные партнёры. */
export async function getPartnerBrandBySlug(slug: string): Promise<PartnerBrandView | null> {
  const partner = await db.partner.findFirst({
    where: { slug, status: "active" },
    select: PARTNER_SELECT,
  });
  return partner ? toBrandView(partner) : null;
}

export async function getPartnerBrandById(partnerId: string): Promise<PartnerBrandView | null> {
  const partner = await db.partner.findUnique({
    where: { id: partnerId },
    select: PARTNER_SELECT,
  });
  return partner ? toBrandView(partner) : null;
}

/** Строка «Ваш консультант: <бренд>, <контакт>» для бота и писем. */
export function consultantLine(brand: Pick<PartnerBrandView, "brandName" | "supportPhone" | "supportTelegram" | "supportEmail">): string {
  const contact = brand.supportPhone || brand.supportTelegram || brand.supportEmail;
  return contact ? `Ваш консультант: ${brand.brandName}, ${contact}` : `Ваш консультант: ${brand.brandName}`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Подпись консультанта для Telegram-сообщений (parse_mode HTML): бренд
 * жирным, контакт — как есть. Пустая строка, если у организации нет
 * видимого партнёрского брендинга — вызывающий просто конкатенирует.
 */
export async function telegramConsultantFooter(organizationId: string | null | undefined): Promise<string> {
  const brand = await getVisibleOrgBranding(organizationId);
  if (!brand) return "";
  const contact = brand.supportPhone || brand.supportTelegram || brand.supportEmail;
  return (
    `\n\n🤝 Ваш консультант: <b>${escapeHtml(brand.brandName)}</b>` +
    (contact ? `, ${escapeHtml(contact)}` : "")
  );
}
