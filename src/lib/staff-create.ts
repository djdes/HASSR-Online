import crypto from "node:crypto";
import { db } from "@/lib/db";
import { getDisabledJournalCodes } from "@/lib/disabled-journals";
import { sanitizeBuildingIds } from "@/lib/building-targets";
import { notifyManagement } from "@/lib/notifications";
import { normalizePhone } from "@/lib/phone";
import { tryAutolinkTasksflowByPhone } from "@/lib/tasksflow-autolink";
import { ensurePlanForHeadcount } from "@/lib/plan-limits.server";
import { normalizeWeeklyDaysOff } from "@/lib/staff-days-off";
import { resolveJournalAccessBootstrap } from "@/lib/staff-journal-bootstrap";

/**
 * Создание сотрудника организации — общее ядро для POST /api/staff и
 * действия AI-помощника `add_staff`. Обе точки входа проходят один и тот
 * же путь: должность из своей организации, синтетический email, пустой
 * passwordHash (логин невозможен), ACL из JobPositionJournalAccess,
 * проверка лимита тарифа и уведомления менеджерам.
 *
 * Права проверяет вызывающая сторона (management-роль) — здесь только
 * доменная логика.
 */

export type CreateStaffInput = {
  jobPositionId: string;
  fullName: string;
  phone?: string;
  weeklyDaysOff?: number[];
  /// Точки сотрудника; чужие id отбрасываются.
  buildingIds?: string[];
  /// «Ответственный за ведение основных журналов». Права на выдачу
  /// проверяет вызывающая сторона; по умолчанию — нет.
  keepsCoreJournals?: boolean;
  /// «Разрешение менять настройки». Права на выдачу проверяет вызывающая
  /// сторона; по умолчанию — нет.
  canManageSettings?: boolean;
};

export type CreateStaffResult =
  | {
      ok: true;
      user: { id: string; name: string; jobPositionId: string | null; isActive: boolean };
      positionName: string;
      planUpgraded: boolean;
    }
  | { ok: false; error: string; status: 400 | 404 };

function syntheticEmail(orgId: string) {
  const salt = crypto.randomBytes(6).toString("hex");
  return `staff-${salt}@${orgId}.local.haccp`;
}

function deriveRoleFromCategory(categoryKey: string): string {
  return categoryKey === "management" ? "manager" : "cook";
}

