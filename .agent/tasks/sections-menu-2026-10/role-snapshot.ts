// Снимок: какие адреса каждая роль видит в навигации (вкладки, пункты меню, карточки).
import { visibleNav, visibleSettingsCards, type NavActor, type NavFacts } from "@/lib/app-nav";

const roles: Record<string, NavActor> = {
  owner: { role: "owner", permissionPreset: "admin" },
  manager: { role: "manager", permissionPreset: "admin" },
  headChef: { role: "head_chef", permissionPreset: "head_chef" },
  verifyOnly: { role: "cook", permissionPreset: "head_chef" },
  settingsManager: { role: "owner", permissionPreset: "cook" },
  cook: { role: "cook", permissionPreset: "cook" },
};
const factsList: Record<string, NavFacts> = {
  plain: { checklists: false, settingsPermissions: false },
  full: { checklists: true, settingsPermissions: true },
};

const out: Record<string, string[]> = {};
for (const [name, actor] of Object.entries(roles)) {
  for (const [fname, facts] of Object.entries(factsList)) {
    const hrefs = new Set<string>();
    for (const section of visibleNav(actor, facts)) {
      for (const tab of section.tabs) hrefs.add(tab.href);
      for (const group of section.menu ?? []) {
        for (const item of group.items) {
          hrefs.add(item.href);
          for (const tab of item.tabs ?? []) hrefs.add(tab.href);
        }
      }
    }
    for (const card of visibleSettingsCards(actor, facts)) hrefs.add(card.href);
    out[`${name}/${fname}`] = [...hrefs].sort();
  }
}
console.log(JSON.stringify(out, null, 1));
