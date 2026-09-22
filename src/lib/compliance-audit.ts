/**
 * Compliance audit — проверка готовности организации к проверке
 * Роспотребнадзора. Считает интегральный score (0..100) на основе
 * нескольких слоёв проверок и выдаёт чек-лист «что починить».
 *
 * Используется на странице /dashboard/compliance-audit и виджете
 * на дашборде.
 */

import { db } from "@/lib/db";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { getJournalSpec } from "@/lib/journal-specs";
import { getEffectiveTaskMode } from "@/lib/journal-task-modes";
import {
  getVerifierSlotId,
  getSchemaForJournal,
} from "@/lib/journal-responsible-schemas";

export type ComplianceCheck = {
  id: string;
  category: "structure" | "team" | "responsibles" | "records" | "capa" | "tasksflow";
  title: string;
  status: "ok" | "warn" | "fail";
  detail?: string;
  fixUrl?: string;
  /// Веса в общем score'е. Сумма всех весов = 100.
  weight: number;
  /// 0..1 — чему равно «выполнение» этого check'а.
  score: number;
};

export type ComplianceReport = {
  totalScore: number;
  grade: "excellent" | "good" | "needs-work" | "critical";
  checks: ComplianceCheck[];
  summary: {
    ok: number;
    warn: number;
    fail: number;
    journalsTotal: number;
    journalsConfigured: number;
    journalsWithRecords30d: number;
  };
};

/**
 * Считает audit для текущей организации.
 */
