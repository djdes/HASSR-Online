import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { VISION_IMAGE_TTL_MS, isVisionImageId } from "@/lib/ai-vision/image-link";

/**
 * Временная папка фото для распознавания: `os.tmpdir()/wesetup-vision/`.
 *
 * Фото живёт, пока воркер его не скачает: запрос распознавания удаляет свои
 * файлы сразу после ответа, а каждый новый запрос подметает забытые (старше
 * 15 минут — это срок ссылки). Имя случайное (128 бит), тип определяем по
 * первым байтам файла, а не по тому, что прислал браузер.
 */

export type VisionImageMime = "image/jpeg" | "image/png" | "image/webp";

const EXT_BY_MIME: Record<VisionImageMime, "jpg" | "png" | "webp"> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const MIME_BY_EXT: Record<string, VisionImageMime> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export function visionTempDir(): string {
  return path.join(os.tmpdir(), "wesetup-vision");
}

/** JPEG / PNG / WEBP по сигнатуре; всё остальное (HEIC, GIF, PDF, мусор) — null. */
export function sniffImageMime(bytes: Uint8Array): VisionImageMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === "RIFF" &&
    String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export function mimeOfVisionImageId(id: string): VisionImageMime | null {
  const ext = id.slice(id.lastIndexOf("-") + 1);
  return MIME_BY_EXT[ext] ?? null;
}

type DirOption = { dir?: string };

/** Сохранить фото; null — не картинка JPEG/PNG/WEBP. */
export async function saveVisionImage(
  bytes: Uint8Array,
  options: DirOption = {}
): Promise<{ id: string; mime: VisionImageMime; path: string } | null> {
  const mime = sniffImageMime(bytes);
  if (!mime) return null;
  const dir = options.dir ?? visionTempDir();
  await fs.mkdir(dir, { recursive: true });
  const id = `${crypto.randomBytes(16).toString("hex")}-${EXT_BY_MIME[mime]}`;
  const file = path.join(dir, id);
  await fs.writeFile(file, bytes, { mode: 0o600, flag: "wx" });
  return { id, mime, path: file };
}

/** Файл по id; null — id не нашего формата или файла уже нет. */
export async function readVisionImage(
  id: string,
  options: DirOption = {}
): Promise<{ bytes: Buffer; mime: VisionImageMime } | null> {
  if (!isVisionImageId(id)) return null;
  const mime = mimeOfVisionImageId(id);
  if (!mime) return null;
  try {
    const bytes = await fs.readFile(path.join(options.dir ?? visionTempDir(), id));
    return { bytes, mime };
  } catch {
    return null;
  }
}

/** Удалить свои фото; вернуть, сколько удалили. Ошибки не бросаем. */
export async function deleteVisionImages(ids: string[], options: DirOption = {}): Promise<number> {
  const dir = options.dir ?? visionTempDir();
  let removed = 0;
  for (const id of ids) {
    if (!isVisionImageId(id)) continue;
    try {
      await fs.unlink(path.join(dir, id));
      removed += 1;
    } catch {
      /* уже удалён */
    }
  }
  return removed;
}

/**
 * Подмести забытые фото: всё в папке старше срока ссылки. Чужих файлов в
 * папке не бывает, но трогаем только имена нашего формата.
 */
export async function sweepExpiredVisionImages(
  options: DirOption & { now?: number; ttlMs?: number } = {}
): Promise<number> {
  const dir = options.dir ?? visionTempDir();
  const cutoff = (options.now ?? Date.now()) - (options.ttlMs ?? VISION_IMAGE_TTL_MS);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    if (!isVisionImageId(name)) continue;
    const file = path.join(dir, name);
    try {
      const stat = await fs.stat(file);
      if (stat.mtimeMs > cutoff) continue;
      await fs.unlink(file);
      removed += 1;
    } catch {
      /* удалили параллельно */
    }
  }
  return removed;
}
