import test from "node:test";
import assert from "node:assert/strict";

import {
  PPK_BLOCKS,
  PPK_MENU_GROUPS,
  PPK_OVERVIEW_HREF,
  ppkBlock,
  ppkBlockHref,
  ppkMenuBlocks,
  ppkReadyTabs,
} from "./registry";

const SERVICE_KEYS = ["haccp-package", "pre-inspection-audit", "layout-planning", "consulting", "ppk-development", "pest-control-service", "norms-subscription"];

test("CTA ведёт в свою услугу: дезинсекция — служба, нормативы — подписка", () => {
  assert.equal(ppkBlock("pest-control").serviceKey, "pest-control-service");
  assert.equal(ppkBlock("norm-documents").serviceKey, "norms-subscription");
});

test("группы меню: главная без подписи, ХАССП и документы с подписью", () => {
  assert.deepEqual(
    PPK_MENU_GROUPS.map((group) => [group.key, group.labelled]),
    [
      ["main", false],
      ["haccp", true],
      ["documents", true],
    ],
  );
  assert.equal(PPK_OVERVIEW_HREF, "/production-control");
});

test("блоки идут в порядке схемы владельца", () => {
  assert.deepEqual(
    PPK_BLOCKS.map((block) => `${block.menuGroup}:${block.key}`),
    [
      "main:program",
      "main:instructions",
      "main:procedures",
      "main:floor-plans",
      "main:products",
      "main:pest-control",
      "main:lab",
      "main:flowcharts",
      "haccp:team",
      "haccp:policy",
      "haccp:hazards",
      "haccp:control-points",
      "haccp:audit",
      "documents:orders",
      "documents:posters",
      "documents:norm-documents",
      "documents:storage",
    ],
  );
});

test("17 блоков, ключи уникальны, у каждого есть своя группа меню", () => {
  assert.equal(PPK_BLOCKS.length, 17);
  assert.equal(new Set(PPK_BLOCKS.map((block) => block.key)).size, 17);
  const groupKeys = new Set(PPK_MENU_GROUPS.map((group) => group.key));
  for (const block of PPK_BLOCKS) assert.ok(groupKeys.has(block.menuGroup), block.key);
});

test("guidelines и sanpin — вкладки, а не блоки", () => {
  const keys = PPK_BLOCKS.map((block) => block.key) as string[];
  assert.ok(!keys.includes("guidelines"));
  assert.ok(!keys.includes("sanpin"));
  assert.deepEqual(
    ppkBlock("norm-documents").tabs?.map((tab) => tab.id),
    ["list", "guidelines", "sanpin"],
  );
});

test("href блоков начинаются с / и не повторяются", () => {
  for (const block of PPK_BLOCKS) assert.ok(block.href.startsWith("/"), block.href);
  assert.equal(new Set(PPK_BLOCKS.map((block) => block.href)).size, PPK_BLOCKS.length);
});

test("serviceKey только из известного списка услуг", () => {
  for (const block of PPK_BLOCKS) {
    if (block.serviceKey !== undefined) {
      assert.ok(SERVICE_KEYS.includes(block.serviceKey), `${block.key}: ${block.serviceKey}`);
    }
  }
});

test("«Программа» — справочный блок: не считается в прогрессе, вкладка «Обзор» готова", () => {
  const program = ppkBlock("program");
  assert.equal(program.href, "/production-control");
  assert.equal(program.counted, false);
  assert.equal(program.ready, true);
  assert.deepEqual(
    program.tabs?.map((tab) => [tab.id, tab.ready]),
    [
      ["overview", true],
      ["program", true],
      ["haccpPlan", true],
    ],
  );
});

test("ppkMenuBlocks возвращает только готовые блоки группы в порядке реестра", () => {
  for (const group of PPK_MENU_GROUPS) {
    const expected = PPK_BLOCKS.filter((block) => block.menuGroup === group.key && block.ready);
    assert.deepEqual(ppkMenuBlocks(group.key), expected);
  }
  const main = ppkMenuBlocks("main").map((block) => block.key);
  assert.deepEqual(main.slice(0, 3), ["program", "instructions", "procedures"]);
});

test("ppkBlockHref: первая готовая вкладка, иначе адрес блока", () => {
  assert.equal(ppkBlockHref(ppkBlock("norm-documents")), "/production-control/norms/documents");
  assert.equal(ppkBlockHref(ppkBlock("program")), "/production-control");
  assert.equal(ppkBlockHref(ppkBlock("orders")), "/orders");
  assert.deepEqual(
    ppkReadyTabs(ppkBlock("norm-documents")).map((tab) => tab.id),
    ["list", "guidelines", "sanpin"],
  );
  assert.deepEqual(ppkReadyTabs(ppkBlock("orders")), []);
});

test("первая вкладка блока с вкладками повторяет адрес блока или идёт после неготовой", () => {
  for (const block of PPK_BLOCKS) {
    if (!block.tabs) continue;
    for (const tab of block.tabs) assert.ok(tab.href.startsWith("/"), `${block.key}/${tab.id}`);
    if (block.key !== "norm-documents") assert.equal(block.tabs[0].href, block.href, block.key);
  }
});

test("ppkBlock бросает ошибку на неизвестный ключ", () => {
  assert.throws(() => ppkBlock("nope" as never));
  assert.equal(ppkBlock("orders").href, "/orders");
});
