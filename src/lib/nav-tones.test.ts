import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { NAV_TONES, hasNavTone, navTone } from "./nav-tones";
import { SETTINGS_CARDS } from "./settings-cards";

test("у каждой иконки меню и карточки настроек есть тон", async () => {
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
