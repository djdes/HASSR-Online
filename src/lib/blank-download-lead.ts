/**
 * Pure helpers for persisting public PDF requesters (without a personal cabinet)
 * into the platform contact and client databases (`CrmContact` + `MarketingContact`).
 *
 * Kept free of Prisma/Node I/O so every merge rule is unit-tested directly.
 */

import type { BlankTarget } from "@/lib/blank-download";
import { contactEmail } from "@/lib/crm/sources";
import { parseTags } from "@/lib/mailing/csv";
import { DEFAULT_ORG_NAME, ORG_SPHERES, normalizeSphere } from "@/lib/org-profile";

export const BLANK_MAILING_SOURCE = "Скачали шаблон журнала";
export const BLANK_MAILING_BASIS_CONSENT = "Согласие при скачивании шаблона журнала на сайте";
export const BLANK_MAILING_BASIS_MARKETING = "Согласие на рассылку при скачивании шаблона на сайте";

export const GUEST_INVOICE_MAILING_SOURCE = "Счёт по ИНН на сайте";
export const GUEST_INVOICE_MAILING_BASIS = "Запрос счёта на оплату на сайте";

const VALID_SPHERES = new Set<string>(ORG_SPHERES.map((item) => item.value));

export type ExistingMarketingContactSnapshot = {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  sphere: string | null;
  city: string | null;
  phone: string | null;
  tags: string[];
  source: string;
  basis: string;
  status: string;
  note: string | null;
};

export type PlatformClientSnapshot = {
  userId: string;
  organizationId: string;
  name: string | null;
  phone: string | null;
  company: string | null;
  sphere: string | null;
  marketingOptOut?: boolean;
};

export type UpsertMarketingContactPlan =
  | { action: "skip" }
  | {
      action: "create";
      data: {
        email: string;
        name: string | null;
        company: string | null;
        sphere: string | null;
        city: string | null;
        phone: string | null;
        tags: string[];
        source: string;
        basis: string;
        status: string;
        note: string | null;
      };
    }
  | {
      action: "update";
      id: string;
      data: {
        name?: string | null;
        company?: string | null;
        sphere?: string | null;
        phone?: string | null;
        tags?: string[];
        basis?: string;
        status?: string;
        note?: string | null;
      };
    };

/** Tag for `MarketingContact.tags` identifying which journal template was downloaded. */
export function blankTargetTag(target: BlankTarget | null | undefined): string | null {
  if (!target) return null;
  const raw = target.kind === "code" ? target.code : `paper-${target.paperId}`;
  return parseTags(raw)[0] ?? null;
}

function cleanPersonName(name: string | null | undefined, email: string): string | null {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return null;
  // Instant registration stores email as placeholder name until profile completion.
  if (trimmed.toLowerCase() === email.toLowerCase()) return null;
  return trimmed.slice(0, 200);
}

function cleanCompanyName(company: string | null | undefined): string | null {
  const trimmed = (company ?? "").trim();
  if (!trimmed || trimmed === DEFAULT_ORG_NAME) return null;
  return trimmed.slice(0, 200);
}

function cleanPhone(phone: string | null | undefined): string | null {
  const trimmed = (phone ?? "").trim();
  return trimmed ? trimmed.slice(0, 40) : null;
}

function cleanSphere(sphere: string | null | undefined): string | null {
  if (!sphere) return null;
  const normalized = normalizeSphere(sphere);
  if (normalized === "other" && sphere.trim().toLowerCase() !== "other") return null;
  return VALID_SPHERES.has(normalized) ? normalized : null;
}

function statusFromSuppression(reason: string): string {
  if (reason === "bounced") return "bounced";
  if (reason === "complained") return "complained";
  return "unsubscribed";
}

function mergeLeadNote(existingNote: string | null | undefined, freshNote: string | null): string | null {
  const current = (existingNote ?? "").trim();
  const incoming = (freshNote ?? "").trim().slice(0, 500) || null;
  if (!current) return incoming;
  // Update auto-generated template/invoice note, but never overwrite a manual manager note.
  if (incoming && (current.startsWith("Шаблон:") || current.startsWith("Счёт:"))) {
    return incoming;
  }
  return current;
}

/**
 * Computes how a public PDF download or guest PDF invoice should be written to
 * `MarketingContact` without overwriting manual edits or opt-outs.
 */
export function mergePdfLeadMarketingContact(params: {
  email: string;
  existing: ExistingMarketingContactSnapshot | null;
  suppressedReason: string | null;
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
}): UpsertMarketingContactPlan {
  const normalizedEmail = contactEmail(params.email);
  if (!normalizedEmail) return { action: "skip" };

  const candidateName =
    cleanPersonName(params.name, normalizedEmail) ??
    cleanPersonName(params.platformClient?.name, normalizedEmail);
  const candidateCompany =
    cleanCompanyName(params.company) ??
    cleanCompanyName(params.platformClient?.company);
  const candidatePhone =
    cleanPhone(params.phone) ??
    cleanPhone(params.platformClient?.phone);
  const candidateSphere =
    cleanSphere(params.sphere) ??
    cleanSphere(params.platformClient?.sphere);

  const normalizedTags = parseTags([
    ...params.tags,
    ...(params.marketingConsent ? ["рассылка"] : []),
  ].join(","));

  const existing = params.existing;
  if (!existing) {
    const status = params.suppressedReason
      ? statusFromSuppression(params.suppressedReason)
      : params.platformClient?.marketingOptOut && !params.marketingConsent
        ? "unsubscribed"
        : "active";
    const basis = params.marketingConsent ? BLANK_MAILING_BASIS_MARKETING : params.basis;
    return {
      action: "create",
      data: {
        email: normalizedEmail,
        name: candidateName,
        company: candidateCompany,
        sphere: candidateSphere,
        city: null,
        phone: candidatePhone,
        tags: normalizedTags.slice(0, 20),
        source: params.source.trim().slice(0, 200),
        basis: basis.trim().slice(0, 200),
        status,
        note: mergeLeadNote(null, params.note),
      },
    };
  }

  const patch: Extract<UpsertMarketingContactPlan, { action: "update" }>["data"] = {};

  if (!existing.name && candidateName) patch.name = candidateName;
  if (!existing.company && candidateCompany) patch.company = candidateCompany;
  if (!existing.phone && candidatePhone) patch.phone = candidatePhone;
  if (!existing.sphere && candidateSphere) patch.sphere = candidateSphere;

  const mergedTags = [...new Set([...existing.tags, ...normalizedTags])].slice(0, 20);
  if (
    mergedTags.length !== existing.tags.length ||
    mergedTags.some((tag, index) => tag !== existing.tags[index])
  ) {
    patch.tags = mergedTags;
  }

  if (params.marketingConsent && existing.basis !== BLANK_MAILING_BASIS_MARKETING) {
    patch.basis = BLANK_MAILING_BASIS_MARKETING;
  }

  // Respect bounce/complaint and stop-list; reactivate unsubscribed only on fresh explicit marketing consent.
  if (params.suppressedReason) {
    const suppressedStatus = statusFromSuppression(params.suppressedReason);
    if (existing.status === "active") {
      patch.status = suppressedStatus;
    }
  } else if (
    params.marketingConsent &&
    existing.status === "unsubscribed"
  ) {
    patch.status = "active";
  }

  const nextNote = mergeLeadNote(existing.note, params.note);
  if (nextNote !== existing.note) {
    patch.note = nextNote;
  }

  if (Object.keys(patch).length === 0) {
    return { action: "skip" };
  }

  return {
    action: "update",
    id: existing.id,
    data: patch,
  };
}
