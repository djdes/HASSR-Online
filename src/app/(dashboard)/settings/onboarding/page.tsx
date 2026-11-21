import { forbidden } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import {
  ArrowRight,
  Building2,
  ClipboardList,
  FileSignature,
  ListChecks,
  Sparkles,
  Users,
  Wrench,
} from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { db } from "@/lib/db";
import { sortJournalsByName } from "@/lib/journal-sort";
import { getCoreSetupStatus } from "@/lib/onboarding-core-status";
import { checklistJournalsForOrg } from "@/lib/onboarding-documents";
import { rulesFor } from "@/lib/sphere-journal-rules";
import { findOrderTemplate } from "@/lib/orders/catalog";
import { listOrders } from "@/lib/orders/store";
import { parseDisabledCodes } from "@/lib/disabled-journals";
import { defaultChecklistFor } from "@/lib/checklist-defaults";
import { OnboardingFinishCta } from "@/components/settings/onboarding-finish-cta";
import {
  OnboardingDocumentsPhase,
  type OnboardingChecklistRow,
  type OnboardingOrderRow,
} from "@/components/settings/onboarding-documents-phase";
import {
  PhaseCard,
  type Phase,
  type SetupItem,
} from "@/components/settings/onboarding-phases";

export const dynamic = "force-dynamic";

/**
 * Быстрый старт — 4 этапа: объект → команда → журналы → документы
 * (приказы и чек-листы, фаза добавлена 2026-09-24). Всё остальное (Telegram, пресеты прав, иерархия,
 * pipeline-инструкции, TasksFlow, «зрелость») живёт на
 * `/settings/onboarding/advanced` — там оно не мешает новичку, который
 * первый раз открыл настройки и должен за 3 шага довести компанию до
 * состояния «сотрудники получают задачи».
 *
 * Карточки намеренно без описаний и без красных подсказок: заголовок,
 * иконка статуса и счётчик-пилюля читаются за секунду, а подробности
 * человек увидит на самой странице настройки.
 */
