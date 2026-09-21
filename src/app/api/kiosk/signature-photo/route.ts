import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { db } from "@/lib/db";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { uploadsDir } from "@/lib/uploads-path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SIZE = 3 * 1024 * 1024;
const RECENT_MS = 5 * 60 * 1000;

/**
 * POST /api/kiosk/signature-photo — кадр с фронтальной камеры к подписи.
 *
 * Снимается на киоске сразу после верного ПИН (при включённой у организации
 * фотофиксации и согласии сотрудника). Файл кладём туда же, куда вложения
 * журналов, и прикрепляем к последнему SignatureEvent этого сотрудника на
 * этом планшете. Это доказательство «вошёл именно он», а не биометрия:
 * автоматического распознавания нет.
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  const deviceId = session?.user?.kioskDeviceId ?? null;
  if (!session || !deviceId) {
    return NextResponse.json({ error: "Нужна сессия общего планшета" }, { status: 401 });
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { kioskPhotoConsentAt: true, organizationId: true },
  });
  if (!user?.kioskPhotoConsentAt) {
    return NextResponse.json({ error: "Нет согласия на фотофиксацию" }, { status: 403 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || !file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Нужен файл изображения" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "Слишком большой кадр" }, { status: 400 });
  }

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const filename = `sig-${crypto.randomBytes(8).toString("hex")}.${ext}`;
  const dir = join(uploadsDir(), "signatures");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, filename), Buffer.from(await file.arrayBuffer()));
  const url = `/uploads/signatures/${filename}`;

  const latest = await db.signatureEvent.findFirst({
    where: {
      userId: session.user.id,
      deviceId,
      photoUrl: null,
      createdAt: { gte: new Date(Date.now() - RECENT_MS) },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (latest) {
    await db.signatureEvent.update({ where: { id: latest.id }, data: { photoUrl: url } });
  }

  return NextResponse.json({ ok: true, url, attached: Boolean(latest) });
}
