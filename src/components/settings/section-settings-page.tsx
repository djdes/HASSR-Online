import { getTranslations } from "next-intl/server";
import { getActiveOrgId, type requireAuth } from "@/lib/auth-helpers";
import { getJournalControls } from "@/lib/journal-controls.server";
import { getOrgCustomNames } from "@/lib/org-custom-names";
import { loadNavFacts } from "@/lib/app-nav.server";
import type { SettingsCardSection } from "@/lib/settings-cards";
import { SectionPageHeader } from "@/components/layout/section-page-header";
import { SettingsCardGrid } from "@/components/settings/settings-card-grid";
type Session = Awaited<ReturnType<typeof requireAuth>>;

/**
 * «Настройка журналов» (пункт меню раздела) или «Остальное»: карточки своих
 * настроек. Сверху — общая шапка раздела с видимым заголовком (название пункта
 * или раздела): в разделах с меню крошек нет.
 * Доступ проверяет сама страница: так его видно в её коде (и тесту меню).
 */
export async function SectionSettingsPage({
  session,
  section,
  children,
}: {
  session: Session;
  section: SettingsCardSection;
  children?: React.ReactNode;
}) {
  const organizationId = getActiveOrgId(session);
  const [facts, customNames, controls, tShell] = await Promise.all([
    loadNavFacts(session),
    getOrgCustomNames(organizationId),
    section === "journals" ? getJournalControls(organizationId) : Promise.resolve(null),
    getTranslations("navigation.shell.leads"),
  ]);
  return (
    <div className="space-y-5">
      <SectionPageHeader description={section === "journals" ? tShell("journalsSetup") : undefined} />
      {children}
      <SettingsCardGrid
        section={section}
        actor={session.user}
        facts={facts}
        customNames={customNames}
        controls={controls}
      />
    </div>
  );
}
