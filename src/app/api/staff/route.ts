import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { isManagementRole } from "@/lib/user-roles";
import { createStaffMember } from "@/lib/staff-create";

/**
 * Minimal "add an employee" endpoint matching the reference-staff screen:
 * just Position + full name — no email invite here. Доменная логика
 * (синтетический email, ACL по должности, лимит тарифа, уведомления)
 * живёт в `src/lib/staff-create.ts` — её же использует действие
 * AI-помощника `add_staff`.
 */

const createSchema = z.object({
  jobPositionId: z.string().min(1, "Выберите должность"),
  fullName: z
    .string()
    .trim()
    .min(2, "ФИО слишком короткое")
    .max(200, "ФИО слишком длинное"),
  // Телефон необязателен: требование номера мешало первому заполнению
  // штата (решение владельца 2026-08-27). Автосвязка с TasksFlow по
  // номеру просто отложится до момента, когда номер добавят в карточке.
  phone: z.string().trim().optional(),
  /// Недельное правило выходных (0=Пн … 6=Вс). Форма добавления
  /// предлагает Сб+Вс, чтобы график не пришлось прокликивать руками.
  weeklyDaysOff: z.array(z.number().int().min(0).max(6)).optional(),
  /// Точки, на которых работает сотрудник; пусто — на всех.
  buildingIds: z.array(z.string().min(1)).max(50).optional(),
});

export async function POST(request: Request) {
  const session = await requireAuth();
  if (!isManagementRole(session.user.role) && !session.user.isRoot) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const orgId = getActiveOrgId(session);

  let parsed;
  try {
    parsed = createSchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Некорректные данные" },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Не удалось прочитать запрос" },
      { status: 400 }
    );
  }

  const result = await createStaffMember(orgId, parsed);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    user: result.user,
    planUpgraded: result.planUpgraded,
  });
}
