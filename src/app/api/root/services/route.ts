import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { refreshPromoDataset } from "@/lib/promo-cache";
import { readServices } from "@/lib/services/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/root/services — правка каталога платных услуг. ROOT-only,
 * middleware отдаёт 404 всем остальным.
 *
 * Ключ услуги не меняем: на него ссылаются уже созданные заявки
 * (`ServiceRequest.serviceKey`), и переименование осиротило бы их.
 * Всё остальное — цена, тексты, категория, видимость — правится здесь,
 * поэтому смена прайса не требует деплоя.
 */

const MAX_PRICE = 10_000_000;

const PatchSchema = z.object({
  key: z.string().min(1).max(64),
  title: z.string().trim().min(1).max(160).optional(),
  summary: z.string().trim().min(1).max(400).optional(),
  description: z.string().trim().min(1).max(4000).optional(),
  // null — «цена по запросу»; это осмысленное значение, не «не менять».
  priceRub: z.number().int().min(0).max(MAX_PRICE).nullable().optional(),
  priceFrom: z.boolean().optional(),
  unit: z.string().trim().max(40).nullable().optional(),
  category: z.enum(["setup", "consult", "audit", "docs"]).optional(),
  active: z.boolean().optional(),
  sort: z.number().int().min(0).max(10_000).optional(),
});

export async function GET() {
  await requireRoot();
  const services = await readServices();
  return NextResponse.json({ services });
}

export async function PATCH(request: Request) {
  await requireRoot();

  const parsed = PatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Некорректный запрос" },
      { status: 400 }
    );
  }

  const { key, ...patch } = parsed.data;

  const existing = await db.platformService.findUnique({ where: { key } });
  if (!existing) {
    return NextResponse.json({ error: "Услуга не найдена" }, { status: 404 });
  }

  // undefined отбрасываем, null оставляем: он означает «сбросить цену
  // в „по запросу“», а не «поле не пришло».
  const data = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined)
  );
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Нечего менять" }, { status: 400 });
  }

  const service = await db.platformService.update({ where: { key }, data });
  await refreshPromoDataset("services").catch((error) =>
    console.error("[services] promo snapshot refresh failed", error),
  );
  return NextResponse.json({ service });
}
