import { FORMAT_LOCALES, formatDate, formatNumber, type Locale } from "@/i18n/locales";

export const SERVICE_REQUEST_STATUS_KEYS = {
  new: "status.new",
  in_progress: "status.inProgress",
  done: "status.done",
  cancelled: "status.cancelled",
} as const;

export type ServiceRequestStatusKey = (typeof SERVICE_REQUEST_STATUS_KEYS)[keyof typeof SERVICE_REQUEST_STATUS_KEYS];
export type ServiceRequestErrorKey = "errors.invalidRequest" | "errors.notFound" | "errors.updateFailed";
export type DeliveryKey = "both" | "telegram" | "email" | "none";

const LEGACY_API_ERRORS = {
  "Некорректный запрос": "errors.invalidRequest",
  "Заявка не найдена": "errors.notFound",
} as const satisfies Record<string, ServiceRequestErrorKey>;

/** Known IDs translate; arbitrary and prototype-like server statuses stay literal. */
export function serviceRequestStatusKey(status: string): ServiceRequestStatusKey | undefined {
  return Object.hasOwn(SERVICE_REQUEST_STATUS_KEYS, status)
    ? SERVICE_REQUEST_STATUS_KEYS[status as keyof typeof SERVICE_REQUEST_STATUS_KEYS]
    : undefined;
}

/** Legacy prose is adapted only by exact known value; unknown API text is not reflected. */
export function serviceRequestErrorKey(error: unknown): ServiceRequestErrorKey {
  return typeof error === "string" && Object.hasOwn(LEGACY_API_ERRORS, error)
    ? LEGACY_API_ERRORS[error as keyof typeof LEGACY_API_ERRORS]
    : "errors.updateFailed";
}

export function serviceRequestDeliveryKey(notifiedTg: boolean, notifiedEmail: boolean): DeliveryKey {
  if (notifiedTg && notifiedEmail) return "both";
  if (notifiedTg) return "telegram";
  if (notifiedEmail) return "email";
  return "none";
}

/** Date and time are display-only; the Date's instant and local runtime zone are retained. */
export type ServiceRequestTimestamp =
  | { kind: "native"; value: string }
  | { kind: "localized"; date: string; time: string };

export function formatServiceRequestTimestamp(value: string, locale: Locale): ServiceRequestTimestamp {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return {
      kind: "native",
      value: date.toLocaleString(FORMAT_LOCALES[locale], {
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    };
  }
  if (locale === "ru") {
    return {
      kind: "native",
      value: date.toLocaleString("ru-RU", {
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      }),
    };
  }

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dateText = formatDate(locale, date, timeZone, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const timeText = new Intl.DateTimeFormat(FORMAT_LOCALES[locale], {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(date);
  return { kind: "localized", date: dateText, time: timeText };
}

/** Healthy Uzbek decimal presentation: Latin digits, NBSP grouping and comma decimal. */
export function formatServiceRequestAmount(value: number, locale: Locale): string {
  return formatNumber(locale === "uz" && Number.isFinite(value) ? "ru" : locale, value);
}
