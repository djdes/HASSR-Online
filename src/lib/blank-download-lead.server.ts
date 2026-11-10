import { Prisma } from "@prisma/client";

import {
  BLANK_CONSENT_SOURCE,
  BLANK_DOWNLOAD_AUDIT_ACTION,
  BLANK_MARKETING_CONSENT_SOURCE,
  normalizeBlankCompany,
  type BlankTarget,
} from "@/lib/blank-download";
import {
  BLANK_MAILING_BASIS_CONSENT,
  BLANK_MAILING_SOURCE,
  GUEST_INVOICE_MAILING_BASIS,
  GUEST_INVOICE_MAILING_SOURCE,
  blankTargetTag,
  mergePdfLeadMarketingContact,
  type ExistingMarketingContactSnapshot,
  type PlatformClientSnapshot,
} from "@/lib/blank-download-lead";
import { CRM_CURSOR_OVERLAP_MS } from "@/lib/crm/constants";
import { ingestCrmItems } from "@/lib/crm/ingest.server";
import { contactEmail, mapBlankDownload, mapGuestInvoice } from "@/lib/crm/sources";
import { db } from "@/lib/db";
import { DEFAULT_ORG_NAME } from "@/lib/org-profile";
import { platformOrgId } from "@/lib/partners/partner-hint";

const PDF_LEADS_CURSOR_KEY = "pdf-leads:cursor:v2";
const BACKFILL_BATCH = 1000;
const LAZY_SYNC_MIN_INTERVAL_MS = 5_000;

const ensuredPlatformOrgs = new Set<string>();
let inFlightSync: Promise<PdfLeadSyncSummary> | null = null;
let lastLazySyncAtMs = 0;

export type PdfLeadSyncSummary = {
  blankRows: number;
  invoiceRows: number;
  crmCreated: number;
  marketingUpserted: number;
};

/**
 * Ensures the synthetic platform organization exists before writing
 * platform-scoped `AuditLog` entries (e.g. when `ROOT_EMAIL` was absent at seed time).
 */
export async function ensurePlatformOrganization(orgId = platformOrgId()): Promise<void> {
  if (!orgId || ensuredPlatformOrgs.has(orgId)) return;
  await db.organization.upsert({
    where: { id: orgId },
    update: {},
    create: {
      id: orgId,
      name: "WeSetup",
      type: "platform",
      subscriptionPlan: "platform",
    },
  });
  ensuredPlatformOrgs.add(orgId);
}

/**
 * Finds an active client user on the platform matching this email (login email
 * or `contactEmail`), excluding ROOT, demo, and the synthetic platform org.
 */
export async function findPlatformClientByEmail(rawEmail: string): Promise<PlatformClientSnapshot | null> {
  const email = contactEmail(rawEmail);
  if (!email) return null;
  const user = await db.user.findFirst({
    where: {
      archivedAt: null,
      isRoot: false,
      organization: { isDemo: false, id: { not: platformOrgId() } },
      OR: [
        { email: { equals: email, mode: "insensitive" } },
        { contactEmail: { equals: email, mode: "insensitive" } },
      ],
    },
    orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      phone: true,
      organizationId: true,
      marketingOptOut: true,
      organization: { select: { name: true, type: true } },
    },
  });
  if (!user) return null;
  return {
    userId: user.id,
    organizationId: user.organizationId,
    name: user.name,
    phone: user.phone,
    company: user.organization.name,
    sphere: user.organization.type,
    marketingOptOut: user.marketingOptOut,
  };
}

const EXISTING_CONTACT_SELECT = {
  id: true,
  email: true,
  name: true,
  company: true,
  sphere: true,
  city: true,
  phone: true,
  tags: true,
  source: true,
  basis: true,
  status: true,
  note: true,
} satisfies Prisma.MarketingContactSelect;

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "P2002",
  );
}

