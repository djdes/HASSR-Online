import { redirect } from "next/navigation";
import {
  Building2,
  ClipboardList,
  FileSignature,
  ListChecks,
  Users,
  Wrench,
} from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { db } from "@/lib/db";
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
  const session = await requireAuth();
  if (!hasCapability(session.user, "admin.full")) redirect("/settings");
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
  const templateNameByCode = new Map(templates.map((t) => [t.code, t.name]));
  const enabledCodes = new Set(
    templates.map((t) => t.code).filter((code) => !disabled.has(code)),
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
  const checklists: OnboardingChecklistRow[] = checklistCodes.map((code) => {
    const defaults = defaultChecklistFor(code);
    return {
      code,
      name: templateNameByCode.get(code) ?? code,
      itemsCount: countByCode.get(code) ?? 0,
      defaultsCount: defaults.length,
      defaultsExample: defaults[0]?.title ?? null,
    };
  });

  // === Items ===

  const buildingsItem: SetupItem = {
    title: "Помещения",
    href: "/settings/buildings",
    icon: Building2,
    state: status.buildings.state,
    metric: `${status.buildings.buildingsCount} зд., ${status.buildings.roomsCount} помещ.`,
  };

  const equipmentItem: SetupItem = {
    title: "Оборудование",
    href: "/settings/equipment",
    icon: Wrench,
    state: status.equipment.state,
    metric: `${status.equipment.count}`,
  };

  // Должности заводятся на странице сотрудников — отдельного роута
  // /settings/job-positions в проекте нет.
  const positionsItem: SetupItem = {
    title: "Должности",
    href: "/settings/users",
    icon: ListChecks,
    state: status.positions.state,
    metric: `${status.positions.count}`,
  };

  const usersItem: SetupItem = {
    title: "Сотрудники",
    href: "/settings/users",
    icon: Users,
    state: status.users.state,
    metric: `${status.users.count}`,
  };

  const journalsSetItem: SetupItem = {
    title: "Выбор журналов",
    href: "/settings/journals",
    icon: ClipboardList,
    state: status.journals.state,
    metric: `${status.journals.enabledCount} по сфере`,
  };

  // === Phases ===

  const phases: Phase[] = [
    {
      id: "site",
      number: 1,
      title: "Объект",
      icon: Building2,
      items: [buildingsItem, equipmentItem],
    },
    {
      id: "team",
      number: 2,
      title: "Команда",
      icon: Users,
      items: [positionsItem, usersItem],
    },
    {
      id: "journals",
      number: 3,
      title: "Журналы",
      icon: ClipboardList,
      items: [journalsSetItem],
    },
    {
      id: "documents",
      number: 4,
      title: "Документы",
      subtitle: "Приказы и чек-листы — чтобы к проверке было заполнено всё, а не только журналы.",
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
          Быстрый старт
        </h1>
        <p className="mt-1.5 text-[15px] text-[#6f7282]">
          4 шага — сотрудники получают задачи, а к проверке готовы и
          журналы, и приказы.
        </p>
      </header>

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
