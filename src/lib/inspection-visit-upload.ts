import { orderScanPhotoToJpeg } from "@/lib/order-scan-camera";

/**
 * Подготовка файла основания в браузере (портал проверяющего и кабинет):
 * PDF уходит как есть, фото — уменьшенным JPEG (как снимок приказа к
 * журналу): 12-мегапиксельное фото иначе весит 5–10 МБ, а HEIC с iPhone
 * сервер не примет. Не получилось перекодировать — исходный файл, сервер
 * сам объяснит, что не так.
 */
export async function prepareVisitUpload(file: File): Promise<File> {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (isPdf) return file;
  const jpeg = await orderScanPhotoToJpeg(file);
  if (jpeg === file) return file;
  const base = file.name.replace(/\.[^.]+$/, "").trim() || "osnovanie";
  return new File([jpeg], `${base}.jpg`, { type: "image/jpeg" });
}
