import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

/**
 * POST /api/bonus-entries/[id]/reject
 *
 * Phase 3 → шаг 3.5. Менеджер отзывает уже выставленную премию: обнуляет
 * выплату, проставляет причину. Видна сотруднику в его фиде (TODO 3.6).
 *
 * Идемпотентно: повторный reject на уже rejected — 409. Новый reason
 * после первого reject не пишем — это решение можно пересмотреть, если
 * потребуется audit-trail (тогда вынести в `BonusEntryHistory`).
 */

const rejectSchema = z.object({
  reason: z
    .string()
    .min(3, "Причина минимум 3 символа")
    .max(500, "Причина максимум 500 символов"),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;

  const session = auth.session;
  if (
    !hasFullWorkspaceAccess({
      role: session.user.role,
      isRoot: session.user.isRoot === true,
    })
  ) {
    return NextResponse.json(
      { error: "Это действие доступно руководителю" },
      { status: 403 }
    );
  }

  const orgId = getActiveOrgId(session);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Некорректный JSON" },
      { status: 400 }
    );
  }

  const parsed = rejectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ошибка валидации" },
      { status: 400 }
    );
  }

  const bonus = await db.bonusEntry.findUnique({
    where: { id },
    select: { id: true, organizationId: true, status: true },
  });

  if (!bonus || bonus.organizationId !== orgId) {
    return NextResponse.json(
      { error: "Премия не найдена" },
      { status: 404 }
    );
  }

  if (bonus.status === "rejected") {
    return NextResponse.json(
      { error: "Премия уже отозвана" },
      { status: 409 }
    );
  }

  const updated = await db.bonusEntry.update({
    where: { id },
    data: {
      status: "rejected",
      rejectedById: session.user.id,
      rejectedAt: new Date(),
      rejectedReason: parsed.data.reason,
    },
    select: {
      id: true,
      status: true,
      rejectedAt: true,
      rejectedReason: true,
    },
  });

  return NextResponse.json({
    id: updated.id,
    status: updated.status,
    rejectedAt: updated.rejectedAt?.toISOString() ?? null,
    rejectedReason: updated.rejectedReason,
  });
}
