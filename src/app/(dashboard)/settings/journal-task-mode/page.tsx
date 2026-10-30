import Link from "next/link";
import { forbidden } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { db } from "@/lib/db";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { sortJournalsByName } from "@/lib/journal-sort";
import {
  parseTaskModesJson,
  getDefaultTaskMode,
} from "@/lib/journal-task-modes";
import { JournalTaskModeClient } from "@/components/settings/journal-task-mode-client";
import { PageGuide } from "@/components/ui/page-guide";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function JournalTaskModePage() {
  const t = await getTranslations("settingsUi.journalTaskModePage");
  const session = await requireAuth();
  if (
    !hasFullWorkspaceAccess({
      role: session.user.role,
      isRoot: session.user.isRoot,
    })
  ) {
    forbidden();
  }
  const organizationId = getActiveOrgId(session);

  const [org, areaCount] = await Promise.all([
    db.organization.findUnique({
      where: { id: organizationId },
      select: { journalTaskModesJson: true },
    }),
    db.area.count({ where: { organizationId } }),
  ]);

  const overrides = parseTaskModesJson(org?.journalTaskModesJson);

  // Готовим список journal'ов с резолвом effective-режима для UI.
  const journals = sortJournalsByName(ACTIVE_JOURNAL_CATALOG, (j) => j.name).map((j) => {
    const def = getDefaultTaskMode(j.code);
    const override = overrides[j.code] ?? {};
    return {
      code: j.code,
      name: j.name,
      // Раздельно: дефолт, чтобы UI мог показать «по умолчанию»; и
      // override (что юзер реально настроил для этого journal).
      defaultMode: def,
      override,
    };
  });

  return (
    <div className="space-y-5">
      <div>

      </div>

      {/* Тёмный hero снят: страница — рабочий список журналов, баннер
          дублировал название из PageNav. Предупреждение про помещения
          вынесено отдельной плашкой — на светлом фоне оно заметнее. */}
      <PageHeader
        title={t("title")}
        description={t("description")}
      />

      {areaCount === 0 ? (
        <p className="max-w-[680px] rounded-2xl border border-amber-200 bg-amber-50 p-3 text-[13px] leading-[1.55] text-[#8a5a06]">
          {t.rich("noAreasWarning", {
            link: (chunks) => (
              <Link href="/settings/areas" className="underline">
                {chunks}
              </Link>
            ),
          })}
        </p>
      ) : null}

      <PageGuide
        storageKey="journal-task-mode"
        title={t("guideTitle")}
        bullets={[
          {
            title: t("b1Title"),
            body: t("b1Body"),
          },
          {
            title: t("b2Title"),
            body: t("b2Body"),
          },
          {
            title: t("b3Title"),
            body: t("b3Body"),
          },
          {
            title: t("b4Title"),
            body: t("b4Body"),
          },
          {
            title: t("b5Title"),
            body: t("b5Body"),
          },
          {
            title: t("b6Title"),
            body: t("b6Body"),
          },
          {
            title: t("b7Title"),
            body: t("b7Body"),
          },
        ]}
        qa={[
          {
            q: t("q1"),
            a: t("a1"),
          },
          {
            q: t("q2"),
            a: t("a2"),
          },
          {
            q: t("q3"),
            a: t("a3"),
          },
        ]}
      />

      <JournalTaskModeClient journals={journals} />
    </div>
  );
}
