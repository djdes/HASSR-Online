import { FORMAT_LOCALES, type Locale } from "@/i18n/locales";
import type { useTranslations } from "next-intl";
import { fieldNumber } from "./kind-fields-presentation";
import { mailingDiagnostic, parseMailingDiagnostic, type MailingDiagnostic } from "@/lib/mailing/diagnostic-presentation";

const KIND_KEYS = { message: "message.kind.message", kp: "message.kind.kp" } as const;
const STATUS_KEYS = { queued: "status.queued", sending: "status.sending", sent: "status.sent", failed: "status.failed", skipped: "status.skipped" } as const;

/** Closed managed enums only; extension identifiers and labels stay outside catalogs. */
export function composeKindKey(value: string): (typeof KIND_KEYS)[keyof typeof KIND_KEYS] | null {
  return Object.hasOwn(KIND_KEYS, value) ? KIND_KEYS[value as keyof typeof KIND_KEYS] : null;
}

export function composeStatusKey(value: string): (typeof STATUS_KEYS)[keyof typeof STATUS_KEYS] | null {
  return Object.hasOwn(STATUS_KEYS, value) ? STATUS_KEYS[value as keyof typeof STATUS_KEYS] : null;
}

export type ComposePreviewRecipient =
  | { version: 1; kind: "sample"; name: string; companyName: string }
  | { version: 1; kind: "actual" };

/** Optional additive presentation metadata must never alter legacy rendered data. */
export function composePreviewRecipient(value: unknown): ComposePreviewRecipient | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const own = (key: string) => Object.hasOwn(value, key);
  const record = value as Record<string, unknown>;
  if (!own("version") || record.version !== 1 || !own("kind")) return null;
  if (record.kind === "actual") return { version: 1, kind: "actual" };
  if (record.kind === "sample" && own("name") && typeof record.name === "string" && own("companyName") && typeof record.companyName === "string") {
    return { version: 1, kind: "sample", name: record.name, companyName: record.companyName };
  }
  return null;
}

export type ComposeCount = { displayCount: string; category: Intl.LDMLPluralRule };

/** Display keeps interpolation bytes. Only a separate finite selector enters ICU. */
export function composeCount(value: unknown, locale: Locale): ComposeCount {
  const displayCount = String(value);
  const count = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return { displayCount, category: Number.isFinite(count) ? new Intl.PluralRules(FORMAT_LOCALES[locale]).select(count) : "other" };
}

/** Only fixed-ruble grouping uses the established finite UZ number profile. */
export function composeDiagnosticText(
  value: unknown,
  locale: Locale,
  translate: ReturnType<typeof useTranslations<"rootMailingDiagnostics">>
): string | null {
  const diagnostic = parseMailingDiagnostic(value);
  if (!diagnostic) return null;
  switch (diagnostic.code) {
    case "request.kindUnknown": return translate(diagnostic.code, { kind: diagnostic.params.kind });
    case "request.draftOnly": return translate(diagnostic.code);
    case "request.campaignMissing": return translate(diagnostic.code);
    case "request.alreadyLaunched": return translate(diagnostic.code);
    case "request.noChannels": return translate(diagnostic.code);
    case "request.noRecipients": return translate(diagnostic.code);
    case "request.scheduleMissing": return translate(diagnostic.code);
    case "request.scheduleTooSoon": return translate(diagnostic.code);
    case "request.scheduleTooFar": return translate(diagnostic.code, { days: `${diagnostic.params.days}` });
    case "request.noEligibleRecipients": return translate(diagnostic.code);
    case "request.saveDraftFirst": return translate(diagnostic.code);
    case "request.userMissing": return translate(diagnostic.code);
    case "request.testRecipientCreateFailed": return translate(diagnostic.code);
    case "message.subjectRequired": return translate(diagnostic.code);
    case "message.subjectMax": return translate(diagnostic.code, { max: `${diagnostic.params.max}` });
    case "message.bodyRequired": return translate(diagnostic.code);
    case "message.bodyMax": return translate(diagnostic.code, { max: `${diagnostic.params.max}` });
    case "message.buttonTextRequired": return translate(diagnostic.code);
    case "message.buttonTextMax": return translate(diagnostic.code, { max: `${diagnostic.params.max}` });
    case "message.buttonUrlRequired": return translate(diagnostic.code);
    case "message.buttonUrlInvalid": return translate(diagnostic.code);
    case "kp.existingRequired": return translate(diagnostic.code);
    case "kp.codeFormat": return translate(diagnostic.code, { code: diagnostic.params.code });
    case "kp.discountPositive": return translate(diagnostic.code);
    case "kp.percentLimit": return translate(diagnostic.code, { max: `${diagnostic.params.max}` });
    case "kp.fixedLimit": return translate(diagnostic.code, { max: fieldNumber(diagnostic.params.max, locale) });
    case "kp.daysRange": return translate(diagnostic.code, { min: `${diagnostic.params.min}`, max: `${diagnostic.params.max}` });
    case "kp.codeMissing": return translate(diagnostic.code, { code: diagnostic.params.code });
    case "kp.personalCodeNotShared": return translate(diagnostic.code, { code: diagnostic.params.code });
    case "kp.singleUseCodeNotShared": return translate(diagnostic.code, { code: diagnostic.params.code });
    case "kp.codeUnavailable": return translate(diagnostic.code, { code: diagnostic.params.code });
    case "server.failure": return translate(diagnostic.code);
    case "http.status": return translate(diagnostic.code, { status: `${diagnostic.params.status}` });
  }
}

export type ComposeErrorKey = "reachFailed" | "previewFailed" | "testFailed" | "launchFailed";
export type ComposeErrorEvent = { key: ComposeErrorKey; detail?: string; presentation?: MailingDiagnostic };
export type ComposeFeedbackEvent = ComposeErrorEvent | { key: "testSucceeded" } | { key: "launched"; count: number } | { key: "scheduled"; at: string };

/** Only Error.message already shown by this workflow is retained, without parsing. */
export function composeError(key: ComposeErrorKey, error: unknown): ComposeErrorEvent {
  if (!(error instanceof Error)) return { key };
  const event = { key, detail: error.message };
  const presentation = mailingDiagnostic(error);
  return presentation ? { ...event, presentation } : event;
}
