import { WorkspaceResourceCards } from "@/components/dashboard/workspace-resource-cards";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { LiveRefresh } from "@/components/live/live-refresh";
import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import { JournalsBrowser } from "@/components/journals/journals-browser";
import { PageGuide } from "@/components/ui/page-guide";
import { PointModeUnavailable } from "@/components/journals/point-mode-unavailable";
import { PageHeader, PageHeaderStat } from "@/components/ui/page-header";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { aclActorFromSession, getAllowedJournalCodes } from "@/lib/journal-acl";
import { getTemplatesFilledToday } from "@/lib/today-compliance";
import { getActiveBuildingId, loadBuildingContext } from "@/lib/active-building";
import { buildingWhere, journalsPointMode } from "@/lib/building-scope";
import { getDisabledJournalCodes, parseDisabledCodes } from "@/lib/disabled-journals";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { getJournalPreviewMap } from "@/lib/journal-preview/service";
import { hasCapability } from "@/lib/permission-presets";
import { resolveSectionName } from "@/lib/org-custom-names";
import { DENIED_PARAM, keepDeniedParam } from "@/lib/denied-notice";

export const dynamic = "force-dynamic";

export default async function JournalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAuth();
  const ui = await getTranslations("journals.ui.index");
  // Заведующая (head_chef) и не-admin'ы не должны видеть «журналы как
  // журналы». Перенаправляем туда где они работают — с меткой `?denied=`,
  // если сюда увёл proxy: объяснение покажет страница, где человек окажется.
  if (!hasCapability(session.user, "journals.view")) {
    const denied = (await searchParams)[DENIED_PARAM];
    if (hasCapability(session.user, "tasks.verify")) {
      redirect(keepDeniedParam("/control-board", denied));
    }
    redirect(keepDeniedParam("/mini/today", denied));
  }
  // Руководство с выбранной в шапке торговой точкой: «Все журналы» — страница
  // всей организации, в режиме точки её нет (владелец, 2026-10-28).
  const pointContext = await loadBuildingContext(session);
  if (journalsPointMode(pointContext)) {
    return (
      <PointModeUnavailable
        pointName={pointContext.activeBuilding?.name ?? ""}
        canViewOrganization={pointContext.canViewOrganization}
      />
    );
  }
  const isManager = hasFullWorkspaceAccess(session.user);

  const allowedCodes = await getAllowedJournalCodes(
    aclActorFromSession(session)
  );

  const [templates, organization] = await Promise.all([
    db.journalTemplate.findMany({
      where: {
        isActive: true,
        ...(allowedCodes ? { code: { in: allowedCodes } } : {}),
      },
      orderBy: { sortOrder: "asc" },
    }),
    db.organization.findUnique({
      where: { id: getActiveOrgId(session) },
      select: { name: true, disabledJournalCodes: true },
    }),
  ]);

  // У точки со своим набором журналов (слитая организация) — её набор.
  const activeBuildingId = await getActiveBuildingId(session);
  const disabledCodes = activeBuildingId
    ? await getDisabledJournalCodes(getActiveOrgId(session), activeBuildingId)
    : parseDisabledCodes(organization?.disabledJournalCodes);

  // Employees (cooks, waiters) don't need to see disabled journals —
  // they can't navigate to settings to re-enable them, so showing the
  // «Отключённые» section would be a dead end. Managers still see the
  // full picture so they can toggle things back.
  const visibleTemplates = isManager
    ? templates
    : templates.filter((t) => !disabledCodes.has(t.code));

  // Точки: бейджи «заполнено»/«есть документ» — для активной точки.
  const filledTodayIds = await getTemplatesFilledToday(
    getActiveOrgId(session),
    new Date(),
    visibleTemplates.map((t) => ({ id: t.id, code: t.code })),
    disabledCodes,
    { buildingId: activeBuildingId }
  );

  // Которые журналы УЖЕ имеют активный документ на сегодня — их
  // bulk-create-кнопка не трогает. Используем для UI-бейджа «есть
  // документ» и для default-фильтра selection.
  const activeTemplateIds = new Set<string>(
    (
      await db.journalDocument.findMany({
        where: {
          organizationId: getActiveOrgId(session),
          status: "active",
          dateFrom: { lte: new Date() },
          dateTo: { gte: new Date() },
          ...buildingWhere(activeBuildingId),
        },
        select: { templateId: true },
        distinct: ["templateId"],
      })
    ).map((d) => d.templateId)
  );

  // Снимки реальных документов — те же, что на дашборде.
  const previewUrls = await getJournalPreviewMap(getActiveOrgId(session), activeBuildingId);

  const items = visibleTemplates.map((template) => ({
    id: template.id,
    code: template.code,
    name: template.name,
    description: template.description,
    isMandatorySanpin: template.isMandatorySanpin,
    isMandatoryHaccp: template.isMandatoryHaccp,
    filledToday: filledTodayIds.has(template.id),
    disabled: disabledCodes.has(template.code),
    hasActiveDocumentToday: activeTemplateIds.has(template.id),
    previewUrl: previewUrls.get(template.code) ?? null,
  }));

  // Готовность считаем здесь же, из уже собранных items: в шапке нужна
  // одна тихая пилюля «Заполнено сегодня N/M», а не четыре StatPill'а —
  // «всего 35 / отключено 31» живут в /settings/journals.
  const enabledItems = items.filter((item) => !item.disabled);
  const filledTodayCount = enabledItems.filter((item) => item.filledToday).length;

  return (
    <div className="space-y-5">
      <LiveRefresh />
      {/* Крошки даёт глобальный PageNav из (dashboard)/layout.tsx —
          локальные тут дублировали бы ту же строку. */}
      <PageHeader
        // Своё название раздела организации, если его задали.
        title={await resolveSectionName(getActiveOrgId(session), "journals")}
        description={ui("description")}
        actions={
          <>
            {isManager ? (
              <Link
                href="/settings/journals"
                className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
              >
                <SlidersHorizontal className="size-4 text-[#5566f6]" />
                {ui("configureSet")}
              </Link>
            ) : null}
            {enabledItems.length > 0 ? (
              <PageHeaderStat
                tone={
                  filledTodayCount === enabledItems.length ? "ok" : "neutral"
                }
              >
                {/* Раньше было «Заполнено сегодня 26/35» — и в эти 26
                    попадали журналы, которые сегодня вести не нужно.
                    Число то же, подпись честная. */}
                {ui("noAttentionToday", {
                  filled: filledTodayCount,
                  total: enabledItems.length,
                })}
              </PageHeaderStat>
            ) : null}
          </>
        }
      />
      <PageGuide
        storageKey="journals-list"
        title={ui("guideTitle")}
        bullets={[
          {
            title: ui("greenTickTitle"),
            body: ui("greenTickBody"),
          },
          {
            title: ui("openJournalTitle"),
            body: ui("openJournalBody"),
          },
          {
            title: ui("greyJournalTitle"),
            body: ui("greyJournalBody"),
          },
          {
            title: ui("sendAllTitle"),
            body: ui("sendAllBody"),
          },
        ]}
        qa={[
          {
            q: ui("qDisabledQ"),
            a: ui("qDisabledA"),
          },
          {
            q: ui("qNoAccessQ"),
            a: ui("qNoAccessA"),
          },
        ]}
      />
      <WorkspaceResourceCards knowledge={false} checklists={!allowedCodes || allowedCodes.includes("custom_checklists")} />
      <JournalsBrowser templates={items} canBulkCreate={isManager} canToggle={isManager} />
    </div>
  );
}
