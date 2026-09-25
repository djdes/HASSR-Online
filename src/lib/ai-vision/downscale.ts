import { VISION_JPEG_QUALITY, VISION_TARGET_PX } from "@/lib/ai-vision/shared";

/**
 * Уменьшение фото в браузере перед отправкой на распознавание: длинная
 * сторона до 1600 px, JPEG 85 %. Снимок телефона 4–8 МБ превращается в
 * 200–600 КБ — быстрее уходит по мобильной связи и укладывается в лимиты.
 * Поворот по EXIF учитываем (`imageOrientation: "from-image"`), прозрачный
 * фон PNG — белый (иначе в JPEG он станет чёрным и текст пропадёт).
 */

/** Размер, вписанный в квадрат maxPx × maxPx с сохранением пропорций; меньше — как есть. */
export function fitWithin(width: number, height: number, maxPx: number): { width: number; height: number; scaled: boolean } {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const longest = Math.max(w, h);
  if (longest <= maxPx) return { width: w, height: h, scaled: false };
  const ratio = maxPx / longest;
  return { width: Math.max(1, Math.round(w * ratio)), height: Math.max(1, Math.round(h * ratio)), scaled: true };
}

type Decoded = { source: CanvasImageSource; width: number; height: number; close: () => void };

async function decodeImage(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      /* ниже — запасной путь через <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

/** Фото → JPEG не больше maxPx по длинной стороне. Бросает, если браузер не смог открыть файл (например, HEIC). */
export async function downscaleImageFile(
  file: Blob,
  options: { maxPx?: number; quality?: number } = {}
): Promise<Blob> {
  const decoded = await decodeImage(file);
  try {
    const { width, height } = fitWithin(decoded.width, decoded.height, options.maxPx ?? VISION_TARGET_PX);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas unavailable");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(decoded.source, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", options.quality ?? VISION_JPEG_QUALITY)
    );
    if (!blob) throw new Error("jpeg encode failed");
    return blob;
  } finally {
    decoded.close();
  }
}
