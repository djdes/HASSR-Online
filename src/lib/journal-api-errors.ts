import { createTranslator } from "use-intl/core";
import { loadMessages } from "@/i18n/messages";
import { resolveRequestLocale } from "@/i18n/site-locale";

const errors = {
  UNAUTHORIZED: { key: "unauthorized", status: 401 },
  DOCUMENT_NOT_FOUND: { key: "notFound", status: 404 },
  EMPTY_REQUEST: { key: "emptyRequest", status: 400 },
  MANAGEMENT_REQUIRED: { key: "managementRequired", status: 403 },
  "responsible-not-in-org": { key: "responsibleNotInOrg", status: 400 },
  DOCUMENT_CLOSED: { key: "closedDocument", status: 400 },
  INVALID_DOCUMENT_STATUS: { key: "invalidStatus", status: 400 },
  INVALID_DOCUMENT_PERIOD: { key: "invalidPeriod", status: 400 },
  REVERSED_DOCUMENT_PERIOD: { key: "reversedPeriod", status: 400 },
  INVALID_DOCUMENT_CONFIG: { key: "invalidConfig", status: 400 },
  CLEANING_ROOMS_REQUIRED: { key: "cleaningRoomsRequired", status: 400 },
  CLEANING_STAFF_REQUIRED: { key: "cleaningStaffRequired", status: 400 },
} as const;

/** Request-local messages: authenticated preferences take precedence over cookies. */
export async function journalApiErrors(request: Request, user?: {
  locale?: string | null; organizationLocale?: string | null;
}) {
  const locale = resolveRequestLocale(request, {
    authenticated: Boolean(user), userLocale: user?.locale,
    organizationLocale: user?.organizationLocale,
  });
  const t = createTranslator({ locale, messages: await loadMessages(locale), namespace: "journalApi" });
  const headers = { "Cache-Control": "private, no-store", "Content-Language": locale };
  return {
    response(code: keyof typeof errors) {
      const { key, status } = errors[code];
      return Response.json({ code, error: t(key) }, { status, headers });
    },
    unsignedRows(rows: { productName?: unknown; productionDateTime?: unknown }[]) {
      return Response.json({
        code: "unsigned-rows",
        error: t("unsignedRows", { count: rows.length }),
        params: { count: rows.length },
        unsigned: rows.slice(0, 20).map(row => String(row.productName || row.productionDateTime || t("unnamedRow"))),
      }, { status: 409, headers });
    },
  };
}
