import { test } from "node:test";
import assert from "node:assert/strict";

import {
  boxInsets,
  classifyChange,
  colorAlpha,
  depthBelow,
  differingProperties,
  flightDirection,
  isChosen,
  isFarFlight,
  joinsLiquid,
  leadingEdgeNeedsSoftLanding,
  onOneTrack,
  pairSelections,
  planLiquid,
  type Look,
  type TreeNode,
} from "./motion-model";

/** Spec `.agent/tasks/site-motion-2026-11-22`, AC6: the pure part of liquid selection. */

type Node = TreeNode & { name: string };

function tree(name: string, parent: Node | null = null): Node {
  return { name, parentElement: parent };
}

test("выбран ли пункт — по значению атрибута", () => {
  assert.equal(isChosen("aria-selected", "true"), true);
  assert.equal(isChosen("aria-selected", "false"), false);
  assert.equal(isChosen("aria-pressed", null), false);
  assert.equal(isChosen("aria-current", "page"), true);
  assert.equal(isChosen("aria-current", "true"), true);
  assert.equal(isChosen("aria-current", "false"), false);
  assert.equal(isChosen("data-active", ""), true, "пустой `data-active` — выбран");
  assert.equal(isChosen("data-active", "false"), false);
  assert.equal(isChosen("data-state", "active"), true);
  assert.equal(isChosen("data-state", "on"), true);
  // Radix: открытое меню и отмеченная галочка — не «выбранный пункт группы».
  assert.equal(isChosen("data-state", "open"), false);
  assert.equal(isChosen("data-state", "checked"), false);
});

test("изменение атрибута: стал выбранным, перестал или ничего", () => {
  assert.equal(classifyChange("aria-selected", "false", "true"), "gained");
  assert.equal(classifyChange("aria-selected", "true", "false"), "lost");
  assert.equal(classifyChange("aria-current", "page", null), "lost");
  assert.equal(classifyChange("aria-current", null, "page"), "gained");
  assert.equal(classifyChange("aria-current", "page", "true"), null, "страница → раздел: пункт остался выбранным");
  assert.equal(classifyChange("data-state", "closed", "open"), null);
  assert.equal(classifyChange("data-active", null, ""), "gained");
});

test("переключатель и галочка в перетекании не участвуют, aria-selected — только у вкладок", () => {
  assert.equal(joinsLiquid("aria-checked", "switch"), false);
  assert.equal(joinsLiquid("aria-checked", "checkbox"), false);
  assert.equal(joinsLiquid("data-state", "checkbox"), false);
  assert.equal(joinsLiquid("aria-checked", "radio"), true);
  assert.equal(joinsLiquid("aria-checked", null), false);
  assert.equal(joinsLiquid("aria-selected", "tab"), true);
  assert.equal(joinsLiquid("aria-selected", "option"), false, "в списке aria-selected ходит за клавиатурой");
  assert.equal(joinsLiquid("aria-pressed", null), true);
  assert.equal(joinsLiquid("aria-current", null), true);
  assert.equal(joinsLiquid("data-active", null), true);
});

test("глубина узла под предком", () => {
  const root = tree("root");
  const list = tree("list", root);
  const item = tree("item", list);
  assert.equal(depthBelow(item, list, 6), 1);
  assert.equal(depthBelow(item, root, 6), 2);
  assert.equal(depthBelow(item, item, 6), 0);
  assert.equal(depthBelow(root, item, 6), null);
  assert.equal(depthBelow(item, root, 1), null, "дальше предела не ищем");
});

test("пара: соседние вкладки — общий родитель", () => {
  const list = tree("tablist");
  const a = tree("a", list);
  const b = tree("b", list);
  assert.deepEqual(pairSelections([a], [b]), [{ from: a, to: b, host: list }]);
});

test("пара: пункты, обёрнутые в li, — общий список", () => {
  const ul = tree("ul");
  const a = tree("a", tree("li-a", ul));
  const b = tree("b", tree("li-b", ul));
  assert.deepEqual(pairSelections([a], [b]), [{ from: a, to: b, host: ul }]);
});

