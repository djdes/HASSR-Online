import { NextResponse } from "next/server";
import { bumpSessionVersion } from "@/lib/session-version";
import { sanitizeBuildingIds } from "@/lib/building-targets";
import { STAFF_OUT_OF_SCOPE_ERROR, mergeScopedBuildingIds, staffInScope } from "@/lib/point-scope";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { getServerSession } from "@/lib/server-session";
import {
  isManagementRole,
  isLegacyUserRoleValue,
  isUserRoleValue,
  normalizeUserRole,
  toCanonicalUserRole,
} from "@/lib/user-roles";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { normalizePhone } from "@/lib/phone";
import { tryAutolinkTasksflowByPhone } from "@/lib/tasksflow-autolink";
import { performOffboarding } from "@/lib/offboarding";
import { normalizeWeeklyDaysOff } from "@/lib/staff-days-off";
import { checkUserActivation, seatLimitResponse } from "@/lib/billing.server";
import { computePointScope } from "@/lib/point-scope.server";
import { assignmentSurvivesEdit, keepPrimaryBuilding } from "@/lib/point-assignments";
import { reconcileAssignmentsAfterEdit } from "@/lib/point-assignments.server";

const updateUserSchema = z.object({
  name: z.string().trim().min(2).optional(),
  role: z
    .string()
    .trim()
    .refine((value) => isUserRoleValue(value) || isLegacyUserRoleValue(value), {
      message: "Выберите корректную должность",
    })
    .optional(),
  phone: z.string().trim().nullable().optional(),
  /// Личная почта сотрудника (не логин): пустая строка или null — стереть.
  contactEmail: z
    .union([z.string().trim().max(200).email("Некорректный формат почты. Пример: ivanova@mail.ru"), z.literal("")])
    .nullable()
    .optional(),
  positionTitle: z.string().trim().max(120).nullable().optional(),
  isActive: z.boolean().optional(),
  /// Недельное правило выходных (0=Пн … 6=Вс) — правится и в карточке
  /// сотрудника, и чипами в графике (PATCH /api/staff/[id]).
  weeklyDaysOff: z.array(z.number().int().min(0).max(6)).optional(),
  /// Точки, на которых работает сотрудник; пусто — на всех.
  buildingIds: z.array(z.string().min(1)).max(50).optional(),
  /// Основная точка у сотрудника на нескольких точках (звезда в чипах);
  /// null — снять. Должна быть среди его точек.
  primaryBuildingId: z.string().min(1).nullable().optional(),
  /// «Уполномочен редактировать в бракеражных журналах список блюд».
  canEditBrakerageDishes: z.boolean().optional(),
  keepsCoreJournals: z.boolean().optional(),
  canManageSettings: z.boolean().optional(),
});

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    // Раньше: isManagerRole — только role=manager, без head_chef и
    // без ROOT-impersonation. Заведующая (head_chef) и ROOT
    // импесонирующий клиента получали 403 при попытке отредактировать
    // сотрудника. Стандартный helper hasFullWorkspaceAccess покрывает
    // всех троих (manager + head_chef + isRoot).
    if (
      !hasFullWorkspaceAccess({
        role: session.user.role,
        isRoot: session.user.isRoot === true,
      })
    ) {
      return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
    }

    const user = await db.user.findFirst({
      where: { id, organizationId: getActiveOrgId(session) },
    });

    if (!user) {
      return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
    }
    // Руководитель точки правит только людей своих точек (фаза 2).
    if (!staffInScope(session.user, user.buildingIds)) {
      return NextResponse.json({ error: STAFF_OUT_OF_SCOPE_ERROR }, { status: 403 });
    }

    const body = updateUserSchema.parse(await request.json());
    const { name, role, phone, contactEmail, positionTitle, isActive, weeklyDaysOff, buildingIds, primaryBuildingId, canEditBrakerageDishes, keepsCoreJournals, canManageSettings } = body;
    // «Разрешение менять настройки» себе не выдают — только другой руководитель.
    if (canManageSettings !== undefined && id === session.user.id) {
      return NextResponse.json({ error: "Разрешение на настройки себе изменить нельзя" }, { status: 400 });
    }
    // Чужие точки человека руководитель точки не трогает, офис не назначает.
    const cleanBuildingIds =
      buildingIds !== undefined
        ? mergeScopedBuildingIds(
            session.user,
            user.buildingIds,
            await sanitizeBuildingIds(getActiveOrgId(session), buildingIds),
          )
        : undefined;

    // Временная точка (замена) лежит в buildingIds: правка целиком её не
    // теряет — оставили точку, назначение живёт; сняли — завершится ниже.
    // Основная точка остаётся, пока она среди точек (или вернётся с перевода).
    const finalBuildingIds = cleanBuildingIds ?? user.buildingIds;
    const activeAssignments =
      cleanBuildingIds !== undefined || primaryBuildingId !== undefined
        ? await db.userPointAssignment.findMany({
            where: { userId: id, endedAt: null },
            select: { buildingId: true, removedBuildingIds: true },
          })
        : [];
    const returningIds = activeAssignments
      .filter((assignment) => assignmentSurvivesEdit(finalBuildingIds, assignment))
      .flatMap((assignment) => assignment.removedBuildingIds);
    let nextPrimaryBuildingId: string | null | undefined;
    if (primaryBuildingId !== undefined) {
      if (primaryBuildingId !== null && !finalBuildingIds.includes(primaryBuildingId)) {
        return NextResponse.json(
          { error: "Основная точка должна быть среди точек сотрудника" },
          { status: 400 }
        );
      }
      nextPrimaryBuildingId = primaryBuildingId;
    } else if (cleanBuildingIds !== undefined) {
      const kept = keepPrimaryBuilding(user.primaryBuildingId, cleanBuildingIds, returningIds);
      if (kept !== user.primaryBuildingId) nextPrimaryBuildingId = kept;
    }

    if (id === session.user.id && role && normalizeUserRole(role) !== "manager") {
      return NextResponse.json(
        { error: "Нельзя изменить свою роль" },
        { status: 400 }
      );
    }

    if (id === session.user.id && isActive === false) {
      return NextResponse.json(
        { error: "Нельзя деактивировать себя" },
        { status: 400 }
      );
    }

    // Normalize phone before saving so every downstream consumer
    // (TasksFlow link, adapter display, Telegram invite) sees a clean
    // `+7XXXXXXXXXX`. Null-clear stays allowed — owner is allowed to
    // scrub a phone from a record.
    let normalizedPhone: string | null | undefined;
    if (phone !== undefined) {
      const trimmed = phone?.trim() ?? "";
      if (trimmed === "") {
        normalizedPhone = null;
      } else {
        const parsed = normalizePhone(trimmed);
        if (!parsed) {
          return NextResponse.json(
            {
              error:
                "Неверный формат телефона. Пример: +7 985 123-45-67",
            },
            { status: 400 }
          );
        }
        normalizedPhone = parsed;
      }
    }

    const wasActive = user.isActive === true;

    // Включение неактивного (заготовки из TasksFlow, онбординга и т. п.)
    // занимает место в тарифе — проверяем до записи.
    if (isActive === true && !wasActive) {
      const seats = await checkUserActivation(id, { source: "users.activate" });
      if (!seats.ok) return seatLimitResponse(seats);
    }

    const updated = await db.user.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(role !== undefined && { role: toCanonicalUserRole(role) }),
        ...(normalizedPhone !== undefined && { phone: normalizedPhone }),
        ...(contactEmail !== undefined && { contactEmail: contactEmail || null }),
        ...(positionTitle !== undefined && {
          positionTitle: positionTitle?.trim() || null,
        }),
        ...(isActive !== undefined && { isActive }),
        ...(weeklyDaysOff !== undefined && {
          weeklyDaysOff: normalizeWeeklyDaysOff(weeklyDaysOff),
        }),
        ...(cleanBuildingIds !== undefined && { buildingIds: cleanBuildingIds }),
        ...(nextPrimaryBuildingId !== undefined && { primaryBuildingId: nextPrimaryBuildingId }),
        ...(canEditBrakerageDishes !== undefined && { canEditBrakerageDishes }),
        ...(keepsCoreJournals !== undefined && { keepsCoreJournals }),
        ...(canManageSettings !== undefined && { canManageSettings }),
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        positionTitle: true,
        isActive: true,
        phone: true,
        contactEmail: true,
      },
    });
    if (cleanBuildingIds !== undefined && activeAssignments.length > 0) {
      await reconcileAssignmentsAfterEdit({
        organizationId: getActiveOrgId(session),
        userId: id,
        nextBuildingIds: cleanBuildingIds,
        session,
      });
    }
    // Права поменялись — старые сессии сотрудника закрываем: новый вход
    // возьмёт актуальную галку (proxy читает её из токена).
    if (canManageSettings !== undefined && canManageSettings !== (user.canManageSettings === true)) {
      await bumpSessionVersion(id).catch(() => null);
    } else if (
      cleanBuildingIds !== undefined &&
      (isManagementRole(toCanonicalUserRole(role ?? user.role)) || user.canManageSettings === true) &&
      JSON.stringify(await computePointScope(user)) !==
        JSON.stringify(await computePointScope({ organizationId: user.organizationId, buildingIds: cleanBuildingIds }))
    ) {
      // Руководитель стал руководителем точки или перестал им быть — те же
      // точки в токене читает proxy (фаза 2 «Офис и точки»).
      await bumpSessionVersion(id).catch(() => null);
    }

    // Auto-offboarding trigger: пользователь только что был
    // деактивирован (был active → стал inactive). Fire-and-forget,
    // чтобы PUT отдал ответ быстро. Сам helper идемпотентен.
    if (wasActive && isActive === false) {
      performOffboarding({
        userId: id,
        organizationId: getActiveOrgId(session),
        actorId: session.user.id,
        actorName: session.user.name ?? null,
      }).catch((err) => {
        console.error("[users/PUT] offboarding failed", err);
      });
    }

    // If the phone just changed (or appeared), try to auto-link the user
    // to the matching TasksFlow worker. Fire-and-forget so a slow TF
    // response doesn't stall the PUT.
    if (normalizedPhone) {
      tryAutolinkTasksflowByPhone({
        organizationId: getActiveOrgId(session),
        weSetupUserId: id,
        phone: normalizedPhone,
        name: updated.name,
      }).catch((err) => {
        console.error("[users/PUT] autolink failed", err);
      });
    }

    // Имя или должность поменялись — прокатим label по Notification.items
    // в рамках организации. Иначе в колокольчике застрял бы устаревший
    // текст «Иван опечатка, Повар» до dismiss.
    if (name !== undefined || positionTitle !== undefined) {
      const newLabel = updated.positionTitle
        ? `${updated.name}, ${updated.positionTitle}`
        : updated.name;
      const notifications = await db.notification.findMany({
        where: { organizationId: getActiveOrgId(session) },
        select: { id: true, items: true },
      });
      for (const n of notifications) {
        const list = Array.isArray(n.items) ? (n.items as unknown[]) : [];
        let changed = false;
        const nextItems = list.map((raw) => {
          if (!raw || typeof raw !== "object") return raw;
          const item = raw as { id?: string; label?: string };
          if (item.id === id && item.label !== newLabel) {
            changed = true;
            return { ...item, label: newLabel };
          }
          return raw;
        });
        if (changed) {
          await db.notification.update({
            where: { id: n.id },
            data: { items: nextItems as Prisma.InputJsonValue },
          });
        }
      }
    }

    return NextResponse.json({ user: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message || "Некорректные данные" },
        { status: 400 }
      );
    }

    console.error("User update error:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    if (
      !hasFullWorkspaceAccess({
        role: session.user.role,
        isRoot: session.user.isRoot === true,
      })
    ) {
      return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
    }

    if (id === session.user.id) {
      return NextResponse.json({ error: "Нельзя удалить себя" }, { status: 400 });
    }

    const user = await db.user.findFirst({
      where: { id, organizationId: getActiveOrgId(session) },
    });

    if (!user) {
      return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
    }
    if (!staffInScope(session.user, user.buildingIds)) {
      return NextResponse.json({ error: STAFF_OUT_OF_SCOPE_ERROR }, { status: 403 });
    }

    await db.user.update({
      where: { id },
      data: { isActive: false },
    });

    // Auto-offboarding запускаем в DELETE так же. Fire-and-forget.
    performOffboarding({
      userId: id,
      organizationId: getActiveOrgId(session),
      actorId: session.user.id,
      actorName: session.user.name ?? null,
    }).catch((err) => {
      console.error("[users/DELETE] offboarding failed", err);
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("User deletion error:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
