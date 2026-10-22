import { useLayoutEffect, useRef } from "react";
import { isFetchNetworkError } from "@/lib/humanize-fetch-error";

export type LifecycleLocale = "ru" | "en" | "uz";
export type LifecycleFeedbackKey =
  | "documentLifecycle.finishFailed"
  | "closeDocument.networkError"
  | "documentActions.deleteError"
  | "documentActions.closeError"
  | "documentLifecycle.statusFailed"
  | "documentLifecycle.restoreFailed"
  | "documentLifecycle.moveToActiveFailed"
  | "documentLifecycle.deleteFailedShort"
  | "documentLifecycle.genericStatusFailed";
export type LifecycleErrorKey =
  | "documentLifecycle.finishFailed"
  | "closeDocument.networkError";

export type LifecycleFeedbackSnapshot = {
  locale: LifecycleLocale;
  translate: (key: LifecycleFeedbackKey) => string;
};
export type LifecycleFeedbackRef = { current: LifecycleFeedbackSnapshot };

function normalizeLifecycleLocale(locale: string): LifecycleLocale {
  return locale === "en" || locale === "uz" ? locale : "ru";
}

/** Keep async operation feedback on the last committed locale, never an uncommitted render. */
export function useLifecycleFeedbackRef(
  locale: string,
  translate: (key: LifecycleFeedbackKey) => string,
): LifecycleFeedbackRef {
  const snapshot = useRef<LifecycleFeedbackSnapshot>({
    locale: normalizeLifecycleLocale(locale),
    translate,
  });
  useLayoutEffect(() => {
    snapshot.current = { locale: normalizeLifecycleLocale(locale), translate };
  }, [locale, translate]);
  return snapshot;
}

type LifecycleErrorMetadata = { code: string; contentLanguage: string | null };
const metadataByError = new WeakMap<Error, LifecycleErrorMetadata>();
const JOURNAL_API_ERROR_CODES = new Set([
  "UNAUTHORIZED", "DOCUMENT_NOT_FOUND", "EMPTY_REQUEST", "MANAGEMENT_REQUIRED",
  "responsible-not-in-org", "DOCUMENT_CLOSED", "INVALID_DOCUMENT_STATUS",
  "INVALID_DOCUMENT_PERIOD", "REVERSED_DOCUMENT_PERIOD", "INVALID_DOCUMENT_CONFIG",
  "CLEANING_ROOMS_REQUIRED", "CLEANING_STAFF_REQUIRED", "unsigned-rows",
]);

/** Attach only response provenance; leave the original Error object untouched. */
export function attachLifecycleErrorMetadata(
  error: Error,
  code: unknown,
  contentLanguage: string | null,
): Error {
  metadataByError.set(error, { code: typeof code === "string" ? code : "", contentLanguage });
  return error;
}

/** Only exact, allowlisted same-language server messages can cross this boundary. */
export function presentLifecycleError(
  error: unknown,
  locale: LifecycleLocale,
  translate: (key: LifecycleErrorKey) => string,
): string {
  if (isFetchNetworkError(error)) return translate("closeDocument.networkError");
  if (error instanceof Error) {
    const metadata = metadataByError.get(error);
    if (
      metadata && JOURNAL_API_ERROR_CODES.has(metadata.code) &&
      metadata.contentLanguage === locale && error.message.trim()
    ) return error.message;
  }
  return translate("documentLifecycle.finishFailed");
}
