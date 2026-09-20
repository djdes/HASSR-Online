/**
 * GET — возвращает текущий override (или null если дефолты).
 * PUT — сохраняет override. Принимает `{ overrides: Partial<Record<preset, capability[]>> }`.
 *
 * Защита:
 *   - Только management-роль может менять (admin.full capability).
 *   - `admin` пресет в overrides игнорируется (нельзя случайно отрубить
 *     себя — hasCapability всё равно вернёт PRESET_CAPABILITIES[admin]).
 *   - Капабилити не из ALLOWED_CAPABILITIES — отклоняются.
 *   - Пресеты не из VALID_PRESETS — отклоняются.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const VALID_PRESETS = [
  "admin",
  "head_chef",
  "cook",
  "waiter",
  "seller",
  "cashier",
  "cleaner",
] as const;

const ALLOWED_CAPABILITIES = [
  "journals.view",
  "journals.manage",
  "staff.manage",
  "staff.view",
  "tasks.verify",
  "reports.view",
  "admin.full",
  "mini.tasks",
  "mini.acceptance",
  "mini.writeoff",
  "mini.cashier",
  "stats.view",
] as const;

const presetEnum = z.enum(VALID_PRESETS);
const capabilityEnum = z.enum(ALLOWED_CAPABILITIES);

const overridesSchema = z.object({
  overrides: z.record(presetEnum, z.array(capabilityEnum)),
});

export async function GET() {
  const session = await requireAuth();
  if (!hasCapability(session.user, "admin.full")) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const orgId = getActiveOrgId(session);
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { presetCapabilitiesJson: true },
  });
  return NextResponse.json({
    overrides: org?.presetCapabilitiesJson ?? null,
  });
}

export async function PUT(request: Request) {
  const session = await requireAuth();
  if (!hasCapability(session.user, "admin.full")) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const orgId = getActiveOrgId(session);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Невалидный JSON" }, { status: 400 });
  }

  const parsed = overridesSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Невалидная схема", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // Игнорируем override для admin'а — он всегда полный.
  const cleaned: Record<string, string[]> = {};
  for (const [preset, caps] of Object.entries(parsed.data.overrides)) {
    if (preset === "admin") continue;
    // Дедуп + сортировка для стабильного storage.
    cleaned[preset] = [...new Set(caps as string[])].sort();
  }

  // Если override-словарь пустой — пишем DbNull чтобы hasCapability
  // упал в дефолты без лишних чтений.
  await db.organization.update({
    where: { id: orgId },
    data: {
      presetCapabilitiesJson:
        Object.keys(cleaned).length > 0
          ? (cleaned as Prisma.InputJsonValue)
          : Prisma.DbNull,
    },
  });

  return NextResponse.json({ ok: true, overrides: cleaned });
}

export async function DELETE() {
  // Сброс к дефолтам — удаляем JSON.
  const session = await requireAuth();
  if (!hasCapability(session.user, "admin.full")) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const orgId = getActiveOrgId(session);
  await db.organization.update({
    where: { id: orgId },
    data: { presetCapabilitiesJson: Prisma.DbNull },
  });
  return NextResponse.json({ ok: true });
}
