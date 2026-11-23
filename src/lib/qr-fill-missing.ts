import type { QrFillKind } from "@/lib/qr-fill-types";

/** Код ответа «предмета QR нет»: окно строки журнала покажет подсказку, а не ошибку с «Повторить». */
export const QR_MISSING_CODE = "missing";

const MESSAGES: Record<QrFillKind, string> = {
  equipment: "Оборудование не найдено в справочнике",
  room: "Помещение не найдено",
  journal: "Документ не найден",
};

/**
 * Ответ 404 превью QR (2026-11-23, скриншот владельца: «Объект не найден» в
 * окне холодильника): «объект» в кабинете — это объект компании, поэтому
 * пишем, чего именно нет. `code` — окно строки журнала вместо бесполезного
 * «Повторить» объясняет, как вернуть QR (сохранить строку).
 */
export function qrMissingError(kind: QrFillKind): { error: string; code: typeof QR_MISSING_CODE } {
  return { error: MESSAGES[kind], code: QR_MISSING_CODE };
}