export async function upsertPdfLeadMarketingContact(params: {
  email: string;
  marketingConsent: boolean;
  source: string;
  basis: string;
  tags: readonly string[];
  note: string | null;
  name?: string | null;
  company?: string | null;
  phone?: string | null;
  sphere?: string | null;
  platformClient?: PlatformClientSnapshot | null;
}): Promise<boolean> {
  const normalizedEmail = contactEmail(params.email);
  if (!normalizedEmail) return false;

  const [existing, suppression] = await Promise.all([
    db.marketingContact.findUnique({
      where: { email: normalizedEmail },
      select: EXISTING_CONTACT_SELECT,
    }),
    db.emailSuppression.findUnique({
      where: { email: normalizedEmail },
      select: { reason: true },
    }),
  ]);

  const plan = mergePdfLeadMarketingContact({
    ...params,
    email: normalizedEmail,
    existing,
    suppressedReason: suppression?.reason ?? null,
  });

  if (plan.action === "skip") return false;
  if (plan.action === "update") {
    await db.marketingContact.update({ where: { id: plan.id }, data: plan.data });
    return true;
  }

  try {
    await db.marketingContact.create({ data: plan.data });
    return true;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await db.marketingContact.findUnique({
      where: { email: normalizedEmail },
      select: EXISTING_CONTACT_SELECT,
    });
    if (!raced) return false;
    const retryPlan = mergePdfLeadMarketingContact({
      ...params,
      email: normalizedEmail,
      existing: raced,
      suppressedReason: suppression?.reason ?? null,
    });
    if (retryPlan.action === "update") {
      await db.marketingContact.update({ where: { id: retryPlan.id }, data: retryPlan.data });
      return true;
    }
    return false;
  }
}

function buyerCompanyFromJson(buyerJson: unknown): string | null {
  if (!buyerJson || typeof buyerJson !== "object") return null;
  const buyer = buyerJson as { name?: unknown; inn?: unknown };
  const name = typeof buyer.name === "string" ? buyer.name.trim() : "";
  if (name) return name.slice(0, 200);
  const inn = typeof buyer.inn === "string" ? buyer.inn.trim() : "";
  return inn ? `ИНН ${inn}`.slice(0, 200) : null;
}

/**
 * Synchronously persists a public journal PDF/Word requester (without a cabinet)
 * into both `CrmContact` (`CrmInteraction`) and `MarketingContact`.
 */
export async function recordBlankDownloadLead(params: {
  consentId: string;
  createdAt: Date;
  email: string;
  company?: string | null;
  target: BlankTarget;
  title: string | null;
  marketing: boolean;
  platformClient?: PlatformClientSnapshot | null;
}): Promise<void> {
  lastLazySyncAtMs = 0;
  const client =
    params.platformClient !== undefined
      ? params.platformClient
      : await findPlatformClientByEmail(params.email).catch(() => null);

  const company = normalizeBlankCompany(params.company);
  const tag = blankTargetTag(params.target);
  const crmItem = mapBlankDownload({
    id: params.consentId,
    email: params.email,
    userId: client?.userId ?? null,
    organizationId: client?.organizationId ?? null,
    createdAt: params.createdAt,
    title: params.title,
    company,
  });

  const settled = await Promise.allSettled([
    ingestCrmItems([crmItem]),
    upsertPdfLeadMarketingContact({
      email: params.email,
      company,
      marketingConsent: params.marketing,
      source: BLANK_MAILING_SOURCE,
      basis: BLANK_MAILING_BASIS_CONSENT,
      tags: tag ? [tag] : [],
      note: params.title ? `Шаблон: ${params.title}` : null,
      platformClient: client,
    }),
  ]);

  for (const result of settled) {
    if (result.status === "rejected") {
      console.error("[blank-download] lead persistence failed", result.reason);
    }
  }
}

/**
 * Synchronously persists a guest PDF invoice requester (`/order` without registration)
 * into both `CrmContact` (`CrmInteraction`) and `MarketingContact`.
 */
export async function recordGuestInvoiceLead(params: {
  orderId: number;
  email: string;
  amountRub: number;
  description: string;
  organizationId: string | null;
  buyerJson: unknown;
  createdAt: Date;
}): Promise<void> {
  lastLazySyncAtMs = 0;
  const client = await findPlatformClientByEmail(params.email).catch(() => null);
  const crmItem = mapGuestInvoice({
    id: params.orderId,
    email: params.email,
    amountRub: params.amountRub,
    description: params.description,
    organizationId: params.organizationId ?? client?.organizationId ?? null,
    buyerJson: params.buyerJson,
    createdAt: params.createdAt,
  });

  const settled = await Promise.allSettled([
    ingestCrmItems([crmItem]),
    upsertPdfLeadMarketingContact({
      email: params.email,
      marketingConsent: false,
      source: GUEST_INVOICE_MAILING_SOURCE,
      basis: GUEST_INVOICE_MAILING_BASIS,
      tags: ["счет-по-инн"],
      company: buyerCompanyFromJson(params.buyerJson),
      note: `Счёт: ${params.description}`,
      platformClient: client,
    }),
  ]);

  for (const result of settled) {
    if (result.status === "rejected") {
      console.error("[invoices] guest lead persistence failed", result.reason);
    }
  }
}

