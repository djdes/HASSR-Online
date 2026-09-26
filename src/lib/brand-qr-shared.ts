/**
 * Пропорции фирменного QR WeSetup — общие для сервера (`brand-qr.ts`,
 * рисует код) и клиента (задаёт размеры картинок в диалогах). Здесь
 * только числа: файл импортируется из клиентских компонентов, поэтому
 * без `qrcode`, `node:fs` и прочего серверного.
 *
 * Плитка полного варианта: квадрат кода (матрица + тихая зона) шириной W,
 * под ним плашка «Отсканировать / wesetup.ru». Доли — от W, поэтому
 * отношение высоты к ширине одно для любого адреса.
 */

/** Белый зазор между тихой зоной кода и плашкой, доля W. */
export const BRAND_QR_PLATE_GAP = 0.012;
/** Высота плашки, доля W. */
export const BRAND_QR_PLATE_HEIGHT = 0.16;
/** Белое поле под плашкой, доля W. */
export const BRAND_QR_PLATE_BOTTOM = 0.013;

/** Высота ÷ ширина плитки с плашкой (без плашки — квадрат, 1). */
export const BRAND_QR_CAPTION_ASPECT = 1 + BRAND_QR_PLATE_GAP + BRAND_QR_PLATE_HEIGHT + BRAND_QR_PLATE_BOTTOM;

/** Высота картинки QR с плашкой по её ширине, px (округление вверх — без обрезки). */
export function brandQrHeightFor(width: number): number {
  return Math.ceil(width * BRAND_QR_CAPTION_ASPECT);
}
