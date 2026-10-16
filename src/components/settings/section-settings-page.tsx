import { getTranslations } from "next-intl/server";
import { getActiveOrgId, type requireAuth } from "@/lib/auth-helpers";
import { getJournalControls } from "@/lib/journal-controls.server";
import { getOrgCustomNames } from "@/lib/org-custom-names";
import { loadNavFacts } from "@/lib/app-nav.server";
import type { RouteTitleKey } from "@/lib/route-titles";
import type { SettingsCardSection } from "@/lib/settings-cards";
import { SettingsCardGrid } from "@/components/settings/settings-card-grid";
type Session = Awaited<ReturnType<typeof requireAuth>>;

/**
 * Вкладка «Настройка» раздела (или «Остальное»): карточки своих настроек.
 * Заголовок только для экранного диктора — раздел и так назван вкладкой.
 * Доступ проверяет сама страница: так его видно в её коде (и тесту меню).
 */
export async function SectionSettingsPage({
  session,
  section,
  titleKey,
  children,
}: {
  session: Session;
  section: SettingsCardSection;
  titleKey: RouteTitleKey;
  children?: React.ReactNode;
}) {
  const organizationId = getActiveOrgId(session);
  const [facts, customNames, controls, tRoutes] = await Promise.all([
    loadNavFacts(session),
    getOrgCustomNames(organizationId),
    section === "journals" ? getJournalControls(organizationId) : Promise.resolve(null),
    getTranslations("navigation.routes"),
  ]);
  return (
    <div className="space-y-5">
      <h1 className="sr-only">{tRoutes(titleKey)}</h1>
      {children}
      <SettingsCardGrid
        section={section}
        actor={session.user}
        facts={facts}
        customNames={customNames}
        specialMode={controls?.specialMode ?? false}
      />
    </div>
  );
}