export async function createStaffMember(
  orgId: string,
  input: CreateStaffInput
): Promise<CreateStaffResult> {
  const position = await db.jobPosition.findFirst({
    where: { id: input.jobPositionId, organizationId: orgId },
  });
  if (!position) {
    return { ok: false, error: "Должность не найдена", status: 404 };
  }

  const rawPhone = input.phone?.trim() ?? "";
  const phone = rawPhone ? normalizePhone(rawPhone) : null;
  // Пустой номер разрешаем, а вот заведомо кривой — нет: иначе в базу
  // попадёт мусор, по которому автосвязка никогда не сработает.
  if (rawPhone && !phone) {
    return {
      ok: false,
      error: "Неверный формат телефона. Пример: +7 985 123-45-67",
      status: 400,
    };
  }

  // Подтягиваем journals разрешённые для chosen position. ACL=migrated +
  // populate UserJournalAccess из JobPositionJournalAccess; если в org
  // нет position-based ACL вообще — legacy back-compat (журналы видны всем).
  const positionTemplates = await db.jobPositionJournalAccess.findMany({
    where: { organizationId: orgId, jobPositionId: position.id },
    include: { template: { select: { code: true } } },
  });
  const accessBootstrap = resolveJournalAccessBootstrap(
    positionTemplates.map((t) => t.template.code)
  );
  const buildingIds = await sanitizeBuildingIds(orgId, input.buildingIds ?? []);

  const user = await db.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        email: syntheticEmail(orgId),
        name: input.fullName,
        phone,
        passwordHash: "",
        role: deriveRoleFromCategory(position.categoryKey),
        positionTitle: position.name,
        jobPositionId: position.id,
        organizationId: orgId,
        // Active on staff from the first day — journals filter their
        // employee selectors on isActive. Login stays impossible while
        // passwordHash is empty.
        isActive: true,
        weeklyDaysOff: normalizeWeeklyDaysOff(input.weeklyDaysOff ?? []),
        buildingIds,
        keepsCoreJournals: input.keepsCoreJournals === true,
        canManageSettings: input.canManageSettings === true,
        journalAccessMigrated: accessBootstrap.journalAccessMigrated,
      },
      select: { id: true, name: true, jobPositionId: true, isActive: true },
    });
    if (accessBootstrap.grantedTemplateCodes.length > 0) {
      await tx.userJournalAccess.createMany({
        data: accessBootstrap.grantedTemplateCodes.map((templateCode) => ({
          userId: u.id,
          templateCode,
          canRead: true,
          canWrite: true,
          canFinalize: false,
        })),
        skipDuplicates: true,
      });
    }
    return u;
  });

  // Лимит бесплатного тарифа (3 сотрудника): создание не блокируем,
  // при превышении переводим организацию на платный (тестовый режим).
  const planCheck = await ensurePlanForHeadcount(orgId);

  // Best-effort автосвязка с TasksFlow по номеру.
  if (phone) {
    tryAutolinkTasksflowByPhone({
      organizationId: orgId,
      weSetupUserId: user.id,
      phone,
      name: user.name,
    }).catch((err) => {
      console.error("[staff] tasksflow autolink failed", err);
    });
  }

  // Surface the new hire in the bell panel.
  const displayLabel = position.name
    ? `${user.name}, ${position.name}`
    : user.name;
  const allJournalsToPopulate = [
    {
      code: "hygiene",
      href: "/journals/hygiene",
      dedupeKey: "staff.added.journal:hygiene",
    },
    {
      code: "health_check",
      href: "/journals/health_check",
      dedupeKey: "staff.added.journal:health_check",
    },
    {
      code: "staff_training",
      href: "/journals/staff_training",
      dedupeKey: "staff.added.journal:staff_training",
    },
  ];
  // Не зовём вносить новичка в выключенный журнал: журнал здоровья по
  // умолчанию выключен (health-check-default-off.ts), и напоминание о
  // нём вело бы на журнал, которого организация не ведёт.
  const disabledCodes = await getDisabledJournalCodes(orgId).catch(
    () => new Set<string>()
  );
  const journalsToPopulate = allJournalsToPopulate.filter(
    (j) => !disabledCodes.has(j.code)
  );
  const staticLinkLabels: Record<string, string> = {
    "/journals/hygiene": "гигиенический журнал",
    "/journals/health_check": "журнал здоровья",
    "/journals/staff_training": "журнал регистрации инструктажей",
  };
  // Сторонняя бракеражная комиссия — не штат: в гигиену, здоровье и
  // инструктажи её не вносят, напоминать об этом руководителю не нужно.
  if (position.categoryKey !== "commission") try {
    await Promise.all(
      journalsToPopulate.map((j) =>
        notifyManagement({
          organizationId: orgId,
          kind: "staff.added.journal",
          dedupeKey: j.dedupeKey,
          title: "Список фамилий, которые нужно внести в",
          linkHref: j.href,
          linkLabel: staticLinkLabels[j.href] ?? "журнал",
          items: [{ id: user.id, label: displayLabel }],
        })
      )
    );
    await notifyManagement({
      organizationId: orgId,
      kind: "position.missing.trainingPlan",
      dedupeKey: `position.missing.trainingPlan:${position.id}`,
      title: "Список должностей, которые нужно внести в",
      linkHref: "/journals/training_plan",
      linkLabel: "план обучения",
      items: [{ id: position.id, label: position.name }],
    });
  } catch (err) {
    console.error("[notifications] staff-create fanout failed", err);
  }

  return {
    ok: true,
    user,
    positionName: position.name,
    planUpgraded: planCheck.upgraded,
  };
}
