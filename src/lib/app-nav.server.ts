import { getTranslations } from "next-intl/server";
import type { Session } from "next-auth";
import { CHECKLIST_CODE } from "@/lib/custom-checklists";
import { customSectionNameByHref, type CustomNames } from "@/lib/custom-names";
import { hasJournalAccess } from "@/lib/journal-acl";
import { sessionHasPermission } from "@/lib/permissions-server";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import {
  visibleNav,
  visibleSettingsCards,
  type NavActor,
  type NavFacts,
  type NavSectionKey,
} from "@/lib/app-nav";

/** Готовая к показу модель меню: подписи уже переведены. Сериализуема. */
export type NavModelTab = { id: string; href: string; label: string };
export type NavModelSection = {
  key: NavSectionKey;
  icon: string;
  label: string;
  rootHref: string;
  tabs: NavModelTab[];
};
/** Пункт поиска ⌘K — карточка настроек, которую человек откроет. */
export type NavModelSearchItem = {
  href: string;
  label: string;
  sectionLabel: string;
  icon: string;
};
export type NavModel = {
  sections: NavModelSection[];
  /** Сайдбар нужен, только когда разделов два и больше. */
  showSidebar: boolean;
  /** Карточки настроек для ⌘K (пусто/нет — только вкладки). */
  search?: NavModelSearchItem[];
};

type NavUser = NavActor & { id: string; role: string; isRoot: boolean };

/** Факты, которые нельзя вывести из роли, — считаются один раз на запрос. */
export async function loadNavFacts(session: Session): Promise<NavFacts> {
  const user = session.user;
  const checklists = await hasJournalAccess(user, CHECKLIST_CODE).catch(() => false);
  // Лишний запрос в БД — только руководству: остальным карточки прав закрыты.
  const settingsPermissions = hasFullWorkspaceAccess(user)
    ? await sessionHasPermission(session, "settings.permissions").catch(() => false)
    : false;
  return { checklists, settingsPermissions };
}

export async function buildNavModel(input: {
  user: NavUser;
  facts: NavFacts;
  customNames: CustomNames | null;
}): Promise<NavModel> {
  const t = await getTranslations("navigation.shell");
  const tCards = await getTranslations("settingsManagement.home.cards");
  const visible = visibleNav(input.user, input.facts);
  const sections = visible.map((section) => ({
    key: section.key,
    icon: section.icon,
    label:
      customSectionNameByHref(input.customNames, section.renameHref) ??
      t(`sections.${section.key}`),
    rootHref: section.rootHref,
    tabs: section.tabs.map((tab) => ({ id: tab.id, href: tab.href, label: t(`tabs.${tab.label}`) })),
  }));
  const sectionLabels = new Map<string, string>(sections.map((s) => [s.key, s.label]));
  const search = visibleSettingsCards(input.user, input.facts).map((card) => ({
    href: card.href,
    label: customSectionNameByHref(input.customNames, card.href) ?? tCards(`${card.id}.title`),
    sectionLabel: sectionLabels.get(card.section) ?? "",
    icon: card.icon,
  }));
  return { sections, showSidebar: sections.length >= 2, search };
}