test("пара: строка меню — со строкой меню, шапка раздела — с шапкой", () => {
  // nav > section > (header, list > row)
  const nav = tree("nav");
  const sectionOne = tree("section-1", nav);
  const sectionTwo = tree("section-2", nav);
  const headerOne = tree("header-1", sectionOne);
  const headerTwo = tree("header-2", sectionTwo);
  const rowOne = tree("row-1", tree("list-1", sectionOne));
  const rowTwo = tree("row-2", tree("list-2", sectionTwo));
  const pairs = pairSelections([headerOne, rowOne], [headerTwo, rowTwo]);
  assert.equal(pairs.length, 2);
  assert.deepEqual(
    pairs.map((pair) => [pair.from.name, pair.to.name, pair.host.name]),
    [
      ["header-1", "header-2", "nav"],
      ["row-1", "row-2", "nav"],
    ],
  );
});

test("пара: далёкие друг от друга элементы не связываются; пункт берётся один раз", () => {
  const far = tree("far", tree("1", tree("2", tree("3", tree("4", tree("5", tree("6", tree("7"))))))));
  const lone = tree("lone", tree("x"));
  assert.deepEqual(pairSelections([far], [lone]), []);
  const list = tree("list");
  const a = tree("a", list);
  const b = tree("b", list);
  const c = tree("c", list);
  const pairs = pairSelections([a], [b, c]);
  assert.equal(pairs.length, 1, "один ушедший — одна пара");
  assert.equal(pairs[0].from, a);
});

test("края фигуры и направление полёта", () => {
  assert.deepEqual(boxInsets({ x: 10, y: 4, width: 50, height: 32 }, 200, 40), { left: 10, top: 4, right: 140, bottom: 4 });
  const left = { x: 0, y: 0, width: 80, height: 40 };
  const right = { x: 200, y: 0, width: 80, height: 40 };
  const below = { x: 0, y: 300, width: 80, height: 40 };
  assert.equal(flightDirection(left, right), "right");
  assert.equal(flightDirection(right, left), "left");
  assert.equal(flightDirection(left, below), "down");
  assert.equal(flightDirection(below, left), "up");
  assert.equal(isFarFlight(left, right), false);
  assert.equal(isFarFlight(left, { x: 600, y: 0, width: 80, height: 40 }), true);
});

test("перетекание — только в одной строке или одном столбце", () => {
  const cell = (x: number, y: number) => ({ x, y, width: 40, height: 40 });
  assert.equal(onOneTrack(cell(0, 0), cell(200, 0)), true, "та же строка");
  assert.equal(onOneTrack(cell(0, 0), cell(0, 300)), true, "тот же столбец");
  assert.equal(onOneTrack(cell(0, 0), cell(10, 300)), true, "строка меню с отступом — тот же столбец");
  assert.equal(onOneTrack(cell(0, 0), cell(200, 120)), false, "другая строка и другой столбец — ячейки сетки");
  assert.equal(onOneTrack(cell(0, 0), cell(200, 30)), false, "вкладка, перенесённая на следующую строку");
  // Широкая строка раздела и узкая вложенная под ней.
  assert.equal(onOneTrack({ x: 0, y: 0, width: 240, height: 44 }, { x: 18, y: 120, width: 222, height: 40 }), true);
});

test("у самого края группы передний край садится без перелёта", () => {
  // Сегменты в дорожке с отступом 2px: перелёт ~1,5 % пути вывел бы плашку за край.
  const from = { left: 2, top: 2, right: 178, bottom: 2 };
  const to = { left: 178, top: 2, right: 2, bottom: 2 };
  assert.equal(leadingEdgeNeedsSoftLanding("right", from, to), true);
  // Вкладки в широкой строке: до края далеко — перелёт остаётся.
  assert.equal(
    leadingEdgeNeedsSoftLanding("right", { left: 22, top: 0, right: 1073, bottom: 0 }, { left: 111, top: 0, right: 878, bottom: 0 }),
    false,
  );
  assert.equal(leadingEdgeNeedsSoftLanding("up", { left: 0, top: 126, right: 0, bottom: 0 }, { left: 0, top: 42, right: 0, bottom: 84 }), false);
  assert.equal(leadingEdgeNeedsSoftLanding("up", { left: 0, top: 126, right: 0, bottom: 0 }, { left: 0, top: 0, right: 0, bottom: 126 }), true);
});

test("прозрачность цвета в записях браузера", () => {
  assert.equal(colorAlpha("transparent"), 0);
  assert.equal(colorAlpha("rgba(0, 0, 0, 0)"), 0);
  assert.equal(colorAlpha("rgb(85, 102, 246)"), 1);
  assert.equal(colorAlpha("rgba(85, 102, 246, 0.04)"), 0.04);
  assert.equal(colorAlpha("rgb(85 102 246 / 0.5)"), 0.5);
  assert.equal(colorAlpha("rgb(85 102 246 / 50%)"), 0.5);
  assert.equal(colorAlpha("oklch(0.97 0.008 265)"), 1);
  assert.equal(colorAlpha("oklch(0.97 0.008 265 / 0.3)"), 0.3);
  assert.equal(colorAlpha("color(srgb 0.33 0.4 0.96 / 0.09)"), 0.09);
  assert.equal(colorAlpha("lab(90.952 0 -0.0000119209)"), 1, "незнакомая запись — считаем непрозрачной");
});