export default async function OnboardingPage() {
  const t = await getTranslations("settingsUi.onboardingPage");
  const session = await requireAuth();
  if (!hasCapability(session.user, "admin.full")) forbidden();
  const organizationId = getActiveOrgId(session);

  // Условия трёх этапов живут в `getCoreSetupStatus` — их же читает
  // карточка «Начальная настройка» на дашборде. Пока расчёт был здесь,
  // дашборд считал по-своему, и страница показывала три «ГОТОВО», а
  // дашборд — «71%, завершите настройку».
  const status = await getCoreSetupStatus(organizationId);
  const activeDocumentsCount = status.activeDocumentsCount;

  // === Документы: приказы и чек-листы сферы ===
  const sphereRules = rulesFor(status.sphere);
  const [orders, org, templates] = await Promise.all([
    listOrders(organizationId),
    db.organization.findUnique({
      where: { id: organizationId },
      select: { disabledJournalCodes: true, checklistsReviewedAt: true },
    }),
    db.journalTemplate.findMany({
      where: { isActive: true, code: { in: sphereRules.checklistJournals } },
      select: { code: true, name: true },
    }),
  ]);
  // listOrders — свежие сверху, поэтому первый встреченный — последний
  // оформленный приказ этого вида.
  const latestOrderByCode = new Map<string, (typeof orders)[number]>();
  for (const order of orders) {
    if (!latestOrderByCode.has(order.templateCode)) {
      latestOrderByCode.set(order.templateCode, order);
    }
  }
  const toOrderRow = (code: string): OnboardingOrderRow | null => {
    const template = findOrderTemplate(code);
    if (!template) return null;
    const issued = latestOrderByCode.get(code);
    return {
      code,
      title: template.title,
      issued: issued
        ? {
            id: issued.id,
            number: issued.number,
            issuedAt: issued.issuedAt.toISOString(),
          }
        : null,
    };
  };
  const requiredOrders = status.documents.ordersRequired
    .map(toOrderRow)
    .filter((row): row is OnboardingOrderRow => row !== null);
  const recommendedOrders = sphereRules.ordersRecommended
    .map(toOrderRow)
    .filter((row): row is OnboardingOrderRow => row !== null);

  const disabled = parseDisabledCodes(org?.disabledJournalCodes);
  const templateNameByCode = new Map(templates.map((tpl) => [tpl.code, tpl.name]));
  const enabledCodes = new Set(
    templates.map((tpl) => tpl.code).filter((code) => !disabled.has(code)),
  );
  const checklistCodes = checklistJournalsForOrg(status.sphere, enabledCodes);
  const checklistCounts = checklistCodes.length
    ? await db.journalChecklistItem.groupBy({
        by: ["journalCode"],
        where: {
          organizationId,
          journalCode: { in: checklistCodes },
          archivedAt: null,
          roomId: null,
        },
        _count: { _all: true },
      })
    : [];
  const countByCode = new Map(
    checklistCounts.map((row) => [row.journalCode, row._count._all]),
  );
  // Чек-листы журналов — по алфавиту названий.
  const checklistRows: OnboardingChecklistRow[] = checklistCodes.map((code) => {
    const defaults = defaultChecklistFor(code, status.sphere);
    return {
      code,
      name: templateNameByCode.get(code) ?? code,
      itemsCount: countByCode.get(code) ?? 0,
      defaultsCount: defaults.length,
      defaultsExample: defaults[0]?.title ?? null,
    };
  });
  const checklists = sortJournalsByName(checklistRows, (row) => row.name);

  // === Items ===

  const buildingsItem: SetupItem = {
    title: t("buildingsTitle"),
    href: "/settings/buildings",
    icon: Building2,
    state: status.buildings.state,
    metric: t("buildingsMetric", {
      buildings: status.buildings.buildingsCount,
      rooms: status.buildings.roomsCount,
    }),
  };

  const equipmentItem: SetupItem = {
    title: t("equipmentTitle"),
    href: "/settings/equipment",
    icon: Wrench,
    state: status.equipment.state,
    metric: `${status.equipment.count}`,
  };

  // Должности заводятся на странице сотрудников — отдельного роута
  // /settings/job-positions в проекте нет.
  const positionsItem: SetupItem = {
    title: t("positionsTitle"),
    href: "/settings/users",
    icon: ListChecks,
    state: status.positions.state,
    metric: `${status.positions.count}`,
  };

  const usersItem: SetupItem = {
    title: t("usersTitle"),
    href: "/settings/users",
    icon: Users,
    state: status.users.state,
    metric: `${status.users.count}`,
  };

  const journalsSetItem: SetupItem = {
    title: t("journalsPickTitle"),
    href: "/settings/journals",
    icon: ClipboardList,
    state: status.journals.state,
    metric: t("journalsMetric", { count: status.journals.enabledCount }),
  };

  // === Phases ===

  const phases: Phase[] = [
    {
      id: "site",
      number: 1,
      title: t("phaseSite"),
      icon: Building2,
      items: [buildingsItem, equipmentItem],
    },
    {
      id: "team",
      number: 2,
      title: t("phaseTeam"),
      icon: Users,
      items: [positionsItem, usersItem],
    },
    {
      id: "journals",
      number: 3,
      title: t("phaseJournals"),
      icon: ClipboardList,
      items: [journalsSetItem],
    },
    {
      id: "documents",
      number: 4,
      title: t("phaseDocuments"),
      subtitle: t("phaseDocumentsSubtitle"),
      icon: FileSignature,
      items: [],
      // Счётчик этапа: обязательные приказы + отметка о чек-листах.
      progress: {
        done:
          status.documents.ordersIssuedCount +
          (status.documents.checklistsDone ? 1 : 0),
        total: status.documents.ordersRequired.length + 1,
      },
      finalNode: (
        <OnboardingDocumentsPhase
          requiredOrders={requiredOrders}
          recommendedOrders={recommendedOrders}
          checklists={checklists}
          checklistsReviewedAt={
            org?.checklistsReviewedAt?.toISOString() ?? null
          }
        />
      ),
    },
  ];

  const statuses = phases.map((p) =>
    (p.id === "documents"
      ? status.documents.done
      : p.items.every((i) => i.state === "complete"))
      ? ("complete" as const)
      : ("active" as const)
  );
  const firstActiveIdx = statuses.findIndex((s) => s !== "complete");
  const allDone = firstActiveIdx === -1;

  // Создать документы журналов можно, как только закрыты первые три
  // этапа: приказы и чек-листы на сами журналы не влияют, и держать
  // из-за них сотрудников без задач незачем. Список «сначала закройте…»
  // не передаём — шаги и так видны над кнопкой.
  const finishReady = status.coreComplete;

  return (
    <div className="space-y-5">
      <header className="px-1">
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024]">
          {t("title")}
        </h1>
        <p className="mt-1.5 text-[15px] text-[#6f7282]">
          {t("subtitle")}
        </p>
      </header>

      {/* «Настройка за 3 минуты» (21.11.2026): вместо четырёх этапов по
          одному — вид деятельности и пять вопросов. Пока основное не
          настроено — первым на странице. */}
      {!status.coreComplete ? (
        <Link
          href="/settings/onboarding-template"
          data-testid="onboarding-quick-setup"
          className="group flex flex-wrap items-center gap-4 rounded-3xl border border-[#5566f6]/25 bg-white p-5 shadow-[0_10px_30px_-15px_rgba(85,102,246,0.25)] transition-all hover:-translate-y-0.5 hover:border-[#5566f6]/50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/20"
        >
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
            <Sparkles className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[17px] font-semibold tracking-[-0.01em] text-[#0b1024]">{t("quickSetupTitle")}</span>
            <span className="mt-0.5 block text-[14px] leading-snug text-[#6f7282]">{t("quickSetupText")}</span>
          </span>
          <span className="inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white">
            {t("quickSetupAction")}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        </Link>
      ) : null}

      <ol className="space-y-4">
        {phases.map((phase, idx) => (
          <PhaseCard
            key={phase.id}
            phase={phase}
            status={statuses[idx]}
            isActive={idx === firstActiveIdx}
            isLocked={!allDone && idx > firstActiveIdx}
            isLast={idx === phases.length - 1}
          />
        ))}
      </ol>

      <OnboardingFinishCta
        prereqsReady={finishReady}
        missing={[]}
        activeDocumentsCount={activeDocumentsCount}
      />
    </div>
  );
}
