export type BlankDownloadLocale = "ru" | "en" | "uz";

export type BlankDownloadErrorCode =
  | "consent_required"
  | "invalid_request"
  | "invalid_email"
  | "target_required"
  | "target_not_found"
  | "format_unsupported"
  | "consent_version"
  | "rate_limit_ip"
  | "rate_limit_email"
  | "email_domain"
  | "server_failure"
  | "network_failure";

export type BlankDownloadErrorKey =
  | "consentRequired"
  | "invalidRequest"
  | "invalidEmail"
  | "targetRequired"
  | "targetNotFound"
  | "formatUnsupported"
  | "consentVersion"
  | "rateLimitIp"
  | "rateLimitEmail"
  | "emailDomain"
  | "serverFailure"
  | "networkFailure"
  | "generic";

const ERROR_KEY_BY_CODE: Record<BlankDownloadErrorCode, BlankDownloadErrorKey> = {
  consent_required: "consentRequired",
  invalid_request: "invalidRequest",
  invalid_email: "invalidEmail",
  target_required: "targetRequired",
  target_not_found: "targetNotFound",
  format_unsupported: "formatUnsupported",
  consent_version: "consentVersion",
  rate_limit_ip: "rateLimitIp",
  rate_limit_email: "rateLimitEmail",
  email_domain: "emailDomain",
  server_failure: "serverFailure",
  network_failure: "networkFailure",
};

/** Unknown or absent locale preserves the historical Russian default. */
export function normalizeBlankDownloadLocale(value: unknown): BlankDownloadLocale {
  return value === "en" || value === "uz" || value === "ru" ? value : "ru";
}

/** The returned key is always safe for the typed publicBlankDownload.error namespace. */
export function blankDownloadErrorKey(
  code: unknown,
  needConsent = false,
): BlankDownloadErrorKey {
  if (typeof code === "string" && Object.hasOwn(ERROR_KEY_BY_CODE, code)) {
    return ERROR_KEY_BY_CODE[code as BlankDownloadErrorCode];
  }
  return needConsent ? "consentRequired" : "generic";
}

/** Snapshot exactly the visible rich consent sentence, without the presentation tags. */
export function blankConsentSnapshot(richMessage: string): string {
  return richMessage.replace(/<\/?(?:consent|privacy)>/g, "");
}

/** Snapshot the visible optional marketing sentence; the lead tag only changes emphasis. */
export function blankMarketingConsentSnapshot(richMessage: string): string {
  return richMessage.replace(/<\/?(?:lead|note)>/g, "");
}
