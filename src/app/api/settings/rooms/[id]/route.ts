import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { syncRoomChecklistItems } from "@/lib/cleaning-room-checklist-sync";
import { parseScopeSteps, type ScopeStep } from "@/lib/cleaning-document";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ClimateMetricSchema = z
  .object({
    enabled: z.boolean(),
    min: z.number().finite().nullable(),
    max: z.number().finite().nullable(),
  })
  .refine(
    (m) => !m.enabled || m.min === null || m.max === null || m.min <= m.max,
    { message: "Минимум нормы не может быть больше максимума." },
  );

const UpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  kind: z
    .enum(["guest", "kitchen", "wash", "bar", "storage", "other"])
    .optional(),
  sortOrder: z.number().int().optional(),
  // Cleaning unification: scope/days/detergent теперь хранятся на Room.
  // См. docs/superpowers/specs/2026-05-08-cleaning-unification.md
  detergent: z.string().max(500).optional().nullable(),
  // Scope-шаги принимаются в двух форматах:
  //  - legacy: string[]
  //  - new:    Array<{ label: string; requirePhoto?: boolean }>
  // parseScopeSteps в БД нормализует оба к { label, requirePhoto? }.
  currentScope: z
    .array(
      z.union([
        z.string().max(300),
        z.object({
          label: z.string().max(300),
          requirePhoto: z.boolean().optional(),
        }),
      ]),
    )
    .max(50)
    .optional(),
  generalScope: z
    .array(
      z.union([
        z.string().max(300),
        z.object({
          label: z.string().max(300),
          requirePhoto: z.boolean().optional(),
        }),
      ]),
    )
    .max(50)
    .optional(),
  currentDays: z.number().int().min(0).max(127).optional(),
  generalDays: z.number().int().min(0).max(127).optional(),
  // 2026-05-08+ schedule-type per scope + monthly day list.
  currentScheduleType: z.enum(["weekly", "monthly"]).optional(),
  generalScheduleType: z.enum(["weekly", "monthly"]).optional(),
  currentMonthDays: z
    .array(
      z.union([z.string().regex(/^([1-9]|[12][0-9]|3[01]|last)$/), z.literal("last")]),
    )
    .max(31)
    .optional(),
  generalMonthDays: z
    .array(
      z.union([z.string().regex(/^([1-9]|[12][0-9]|3[01]|last)$/), z.literal("last")]),
    )
    .max(31)
    .optional(),
  requirePhoto: z.boolean().optional(),
  // 2026-09-04: кто убирает / кто проверяет помещение. Порядок = приоритет.
  cleanerUserIds: z.array(z.string().min(1)).max(30).optional(),
  verifierUserIds: z.array(z.string().min(1)).max(30).optional(),
  // 2026-09-04: нормы климата (единый справочник помещений). null —
  // нормы не заданы.
  climateNorms: z
    .object({
      temperature: ClimateMetricSchema,
      humidity: ClimateMetricSchema,
    })
    .refine((v) => v.temperature.enabled || v.humidity.enabled, {
      message: "Нужно оставить включённой хотя бы одну норму для помещения.",
    })
    .nullable()
    .optional(),
});

type Ctx = { params: Promise<{ id: string }> };

/** Дедуп с сохранением порядка (первый = основной). */
function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids));
}

/**
 * Все id принадлежат организации и активны. Паттерн из
 * api/settings/journal-responsibles/[code] — чужие/архивные id → 400.
 */
async function ensureOrgUsers(orgId: string, ids: string[]): Promise<boolean> {
  if (ids.length === 0) return true;
  const found = await db.user.findMany({
    where: { id: { in: ids }, organizationId: orgId, isActive: true, archivedAt: null },
    select: { id: true },
  });
  return found.length === ids.length;
}