export async function runComplianceAudit(
  organizationId: string,
): Promise<ComplianceReport> {
  const checks: ComplianceCheck[] = [];

  // 1. Структура — buildings + areas (5 баллов)
  const areasCount = await db.area.count({ where: { organizationId } });
  checks.push({
    id: "structure.areas",
    category: "structure",
    title: "Помещения / зоны заведены",
    status: areasCount === 0 ? "fail" : areasCount < 3 ? "warn" : "ok",
    detail:
      areasCount === 0
        ? "Не создано ни одного помещения. Создайте как минимум кухню, склад, мойку."
        : areasCount < 3
          ? `Создано ${areasCount}. Рекомендуется минимум 3 (горячий цех, склад, мойка).`
          : `Создано ${areasCount} помещений.`,
    fixUrl: "/settings/buildings",
    weight: 5,
    score: areasCount === 0 ? 0 : areasCount < 3 ? 0.5 : 1,
  });

  // 2. Оборудование — холодильники с tempMin/Max (5 баллов)
  const equipmentCount = await db.equipment.count({
    where: { area: { organizationId } },
  });
  const fridgesCount = await db.equipment.count({
    where: {
      area: { organizationId },
      type: "fridge",
      tempMin: { not: null },
      tempMax: { not: null },
    },
  });
  checks.push({
    id: "structure.equipment",
    category: "structure",
    title: "Оборудование с настроенными нормами",
    status:
      fridgesCount === 0 && equipmentCount > 0
        ? "warn"
        : equipmentCount === 0
          ? "fail"
          : "ok",
    detail:
      equipmentCount === 0
        ? "Нет ни одной единицы оборудования. Заведите холодильники для журналов температурного контроля."
        : fridgesCount === 0
          ? "Есть оборудование, но нет холодильников с заданными нормами температуры. Журналы температуры будут без автоматической проверки."
          : `${equipmentCount} единиц, из них ${fridgesCount} холодильников с нормами.`,
    fixUrl: "/settings/equipment",
    weight: 5,
    score: equipmentCount === 0 ? 0 : fridgesCount === 0 ? 0.5 : 1,
  });

  // 3. Команда — должности и сотрудники (10 баллов)
  const positionsCount = await db.jobPosition.count({
    where: { organizationId },
  });
  const usersCount = await db.user.count({
    where: { organizationId, isActive: true, archivedAt: null },
  });
  checks.push({
    id: "team.positions",
    category: "team",
    title: "Должности заведены",
    status: positionsCount < 3 ? "warn" : "ok",
    detail: `${positionsCount} должностей, ${usersCount} активных сотрудников.`,
    fixUrl: "/settings/users",
    weight: 5,
    score: positionsCount === 0 ? 0 : positionsCount < 3 ? 0.5 : 1,
  });

  // 4. Manager-scope / иерархия (5 баллов)
  const scopesCount = await db.managerScope.count({
    where: { organizationId },
  });
  checks.push({
    id: "team.hierarchy",
    category: "team",
    title: "Иерархия (кто кого видит) настроена",
    status: scopesCount === 0 ? "warn" : "ok",
    detail:
      scopesCount === 0
        ? "Не настроено, кого видит каждый руководитель. Заведующий производством не видит подчинённых в TasksFlow."
        : `Настроено правил видимости: ${scopesCount}.`,
    fixUrl: "/settings/staff-hierarchy",
    weight: 5,
    score: scopesCount === 0 ? 0.3 : 1,
  });

  // 5. Task-visibility (3 балла)
  const adminPositionsCount = await db.jobPosition.count({
    where: { organizationId, seesAllTasks: true },
  });
  checks.push({
    id: "team.task_visibility",
    category: "team",
    title: "Видимость чужих задач настроена",
    status: adminPositionsCount === 0 ? "warn" : "ok",
    detail:
      adminPositionsCount === 0
        ? "Ни одна должность не отмечена как «видит чужие задачи». Сейчас чужие задачи видит первый руководитель по списку — лучше указать это явно."
        : `${adminPositionsCount} должность(и) видят чужие задачи.`,
    fixUrl: "/settings/task-visibility",
    weight: 3,
    score: adminPositionsCount === 0 ? 0.6 : 1,
  });

  // 6. Журналы — обязательные включены (10 баллов)
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: {
      disabledJournalCodes: true,
      journalResponsibleUsersJson: true,
      journalTaskModesJson: true,
    },
  });
  const disabledCodes = new Set(
    Array.isArray(org?.disabledJournalCodes)
      ? (org!.disabledJournalCodes as string[])
      : [],
  );
  const enabledJournalCount =
    ACTIVE_JOURNAL_CATALOG.length - disabledCodes.size;
  checks.push({
    id: "journals.enabled",
    category: "responsibles",
    title: "Обязательные журналы включены",
    status:
      enabledJournalCount < 10
        ? "fail"
        : enabledJournalCount < 25
          ? "warn"
          : "ok",
    detail: `Включено ${enabledJournalCount} из ${ACTIVE_JOURNAL_CATALOG.length} обязательных.`,
    fixUrl: "/settings/journals",
    weight: 10,
    score:
      enabledJournalCount < 10
        ? 0
        : enabledJournalCount < 25
          ? 0.6
          : 1,
  });

  // 7. Responsibles — у каждого включённого журнала есть ответственный (15 баллов)
  const slotsByJournal = (org?.journalResponsibleUsersJson ?? {}) as Record<
    string,
    Record<string, string | null>
  >;
  let journalsWithResponsibles = 0;
  let journalsWithVerifier = 0;
  const journalsToCheck = ACTIVE_JOURNAL_CATALOG.filter(
    (j) => !disabledCodes.has(j.code),
  );
  for (const j of journalsToCheck) {
    const slots = slotsByJournal[j.code] ?? {};
    const schema = getSchemaForJournal(j.code);
    const fillerSlots = schema.slots.filter((s) => s.kind !== "verifier");
    const hasFiller = fillerSlots.some((s) => slots[s.id]);
    const verifierId = getVerifierSlotId(j.code);
    const hasVerifier = Boolean(slots[verifierId]);
    if (hasFiller) journalsWithResponsibles += 1;
    if (hasVerifier) journalsWithVerifier += 1;
  }
  const responsiblesPct =
    journalsToCheck.length === 0
      ? 0
      : journalsWithResponsibles / journalsToCheck.length;
  checks.push({
    id: "responsibles.fillers",
    category: "responsibles",
    title: "У каждого журнала есть ответственный",
    status:
      responsiblesPct < 0.6
        ? "fail"
        : responsiblesPct < 0.9
          ? "warn"
          : "ok",
    detail: `У ${journalsWithResponsibles} из ${journalsToCheck.length} журналов назначен ответственный за заполнение.`,
    fixUrl: "/settings/journal-responsibles",
    weight: 10,
    score: responsiblesPct,
  });
  const verifiersPct =
    journalsToCheck.length === 0
      ? 0
      : journalsWithVerifier / journalsToCheck.length;
  checks.push({
    id: "responsibles.verifiers",
    category: "responsibles",
    title: "У каждого журнала есть проверяющий",
    status:
      verifiersPct < 0.5 ? "fail" : verifiersPct < 0.8 ? "warn" : "ok",
    detail: `У ${journalsWithVerifier} из ${journalsToCheck.length} журналов назначен проверяющий.`,
    fixUrl: "/settings/journal-responsibles",
    weight: 5,
    score: verifiersPct,
  });

  // 8. Записи за последние 30 дней (15 баллов)
  const since30 = new Date(Date.now() - 30 * 86_400_000);
  const recordsByCode = await db.journalEntry.groupBy({
    by: ["templateId"],
    where: { organizationId, createdAt: { gte: since30 } },
    _count: true,
  });
  const templates = await db.journalTemplate.findMany({
    where: { code: { in: journalsToCheck.map((j) => j.code) } },
    select: { id: true, code: true },
  });
  const templateIdToCode = new Map(templates.map((t) => [t.id, t.code]));
  const codesWithRecords = new Set(
    recordsByCode
      .filter((r) => r._count > 0)
      .map((r) => templateIdToCode.get(r.templateId))
      .filter((c): c is string => Boolean(c)),
  );
  const recordsPct =
    journalsToCheck.length === 0
      ? 0
      : codesWithRecords.size / journalsToCheck.length;
  checks.push({
    id: "records.30d",
    category: "records",
    title: "Записи за последние 30 дней",
    status: recordsPct < 0.3 ? "fail" : recordsPct < 0.7 ? "warn" : "ok",
    detail: `${codesWithRecords.size} из ${journalsToCheck.length} журналов имеют хотя бы одну запись за 30 дней. РПН ожидает что журналы реально ведутся.`,
    fixUrl: "/journals",
    weight: 15,
    score: recordsPct,
  });

  // 9. Time-window — все журналы с timeWindowHours имеют свежие записи (10)
  let twTotal = 0;
  let twOk = 0;
  for (const j of journalsToCheck) {
    const spec = getJournalSpec(j.code);
    if (spec.timeWindowHours === null) continue;
    twTotal += 1;
    const tpl = templates.find((t) => t.code === j.code);
    if (!tpl) continue;
    const last = await db.journalEntry.findFirst({
      where: { organizationId, templateId: tpl.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (!last) continue;
    const hoursAgo = (Date.now() - last.createdAt.getTime()) / 3_600_000;
    if (hoursAgo <= spec.timeWindowHours * 1.5) twOk += 1;
  }
  const twPct = twTotal === 0 ? 1 : twOk / twTotal;
  checks.push({
    id: "records.time_window",
    category: "records",
    title: "Журналы с периодичностью заполняются вовремя",
    status: twPct < 0.5 ? "fail" : twPct < 0.8 ? "warn" : "ok",
    detail: `${twOk} из ${twTotal} периодических журналов в норме (термоконтроль/гигиена/уборка).`,
    fixUrl: "/journals",
    weight: 10,
    score: twPct,
  });

  // 10. CAPA — нет старых открытых аномалий > 7 дней (5 баллов)
  const since7 = new Date(Date.now() - 7 * 86_400_000);
  const staleCapaCount = await db.capaTicket.count({
    where: { organizationId, status: "open", createdAt: { lte: since7 } },
  });
  checks.push({
    id: "capa.stale",
    category: "capa",
    title: "Аномалии (CAPA) закрываются за неделю",
    status:
      staleCapaCount > 5 ? "fail" : staleCapaCount > 0 ? "warn" : "ok",
    detail:
      staleCapaCount === 0
        ? "Нет старых открытых аномалий."
        : `${staleCapaCount} аномалий открыты больше 7 дней.`,
    fixUrl: "/capa",
    weight: 5,
    score: staleCapaCount > 5 ? 0.3 : staleCapaCount > 0 ? 0.7 : 1,
  });

  // 11. TasksFlow integration (10 баллов)
  const integration = await db.tasksFlowIntegration.findFirst({
    where: { organizationId, enabled: true },
  });
  let tfLinkedUsersPct = 0;
  if (integration) {
    const linkedUsers = await db.tasksFlowUserLink.count({
      where: { integrationId: integration.id, tasksflowUserId: { not: null } },
    });
    tfLinkedUsersPct = usersCount === 0 ? 0 : linkedUsers / usersCount;
  }
  checks.push({
    id: "tasksflow.integration",
    category: "tasksflow",
    title: "TasksFlow подключён, сотрудники привязаны",
    status: !integration
      ? "fail"
      : tfLinkedUsersPct < 0.5
        ? "warn"
        : "ok",
    detail: !integration
      ? "Интеграция с TasksFlow не подключена. Задачи не дойдут до сотрудников."
      : tfLinkedUsersPct < 1
        ? `Привязано ${Math.round(tfLinkedUsersPct * 100)}% сотрудников. У остальных нет телефона или аккаунта в TasksFlow.`
        : "Все сотрудники привязаны к TasksFlow.",
    fixUrl: "/settings/integrations/tasksflow",
    weight: 10,
    score: !integration ? 0 : tfLinkedUsersPct,
  });

  // 12. Job position task modes — все обязательные journals имеют settings
  const taskModesObj = (org?.journalTaskModesJson ?? {}) as Record<
    string,
    unknown
  >;
  const journalsWithMode = journalsToCheck.filter((j) => {
    const mode = getEffectiveTaskMode(j.code, taskModesObj);
    return mode.distribution !== "one-summary" || j.code in taskModesObj;
  }).length;
  // Это soft-check — task modes имеют sensible defaults и работают без явной настройки.
  checks.push({
    id: "tasksflow.task_modes",
    category: "tasksflow",
    title: "Режимы задач журналов настроены (или стоят по умолчанию)",
    status: "ok",
    detail: `Режим задач действует для всех ${journalsToCheck.length} журналов (настроено вручную: ${journalsWithMode}, по умолчанию: ${journalsToCheck.length - journalsWithMode}).`,
    fixUrl: "/settings/journal-task-mode",
    weight: 2,
    score: 1,
  });

  // Итог
  const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
  const weightedScore = checks.reduce(
    (s, c) => s + c.score * c.weight,
    0,
  );
  const totalScore = totalWeight > 0
    ? Math.round((weightedScore / totalWeight) * 100)
    : 0;
  const grade =
    totalScore >= 90
      ? "excellent"
      : totalScore >= 70
        ? "good"
        : totalScore >= 50
          ? "needs-work"
          : "critical";
  return {
    totalScore,
    grade,
    checks,
    summary: {
      ok: checks.filter((c) => c.status === "ok").length,
      warn: checks.filter((c) => c.status === "warn").length,
      fail: checks.filter((c) => c.status === "fail").length,
      journalsTotal: journalsToCheck.length,
      journalsConfigured: journalsWithResponsibles,
      journalsWithRecords30d: codesWithRecords.size,
    },
  };
}
