import Link from "next/link";
import { forbidden } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  Bell,
  Building2,
  ClipboardList,
  Clock,
  CloudUpload,
  Coins,
  CreditCard,
  FileSpreadsheet,
  Layers,
  ListChecks,
  Network,
  Package,
  Plug,
  ScrollText,
  Send,
  ShieldCheck,
  Shuffle,
  Sparkles,
  Users,
  Wrench,
} from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { db } from "@/lib/db";
import { OnboardingFinishCta } from "@/components/settings/onboarding-finish-cta";
import { OnboardingDocHealthCard } from "@/components/settings/onboarding-doc-health-card";
import { OnboardingPipelineHealthCard } from "@/components/settings/onboarding-pipeline-health-card";
import {
  PhaseCard,
  SetupCard,
  type Phase,
  type SetupItem,
} from "@/components/settings/onboarding-phases";
import { PIPELINE_EXEMPT_JOURNALS } from "@/lib/journal-default-pipelines";
import { PageHeader, PageHeaderStat } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function OnboardingAdvancedPage() {
  const t = await getTranslations("settingsUi.onboardingAdvancedPage");
  const session = await requireAuth();
  if (!hasCapability(session.user, "admin.full")) forbidden();
  const organizationId = getActiveOrgId(session);

  const [
    org,
    positionsCount,
    activeUsersCount,
    usersWithTg,
    usersWithPreset,
    buildingsCount,
    roomsCount,
    equipmentCount,
    managerScopesCount,
    tfIntegration,
    tfLinkedUsersCount,
    pipelineTreeCount,
    inspectorTokensCount,
    bonusJournalsCount,
    activeTemplates,
    journalsWithResponsiblesCount,
    activeDocumentsCount,
  ] = await Promise.all([
    db.organization.findUnique({
      where: { id: organizationId },
      select: {
        type: true,
        name: true,
        inn: true,
        address: true,
        taskFlowMode: true,
        journalPipelinesJson: true,
        disabledJournalCodes: true,
      },
    }),
    db.jobPosition.count({ where: { organizationId } }),
    db.user.count({
      where: { organizationId, isActive: true, archivedAt: null },
    }),
    db.user.count({
      where: {
        organizationId,
        isActive: true,
        archivedAt: null,
        telegramChatId: { not: null },
      },
    }),
    db.user.count({
      where: {
        organizationId,
        isActive: true,
        archivedAt: null,
        permissionPreset: { not: null },
      },
    }),
    db.building.count({ where: { organizationId } }),
    db.room.count({ where: { building: { organizationId } } }),
    db.equipment.count({ where: { area: { organizationId } } }),
    db.managerScope.count({ where: { organizationId } }),
    db.tasksFlowIntegration.findFirst({
      where: { organizationId, enabled: true },
      select: { id: true, label: true },
    }),
    // У TasksFlowUserLink нет Prisma-relation на User (см. schema.prisma
    // l.1499 — composite-unique вместо @relation), поэтому фильтруем
    // через integration.organizationId. Для упрощения берём суммарно по
    // активным интеграциям орги.
    db.tasksFlowUserLink.count({
      where: { integration: { organizationId, enabled: true } },
    }),
    // Pipeline-tree templates (новый формат — JournalPipelineTemplate
    // + JournalPipelineNode). Считаем те у которых хотя бы один узел —
    // пустой template без узлов считаем «не настроенным».
    db.journalPipelineTemplate
      .findMany({
        where: { organizationId },
        select: {
          templateCode: true,
          _count: { select: { nodes: true } },
        },
      })
      .then((rows) => rows.filter((r) => r._count.nodes > 0).length),
    db.inspectorToken.count({
      where: { organizationId, revokedAt: null },
    }),
    db.journalTemplate.count({
      where: { isActive: true, bonusAmountKopecks: { gt: 0 } },
    }),
    // Активные templates с кодами — нужны для двух метрик: общего
    // enabled-count (за вычетом disabled) и пересечения с
    // PIPELINE_EXEMPT_JOURNALS (журналы со своим адаптером, у которых
    // pipeline-tree не нужен, считаются «настроенными by-design»).
    db.journalTemplate.findMany({
      where: { isActive: true },
      select: { code: true },
    }),
    db.journalTemplate
      .findMany({
        where: { isActive: true },
        select: {
          id: true,
          _count: {
            select: {
              positionAccess: { where: { organizationId } },
            },
          },
        },
      })
      .then((rows) => rows.filter((r) => r._count.positionAccess > 0).length),
    db.journalDocument.count({
      where: { organizationId, status: "active" },
    }),
  ]);

  // Health-check для активных документов: сколько без ответственного и
  // без verifier'а — отдельный запрос потому что Promise.all выше уже
  // развёрнут под красивые counters, а вычислять missingX из всего
  // findMany() было бы дороже.
  const [docsMissingResponsible, docsMissingVerifier] = await Promise.all([
    db.journalDocument.count({
      where: { organizationId, status: "active", responsibleUserId: null },
    }),
    db.journalDocument.count({
      where: { organizationId, status: "active", verifierUserId: null },
    }),
  ]);

  const disabledCodes = new Set<string>(
    Array.isArray(org?.disabledJournalCodes)
      ? (org!.disabledJournalCodes as string[])
      : []
  );
  const enabledCodes = activeTemplates
    .map((tpl) => tpl.code)
    .filter((c) => !disabledCodes.has(c));
  const enabledTemplatesCount = enabledCodes.length;
  // Сколько из enabled — exempt'ы (свой адаптер): hygiene, climate,
  // cleaning и пр. — pipeline-tree им не нужен.
  const exemptEnabledCount = enabledCodes.filter((c) =>
    PIPELINE_EXEMPT_JOURNALS.has(c)
  ).length;
  // Pipeline-tree count: смотрим JournalPipelineTemplate (новый
  // формат с pinned/custom-узлами в /settings/journal-pipelines-tree),
  // НЕ legacy `Organization.journalPipelinesJson` (там старые plain
  // step-instructions). Pipeline-tree — это то, что увидит сотрудник
  // в TasksFlow при выполнении задачи.
  const pipelinesCount = pipelineTreeCount;

  // === Items ===

  const orgInfoItem: SetupItem = {
    title: t("orgInfoTitle"),
    description: t("orgInfoDescription"),
    href: "/settings/organization",
    icon: Building2,
    state:
      org?.name && org?.inn && org?.address
        ? "complete"
        : org?.name
          ? "partial"
          : "empty",
    metric: org?.name ?? undefined,
    issue: !org?.inn
      ? t("orgInnMissing")
      : !org?.address
        ? t("orgAddressMissing")
        : undefined,
  };

  const positionsItem: SetupItem = {
    title: t("positionsTitle"),
    description: t("positionsDescription"),
    href: "/settings/users",
    icon: ListChecks,
    state: positionsCount === 0 ? "empty" : "complete",
    metric: `${positionsCount}`,
    issue: positionsCount === 0 ? t("positionsIssue") : undefined,
  };

  const buildingsItem: SetupItem = {
    title: t("buildingsTitle"),
    description: t("buildingsDescription"),
    href: "/settings/buildings",
    icon: Building2,
    state:
      buildingsCount === 0
        ? "empty"
        : roomsCount === 0
          ? "partial"
          : "complete",
    metric: t("buildingsMetric", {
      buildings: buildingsCount,
      rooms: roomsCount,
    }),
    issue:
      buildingsCount === 0
        ? t("buildingsIssueNone")
        : roomsCount === 0
          ? t("buildingsIssueRooms")
          : undefined,
  };

  const equipmentItem: SetupItem = {
    title: t("equipmentTitle"),
    description: t("equipmentDescription"),
    href: "/settings/equipment",
    icon: Wrench,
    state: equipmentCount === 0 ? "empty" : "complete",
    metric: `${equipmentCount}`,
    issue:
      equipmentCount === 0
        ? t("equipmentIssue")
        : undefined,
  };

  const usersItem: SetupItem = {
    title: t("usersTitle"),
    description: t("usersDescription"),
    href: "/settings/users",
    icon: Users,
    state:
      activeUsersCount < 2
        ? "empty"
        : activeUsersCount < 4
          ? "partial"
          : "complete",
    metric: `${activeUsersCount}`,
    issue:
      activeUsersCount < 2
        ? t("usersIssueNone")
        : activeUsersCount < 4
          ? t("usersIssueFew")
          : undefined,
  };

  const presetsItem: SetupItem = {
    title: t("presetsTitle"),
    description: t("presetsDescription"),
    href: "/settings/role-presets",
    icon: ShieldCheck,
    state:
      activeUsersCount === 0
        ? "empty"
        : usersWithPreset === activeUsersCount
          ? "complete"
          : usersWithPreset > 0
            ? "partial"
            : "empty",
    metric: `${usersWithPreset}/${activeUsersCount}`,
    issue:
      activeUsersCount > 0 && usersWithPreset < activeUsersCount
        ? t("presetsIssue", { count: activeUsersCount - usersWithPreset })
        : undefined,
    optional: true,
  };

  const hierarchyItem: SetupItem = {
    title: t("hierarchyTitle"),
    description: t("hierarchyDescription"),
    href: "/settings/staff-hierarchy",
    icon: Network,
    state: managerScopesCount === 0 ? "empty" : "complete",
    metric: `${managerScopesCount}`,
    issue:
      managerScopesCount === 0
        ? t("hierarchyIssue")
        : undefined,
    optional: true,
  };

  const telegramItem: SetupItem = {
    title: t("telegramTitle"),
    description: t("telegramDescription"),
    href: "/settings/users",
    icon: Bell,
    state:
      activeUsersCount === 0
        ? "empty"
        : usersWithTg === activeUsersCount
          ? "complete"
          : usersWithTg > 0
            ? "partial"
            : "empty",
    metric: usersWithTg > 0 ? `${usersWithTg}/${activeUsersCount}` : undefined,
    optional: true,
  };

  const journalsSetItem: SetupItem = {
    title: t("journalsSetTitle"),
    description: t("journalsSetDescription"),
    href: "/settings/journals",
    icon: ClipboardList,
    state:
      enabledTemplatesCount === 0
        ? "empty"
        : enabledTemplatesCount < 5
          ? "partial"
          : "complete",
    metric: `${enabledTemplatesCount}`,
    issue:
      enabledTemplatesCount === 0
        ? t("journalsSetIssue")
        : undefined,
  };

  const responsiblesItem: SetupItem = {
    title: t("responsiblesTitle"),
    description: t("responsiblesDescription"),
    href: "/settings/journal-responsibles",
    icon: Network,
    state:
      enabledTemplatesCount === 0
        ? "empty"
        : journalsWithResponsiblesCount >= enabledTemplatesCount
          ? "complete"
          : journalsWithResponsiblesCount > 0
            ? "partial"
            : "empty",
    metric: `${journalsWithResponsiblesCount}/${enabledTemplatesCount}`,
    issue:
      enabledTemplatesCount > 0 &&
      journalsWithResponsiblesCount < enabledTemplatesCount
        ? t("responsiblesIssue", {
            count: enabledTemplatesCount - journalsWithResponsiblesCount,
          })
        : undefined,
  };

  const pipelinesItem: SetupItem = {
    title: t("pipelinesTitle"),
    description: t("pipelinesDescription"),
    href: "/settings/journal-pipelines",
    icon: ListChecks,
    state:
      pipelinesCount === 0
        ? "empty"
        : pipelinesCount < 3
          ? "partial"
          : "complete",
    metric: t("pipelinesMetric", { count: pipelinesCount }),
    issue:
      pipelinesCount === 0 ? t("pipelinesIssue") : undefined,
    optional: true,
  };

  const tfModeItem: SetupItem = {
    title: t("tfModeTitle"),
    description: t("tfModeDescription"),
    href: "/settings/journal-flow",
    icon: Shuffle,
    state: org?.taskFlowMode ? "complete" : "empty",
    metric:
      org?.taskFlowMode === "race"
        ? t("tfModeRace")
        : org?.taskFlowMode === "shared"
          ? t("tfModeShared")
          : org?.taskFlowMode === "manual"
            ? t("tfModeManual")
            : t("tfModeNone"),
  };

  const tfIntegrationItem: SetupItem = {
    title: t("tfIntegrationTitle"),
    description: t("tfIntegrationDescription"),
    href: "/settings/integrations/tasksflow",
    icon: Plug,
    state: tfIntegration ? "complete" : "empty",
    metric: tfIntegration?.label ?? undefined,
    issue: tfIntegration ? undefined : t("tfIntegrationIssue"),
  };

  const tfLinkItem: SetupItem = {
    title: t("tfLinkTitle"),
    description: t("tfLinkDescription"),
    href: "/settings/integrations/tasksflow",
    icon: Send,
    state: !tfIntegration
      ? "empty"
      : activeUsersCount === 0
        ? "empty"
        : tfLinkedUsersCount >= activeUsersCount
          ? "complete"
          : tfLinkedUsersCount > 0
            ? "partial"
            : "empty",
    metric:
      activeUsersCount > 0
        ? `${tfLinkedUsersCount}/${activeUsersCount}`
        : undefined,
    issue:
      tfIntegration &&
      activeUsersCount > 0 &&
      tfLinkedUsersCount < activeUsersCount
        ? t("tfLinkIssue", { count: activeUsersCount - tfLinkedUsersCount })
        : undefined,
  };

  // === Optional / зрелость ===

  const extras: SetupItem[] = [
    {
      title: t("extraNotificationsTitle"),
      description: t("extraNotificationsDescription"),
      href: "/settings/notifications",
      icon: Bell,
      state: "complete",
      metric: t("extraNotificationsMetric"),
    },
    {
      title: t("extraComplianceTitle"),
      description: t("extraComplianceDescription"),
      href: "/settings/compliance",
      icon: ShieldCheck,
      state: "complete",
    },
    {
      title: t("extraBonusesTitle"),
      description: t("extraBonusesDescription"),
      href: "/settings/journal-bonuses",
      icon: Coins,
      state: bonusJournalsCount === 0 ? "empty" : "complete",
      metric: t("extraBonusesMetric", { count: bonusJournalsCount }),
    },
    {
      title: t("extraScheduleTitle"),
      description: t("extraScheduleDescription"),
      href: "/settings/schedule",
      icon: Layers,
      state: "empty",
    },
    {
      title: t("extraBackupTitle"),
      description: t("extraBackupDescription"),
      href: "/settings/backup",
      icon: CloudUpload,
      state: "empty",
    },
    {
      title: t("extraAccountingTitle"),
      description: t("extraAccountingDescription"),
      href: "/settings/accounting",
      icon: FileSpreadsheet,
      state: "empty",
    },
    {
      title: t("extraInspectorTitle"),
      description: t("extraInspectorDescription"),
      href: "/settings/inspector-portal",
      icon: ShieldCheck,
      state: inspectorTokensCount === 0 ? "empty" : "complete",
      metric: t("extraInspectorMetric", { count: inspectorTokensCount }),
    },
    {
      title: t("extraProductsTitle"),
      description: t("extraProductsDescription"),
      href: "/settings/products",
      icon: Package,
      state: "empty",
    },
    {
      title: t("extraSubscriptionTitle"),
      description: t("extraSubscriptionDescription"),
      href: "/settings/subscription",
      icon: CreditCard,
      state: "complete",
    },
    {
      title: t("extraAuditTitle"),
      description: t("extraAuditDescription"),
      href: "/settings/audit",
      icon: ScrollText,
      state: "complete",
    },
  ];

  // === Phase 5 (документы) — pre-flight для CTA ===
  const finishMissing: string[] = [];
  if (!org?.name || !org?.inn || !org?.address)
    finishMissing.push(t("finishOrg"));
  if (positionsCount === 0) finishMissing.push(t("finishPositions"));
  if (activeUsersCount < 2) finishMissing.push(t("finishUsers"));
  if (buildingsCount === 0)
    finishMissing.push(t("finishBuildings"));
  if (equipmentCount === 0)
    finishMissing.push(t("finishEquipment"));
  if (enabledTemplatesCount === 0)
    finishMissing.push(t("finishJournals"));
  if (
    enabledTemplatesCount > 0 &&
    journalsWithResponsiblesCount < enabledTemplatesCount
  )
    finishMissing.push(
      t("finishResponsibles", {
        count: enabledTemplatesCount - journalsWithResponsiblesCount,
      })
    );
  const finishReady = finishMissing.length === 0;

  // === Phases ===

  const phases: Phase[] = [
    {
      id: "company",
      number: 1,
      title: t("phaseCompanyTitle"),
      subtitle: t("phaseCompanySubtitle"),
      icon: Building2,
      items: [orgInfoItem],
    },
    {
      id: "structure",
      number: 2,
      title: t("phaseStructureTitle"),
      subtitle: t("phaseStructureSubtitle"),
      icon: Layers,
      items: [positionsItem, buildingsItem, equipmentItem],
    },
    {
      id: "team",
      number: 3,
      title: t("phaseTeamTitle"),
      subtitle: t("phaseTeamSubtitle"),
      icon: Users,
      items: [usersItem, telegramItem, presetsItem, hierarchyItem],
    },
    {
      id: "journals",
      number: 4,
      title: t("phaseJournalsTitle"),
      subtitle: t("phaseJournalsSubtitle"),
      icon: ClipboardList,
      items: [journalsSetItem, responsiblesItem, pipelinesItem],
      finalNode: (
        <OnboardingPipelineHealthCard
          totalEnabled={enabledTemplatesCount}
          exemptCount={exemptEnabledCount}
          configured={pipelineTreeCount}
        />
      ),
    },
    {
      id: "documents",
      number: 5,
      title: t("phaseDocumentsTitle"),
      subtitle: t("phaseDocumentsSubtitle"),
      icon: FileSpreadsheet,
      items: [],
      finalNode: (
        <div className="space-y-4">
          <OnboardingFinishCta
            prereqsReady={finishReady}
            missing={finishMissing}
            activeDocumentsCount={activeDocumentsCount}
          />
          <OnboardingDocHealthCard
            totalActive={activeDocumentsCount}
            missingVerifier={docsMissingVerifier}
            missingResponsible={docsMissingResponsible}
          />
        </div>
      ),
    },
    {
      id: "tasksflow",
      number: 6,
      title: t("phaseTasksflowTitle"),
      subtitle: t("phaseTasksflowSubtitle"),
      icon: Plug,
      items: [tfModeItem, tfIntegrationItem, tfLinkItem],
      finalNode: (
        <SendTasksCta
          ready={Boolean(
            tfIntegration &&
              activeDocumentsCount > 0 &&
              tfLinkedUsersCount > 0
          )}
          activeDocumentsCount={activeDocumentsCount}
          tfLinkedUsersCount={tfLinkedUsersCount}
          tfConnected={Boolean(tfIntegration)}
        />
      ),
    },
  ];

  // === Phase status calc ===

  function phaseStatus(p: Phase): "complete" | "active" | "locked" {
    // Этап считается «complete» если все обязательные items complete.
    // Optional items не блокируют переход.
    // Дополнительные condition'ы для phases с finalNode'ами:
    //   • journals: pipeline-tree должен быть заведён для всех
    //     non-exempt enabled журналов — иначе health-card будет
    //     висеть и не виден пользователю (phase свёрнута).
    //   • documents: см. ниже.
    //   • tasksflow: см. ниже.
    if (p.id === "journals") {
      const requiredItems = p.items.filter((i) => !i.optional);
      const itemsAllDone = requiredItems.every((i) => i.state === "complete");
      const pipelineTarget = Math.max(0, enabledTemplatesCount - exemptEnabledCount);
      const pipelineAllDone = pipelineTreeCount >= pipelineTarget;
      return itemsAllDone && pipelineAllDone ? "complete" : "active";
    }
    const required = p.items.filter((i) => !i.optional);
    if (required.length === 0 && !p.finalNode) return "complete";
    if (required.length === 0) {
      // Этап только с finalNode — оцениваем по prereqsReady (для phase 5)
      // или вручную в SendTasksCta (для phase 6).
      if (p.id === "documents") {
        // Этап 5 «complete» только если документы созданы И каждый имеет
        // ответственного + проверяющего. Иначе — этап остаётся active,
        // карточка OnboardingDocHealthCard покажет жёлтый warning и
        // кнопку «Применить ответственных».
        return finishReady &&
          activeDocumentsCount > 0 &&
          docsMissingResponsible === 0 &&
          docsMissingVerifier === 0
          ? "complete"
          : "active";
      }
      if (p.id === "tasksflow") {
        // Дополнительно — реальная отправка не отслеживается; считаем
        // complete если TF подключён и есть привязанные юзеры.
        return tfIntegration && tfLinkedUsersCount > 0 ? "complete" : "active";
      }
      return "active";
    }
    const allDone = required.every((i) => i.state === "complete");
    return allDone ? "complete" : "active";
  }

  const statuses = phases.map(phaseStatus);
  const firstActiveIdx = statuses.findIndex((s) => s !== "complete");
  const allDone = firstActiveIdx === -1;
  const completedPhases = statuses.filter((s) => s === "complete").length;
  const overallProgress = Math.round((completedPhases / phases.length) * 100);

  return (
    <div className="space-y-5">
      {/* Тёмный hero снят: главное на странице — сами этапы, а не баннер.
          Крупный счётчик «Готовность %» свёрнут в одну пилюлю справа,
          полоска прогресса осталась — она единственная показывает, какой
          именно этап сейчас активен, и оставлена на светлом фоне. */}
      <PageHeader
        title={
          allDone
            ? t("headingAllDone")
            : t("headingInProgress")
        }
        description={
          allDone
            ? t("descriptionAllDone")
            : t("descriptionInProgress")
        }
        actions={
          <PageHeaderStat tone={allDone ? "ok" : "neutral"}>
            {t("readiness", {
              percent: overallProgress,
              done: completedPhases,
              total: phases.length,
            })}
          </PageHeaderStat>
        }
      />

      <div className="flex items-center gap-1">
        {phases.map((p, idx) => {
          const s = statuses[idx];
          return (
            <div
              key={p.id}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                s === "complete"
                  ? "bg-emerald-400"
                  : idx === firstActiveIdx
                    ? "bg-[#5566f6]"
                    : "bg-[#ececf4]"
              }`}
              title={t("stageTitle", { number: p.number, title: p.title })}
            />
          );
        })}
      </div>

      <ol className="space-y-4">
        {phases.map((phase, idx) => {
          const status = statuses[idx];
          const isActive = idx === firstActiveIdx;
          const isLocked = !allDone && idx > firstActiveIdx;
          const isLast = idx === phases.length - 1;
          return (
            <PhaseCard
              key={phase.id}
              phase={phase}
              status={status}
              isActive={isActive}
              isLocked={isLocked}
              isLast={isLast}
            />
          );
        })}
      </ol>

      {/* Зрелость — optional features. Не блокируют ничего, показываются
          сразу для тех, кто хочет полный обзор возможностей. */}
      <section className="space-y-3 pt-2">
        <div className="flex items-center gap-2 px-1">
          <span className="size-2 rounded-full bg-[#9b9fb3]" />
          <h2 className="text-[16px] font-semibold text-[#0b1024]">
            {t("maturity")}
          </h2>
          <span className="text-[12px] text-[#9b9fb3]">·</span>
          <span className="text-[12px] text-[#9b9fb3]">
            {t("maturityHint")}
          </span>
        </div>
        <div className="grid gap-2 lg:grid-cols-2">
          {extras.map((item) => (
            <SetupCard key={item.title} item={item} />
          ))}
        </div>
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────

/**
 * Финальный CTA для этапа TasksFlow — отправляет пользователя на
 * дашборд, где живёт «Превью отправки задач TasksFlow». Реальная
 * отправка идёт оттуда (а не отсюда), потому что dashboard-карточка
 * показывает per-журнал статус «получит / не получит» с причиной.
 */
async function SendTasksCta({
  ready,
  activeDocumentsCount,
  tfLinkedUsersCount,
  tfConnected,
}: {
  ready: boolean;
  activeDocumentsCount: number;
  tfLinkedUsersCount: number;
  tfConnected: boolean;
}) {
  const t = await getTranslations("settingsUi.onboardingAdvancedPage");
  if (!ready) {
    const blockers: string[] = [];
    if (!tfConnected) blockers.push(t("sendBlockerTf"));
    if (activeDocumentsCount === 0)
      blockers.push(t("sendBlockerDocs"));
    if (tfLinkedUsersCount === 0)
      blockers.push(t("sendBlockerLinks"));

    return (
      <section className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] p-5">
        <div className="flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#fff8eb] text-[#a13a32]">
            <Clock className="size-5" />
          </span>
          <div className="flex-1">
            <h3 className="text-[15px] font-semibold text-[#0b1024]">
              {t("sendUnavailable")}
            </h3>
            <p className="mt-1 text-[13px] text-[#6f7282]">
              {t("sendCloseFirst")}
            </p>
            <ul className="mt-2 space-y-1">
              {blockers.map((b) => (
                <li
                  key={b}
                  className="flex items-start gap-2 text-[12px] text-[#a13a32]"
                >
                  <span className="mt-1 inline-flex size-1.5 shrink-0 rounded-full bg-[#a13a32]" />
                  {b}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="relative overflow-hidden rounded-3xl border border-[#5566f6]/30 bg-gradient-to-br from-[#5566f6] to-[#7a5cff] p-5 text-white shadow-[0_20px_50px_-20px_rgba(85,102,246,0.55)]">
      <div className="pointer-events-none absolute -right-16 -top-16 size-[280px] rounded-full bg-white/10 blur-[80px]" />
      <div className="pointer-events-none absolute -left-12 -bottom-12 size-[220px] rounded-full bg-[#0b1024]/30 blur-[60px]" />
      <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25">
            <Send className="size-6" />
          </span>
          <div>
            <div className="text-[11px] uppercase tracking-[0.16em] text-white/70">
              {t("sendFinalEyebrow")}
            </div>
            <h3 className="mt-1 text-[18px] font-semibold leading-tight">
              {t("sendReadyTitle")}
            </h3>
            <p className="mt-1 max-w-[480px] text-[13px] text-white/80">
              {t("sendReadyBody")}
            </p>
          </div>
        </div>
        <Link
          href="/dashboard"
          className="inline-flex h-12 shrink-0 items-center gap-2 rounded-2xl bg-white px-5 text-[14px] font-semibold text-[#5566f6] shadow-[0_10px_24px_-12px_rgba(0,0,0,0.45)] transition-opacity hover:opacity-90"
        >
          <Sparkles className="size-4" />
          {t("openDashboard")}
        </Link>
      </div>
    </section>
  );
}