async function readBackfillCursor(): Promise<Date | null> {
  const row = await db.platformSetting.findUnique({ where: { key: PDF_LEADS_CURSOR_KEY } });
  const parsed = row ? new Date(row.value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

async function writeBackfillCursor(at: Date): Promise<void> {
  await db.platformSetting.upsert({
    where: { key: PDF_LEADS_CURSOR_KEY },
    create: { key: PDF_LEADS_CURSOR_KEY, value: at.toISOString() },
    update: { value: at.toISOString() },
  });
}

function auditTargetFromDetails(details: unknown): {
  title: string | null;
  company: string | null;
  target: BlankTarget | null;
} {
  if (!details || typeof details !== "object") return { title: null, company: null, target: null };
  const raw = details as Record<string, unknown>;
  const title = typeof raw.title === "string" ? raw.title : null;
  const company = normalizeBlankCompany(raw.company);
  if (typeof raw.code === "string" && raw.code) {
    return { title, company, target: { kind: "code", code: raw.code } };
  }
  if (typeof raw.paperId === "string" && raw.paperId) {
    return { title, company, target: { kind: "paper", paperId: raw.paperId } };
  }
  return { title, company, target: null };
}

async function loadClientsByEmails(emails: string[]): Promise<Map<string, PlatformClientSnapshot>> {
  const map = new Map<string, PlatformClientSnapshot>();
  if (!emails.length) return map;
  const users = await db.user.findMany({
    where: {
      archivedAt: null,
      isRoot: false,
      organization: { isDemo: false, id: { not: platformOrgId() } },
      OR: [
        { email: { in: emails, mode: "insensitive" } },
        { contactEmail: { in: emails, mode: "insensitive" } },
      ],
    },
    orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      contactEmail: true,
      phone: true,
      organizationId: true,
      marketingOptOut: true,
      organization: { select: { name: true, type: true } },
    },
  });
  for (const user of users) {
    const snap: PlatformClientSnapshot = {
      userId: user.id,
      organizationId: user.organizationId,
      name: user.name,
      phone: user.phone,
      company: user.organization.name,
      sphere: user.organization.type,
      marketingOptOut: user.marketingOptOut,
    };
    const primary = contactEmail(user.email);
    const secondary = contactEmail(user.contactEmail);
    if (primary && !map.has(primary)) map.set(primary, snap);
    if (secondary && !map.has(secondary)) map.set(secondary, snap);
  }
  return map;
}

/**
 * Idempotently backfills historical public PDF downloads (`LegalConsent` with
 * `source = "blank-download"`) and guest PDF invoices into both `CrmContact`
 * and `MarketingContact`.
 */
export async function syncPdfLeadsBackfill(now = new Date()): Promise<PdfLeadSyncSummary> {
  const storedCursor = await readBackfillCursor();
  const sinceWhere = storedCursor
    ? { gte: new Date(storedCursor.getTime() - CRM_CURSOR_OVERLAP_MS) }
    : undefined;

  const [consents, invoices] = await Promise.all([
    db.legalConsent.findMany({
      where: {
        source: BLANK_CONSENT_SOURCE,
        ...(sinceWhere ? { createdAt: sinceWhere } : {}),
      },
      orderBy: { createdAt: "asc" },
      take: BACKFILL_BATCH,
      select: { id: true, email: true, userId: true, organizationId: true, createdAt: true },
    }),
    db.paymentOrder.findMany({
      where: {
        paymentMethod: "invoice",
        buyerJson: { not: Prisma.DbNull },
        ...(sinceWhere ? { createdAt: sinceWhere } : {}),
      },
      orderBy: { createdAt: "asc" },
      take: BACKFILL_BATCH,
      select: {
        id: true,
        email: true,
        amountRub: true,
        description: true,
        organizationId: true,
        buyerJson: true,
        createdAt: true,
      },
    }),
  ]);

  if (!consents.length && !invoices.length) {
    await writeBackfillCursor(now);
    return { blankRows: 0, invoiceRows: 0, crmCreated: 0, marketingUpserted: 0 };
  }

  const consentIds = consents.map((row) => row.id);
  const allEmails = [
    ...new Set(
      [...consents.map((row) => contactEmail(row.email)), ...invoices.map((row) => contactEmail(row.email))].filter(
        (email): email is string => Boolean(email),
      ),
    ),
  ];

  const [audits, marketingConsents, clientsByEmail, existingContacts, suppressions] = await Promise.all([
    consentIds.length
      ? db.auditLog.findMany({
          where: { action: BLANK_DOWNLOAD_AUDIT_ACTION, entityId: { in: consentIds } },
          select: { entityId: true, details: true },
        })
      : Promise.resolve([]),
    allEmails.length
      ? db.legalConsent.findMany({
          where: { source: BLANK_MARKETING_CONSENT_SOURCE, email: { in: allEmails } },
          select: { email: true },
          distinct: ["email"],
        })
      : Promise.resolve([]),
    loadClientsByEmails(allEmails),
    allEmails.length
      ? db.marketingContact.findMany({
          where: { email: { in: allEmails } },
          select: EXISTING_CONTACT_SELECT,
        })
      : Promise.resolve([]),
    allEmails.length
      ? db.emailSuppression.findMany({
          where: { email: { in: allEmails } },
          select: { email: true, reason: true },
        })
      : Promise.resolve([]),
  ]);

  const auditByConsentId = new Map(
    audits
      .filter((row): row is { entityId: string; details: Prisma.JsonValue } => Boolean(row.entityId))
      .map((row) => [row.entityId, auditTargetFromDetails(row.details)]),
  );
  const marketingEmailSet = new Set(
    marketingConsents
      .map((row) => contactEmail(row.email))
      .filter((email): email is string => Boolean(email)),
  );
  const existingMap = new Map<string, ExistingMarketingContactSnapshot>(
    existingContacts.map((row) => [row.email, row]),
  );
  const suppressionMap = new Map<string, string>(
    suppressions.map((row) => [row.email, row.reason]),
  );

  // Backfill userId / organizationId onto LegalConsent rows that matched an existing platform client.
  for (const consent of consents) {
    if (consent.userId && consent.organizationId) continue;
    const email = contactEmail(consent.email);
    const client = email ? clientsByEmail.get(email) : undefined;
    if (!client) continue;
    await db.legalConsent
      .update({
        where: { id: consent.id },
        data: {
          userId: consent.userId ?? client.userId,
          organizationId: consent.organizationId ?? client.organizationId,
        },
      })
      .catch(() => undefined);
  }

  const crmItems = [
    ...consents.map((row) => {
      const email = contactEmail(row.email);
      const client = email ? clientsByEmail.get(email) : undefined;
      const meta = auditByConsentId.get(row.id);
      return mapBlankDownload({
        id: row.id,
        email: row.email,
        userId: row.userId ?? client?.userId ?? null,
        organizationId: row.organizationId ?? client?.organizationId ?? null,
        createdAt: row.createdAt,
        title: meta?.title ?? null,
        company: meta?.company ?? null,
      });
    }),
    ...invoices.map((row) => {
      const email = contactEmail(row.email);
      const client = email ? clientsByEmail.get(email) : undefined;
      return mapGuestInvoice({
        id: row.id,
        email: row.email,
        amountRub: Number(row.amountRub),
        description: row.description,
        organizationId: row.organizationId ?? client?.organizationId ?? null,
        buyerJson: row.buyerJson,
        createdAt: row.createdAt,
      });
    }),
  ];

  const ingested = await ingestCrmItems(crmItems);

  // Backfill company name on existing CrmContact rows if earlier blank downloads were ingested without company.
  const latestCompanyByEmail = new Map<string, string>();
  for (const row of consents) {
    const email = contactEmail(row.email);
    const company = auditByConsentId.get(row.id)?.company;
    if (email && company && company !== DEFAULT_ORG_NAME) {
      latestCompanyByEmail.set(email, company);
    }
  }
  for (const [email, company] of latestCompanyByEmail) {
    await db.crmContact
      .updateMany({
        where: {
          email,
          OR: [{ company: null }, { company: "" }, { company: DEFAULT_ORG_NAME }],
        },
        data: { company: company.slice(0, 300) },
      })
      .catch(() => undefined);
  }

  let marketingUpserted = 0;

  // Apply blank downloads then guest invoices in chronological order, updating in-memory snapshot per email.
  type MarketingLeadEvent = {
    at: number;
    email: string;
    marketingConsent: boolean;
    source: string;
    basis: string;
    tags: string[];
    company: string | null;
    note: string | null;
  };

  const events: MarketingLeadEvent[] = [];
  for (const row of consents) {
    const email = contactEmail(row.email);
    if (!email) continue;
    const meta = auditByConsentId.get(row.id);
    const tag = blankTargetTag(meta?.target);
    events.push({
      at: row.createdAt.getTime(),
      email,
      marketingConsent: marketingEmailSet.has(email),
      source: BLANK_MAILING_SOURCE,
      basis: BLANK_MAILING_BASIS_CONSENT,
      tags: tag ? [tag] : [],
      company: meta?.company ?? null,
      note: meta?.title ? `Шаблон: ${meta.title}` : null,
    });
  }
  for (const row of invoices) {
    const email = contactEmail(row.email);
    if (!email) continue;
    events.push({
      at: row.createdAt.getTime(),
      email,
      marketingConsent: marketingEmailSet.has(email),
      source: GUEST_INVOICE_MAILING_SOURCE,
      basis: GUEST_INVOICE_MAILING_BASIS,
      tags: ["счет-по-инн"],
      company: buyerCompanyFromJson(row.buyerJson),
      note: `Счёт: ${row.description}`,
    });
  }
  events.sort((a, b) => a.at - b.at);

  for (const event of events) {
    const current = existingMap.get(event.email) ?? null;
    const client = clientsByEmail.get(event.email) ?? null;
    const plan = mergePdfLeadMarketingContact({
      email: event.email,
      existing: current,
      suppressedReason: suppressionMap.get(event.email) ?? null,
      marketingConsent: event.marketingConsent,
      source: event.source,
      basis: event.basis,
      tags: event.tags,
      company: event.company,
      note: event.note,
      platformClient: client,
    });
    if (plan.action === "skip") continue;
    if (plan.action === "create") {
      try {
        const created = await db.marketingContact.create({
          data: plan.data,
          select: EXISTING_CONTACT_SELECT,
        });
        existingMap.set(event.email, created);
        marketingUpserted += 1;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const raced = await db.marketingContact.findUnique({
          where: { email: event.email },
          select: EXISTING_CONTACT_SELECT,
        });
        if (raced) existingMap.set(event.email, raced);
      }
    } else {
      const updated = await db.marketingContact.update({
        where: { id: plan.id },
        data: plan.data,
        select: EXISTING_CONTACT_SELECT,
      });
      existingMap.set(event.email, updated);
      marketingUpserted += 1;
    }
  }

  const saturated = consents.length >= BACKFILL_BATCH || invoices.length >= BACKFILL_BATCH;
  let nextCursor = now;
  if (saturated) {
    const boundaryCandidates = [
      consents.length >= BACKFILL_BATCH ? consents[consents.length - 1]?.createdAt : null,
      invoices.length >= BACKFILL_BATCH ? invoices[invoices.length - 1]?.createdAt : null,
    ].filter((date): date is Date => Boolean(date));
    if (boundaryCandidates.length > 0) {
      nextCursor = new Date(Math.min(...boundaryCandidates.map((date) => date.getTime())));
    }
  }
  await writeBackfillCursor(nextCursor);

  return {
    blankRows: consents.length,
    invoiceRows: invoices.length,
    crmCreated: ingested.created,
    marketingUpserted,
  };
}

/**
 * Throttled, single-flight sync called on admin CRM / Mailing / Downloads reads
 * so historical downloads appear immediately even if `/api/cron/crm` hasn't run.
 */
export async function ensurePdfLeadsSynced(now = new Date()): Promise<void> {
  const nowMs = Date.now();
  if (nowMs - lastLazySyncAtMs < LAZY_SYNC_MIN_INTERVAL_MS) return;
  if (!inFlightSync) {
    inFlightSync = syncPdfLeadsBackfill(now)
      .then((summary) => {
        lastLazySyncAtMs = Date.now();
        return summary;
      })
      .finally(() => {
        inFlightSync = null;
      });
  }
  try {
    await inFlightSync;
  } catch (error) {
    console.error("[pdf-leads] lazy sync failed", error);
  }
}
