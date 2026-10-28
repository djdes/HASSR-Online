import test from "node:test";
import assert from "node:assert/strict";

import { POSTER_ART_NAMES } from "../../components/production-control/poster-art/types";
import {
  POSTERS,
  POSTER_GROUPS,
  findPoster,
  normalizeDisinfectantName,
  orderPosters,
  selectPosters,
  type PosterBlock,
  type PosterKey,
} from "./posters";

const EXPECTED_KEYS: PosterKey[] = [
  "hand-washing",
  "antiseptic",
  "hygiene",
  "chef-clothing",
  "daily-inspection",
  "product-marking",
  "board-marking",
  "storage-times",
  "storage",
  "disinfectant-safety",
  "nika-2",
  "nika-chlor",
  "chlormisept-r",
  "cross-contamination",
  "daily-sample",
  "eggs",
  "dishes",
];

function artNames(block: PosterBlock): string[] {
  switch (block.type) {
    case "steps":
    case "list":
      return [...block.items.flatMap((item) => (item.art ? [item.art] : [])), ...(block.type === "list" && block.art ? [block.art] : [])];
    case "doDont":
      return [block.doArt, block.dontArt];
    case "callout":
      return block.art ? [block.art] : [];
    default:
      return [];
  }
}

function blockIsEmpty(block: PosterBlock): boolean {
  switch (block.type) {
    case "steps":
    case "list":
      return block.items.length === 0 || block.items.some((item) => item.text.trim() === "");
    case "doDont":
      return block.do.length === 0 || block.dont.length === 0;
    case "table":
      return block.head.length === 0 || block.rows.length === 0;
    case "callout":
      return block.text.trim() === "";
    case "text":
      return block.paragraphs.length === 0 || block.paragraphs.some((p) => p.trim() === "");
    case "labelSample":
      return block.callouts.length === 0;
    case "journalQr":
      return block.templateCode === "" || block.caption.trim() === "";
  }
}

test("17 плакатов с уникальными ключами в порядке каталога", () => {
  assert.deepEqual(
    POSTERS.map((poster) => poster.key),
    EXPECTED_KEYS,
  );
  assert.equal(new Set(POSTERS.map((poster) => poster.key)).size, 17);
});

test("группы идут подряд в заданном порядке", () => {
  const order = POSTER_GROUPS.map((group) => group.key);
  assert.deepEqual(order, ["hygiene", "marking", "disinfection", "kitchen"]);
  const sequence = POSTERS.map((poster) => poster.group).filter((group, index, all) => group !== all[index - 1]);
  assert.deepEqual(sequence, order);
});

test("у каждого плаката заголовок и непустые блоки", () => {
  for (const poster of POSTERS) {
    assert.ok(poster.title.trim().length > 0, poster.key);
    assert.ok(poster.blocks.length > 0, poster.key);
    for (const block of poster.blocks) assert.equal(blockIsEmpty(block), false, `${poster.key}: ${block.type}`);
  }
});

test("все иллюстрации есть в каталоге poster-art", () => {
  const known = new Set<string>(POSTER_ART_NAMES);
  for (const poster of POSTERS) {
    for (const block of poster.blocks) for (const name of artNames(block)) assert.ok(known.has(name), `${poster.key}: ${name}`);
  }
});

test("строки таблиц совпадают с шапкой по числу колонок", () => {
  for (const poster of POSTERS) {
    for (const block of poster.blocks) {
      if (block.type !== "table") continue;
      for (const row of block.rows) assert.equal(row.length, block.head.length, `${poster.key}: ${row[0]}`);
    }
  }
});

test("мытьё рук — десять шагов с картинками, сроки хранения — 23 строки", () => {
  const steps = findPoster("hand-washing")?.blocks.find((block) => block.type === "steps");
  assert.ok(steps && steps.type === "steps");
  assert.equal(steps.items.length, 10);
  assert.ok(steps.items.every((item) => item.art));
  const times = findPoster("storage-times")?.blocks.find((block) => block.type === "table");
  assert.ok(times && times.type === "table");
  assert.equal(times.rows.length, 23);
});

