import type { QrFillKind } from "@/lib/qr-fill-types";

/**
 * Куда ведёт кнопка «QR-точка контроля» журнала — чистый модуль без
 * серверных импортов (его берут клиентские кнопки и страница плакатов).
 *
 * ПОЧЕМУ отдельно: кнопка вела на `/settings/qr-posters?kind=journals&ids=
 * <код>`, а плакаты журналов собирались только для журналов «хаба». У
 * журналов объектов (холодильники, склады, УФ-лампы) плаката журнала нет
 * вовсе — запись идёт по наклейке на самом объекте, — и человек видел
 * «Выбранные объекты не найдены». Теперь адрес строится здесь, один раз:
 *   • журнал объектов → наклейки ЕГО объектов (`kind=equipment|rooms`,
 *     `layout=sheet`, `journal=<код>`, из документа — ещё `doc=`);
 *   • остальные → плакат журнала (`kind=journals&ids=<код>[:документ]`);
 *   • гигиена → оба плаката: сотрудникам и «допуск» ответственному.
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
  const search = new URLSearchParams();
  if (isJournalObjectQrCode(templateCode)) {
    search.set("kind", JOURNAL_OBJECT_QR_KINDS[templateCode]);
    search.set("layout", "sheet");
    search.set("journal", templateCode);
    if (options.documentId) search.set("doc", options.documentId);
  } else {
    const suffix = options.documentId ? `:${options.documentId}` : "";
    const ids =
      templateCode === "hygiene"
        ? [`hygiene${suffix}`, `hygiene${HYGIENE_VERIFY_SUFFIX}${suffix}`]
        : [`${templateCode}${suffix}`];
    search.set("kind", "journals");
    search.set("ids", ids.join(","));
  }
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
