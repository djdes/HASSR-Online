import { getTranslations } from "next-intl/server";

import { authOptions } from "@/lib/auth";
import { getServerSession } from "@/lib/server-session";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { getOrgCustomNames } from "@/lib/org-custom-names";
import { buildNavModel, loadNavFacts } from "@/lib/app-nav.server";
import { mainNavSections } from "@/lib/app-nav";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";

import { MiniSectionsClient, type MiniSectionGroupView } from "./sections-client";

export const dynamic = "force-dynamic";

/**
 * «Все разделы» — вход из мини-приложения в любую страницу кабинета.
 *
 * То же главное меню, что слева на сайте (меню 2026-10-16,
 * `lib/app-nav.ts`), с теми же правами: страницы сайта открываются в
 * оболочке приложения как есть, со своими guard'ами (П-3, П-4). Внутри
 * раздела — те же вкладки сверху. Под названием раздела — его вкладки,
 * чтобы было видно, что внутри.
 *
 * Иконки уезжают на клиент строками — компоненты lucide через границу
 * RSC не сериализуются (см. правило про `WhatsNewModal` в CLAUDE.md).
 */
export default async function MiniSectionsPage() {
  const session = await getServerSession(authOptions).catch(() => null);
  const user = session?.user ?? null;
  const groups: MiniSectionGroupView[] = [];
  if (session && user) {
    const customNames = await getOrgCustomNames(getActiveOrgId(session));
    const facts = await loadNavFacts(session);
    const model = await buildNavModel({
      user,
      facts,
      customNames,
      });
    // «Сеть» приложения (серия E, Р8) — владельцу аккаунта и управляющему
    // сетью из двух организаций и больше (тот же факт, что у пункта меню сайта).
    if (facts.accountNetwork) {
      const t = await getTranslations("miniSections");
      groups.push({
        id: "network",
        title: "",
        subtitle: "",
        items: [{ href: "/mini/network", label: t("network.label"), hint: t("network.hint"), icon: "Map" }],
      });
    }
    groups.push({
      id: "sections",
      title: "",
      subtitle: "",
      // Главное меню: вложенные разделы открываются из меню родителя.
      items: mainNavSections(model.sections).map((section) => ({
        href: section.rootHref,
        label: section.label,
        // Раздел с меню — первые четыре пункта; остальные — вкладки раздела.
        hint: section.menu
          ? section.menu
              .flatMap((group) => group.items)
              .slice(0, 4)
              .map((item) => item.label)
              .join(" · ")
          : section.tabs.length > 1
            ? section.tabs.map((tab) => tab.label).join(" · ")
            : "",
        icon: section.icon,
        // Стрелка › — только у раздела со своим меню (как в меню сайта).
        hasMenu: Boolean(section.menu),
      })),
    });
  }

  return (
    <DomainMessagesBoundary namespaces={["miniSections"]}>
      <MiniSectionsClient groups={groups} authed={Boolean(user)} />
    </DomainMessagesBoundary>
  );
}
