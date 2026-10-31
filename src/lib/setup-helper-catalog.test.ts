import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHelperCatalog,
  CATALOG_LIMITS,
  catalogVersion,
  shelfLifeHours,
  type CatalogSource,
} from "./setup-helper-catalog";

const source: CatalogSource = {
  products: [
    { name: "  Молоко   3,2% ", shelfLifeDays: 5, storageTemp: "+2…+6 °C", supplier: "ООО «Агро»" },
    { name: "молоко 3,2%", shelfLifeDays: 7, storageTemp: null, supplier: null },
    { name: "Филе куриное", shelfLifeDays: null, storageTemp: null, supplier: "ИП Петров" },
    { name: "   ", shelfLifeDays: 1, storageTemp: null, supplier: null },
    { name: "Ошибка срока", shelfLifeDays: 100000, storageTemp: "", supplier: "" },
  ],
  documents: [
    {
      code: "finished_product",
      config: {
        itemsCatalog: ["Суп гороховый", "Каша овсяная", 42],
        productLists: [{ id: "l1", name: "Изделия", items: ["каша овсяная", "Компот"] }],
        rows: [{ productName: "не из справочника" }],
      },
    },
    {
      code: "perishable_rejection",
      config: {
        productLists: [{ id: "p1", name: "Продукты", items: ["Сметана 20%", "Филе куриное"] }],
        suppliers: ["ИП Петров", "ООО «Молоко»"],
      },
    },
    { code: "hygiene", config: { itemsCatalog: ["не блюдо"] } },
  ],
  staff: [{ name: "Петрова Анна" }, { name: "Иванова Мария" }, { name: "петрова анна" }, { name: "" }],
};

test("products merge the directory with perishable lists without duplicates, shelf life in hours", () => {
  const catalog = buildHelperCatalog(source);
  assert.deepEqual(catalog.products, [
    { name: "Молоко 3,2%", shelfLifeHours: 120, storage: "+2…+6 °C", supplier: "ООО «Агро»" },
    { name: "Ошибка срока", shelfLifeHours: null, storage: null, supplier: null },
    { name: "Сметана 20%", shelfLifeHours: null, storage: null, supplier: null },
    { name: "Филе куриное", shelfLifeHours: null, storage: null, supplier: "ИП Петров" },
  ]);
});

test("dishes come from the brakerage journal lists, suppliers and staff are unique and sorted", () => {
  const catalog = buildHelperCatalog(source);
  assert.deepEqual(catalog.dishes, ["Каша овсяная", "Компот", "Суп гороховый"]);
  assert.deepEqual(catalog.suppliers, ["ИП Петров", "ООО «Агро»", "ООО «Молоко»"]);
  assert.deepEqual(catalog.staff, ["Иванова Мария", "Петрова Анна"]);
});

test("version changes with the content and only with it", () => {
  const a = buildHelperCatalog(source);
  const b = buildHelperCatalog(source);
  assert.equal(a.version, b.version);
  assert.match(a.version, /^[0-9a-f]{16}$/);
  const { version, ...content } = a;
  assert.equal(catalogVersion(content), version);
  const renamed = buildHelperCatalog({ ...source, staff: [{ name: "Сидорова Ольга" }] });
  assert.notEqual(renamed.version, a.version);
});

test("shelf life accepts only sane day counts", () => {
  assert.equal(shelfLifeHours(1), 24);
  assert.equal(shelfLifeHours(0.5), 12);
  assert.equal(shelfLifeHours(0), null);
  assert.equal(shelfLifeHours(null), null);
  assert.equal(shelfLifeHours(731), null);
});

test("lists are capped so a huge directory cannot bloat the phone copy", () => {
  const many = Array.from({ length: CATALOG_LIMITS.staff + 50 }, (_, i) => ({ name: `Сотрудник ${i}` }));
  const catalog = buildHelperCatalog({ products: [], documents: [], staff: many });
  assert.equal(catalog.staff.length, CATALOG_LIMITS.staff);
  assert.equal(catalog.staff[0], "Сотрудник 0");
  const long = buildHelperCatalog({
    products: [{ name: "П".repeat(200), shelfLifeDays: null, storageTemp: "Т".repeat(100), supplier: null }],
    documents: [],
    staff: [],
  });
  assert.equal(long.products[0].name.length, 80);
  assert.equal(long.products[0].storage?.length, 30);
});
