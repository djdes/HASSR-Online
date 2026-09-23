import { isJournalObjectQrCode, parseQrPosterKind, splitJournalPosterId } from "@/lib/journal-qr-target";
import type { QrPrintFormat } from "@/lib/qr-fill-types";

/**
 * Разбор адреса страницы QR-кодов (`/settings/qr-posters`) — чистый модуль.
 *
 * Все старые входы продолжают работать, их просто переводим в три экрана:
 *   • journal  — «QR-коды журнала»: основные + дополнительные (или наклейки
 *     объектов у холодильников, климата и УФ);
 *   • objects  — наклейки оборудования или помещений (`kind=equipment|rooms`);
 *   • overview — без параметров: «Все журналы» + QR отдельных журналов.
 *
 * Входы (тест на каждый — `qr-posters-request.test.ts`):
 *   • `?journal=<код>[&doc=]`                       — кнопка «QR-точка контроля»;
 *   • `?kind=journals&ids=<код>[:док][,hygiene@verify…]` — старые ссылки и
 *     «Плакат A4 / Наклейка» из диалога QR документа (`&layout=`, `&autoprint=1`);
 *     отмечаются ровно эти id;
 *   • `?kind=equipment|rooms&layout=sheet&journal=<код>[&doc=]` — старая
 *     кнопка журнала объектов;
 *   • `?kind=equipment|rooms&doc=<id>`              — меню холодильников и климата;
 *   • `?kind=equipment&layout=sheet&ids=a,b`         — выделение холодильников;
 *   • `?kind=equipment|rooms[&layout=]`             — справочники, старый qr-sheet;
 *   • `?kind=journals`                              — «Все коды» из диалога.
 */

export type QrPostersTarget =
  | { type: "overview" }
  | { type: "journal"; code: string; documentId: string | null }
  | { type: "objects"; kind: "equipment" | "room"; documentId: string | null };

export type QrPostersRequest = {
  target: QrPostersTarget;
  /** Отметить ровно эти id (старые ссылки с `ids=`); null — отметки по умолчанию. */
  selectedIds: string[] | null;
  /** Формат из `layout=` / `format=`; null — у каждой группы свой по умолчанию. */
  format: QrPrintFormat | null;
  autoprint: boolean;
  origin: string | null;
};

export type QrPostersSearch = Partial<Record<"kind" | "layout" | "format" | "ids" | "doc" | "journal" | "autoprint" | "origin", string | string[] | undefined>>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value ?? "").trim();
}

function parseFormat(layout: string, format: string): QrPrintFormat | null {
  const raw = (format || layout).toLowerCase();
  if (raw === "sheet" || raw === "sticker") return "sticker";
  if (raw === "poster" || raw === "a4") return "a4";
  if (raw === "a5") return "a5";
  return null;
}

export function parseQrPostersRequest(search: QrPostersSearch): QrPostersRequest {
  const kindRaw = first(search.kind);
  const journal = first(search.journal);
  const doc = first(search.doc) || null;
  const ids = Array.from(
    new Set(
      first(search.ids)
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
    )
  );
  const base = {
    format: parseFormat(first(search.layout), first(search.format)),
    autoprint: first(search.autoprint) === "1",
    origin: first(search.origin) || null,
  };

  // Кнопка журнала (новая `?journal=` и старая объектная `kind=…&journal=`).
  if (journal) {
    return { ...base, target: { type: "journal", code: journal, documentId: doc }, selectedIds: ids.length > 0 ? ids : null };
  }

  if (!kindRaw) {
    return { ...base, target: { type: "overview" }, selectedIds: ids.length > 0 ? ids : null };
  }

  const kind = parseQrPosterKind(kindRaw);
  if (kind !== "journal") {
    return { ...base, target: { type: "objects", kind, documentId: doc }, selectedIds: ids.length > 0 ? ids : null };
  }

  if (ids.length === 0) return { ...base, target: { type: "overview" }, selectedIds: null };

  const parts = ids.map(splitJournalPosterId);
  const codes = Array.from(new Set(parts.map((part) => part.code)));
  if (codes.length === 1 && codes[0] && codes[0] !== "all") {
    const code = codes[0];
    const documentId = parts.find((part) => part.documentId)?.documentId ?? doc;
    // Журнал объектов в `ids=` — раньше редирект на его наклейки. Теперь
    // экран журнала с отметками по умолчанию: основной QR + наклейки.
    if (isJournalObjectQrCode(code)) {
      return { ...base, target: { type: "journal", code, documentId }, selectedIds: null };
    }
    return { ...base, target: { type: "journal", code, documentId }, selectedIds: ids };
  }
  // Несколько журналов или «Все журналы» — общий экран, отмечены эти id.
  return { ...base, target: { type: "overview" }, selectedIds: ids };
}

