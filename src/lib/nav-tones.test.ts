import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { NAV_TONES, hasNavTone, navTone } from "./nav-tones";
import { mainNavSections, visibleNav, type NavActor, type NavFacts } from "./app-nav";
import { SETTINGS_CARDS } from "./settings-cards";

const ACTORS: Record<string, NavActor> = {
  owner: { role: "owner", permissionPreset: "admin" },
  manager: { role: "manager", permissionPreset: "admin" },
  root: { isRoot: true },
  headChef: { role: "head_chef", permissionPreset: "head_chef" },
  cook: { role: "cook", permissionPreset: "cook" },
  cleaner: { role: "cook", permissionPreset: "cleaner" },
  verifyOnly: { role: "cook", permissionPreset: "head_chef" },
};

const FACTS: NavFacts[] = [
  { checklists: false, settingsPermissions: false },
  { checklists: true, settingsPermissions: true },
  { checklists: true, settingsPermissions: true, journalsPointMode: true },
];

/** Соседи в списке: разные иконки — разные цвета (одинаковую иконку красим одинаково). */
function sameToneNeighbours(icons: readonly string[]): string[] {
  const clashes: string[] = [];
  for (let index = 1; index < icons.length; index += 1) {
    const previous = icons[index - 1];
    const current = icons[index];
    if (previous !== current && navTone(previous) === navTone(current)) {
      clashes.push(`${previous} → ${current}: ${navTone(current)}`);
    }
  }
  return clashes;
}

test("у каждой иконки меню и карточки настроек есть свой тон", async () => {
  const { NAV_ICON_NAMES } = await import("../components/layout/nav-icons");
  const icons = [...NAV_ICON_NAMES, ...SETTINGS_CARDS.map((card) => card.icon)];
  assert.deepEqual(
    icons.filter((icon) => !hasNavTone(icon)),
    [],
  );
});

test("иконки плашек, названные в коде, есть в карте иконок меню", async () => {
  // Незнакомое имя молча рисует запасную иконку (квадратики) вместо нужной.
  const { hasNavIcon } = await import("../components/layout/nav-icons");
  const named: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name)) {
        for (const match of readFileSync(full, "utf8").matchAll(/NavIconChip name="([A-Za-z0-9]+)"/g)) {
          named.push(match[1]);
        }
      }
    }
  };
  walk(join(process.cwd(), "src"));
  assert.ok(named.length > 0);
  assert.deepEqual(named.filter((name) => !hasNavIcon(name)), []);
});

test("тон — один из девяти, незнакомая иконка — индиго", () => {
  assert.equal(navTone("Нет-такой-иконки"), "indigo");
  assert.ok(NAV_TONES.includes(navTone("Gauge")));
  assert.equal(navTone("ShieldAlert"), "rose");
});

test("соседние пункты видимых меню различаются цветом", () => {
  for (const [who, actor] of Object.entries(ACTORS)) {
    for (const facts of FACTS) {
      const sections = visibleNav(actor, facts);
      assert.deepEqual(
        sameToneNeighbours(mainNavSections(sections).map((section) => section.icon)),
        [],
        `${who}: главное меню`,
      );
      for (const section of sections) {
        const icons = (section.menu ?? []).flatMap((group) => group.items.map((item) => item.icon));
        assert.deepEqual(sameToneNeighbours(icons), [], `${who}: меню раздела «${section.key}»`);
      }
    }
  }
});
