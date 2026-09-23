import type { QrFillKind } from "@/lib/qr-fill-types";

/**
 * Куда ведёт кнопка «QR-точка контроля» журнала — чистый модуль без
 * серверных импортов (его берут клиентские кнопки и страница плакатов).
 *
 * Адрес один на все журналы: `?journal=<код>[&doc=<документ>]` — экран
 * «QR-коды журнала» (2026-09-23). Там основные QR (у гигиены два — сотрудникам
 * и «допуск»), дополнительные QR документов, а у журналов объектов
 * (холодильники, склады, УФ-лампы) ещё и наклейки на сами объекты; `doc=`
 * сужает наклейки до строк документа. Старые адреса (`kind=journals&ids=…`,
 * `kind=equipment&layout=sheet&journal=…`) разбирает `parseQrPostersRequest`.
 */

/** Второй плакат гигиены — «Допуск сотрудников» для ответственного. */
export const HYGIENE_VERIFY_SUFFIX = "@verify";

/** Журналы объектов и вид их наклеек на странице плакатов. */
export const JOURNAL_OBJECT_QR_KINDS: Readonly<Record<string, "equipment" | "rooms">> = Object.freeze({
  cold_equipment_control: "equipment",
  climate_control: "rooms",
  uv_lamp_runtime: "equipment",
});

export function isJournalObjectQrCode(code: string | null | undefined): boolean {
  return typeof code === "string" && Object.prototype.hasOwnProperty.call(JOURNAL_OBJECT_QR_KINDS, code);
}

export function journalQrHref(templateCode: string, options: { documentId?: string | null } = {}): string {
  const search = new URLSearchParams({ journal: templateCode });
  if (options.documentId) search.set("doc", options.documentId);
  return `/settings/qr-posters?${search.toString()}`;
}

/**
 * `kind` из адреса страницы плакатов. Принимаем и единственное, и
 * множественное число: ссылка гигиены шла с `kind=journal` и открывала
 * склады вместо журналов.
 */
export function parseQrPosterKind(raw: string | null | undefined): QrFillKind {
  switch ((raw ?? "").trim().toLowerCase()) {
    case "journal":
    case "journals":
      return "journal";
    case "equipment":
      return "equipment";
    default:
      return "room";
  }
}

/** `hygiene@verify:<doc>` → код, документ и признак второго плаката. */
export function splitJournalPosterId(id: string): { code: string; documentId: string | null; verify: boolean } {
  const [rawCode = "", documentId] = id.split(":");
  const verify = rawCode.endsWith(HYGIENE_VERIFY_SUFFIX);
  return {
    code: verify ? rawCode.slice(0, -HYGIENE_VERIFY_SUFFIX.length) : rawCode,
    documentId: documentId ? documentId : null,
    verify,
  };
}
