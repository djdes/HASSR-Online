import assert from "node:assert/strict";
import test from "node:test";

import {
  applySharedToFinishedProductConfig,
  applySharedToPerishableConfig,
  mergeSharedIntoList,
} from "@/lib/master-directory-push";

test("mergeSharedIntoList: first push adds master items after local ones", () => {
  assert.deepEqual(mergeSharedIntoList(["Своё блюдо"], [], ["Борщ", "Плов"]), ["Своё блюдо", "Борщ", "Плов"]);
});

test("mergeSharedIntoList: removal drops only what the master sent before", () => {
  const current = ["Своё блюдо", "Борщ", "Плов", "Компот"];
  const result = mergeSharedIntoList(current, ["Борщ", "Плов"], ["Борщ"]);
  // «Плов» прислал мастер и убрал; «Компот» и «Своё блюдо» — свои, остаются.
  assert.deepEqual(result, ["Своё блюдо", "Борщ", "Компот"]);
});

test("mergeSharedIntoList: local item with the same name as a removed master item is not kept twice", () => {
  // Кухня сама вписала «Плов» до мастера — после удаления у мастера он уходит:
  // различить «своё» и «мастерское» с одинаковым именем нельзя, решает мастер.
  assert.deepEqual(mergeSharedIntoList(["Плов"], ["Плов"], []), []);
});

test("mergeSharedIntoList: comparison ignores case and spaces, no duplicates", () => {
  const result = mergeSharedIntoList(["борщ ", "Своё"], [], ["Борщ", "СВОЁ", "Плов"]);
  assert.deepEqual(result, ["борщ ", "Своё", "Плов"]);
});

test("mergeSharedIntoList: new master items keep the master order", () => {
  assert.deepEqual(mergeSharedIntoList([], ["Старое"], ["В", "А", "Б"]), ["В", "А", "Б"]);
});

test("mergeSharedIntoList: case change at the master does not remove the kitchen item", () => {
  assert.deepEqual(mergeSharedIntoList(["Борщ"], ["Борщ"], ["БОРЩ"]), ["Борщ"]);
});

test("applySharedToFinishedProductConfig: merges itemsCatalog and remembers sharedCatalog", () => {
  const first = applySharedToFinishedProductConfig({ itemsCatalog: ["Своё"], rows: [] }, ["Борщ", "Плов"]);
  assert.deepEqual(first.itemsCatalog, ["Своё", "Борщ", "Плов"]);
  assert.deepEqual(first.sharedCatalog, ["Борщ", "Плов"]);
  assert.deepEqual(first.rows, []);
  const second = applySharedToFinishedProductConfig(first, ["Плов"]);
  assert.deepEqual(second.itemsCatalog, ["Своё", "Плов"]);
  assert.deepEqual(second.sharedCatalog, ["Плов"]);
});

test("applySharedToPerishableConfig: products, suppliers, manufacturers merged separately", () => {
  const config = {
    productLists: [{ id: "l1", name: "Изделия", items: ["Своё сырьё"] }],
    suppliers: ["Свой поставщик"],
    manufacturers: [],
    showNote: true,
  };
  const first = applySharedToPerishableConfig(config, [
    { name: "Молоко", supplier: "ИП Иванов", manufacturer: "Молокозавод" },
    { name: "Кефир", supplier: "ИП Иванов", manufacturer: null },
  ]);
  assert.deepEqual(first.productLists, [{ id: "l1", name: "Изделия", items: ["Своё сырьё", "Молоко", "Кефир"] }]);
  assert.deepEqual(first.suppliers, ["Свой поставщик", "ИП Иванов"]);
  assert.deepEqual(first.manufacturers, ["Молокозавод"]);
  assert.deepEqual(first.sharedProducts, ["Молоко", "Кефир"]);
  assert.equal(first.showNote, true);

  const second = applySharedToPerishableConfig(first, [{ name: "Кефир", supplier: null, manufacturer: null }]);
  assert.deepEqual((second.productLists as Array<{ items: string[] }>)[0].items, ["Своё сырьё", "Кефир"]);
  assert.deepEqual(second.suppliers, ["Свой поставщик"]);
  assert.deepEqual(second.manufacturers, []);
});

test("applySharedToPerishableConfig: config without product lists gets one", () => {
  const result = applySharedToPerishableConfig({}, [{ name: "Масло", supplier: null, manufacturer: null }]);
  const lists = result.productLists as Array<{ name: string; items: string[] }>;
  assert.equal(lists.length, 1);
  assert.deepEqual(lists[0].items, ["Масло"]);
});
