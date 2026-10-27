import { getJournalControls } from "@/lib/journal-controls.server";
import { automationOn } from "@/lib/journal-controls";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { MapPin, Sparkles } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { buildingTargets, getActiveBuildingId } from "@/lib/active-building";
import { buildingWhere } from "@/lib/building-scope";
import { readBuildingJournalSettings, withBuildingJournalSettings } from "@/lib/building-settings";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { db } from "@/lib/db";
import { sortJournalsByName } from "@/lib/journal-sort";
import { AutoJournalsClient } from "./auto-journals-client";
import { PageGuide } from "@/components/ui/page-guide";
import {
  getJournalAutomation,
  isAutomationSupported,
} from "@/lib/journal-automation";

export const dynamic = "force-dynamic";

export default async function AutoJournalsPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) {
    redirect("/settings");
  }
  const organizationId = getActiveOrgId(session);
  const t = await getTranslations("settingsUi.autoJournalsPage");
  // Страница — про автосоздание; колонка автозаполнения — по своей галочке спецрежима.
  const controls = await getJournalControls(organizationId);
  if (!automationOn(controls, "autoCreate")) redirect("/inspection/special-mode");
  const autoFillAvailable = automationOn(controls, "autoFill");

  const activeBuildingId = await getActiveBuildingId(session);
  const [templates, orgRow, activeDocs, buildingSettings] = await Promise.all([
    db.journalTemplate.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        isMandatorySanpin: true,
        isMandatoryHaccp: true,
      },
    }),
    db.organization.findUnique({
      where: { id: organizationId },
      select: {
        autoJournalCodes: true,
        disabledJournalCodes: true,
        journalAutomationJson: true,
      },
    }),
    db.journalDocument.findMany({
      where: {
        organizationId,
        status: "active",
        dateFrom: { lte: new Date() },
        dateTo: { gte: new Date() },
        ...buildingWhere(activeBuildingId),
      },
      select: { templateId: true },
      distinct: ["templateId"],
    }),
    readBuildingJournalSettings(db, activeBuildingId),
  ]);
  // У точки со своей автоматикой (слитая организация) — её настройки.
  const org = withBuildingJournalSettings(orgRow, buildingSettings);

  const disabledSet = new Set<string>(
    Array.isArray(org?.disabledJournalCodes)
      ? (org.disabledJournalCodes as unknown[]).filter(
          (c): c is string => typeof c === "string"
        )
      : []
  );
  const activeTemplateIds = new Set(activeDocs.map((d) => d.templateId));

  // Журналы по алфавиту.
  const items = sortJournalsByName(templates, (tpl) => tpl.name)
    .filter((tpl) => !disabledSet.has(tpl.code))
    .map((tpl) => ({
      id: tpl.id,
      code: tpl.code,
      name: tpl.name,
      description: tpl.description ?? null,
      isMandatory: tpl.isMandatorySanpin || tpl.isMandatoryHaccp,
      enabled: getJournalAutomation(org, tpl.code).autoCreate,
      // Автозаполнение умеет только «кадровая» механика (строка на
      // сотрудника × день) — для остальных журналов колонка неактивна.
      autoFill: getJournalAutomation(org, tpl.code).autoFill,
      autoFillSupported: isAutomationSupported(tpl.code),
      hasActiveDocumentToday: activeTemplateIds.has(tpl.id),
    }));

  // Точки: документы создаются на каждую точку — скажем об этом прямо
  // над списком, чтобы «N журналов» не превратились неожиданно в 3N.
  const locationsCount = (await buildingTargets(organizationId)).filter(Boolean).length;

  return (
    <div className="space-y-5">
      <div>

        <div className="mt-4 flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
            <Sparkles className="size-5" />
          </span>
          <div>
            <h1 className="text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold tracking-[-0.02em] text-[#0b1024]">
              {t("title")}
            </h1>
            <p className="mt-1.5 max-w-[680px] text-[14px] leading-relaxed text-[#6f7282]">
              {t("description", { example: "t\u00a0<\u00a037" })}
            </p>
          </div>
        </div>
      </div>

      {locationsCount >= 2 ? (
        <div className="flex items-center gap-2.5 rounded-2xl border border-[#dfe3ff] bg-[#f5f6ff] px-4 py-2.5 text-[13px] text-[#3848c7]">
          <MapPin className="size-4 shrink-0" />
          <span>
            {t.rich("pointsNote", {
              count: locationsCount,
              b: (chunks) => <b className="font-semibold tabular-nums">{chunks}</b>,
            })}
          </span>
        </div>
      ) : null}

      <PageGuide
        title={t("guideTitle")}
        storageKey="settings-auto-journals-v1"
        bullets={[
          { title: t("guide1Title"), body: t("guide1Body") },
          { title: t("guide2Title"), body: t("guide2Body") },
          { title: t("guide3Title"), body: t("guide3Body") },
        ]}
        qa={[
          { q: t("qa1Q"), a: t("qa1A") },
          { q: t("qa2Q"), a: t("qa2A") },
        ]}
      />
      <AutoJournalsClient items={items} autoFillAvailable={autoFillAvailable} />
    </div>
  );
}
