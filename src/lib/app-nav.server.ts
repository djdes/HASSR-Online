import { getTranslations } from "next-intl/server";
import { CHECKLIST_CODE } from "@/lib/custom-checklists";
import { customSectionNameByHref, type CustomNames } from "@/lib/custom-names";
import { hasJournalAccess } from "@/lib/journal-acl";
import { visibleNav, type NavActor, type NavFacts, type NavSectionKey } from "@/lib/app-nav";

/** Готовая к показу модель меню: подписи уже переведены. Сериализуема. */
export type NavModelTab = { id: string; href: string; label: string };
export type NavModelSection = {
  key: NavSectionKey;
  icon: string;
  label: string;
  rootHref: string;
  tabs: NavModelTab[];
};
export type NavModel = {
  sections: NavModelSection[];
  /** Сайдбар нужен, только когда разделов два и больше. */
  showSidebar: boolean;
};

type NavUser = NavActor & { id: string; role: string; isRoot: boolean };

/** Факты, которые нельзя вывести из роли, — считаются один раз на запрос. */
export async function loadNavFacts(user: NavUser): Promise<NavFacts> {
  const checklists = await hasJournalAccess(user, CHECKLIST_CODE).catch(() => false);
  return { checklists };
}

export async function buildNavModel(input: {
  user: NavUser;
  facts: NavFacts;
  customNames: CustomNames | null;
}): Promise<NavModel> {
  const t = await getTranslations("navigation.shell");
  const sections = visibleNav(input.user, input.facts).map((section) => ({
    key: section.key,
    icon: section.icon,
    label:
      customSectionNameByHref(input.customNames, section.renameHref) ??
      t(`sections.${section.key}`),
    rootHref: section.rootHref,
    tabs: section.tabs.map((tab) => ({ id: tab.id, href: tab.href, label: t(`tabs.${tab.label}`) })),
  }));
  return { sections, showSidebar: sections.length >= 2 };
}