export async function PATCH(request: Request, ctx: Ctx) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const orgId = getActiveOrgId(auth.session);
  const { id } = await ctx.params;
  const previous = await db.room.findFirst({
    where: { id, building: { organizationId: orgId } },
    select: { id: true, name: true },
  });
  if (!previous) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }

  let body: z.infer<typeof UpdateSchema>;
  try {
    body = UpdateSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Bad input" },
        { status: 400 }
      );
    }
    throw err;
  }

  // Нормализуем scope в единый формат ScopeStep[] (с валидацией label
  // и опциональным requirePhoto). Принятый input может быть смешанный:
  // часть string-ов (legacy), часть объектов — parseScopeSteps это
  // унифицирует.
  const cleanScopeSteps = (
    arr: Array<string | { label: string; requirePhoto?: boolean }> | undefined,
  ): ScopeStep[] | undefined =>
    arr === undefined ? undefined : parseScopeSteps(arr).slice(0, 50);

  // Для checklist-sync нужны только labels (ChecklistItem не хранит
  // requirePhoto — это атрибут pipeline, не самого пункта).
  const labelsOnly = (steps: ScopeStep[] | undefined): string[] | undefined =>
    steps === undefined ? undefined : steps.map((s) => s.label);

  const nextCurrentScope = cleanScopeSteps(body.currentScope);
  const nextGeneralScope = cleanScopeSteps(body.generalScope);

  const nextCleanerIds =
    body.cleanerUserIds !== undefined ? uniqueIds(body.cleanerUserIds) : undefined;
  const nextVerifierIds =
    body.verifierUserIds !== undefined ? uniqueIds(body.verifierUserIds) : undefined;
  const idsToCheck = uniqueIds([...(nextCleanerIds ?? []), ...(nextVerifierIds ?? [])]);
  if (!(await ensureOrgUsers(orgId, idsToCheck))) {
    return NextResponse.json(
      { error: "Некоторые сотрудники не принадлежат организации или в архиве" },
      { status: 400 },
    );
  }

  // Cleaning unification 2026-05-08: при изменении scope — синкаем
  // JournalChecklistItem'ы (TF task-fill подтягивает оттуда чек-лист).
  // Делаем ДО update Room чтобы не оставлять рассинхрона если sync упадёт.
  if (nextCurrentScope !== undefined || nextGeneralScope !== undefined) {
    await syncRoomChecklistItems({
      organizationId: orgId,
      roomId: id,
      currentScope: labelsOnly(nextCurrentScope),
      generalScope: labelsOnly(nextGeneralScope),
      createdByUserId: auth.session.user.id,
    });
  }

  const updated = await db.room.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.kind !== undefined ? { kind: body.kind } : {}),
      ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
      ...(body.detergent !== undefined
        ? { detergent: body.detergent ?? "" }
        : {}),
      ...(nextCurrentScope !== undefined
        ? { currentScope: nextCurrentScope }
        : {}),
      ...(nextGeneralScope !== undefined
        ? { generalScope: nextGeneralScope }
        : {}),
      ...(body.currentDays !== undefined
        ? { currentDays: body.currentDays }
        : {}),
      ...(body.generalDays !== undefined
        ? { generalDays: body.generalDays }
        : {}),
      ...(body.currentScheduleType !== undefined
        ? { currentScheduleType: body.currentScheduleType }
        : {}),
      ...(body.generalScheduleType !== undefined
        ? { generalScheduleType: body.generalScheduleType }
        : {}),
      ...(body.currentMonthDays !== undefined
        ? { currentMonthDays: [...new Set(body.currentMonthDays)] }
        : {}),
      ...(body.generalMonthDays !== undefined
        ? { generalMonthDays: [...new Set(body.generalMonthDays)] }
        : {}),
      ...(body.requirePhoto !== undefined
        ? { requirePhoto: body.requirePhoto }
        : {}),
      ...(nextCleanerIds !== undefined ? { cleanerUserIds: nextCleanerIds } : {}),
      ...(nextVerifierIds !== undefined ? { verifierUserIds: nextVerifierIds } : {}),
      ...(body.climateNorms !== undefined
        ? { climateNorms: body.climateNorms === null ? Prisma.JsonNull : body.climateNorms }
        : {}),
    },
  });

  // Зеркальная Area (legacy split: Area — оборудование/записи, Room —
  // журналы). Переименование помещения раньше не доходило до Area, и
  // связь по имени рвалась.
  if (body.name !== undefined && body.name !== previous.name) {
    await db.area
      .updateMany({
        where: { organizationId: orgId, name: previous.name },
        data: { name: body.name },
      })
      .catch(() => {
        /* best-effort: дубликат имени в Area не должен ломать PATCH */
      });
  }
  return NextResponse.json({ room: updated });
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const orgId = getActiveOrgId(auth.session);
  const { id } = await ctx.params;
  const room = await db.room.findFirst({
    where: { id, building: { organizationId: orgId } },
    select: { id: true, name: true },
  });
  if (!room) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }
  await db.room.delete({ where: { id } });
  // Зеркальная Area удаляется только если к ней ничего не привязано
  // (оборудование, записи журналов) — иначе остаётся.
  const mirrors = await db.area.findMany({
    where: { organizationId: orgId, name: room.name },
    select: {
      id: true,
      _count: { select: { equipment: true, journalEntries: true } },
    },
  });
  const removable = mirrors
    .filter((a) => a._count.equipment === 0 && a._count.journalEntries === 0)
    .map((a) => a.id);
  if (removable.length > 0) {
    await db.area.deleteMany({ where: { id: { in: removable } } });
  }
  return NextResponse.json({ ok: true });
}
