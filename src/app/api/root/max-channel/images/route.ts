import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { MAX_POST_IMAGE_DIR } from "@/lib/max/channel-post";
import { uploadsDir } from "@/lib/uploads-path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024;

/** Тип картинки по первым байтам — расширению и заявленному MIME не верим. */
function imageExtension(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "gif";
  const riff = String.fromCharCode(...bytes.slice(0, 4));
  const webp = String.fromCharCode(...bytes.slice(8, 12));
  if (riff === "RIFF" && webp === "WEBP") return "webp";
  return null;
}

/**
 * POST /api/root/max-channel/images — картинка для поста (multipart,
 * поле `file`). Хранится в каталоге загрузок; в MAX уходит при публикации.
 */
export async function POST(request: Request) {
  await requireRoot();
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Выберите картинку." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Картинка больше 10 МБ — уменьшите её." }, { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = imageExtension(bytes);
  if (!ext) return NextResponse.json({ error: "Подойдут JPG, PNG, WebP или GIF." }, { status: 415 });
  const name = `${randomBytes(12).toString("base64url")}.${ext}`;
  const dir = join(uploadsDir(), MAX_POST_IMAGE_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), bytes);
  const path = `${MAX_POST_IMAGE_DIR}/${name}`;
  return NextResponse.json({ path, url: `/uploads/${path}` });
}
