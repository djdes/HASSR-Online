import { NextResponse } from "next/server";
import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { recordAuditLog } from "@/lib/audit-log";
import { tasksflowClientFor } from "@/lib/tasksflow-client";
import { isBillingCycle, MAX_POINTS } from "@/lib/tariff-plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/root/organizations/[id]
 *
 * ROOT-only удаление организации со всеми зависимостями (cascade на
 * Prisma-уровне покрывает users, journals, telegram-логи и т.д.).
 *
 * Безопасность:
 *   - 401 если не авторизован, 403 если не root.
 *   - 404 если организация не найдена.
 *   - Защита от удаления platform-org (id из PLATFORM_ORG_ID).
 *   - Запись в AuditLog (organizationId платформы).
 */
/**
 * PATCH /api/root/organizations/[id]
 *
 * ROOT правит карточку организации: название, тариф и срок подписки.
 * Раньше всё это менялось только руками в базе — на поддержку клиента
 * («продлите нам месяц») уходил заход на сервер.
 *
 * Тарифы 2026-10 живут на аккаунте (сеть платит один раз): тариф, срок,
 * период оплаты, точки и конец пробного пишутся в аккаунт и зеркалом в
 * организацию. «Приостановлен» и «Отменён» — состояние самой организации,
 * тариф аккаунта они не трогают.
 *
 * Меняем только переданные поля: пустой PATCH — не сброс, а no-op.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await requireRoot();
  const { id } = await context.params;

  const org = await db.organization.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      subscriptionPlan: true,
      subscriptionEnd: true,
      accountId: true,
      account: {
        select: { subscriptionPlan: true, subscriptionEnd: true, planCycle: true, planPoints: true, trialEndsAt: true },
      },
    },
  });
  if (!org) {
    return NextResponse.json({ error: "Организация не найдена", errorCode: "ORG_NOT_FOUND" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    subscriptionPlan?: unknown;
    subscriptionEnd?: unknown;
    planCycle?: unknown;
    planPoints?: unknown;
    trialEndsAt?: unknown;
  } | null;

  const data: {
    name?: string;
    subscriptionPlan?: string;
    subscriptionEnd?: Date | null;
  } = {};

  if (typeof body?.name === "string") {
    const name = body.name.trim();
    if (name.length < 2) {
      return NextResponse.json({ error: "Слишком короткое название", errorCode: "ORG_NAME_SHORT" }, { status: 400 });
    }
    data.name = name;
  }

  if (typeof body?.subscriptionPlan === "string") {
    const plan = body.subscriptionPlan.trim();
    // Список закрыт намеренно: опечатка в тарифе тихо ломает и витрину,
    // и лимиты — значение сравнивается строкой в десятке мест.
    // `trial` намеренно отсутствует: это legacy-значение бесплатного
    // тарифа, читается как `free`, но новым его не назначаем. `paid` —
    // «Подписка» прежнего тарифа (без новых лимитов).
    if (!["free", "standard", "premium", "paid", "paused", "cancelled"].includes(plan)) {
      return NextResponse.json({ error: "Неизвестный тариф", errorCode: "ORG_PLAN_UNKNOWN" }, { status: 400 });
    }
    data.subscriptionPlan = plan;
  }

  if (body?.subscriptionEnd !== undefined) {
    if (body.subscriptionEnd === null || body.subscriptionEnd === "") {
      data.subscriptionEnd = null;
    } else if (typeof body.subscriptionEnd === "string") {
      const parsed = new Date(body.subscriptionEnd);
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json({ error: "Некорректная дата", errorCode: "ORG_DATE_INVALID" }, { status: 400 });
      }
      data.subscriptionEnd = parsed;
    }
  }

  // Поля тарифа аккаунта: период оплаты, точки и продлённый пробный.
  const accountData: {
    subscriptionPlan?: string;
    subscriptionEnd?: Date | null;
    planCycle?: string;
    planPoints?: number;
    trialEndsAt?: Date | null;
  } = {};
  if (body?.planCycle !== undefined) {
    if (!isBillingCycle(body.planCycle)) {
      return NextResponse.json({ error: "Неизвестный период оплаты", errorCode: "ORG_PLAN_UNKNOWN" }, { status: 400 });
    }
    accountData.planCycle = body.planCycle;
  }
  if (body?.planPoints !== undefined) {
    const points = Number(body.planPoints);
    if (!Number.isInteger(points) || points < 1 || points > MAX_POINTS) {
      return NextResponse.json({ error: "Некорректное число точек", errorCode: "ORG_POINTS_INVALID" }, { status: 400 });
    }
    accountData.planPoints = points;
  }
  if (body?.trialEndsAt !== undefined) {
    if (body.trialEndsAt === null || body.trialEndsAt === "") {
      accountData.trialEndsAt = null;
    } else if (typeof body.trialEndsAt === "string" && Number.isFinite(new Date(body.trialEndsAt).getTime())) {
      accountData.trialEndsAt = new Date(body.trialEndsAt);
    } else {
      return NextResponse.json({ error: "Некорректная дата", errorCode: "ORG_DATE_INVALID" }, { status: 400 });
    }
  }
  // Тариф и срок — на аккаунт; пауза и отмена — только организации.
  if (data.subscriptionPlan && data.subscriptionPlan !== "paused" && data.subscriptionPlan !== "cancelled") {
    accountData.subscriptionPlan = data.subscriptionPlan;
  }
  if (data.subscriptionEnd !== undefined) accountData.subscriptionEnd = data.subscriptionEnd;
  const accountTouched = Boolean(org.accountId) && Object.keys(accountData).length > 0;
  if (!org.accountId && (accountData.planCycle || accountData.planPoints || accountData.trialEndsAt !== undefined)) {
    return NextResponse.json({ error: "У организации нет аккаунта", errorCode: "ORG_NO_ACCOUNT" }, { status: 409 });
  }

  if (Object.keys(data).length === 0 && !accountTouched) {
    return NextResponse.json({ ok: true, organization: org });
  }

  const updated = await db.organization.update({
    where: { id },
    data,
    select: {
      id: true,
      name: true,
      subscriptionPlan: true,
      subscriptionEnd: true,
    },
  });
  const updatedAccount =
    accountTouched && org.accountId
      ? await db.account.update({
          where: { id: org.accountId },
          data: accountData,
          select: { subscriptionPlan: true, subscriptionEnd: true, planCycle: true, planPoints: true, trialEndsAt: true },
        })
      : null;

  await recordAuditLog({
    request,
    session,
    organizationId: id,
    action: "organization.update",
    entity: "Organization",
    entityId: id,
    // Пишем «было → стало»: без этого по логу не понять, что именно
    // правили и к чему возвращаться, если клиент оспорит срок.
    details: {
      before: {
        name: org.name,
        subscriptionPlan: org.subscriptionPlan,
        subscriptionEnd: org.subscriptionEnd?.toISOString() ?? null,
        ...(updatedAccount && org.account
          ? {
              account: {
                subscriptionPlan: org.account.subscriptionPlan,
                subscriptionEnd: org.account.subscriptionEnd?.toISOString() ?? null,
                planCycle: org.account.planCycle,
                planPoints: org.account.planPoints,
                trialEndsAt: org.account.trialEndsAt?.toISOString() ?? null,
              },
            }
          : {}),
      },
      after: {
        name: updated.name,
        subscriptionPlan: updated.subscriptionPlan,
        subscriptionEnd: updated.subscriptionEnd?.toISOString() ?? null,
        ...(updatedAccount
          ? {
              account: {
                subscriptionPlan: updatedAccount.subscriptionPlan,
                subscriptionEnd: updatedAccount.subscriptionEnd?.toISOString() ?? null,
                planCycle: updatedAccount.planCycle,
                planPoints: updatedAccount.planPoints,
                trialEndsAt: updatedAccount.trialEndsAt?.toISOString() ?? null,
              },
            }
          : {}),
      },
    },
  });

  return NextResponse.json({ ok: true, organization: updated });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await requireRoot();
  const { id } = await context.params;

  const platformOrgId = (process.env.PLATFORM_ORG_ID ?? "").trim();
  if (platformOrgId && id === platformOrgId) {
    return NextResponse.json(
      { error: "Нельзя удалить platform-organization", errorCode: "ORG_PLATFORM_PROTECTED" },
      { status: 400 }
    );
  }

  const org = await db.organization.findUnique({
    where: { id },
    select: { id: true, name: true, type: true },
  });
  if (!org) {
    return NextResponse.json({ error: "Организация не найдена", errorCode: "ORG_NOT_FOUND" }, { status: 404 });
  }

  // Best-effort cleanup TasksFlow-задач до DELETE org. Cascade prisma
  // удалит TasksFlowTaskLink/TasksFlowIntegration в БД, но в TF
  // remote-таски останутся «зомби» (с baseUrl на удалённую WeSetup org)
  // и будут показываться у TF-юзеров с битым task-fill flow. Чтобы
  // этого избежать — проходим по интеграциям org'а и DELETE-каждого
  // task'а через TF API.
  let tfTasksDeleted = 0;
  let tfTasksFailed = 0;
  try {
    const integrations = await db.tasksFlowIntegration.findMany({
      where: { organizationId: id, enabled: true },
    });
    for (const integration of integrations) {
      const taskLinks = await db.tasksFlowTaskLink.findMany({
        where: { integrationId: integration.id },
        select: { tasksflowTaskId: true },
      });
      if (taskLinks.length === 0) continue;
      const client = tasksflowClientFor(integration);
      for (const link of taskLinks) {
        try {
          await client.deleteTask(link.tasksflowTaskId);
          tfTasksDeleted += 1;
        } catch (err) {
          tfTasksFailed += 1;
          console.warn(
            `[org-delete] TF task ${link.tasksflowTaskId} delete failed`,
            err instanceof Error ? err.message : err
          );
        }
      }
    }
  } catch (err) {
    console.error("[org-delete] TF cleanup failed", err);
  }

  await db.organization.delete({ where: { id } });

  // AuditLog требует organizationId — пишем в platform-org, чтобы запись
  // была видна root-у на /root/audit. Если platform-org нет — пропускаем.
  if (platformOrgId) {
    await recordAuditLog({
      request,
      session: {
        user: {
          id: session.user.id,
          name: session.user.name ?? null,
          email: session.user.email ?? null,
        },
      },
      organizationId: platformOrgId,
      action: "root.organization.delete",
      entity: "Organization",
      entityId: id,
      details: {
        name: org.name,
        type: org.type,
        tfTasksDeleted,
        tfTasksFailed,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    tfTasksDeleted,
    tfTasksFailed,
  });
}