test("маркировка разделочного инвентаря: таблица из десяти строк по три колонки", () => {
  const board = POSTERS.find((poster) => poster.key === "board-marking");
  const table = board?.blocks.find((block) => block.type === "table");
  assert.ok(table && table.type === "table");
  assert.deepEqual(table.head, ["Маркировка", "Для чего", "Цвет (если цветная)"]);
  assert.equal(table.rows.length, 10);
  assert.deepEqual(table.rows[0], ["СМ", "Сырое мясо", "красный"]);
  for (const row of table.rows) assert.equal(row.length, 3);
  assert.equal(table.swatchColumn, 2);
});

test("ежедневный осмотр ведёт на гигиенический журнал", () => {
  const qr = findPoster("daily-inspection")?.blocks.find((block) => block.type === "journalQr");
  assert.ok(qr && qr.type === "journalQr");
  assert.equal(qr.templateCode, "hygiene");
});

// Правки по скану 97 (2026-10-28).
test("мытьё посуды: «Важно» — щётки, металлические мочалки и губчатый материал не используются", () => {
  const callouts = findPoster("dishes")?.blocks.filter((block) => block.type === "callout") ?? [];
  assert.equal(callouts.length, 1);
  const [callout] = callouts;
  assert.ok(callout.type === "callout");
  assert.equal(callout.tone, "warn");
  assert.equal(
    callout.text,
    "Щётки с наличием дефектов, плесени и видимых загрязнений, а также металлические мочалки и губчатый материал для обработки посуды — не используются!",
  );
  assert.doesNotMatch(callout.text, /Посудомоечную машину/);
});

test("товарное соседство: хлеб в шкафах с вентиляцией, хранение на подтоварниках", () => {
  const list = findPoster("storage")?.blocks.find((block) => block.type === "list");
  assert.ok(list && list.type === "list");
  const texts = list.items.map((item) => item.text);
  assert.ok(texts.includes("Хлеб хранится в отдельных шкафах с отверстиями для вентиляции"));
  assert.ok(texts.includes("Хранение допускается только на подтоварниках, не ниже 15 см от пола"));
  assert.ok(!texts.some((text) => text.startsWith("Яйца")));
  assert.ok(!texts.some((text) => text.startsWith("Не ставьте продукты на пол")));
  assert.equal(texts.length, 8);
});

test("суточная проба: у каждого пункта своя картинка", () => {
  const list = findPoster("daily-sample")?.blocks.find((block) => block.type === "list");
  assert.ok(list && list.type === "list");
  assert.deepEqual(
    list.items.map((item) => item.art),
    ["ds-jar", "ds-spoon", "ds-weight", "ds-portion", "ds-fridge"],
  );
});

test("длинные памятки средств печатаются плотнее, чтобы помещаться на лист", () => {
  assert.equal(findPoster("chlormisept-r")?.density, "dense");
  assert.equal(findPoster("disinfectant-safety")?.density, "dense");
});

test("findPoster и selectPosters", () => {
  assert.equal(findPoster("нет такого"), null);
  assert.deepEqual(
    selectPosters(["eggs", "hand-washing", "bad"]).map((poster) => poster.key),
    ["hand-washing", "eggs"],
  );
});

test("названия средств нормализуются для сравнения", () => {
  assert.equal(normalizeDisinfectantName("Ника-2"), "ника2");
  assert.equal(normalizeDisinfectantName("«Ника Хлор»".replace(/[«»]/g, "")), "никахлор");
  assert.equal(normalizeDisinfectantName("Хлормисепт-Р"), "хлормисептр");
});

test("памятки средств из журнала идут первыми внутри дезинфекции", () => {
  const keys = (names: string[]) =>
    orderPosters(names.map(normalizeDisinfectantName))
      .filter((poster) => poster.group === "disinfection")
      .map((poster) => poster.key);
  assert.deepEqual(keys([]), ["disinfectant-safety", "nika-2", "nika-chlor", "chlormisept-r"]);
  assert.deepEqual(keys(["Хлормисепт-Р 0,1%"]), ["disinfectant-safety", "chlormisept-r", "nika-2", "nika-chlor"]);
  assert.deepEqual(keys(["Ника Хлор", "Ника-2"]), ["disinfectant-safety", "nika-2", "nika-chlor", "chlormisept-r"]);
  assert.equal(orderPosters([]).length, 17);
});