const IDLE: Look = {
  "background-color": "rgba(0, 0, 0, 0)",
  "background-image": "none",
  "box-shadow": "none",
  "border-top-color": "rgba(0, 0, 0, 0)",
  "border-right-color": "rgba(0, 0, 0, 0)",
  "border-bottom-color": "rgba(0, 0, 0, 0)",
  "border-left-color": "rgba(0, 0, 0, 0)",
  "border-top-width": "0px",
  "border-right-width": "0px",
  "border-bottom-width": "0px",
  "border-left-width": "0px",
  "border-top-left-radius": "12px",
  "border-top-right-radius": "12px",
  "border-bottom-right-radius": "12px",
  "border-bottom-left-radius": "12px",
};

test("план: залитый сегмент — фигура несёт заливку и тень, пункт на время выглядит обычным", () => {
  const chosen: Look = { ...IDLE, "background-color": "rgb(255, 255, 255)", "box-shadow": "rgba(11, 16, 36, 0.06) 0px 1px 2px 0px" };
  assert.deepEqual(differingProperties(chosen, IDLE), ["background-color", "box-shadow"]);
  const plan = planLiquid(chosen, IDLE);
  assert.ok(plan);
  assert.equal(plan.shape["--lq-bg"], "rgb(255, 255, 255)");
  assert.equal(plan.shape["--lq-shadow"], "rgba(11, 16, 36, 0.06) 0px 1px 2px 0px");
  assert.equal(plan.shape["--lq-radius"], "12px 12px 12px 12px");
  assert.deepEqual(plan.mask, { "background-color": "rgba(0, 0, 0, 0)", "box-shadow": "none" });
});

test("план: вкладка с подчёркиванием — фигура несёт только нижнюю рамку", () => {
  const line: Look = { ...IDLE, "border-bottom-width": "2px", "border-top-left-radius": "0px", "border-top-right-radius": "0px", "border-bottom-right-radius": "0px", "border-bottom-left-radius": "0px" };
  const accent = "rgb(85, 102, 246)";
  const chosen: Look = { ...line, "border-top-color": accent, "border-right-color": accent, "border-bottom-color": accent, "border-left-color": accent };
  const plan = planLiquid(chosen, line);
  assert.ok(plan);
  assert.equal(plan.shape["--lq-bg"], "transparent");
  assert.equal(plan.shape["--lq-bw"], "0px 0px 2px 0px");
  assert.equal(plan.shape["--lq-bc"], `${accent} ${accent} ${accent} ${accent}`);
  assert.equal(plan.mask["border-bottom-color"], "rgba(0, 0, 0, 0)");
});

test("план: нечего показывать — состояние только в цвете текста, либо рамка нулевой ширины", () => {
  assert.equal(planLiquid(IDLE, IDLE), null);
  const onlyZeroBorder: Look = { ...IDLE, "border-top-color": "rgb(85, 102, 246)" };
  assert.equal(planLiquid(onlyZeroBorder, IDLE), null);
});

test("план: непрозрачные обычные пункты закрыли бы фигуру — группу не трогаем", () => {
  const idleChip: Look = { ...IDLE, "background-color": "rgb(255, 255, 255)" };
  const chosenChip: Look = { ...idleChip, "background-color": "rgb(85, 102, 246)" };
  assert.equal(planLiquid(chosenChip, idleChip), null);
  // Лёгкая вуаль (кабинет без рамок) фигуру не закрывает.
  const veil: Look = { ...IDLE, "background-color": "rgba(11, 16, 36, 0.04)" };
  assert.ok(planLiquid({ ...veil, "background-color": "rgb(85, 102, 246)" }, veil));
});

test("план: эллиптический радиус сводится к одной длине на угол", () => {
  const chosen: Look = { ...IDLE, "background-color": "rgb(255, 255, 255)", "border-top-left-radius": "10px 6px" };
  assert.equal(planLiquid(chosen, IDLE)?.shape["--lq-radius"], "10px 12px 12px 12px");
});
