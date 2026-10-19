import { authOptions } from "@/lib/auth";
import { getServerSession } from "@/lib/server-session";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { getOrgCustomNames } from "@/lib/org-custom-names";
import { buildNavModel, loadNavFacts, loadNavMenuData } from "@/lib/app-nav.server";

import { MiniSectionsClient, type MiniSectionGroupView } from "./sections-client";

export const dynamic = "force-dynamic";

/**
 * «Все разделы» — вход из мини-приложения в любую страницу кабинета.
 *
 * Те же девять разделов, что слева на сайте (меню 2026-10-16,
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
    const model = await buildNavModel({
      user,
      facts: await loadNavFacts(session),
      customNames,
      menuData: await loadNavMenuData(session),
    });
    groups.push({
      id: "sections",
      title: "",
      subtitle: "",
      items: model.sections.map((section) => ({
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

  return <MiniSectionsClient groups={groups} authed={Boolean(user)} />;
}
