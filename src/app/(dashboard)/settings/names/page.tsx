import { redirect } from "next/navigation";

import { PageHeader, PageHeaderStat } from "@/components/ui/page-header";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { countCustomNames, parseCustomNames, RENAMABLE_SECTIONS } from "@/lib/custom-names";
import { db } from "@/lib/db";
import { sortJournalsByName } from "@/lib/journal-sort";
import { parseDisabledCodes } from "@/lib/disabled-journals";
import { pluralRu } from "@/lib/plural-ru";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

import { NamesSettingsClient } from "./names-settings-client";

export const dynamic = "force-dynamic";

/**
 * «Настройки → Названия»: свои названия разделов меню и журналов.
 *
 * Права — как у «Набора журналов» (`/settings/journals`): руководство.
 * Названия действуют только в этой организации и только на экранах:
 * печать, проверяющий, образцы на сайте и отчёты для надзорных органов
 * берут официальные (см. `src/lib/custom-names.ts`).
 */
export default async function NamesSettingsPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/dashboard");
  const organizationId = getActiveOrgId(session);

  const [templates, organization] = await Promise.all([
    db.journalTemplate.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { code: true, name: true },
    }),
    db.organization.findUnique({
      where: { id: organizationId },
      select: { customNamesJson: true, disabledJournalCodes: true },
    }),
  ]);

  const names = parseCustomNames(organization?.customNamesJson);
  const disabled = parseDisabledCodes(organization?.disabledJournalCodes);
  const customCount = countCustomNames(names);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Названия"
        description="Назовите разделы меню и журналы так, как привыкла ваша команда. Своё название увидят только сотрудники вашей организации — в меню, на главной, в журналах, QR-формах, мини-приложении и Telegram. В печати, у проверяющего и в отчётах остаются официальные названия."
        actions={
          customCount > 0 ? (
            <PageHeaderStat>
              {customCount} {pluralRu(customCount, "своё название", "своих названия", "своих названий")}
            </PageHeaderStat>
          ) : null
        }
      />
      <NamesSettingsClient
        sections={RENAMABLE_SECTIONS.map((section) => ({
          key: section.key,
          label: section.label,
        }))}
        // По алфавиту официальных названий: строка редактора подписана
        // официальным названием, и во время ввода своего она не прыгает.
        journals={sortJournalsByName(templates, (t) => t.name).map((template) => ({
          code: template.code,
          name: template.name,
          disabled: disabled.has(template.code),
        }))}
        initialNames={names}
      />
    </div>
  );
}
