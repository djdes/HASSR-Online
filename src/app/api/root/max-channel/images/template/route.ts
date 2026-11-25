import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRoot } from "@/lib/auth-helpers";
import { saveTemplateImage } from "@/lib/smm/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  template: z.enum(["photo-band", "photo-frame", "card", "promo"]),
  title: z.string().trim().min(1, "Напишите заголовок картинки").max(160),
  subtitle: z.string().trim().max(240).optional(),
  rubric: z.string().trim().max(40).optional(),
  offer: z.string().trim().max(24).optional(),
  deadline: z.string().trim().max(40).optional(),
  photoPath: z.string().max(120).nullable().optional(),
});

/**
 * POST /api/root/max-channel/images/template — картинка по шаблону бренда
 * (A23): фото из медиатеки + заголовок, рубрика, логотип, фирменные цвета.
 */
export async function POST(request: Request) {
  await requireRoot();
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Проверьте поля" }, { status: 400 });
  const { template, photoPath, ...data } = parsed.data;
  try {
    const path = await saveTemplateImage({ template, data, photoPath: photoPath || null });
    return NextResponse.json({ path, url: `/uploads/${path}` });
  } catch (error) {
    console.error("[smm] template render failed", (error as Error)?.message?.slice(0, 200));
    return NextResponse.json({ error: "Не удалось собрать картинку — попробуйте другое фото." }, { status: 500 });
  }
}
