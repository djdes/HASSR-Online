import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  THEME_PREVIEW_PALETTES,
  THEME_TILES,
  chooseThemeTile,
  contrastRatio,
  isThemeMode,
  relativeLuminance,
  selectedThemeTile,
  themeTileForKey,
} from "./theme-tiles-model";

describe("карточки темы: состав и выбор", () => {
  it("три карточки в порядке Claude: светлая, тёмная, как на устройстве", () => {
    assert.deepEqual(
      THEME_TILES.map((tile) => [tile.mode, tile.label]),
      [
        ["light", "Светлая"],
        ["dark", "Тёмная"],
        ["system", "Как на устройстве"],
      ]
    );
  });

  it("выбрана карточка сохранённого режима, пока смена по времени суток выключена", () => {
    for (const mode of ["light", "dark", "system"] as const) {
      assert.equal(selectedThemeTile({ mode, autoBySchedule: false }), mode);
    }
  });

  it("при смене по времени суток не выбрана ни одна — тему задаёт час", () => {
    for (const mode of ["light", "dark", "system"] as const) {
      assert.equal(selectedThemeTile({ mode, autoBySchedule: true }), null);
    }
  });

  it("нажатие на карточку: режим — эта карточка, смена по времени выключена", () => {
    for (const tile of ["light", "dark", "system"] as const) {
      assert.deepEqual(chooseThemeTile({ autoBySchedule: false }, tile), {
        mode: tile,
        autoBySchedule: false,
        turnedOffAuto: false,
      });
      // Смену по времени выключает именно это нажатие — меню скажет
      // «выключена» и предложит вернуть.
      assert.deepEqual(chooseThemeTile({ autoBySchedule: true }, tile), {
        mode: tile,
        autoBySchedule: false,
        turnedOffAuto: true,
      });
    }
  });

  it("после нажатия выбрана ровно нажатая карточка", () => {
    for (const tile of ["light", "dark", "system"] as const) {
      for (const autoBySchedule of [false, true]) {
        const next = chooseThemeTile({ autoBySchedule }, tile);
        assert.equal(selectedThemeTile(next), tile);
      }
    }
  });

  it("isThemeMode пропускает только три режима", () => {
    for (const ok of ["light", "dark", "system"]) assert.equal(isThemeMode(ok), true);
    for (const bad of ["", "auto", "Light", null, undefined, 1]) {
      assert.equal(isThemeMode(bad), false);
    }
  });
});

describe("карточки темы: клавиатура", () => {
  it("стрелки идут по кругу в обе стороны", () => {
    assert.equal(themeTileForKey("light", "ArrowRight"), "dark");
    assert.equal(themeTileForKey("dark", "ArrowRight"), "system");
    assert.equal(themeTileForKey("system", "ArrowRight"), "light");
    assert.equal(themeTileForKey("light", "ArrowLeft"), "system");
    assert.equal(themeTileForKey("system", "ArrowLeft"), "dark");
    assert.equal(themeTileForKey("dark", "ArrowDown"), "system");
    assert.equal(themeTileForKey("dark", "ArrowUp"), "light");
  });

  it("Home и End — к краям, без выбора стрелки начинают с краёв", () => {
    assert.equal(themeTileForKey("system", "Home"), "light");
    assert.equal(themeTileForKey("light", "End"), "system");
    assert.equal(themeTileForKey(null, "ArrowRight"), "light");
    assert.equal(themeTileForKey(null, "ArrowLeft"), "system");
  });

  it("чужие клавиши не перехватываются", () => {
    for (const key of ["Enter", " ", "Tab", "Escape", "a"]) {
      assert.equal(themeTileForKey("light", key), null);
    }
  });
});

describe("карточки темы: мини-превью", () => {
  const { light, dark } = THEME_PREVIEW_PALETTES;

  it("светлая карточка светлая, тёмная — тёмная (превью не перепутаны)", () => {
    assert.ok(relativeLuminance(light.card) > 0.9, light.card);
    assert.ok(relativeLuminance(dark.card) < 0.1, dark.card);
    assert.ok(relativeLuminance(light.page) > 0.8, light.page);
    assert.ok(relativeLuminance(dark.page) < 0.05, dark.page);
  });

  it("карточка «поднята» над фоном в обеих палитрах", () => {
    assert.ok(relativeLuminance(light.card) > relativeLuminance(light.page));
    assert.ok(relativeLuminance(dark.card) > relativeLuminance(dark.page));
  });

  it("индиго-точка различима на карточке (не ниже 3:1)", () => {
    assert.ok(contrastRatio(light.dot, light.card) >= 3, String(contrastRatio(light.dot, light.card)));
    assert.ok(contrastRatio(dark.dot, dark.card) >= 3, String(contrastRatio(dark.dot, dark.card)));
  });

  it("первая полоска заметнее второй — как заголовок и текст", () => {
    for (const palette of [light, dark]) {
      assert.ok(
        contrastRatio(palette.stripe, palette.card) > contrastRatio(palette.stripeSoft, palette.card),
        JSON.stringify(palette)
      );
    }
  });

  it("цвета превью совпадают с токенами темы кабинета (app-theme.css)", () => {
    // Превью обещает, как будет выглядеть кабинет. Перекрасили тему —
    // этот тест напомнит перекрасить и превью.
    const css = readFileSync("src/app/app-theme.css", "utf8");
    const darkStart = css.indexOf('.app-shell[data-app-theme="dark"],');
    assert.ok(darkStart > 0, "нет блока тёмной темы");
    const darkBlock = css.slice(darkStart, css.indexOf("}", darkStart));
    const lightBlock = css.slice(css.indexOf(":root,"), css.indexOf("}", css.indexOf(":root,")));
    const token = (block: string, name: string) =>
      block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1]?.toLowerCase();

    assert.equal(token(darkBlock, "--app-bg"), dark.page);
    assert.equal(token(darkBlock, "--app-surface"), dark.card);
    assert.equal(token(darkBlock, "--app-indigo"), dark.dot);
    assert.equal(token(lightBlock, "--app-surface"), light.card);
    assert.equal(token(lightBlock, "--app-indigo"), light.dot);
  });

  it("contrastRatio считает по WCAG", () => {
    assert.equal(contrastRatio("#ffffff", "#000000"), 21);
    assert.equal(contrastRatio("#5566f6", "#5566f6"), 1);
  });
});
