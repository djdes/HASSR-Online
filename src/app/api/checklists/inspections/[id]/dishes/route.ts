import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { checklistInspectionInArea, requireChecklistAccess } from "@/lib/custom-checklists.server";
import { checklistAnswersSchema, checklistDefinitionSchema } from "@/lib/custom-checklists";
import { hasChecklistRowSource } from "@/lib/custom-checklist-rows";
import { applyServingDishes } from "@/lib/serving-dishes";
import { loadServingDishes } from "@/lib/serving-dishes.server";
import { visibleObjectBuildingIds } from "@/lib/point-objects.server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

/**
 * «Обновить список блюд» в черновике чек-листа «Контроль температуры готовых
 * блюд на раздаче» (05.11.2026): блюда, которые появились в бракераже или в
 * справочнике после начала проверки, добавляются в конец; ответы по уже
 * имеющимся блюдам не трогаем. Права — как у сохранения черновика.
 */
export async function POST(request: Request, ctx: Ctx) {
  const auth = await requireChecklistAccess("write");
  if (!auth.ok) return auth.response;
  const parsed = z.object({ updatedAt: z.iso.datetime() }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Обновите страницу проверки" }, { status: 400 });
  const { id } = await ctx.params;
  const where = { id, organizationId: auth.organizationId, ...(auth.canManage ? {} : { createdById: auth.session.user.id }) };
  const current = await db.checklistInspection.findFirst({ where });
  if (!current || !(await checklistInspectionInArea(auth.session, auth.organizationId, current))) {
    return NextResponse.json({ error: "Проверка не найдена" }, { status: 404 });
  }
  if (current.status !== "draft") return NextResponse.json({ error: "Завершённую проверку нельзя изменять" }, { status: 409 });
  const definition = checklistDefinitionSchema.safeParse(current.snapshot);
  if (!definition.success || !hasChecklistRowSource(definition.data, "serving_dishes")) {
    return NextResponse.json({ error: "В этой проверке нет списка блюд" }, { status: 400 });
  }
  const dishes = await loadServingDishes({ organizationId: auth.organizationId, points: await visibleObjectBuildingIds(auth.session) });
  const outcome = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ChecklistInspection" WHERE id = ${id} AND "organizationId" = ${auth.organizationId} FOR UPDATE`;
    const locked = await tx.checklistInspection.findFirst({ where });
    if (!locked || locked.status !== "draft" || locked.updatedAt.toISOString() !== parsed.data.updatedAt) {
      return { error: "Проверка изменена в другой вкладке. Обновите её.", status: 409 } as const;
    }
    const applied = applyServingDishes(
      checklistDefinitionSchema.parse(locked.snapshot),
      dishes,
      checklistAnswersSchema.parse(locked.answers),
    );
    if (applied.added.length === 0) return { inspection: locked, added: 0 } as const;
    const inspection = await tx.checklistInspection.update({
      where: { id },
      data: { snapshot: json(applied.definition), answers: json(applied.answers) },
    });
    return { inspection, added: applied.added.length } as const;
  });
  if ("error" in outcome) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  return NextResponse.json(outcome, { headers: { "Cache-Control": "private, no-store" } });
}
