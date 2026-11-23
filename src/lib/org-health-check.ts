import { db } from "@/lib/db";

/**
 * Self-audit для организации: проверяет N конфигурационных аспектов
 * и возвращает list проблем + score (0-100). Результат показывается
 * на /dashboard виджетом «Здоровье настройки: N/M».
 *
 * Каждая проверка возвращает:
 *   - id (уникальный код)
 *   - title (что проверяли)
 *   - status: "ok" | "warn" | "fail"
 *   - hint (что сделать чтобы исправить)
 *   - href (куда вести юзера)
 */

export type HealthCheck = {
  id: string;
  title: string;
  status: "ok" | "warn" | "fail";
  hint: string;
  href?: string;
};

export type OrgHealthSummary = {
  checks: HealthCheck[];
  okCount: number;
  warnCount: number;
  failCount: number;
  totalCount: number;
  scorePercent: number;
};

export async function runOrgHealthCheck(
  organizationId: string
): Promise<OrgHealthSummary> {
  const [
    positionsCount,
    activeUsersCount,
    usersWithoutPhoneCount,
    activeDocsCount,
    autoJournalsCount,
    tfIntegration,
    inspectorTokenCount,
    botInviteCount,
  ] = await Promise.all([
    db.jobPosition.count({ where: { organizationId } }),
    db.user.count({
      where: { organizationId, isActive: true, archivedAt: null },
    }),
    db.user.count({
      where: {
        organizationId,
        isActive: true,
        archivedAt: null,
        phone: null,
      },
    }),
    db.journalDocument.count({
      where: {
        organizationId,
        status: "active",
        dateFrom: { lte: new Date() },
        dateTo: { gte: new Date() },
      },
    }),
    db.organization.findUnique({
      where: { id: organizationId },
      select: { autoJournalCodes: true, type: true, name: true },
    }),
    db.tasksFlowIntegration.findFirst({
      where: { organizationId, enabled: true },
      select: { id: true },
    }),
    db.inspectorToken.count({
      where: {
        organizationId,
        revokedAt: null,
        expiresAt: { gte: new Date() },
      },
    }),
    db.user.count({
      where: { organizationId, telegramChatId: { not: null } },
    }),
  ]);

  const checks: HealthCheck[] = [];

  // 1. Должности настроены
  if (positionsCount > 0) {
    checks.push({
      id: "positions",
      title: `Должности настроены (${positionsCount})`,
      status: "ok",
      hint: "Готово",
    });
  } else {
    checks.push({
      id: "positions",
      title: "Должности не созданы",
      status: "fail",
      hint: "Запустите быструю настройку — она создаст типовые должности",
      href: "/settings/onboarding",
    });
  }

  // 2. Активные сотрудники
  if (activeUsersCount > 1) {
    checks.push({
      id: "users",
      title: `Активных сотрудников: ${activeUsersCount}`,
      status: "ok",
      hint: "Готово",
    });
  } else {
    checks.push({
      id: "users",
      title: "Сотрудники не добавлены",
      status: "fail",
      hint: "Импортируйте штат из Excel или добавьте вручную",
      href: "/settings/users",
    });
  }

  // 3. У всех есть телефоны (для Telegram)
  if (activeUsersCount > 0 && usersWithoutPhoneCount === 0) {
    checks.push({
      id: "phones",
      title: "У всех сотрудников указан телефон",
      status: "ok",
      hint: "Готово",
    });
  } else if (usersWithoutPhoneCount > 0) {
    checks.push({
      id: "phones",
      title: `Без телефона: ${usersWithoutPhoneCount} сотрудников`,
      status: "warn",
      hint: "Без телефона нет уведомлений в Telegram. Добавьте номера",
      href: "/settings/users",
    });
  }

  // 4. Активные документы за сегодня
  if (activeDocsCount > 0) {
    checks.push({
      id: "active-docs",
      title: `Активных журнальных документов: ${activeDocsCount}`,
      status: "ok",
      hint: "Готово",
    });
  } else {
    checks.push({
      id: "active-docs",
      title: "Нет активных документов журналов",
      status: "fail",
      hint: "Создайте документ хотя бы по одному журналу",
      href: "/journals",
    });
  }

  // 5. Авто-создание журналов настроено
  const autoCodes = Array.isArray(autoJournalsCount?.autoJournalCodes)
    ? (autoJournalsCount.autoJournalCodes as unknown[]).filter(
        (c): c is string => typeof c === "string"
      )
    : [];
  if (autoCodes.length > 0) {
    checks.push({
      id: "auto-journals",
      title: `Автосоздание включено для ${autoCodes.length} журналов`,
      status: "ok",
      hint: "Готово",
    });
  } else {
    checks.push({
      id: "auto-journals",
      title: "Автосоздание журналов не настроено",
      status: "warn",
      hint: "Иначе придётся вручную создавать документ каждый месяц",
      href: "/settings/auto-journals",
    });
  }

  // 6. TasksFlow интеграция
  if (tfIntegration) {
    checks.push({
      id: "tf-integration",
      title: "Программный модуль подключён",
      status: "ok",
      hint: "Готово",
    });
  } else {
    checks.push({
      id: "tf-integration",
      title: "Программный модуль не подключён",
      status: "warn",
      hint: "Без программного модуля сотрудники не получают задачи на телефон. Подключите его",
      href: "/settings/integrations/tasksflow",
    });
  }

  // 7. Inspector portal токен (опционально, не blocker)
  if (inspectorTokenCount > 0) {
    checks.push({
      id: "inspector-portal",
      title: `Активных ссылок инспектора: ${inspectorTokenCount}`,
      status: "ok",
      hint: "Готово к проверке",
    });
  } else {
    checks.push({
      id: "inspector-portal",
      title: "Нет ссылок для инспектора",
      status: "warn",
      hint: "Создайте ссылку перед проверкой СЭС или скачайте сертификат",
      href: "/settings/inspector-portal",
    });
  }

  // 8. Связки с Telegram (botInviteToken)
  if (botInviteCount > 0) {
    checks.push({
      id: "telegram-links",
      title: `Сотрудники в Telegram: ${botInviteCount}`,
      status: "ok",
      hint: "Готово",
    });
  } else {
    checks.push({
      id: "telegram-links",
      title: "Никто не подключил Telegram-бот",
      status: "warn",
      hint: "Без бота сотрудники не получают уведомления о задачах",
      href: "/settings/users",
    });
  }

  const okCount = checks.filter((c) => c.status === "ok").length;
  const warnCount = checks.filter((c) => c.status === "warn").length;
  const failCount = checks.filter((c) => c.status === "fail").length;
  const totalCount = checks.length;
  // Score: ok=1, warn=0.5, fail=0
  const scoreRaw =
    (okCount * 1 + warnCount * 0.5 + failCount * 0) / totalCount;
  const scorePercent = Math.round(scoreRaw * 100);

  return {
    checks,
    okCount,
    warnCount,
    failCount,
    totalCount,
    scorePercent,
  };
}
