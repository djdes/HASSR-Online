import { authOptions } from "@/lib/auth";
import { getServerSession } from "@/lib/server-session";
import { appSectionLabel, visibleAppSectionGroups } from "@/lib/app-sections";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { customSectionNameByHref } from "@/lib/custom-names";
import { getOrgCustomNames } from "@/lib/org-custom-names";

import { MiniSectionsClient, type MiniSectionGroupView } from "./sections-client";

export const dynamic = "force-dynamic";

/**
 * «Все разделы» — вход из мини-приложения в любую страницу кабинета.
 *
 * Список считается на сервере теми же проверками, что и на сайте
 * (`visibleAppSectionGroups` → `canAccessWebPath` + правило доступа
 * самой страницы, `AppSection.access`).
 * Новых правил доступа тут нет и быть не должно: страницы сайта
 * открываются в оболочке приложения как есть, со своими guard'ами, и
 * этот экран лишь показывает то, что человеку и так доступно.
 *
 * Иконки уезжают на клиент строками — компоненты lucide через границу
 * RSC не сериализуются (см. правило про `WhatsNewModal` в CLAUDE.md).
 */
export default async function MiniSectionsPage() {
  const session = await getServerSession(authOptions).catch(() => null);
  const user = session?.user ?? null;
  // Свои названия разделов организации — те же, что в меню сайта.
  const customNames = session ? await getOrgCustomNames(getActiveOrgId(session)) : null;

  const groups: MiniSectionGroupView[] = user
    ? visibleAppSectionGroups(user).map((group) => ({
        id: group.id,
        title: group.title,
        subtitle: group.subtitle,
        items: group.sections.map((section) => ({
          href: section.href,
          label: customSectionNameByHref(customNames, section.href) ?? appSectionLabel(section),
          hint: section.hint,
          icon: section.icon,
        })),
      }))
    : [];

  return <MiniSectionsClient groups={groups} authed={Boolean(user)} />;
}
