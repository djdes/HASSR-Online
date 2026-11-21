import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { loadMessages } from "@/i18n/messages";
import { appendSuggestionValues, NAME_SUGGESTION_LIMIT } from "@/lib/name-suggestions";

import { connectionView, posterCredentialsSchema, SUPPLY_PROVIDERS } from "./connections";
import {
  createPosterClient,
  parseProducts,
  parseSupplies,
  parseSupplyItems,
  parseWaste,
  posterAccountNumber,
  posterDate,
  PosterError,
  type FetchLike,
} from "./poster";
import { buildPosterDirectory, posterProductsForDirectory, posterSupplyToDocument, posterWasteToLosses } from "./poster-map";
import { MAX_POSTER_DOCUMENTS_PER_SYNC, syncPosterData, type SyncSink } from "./sync";
import { supplyAccompanyingDocs } from "./to-acceptance-row";

/**
 * Poster (спека pos-menu-poster-2026-11-21). Ответы — по примерам из
 * документации Poster (`raw/poster-docs/`), суммы — в копейках.
 */

const TOKEN = "687409:4164553abf6a031302898da7800b59fb";

const SUPPLIES = {
  response: [
    { supply_id: "48", storage_id: "1", supplier_id: "1", date: "2026-11-20 08:09:33", supply_sum: "1800", supply_comment: "", storage_name: "Кухня", supplier_name: "ООО «Овощебаза»", delete: "1", account_id: null },
    { supply_id: "47", storage_id: "1", supplier_id: "1", date: "2026-11-19 09:11:00", supply_sum: "300000", supply_comment: "", storage_name: "Кухня", supplier_name: "ООО «Овощебаза»", delete: "0", account_id: null },
    { supply_id: "46", storage_id: "2", supplier_id: "2", date: "2026-11-18 09:07:00", supply_sum: "16100", supply_comment: "", storage_name: "Бар", supplier_name: "Чай-опт", delete: "0", account_id: null },
  ],
};
const SUPPLY_47_ITEMS = {
  response: [
    { ingredient_id: "66", supply_ingredient_num: "3.00000", supply_ingredient_sum: "15000", ingredient_name: "Рыба", ingredient_unit: "kg", tax_id: 0 },
    { ingredient_id: "76", supply_ingredient_num: "30.00000", supply_ingredient_sum: "390", ingredient_name: "Яйца", ingredient_unit: "p", tax_id: 0 },
  ],
};
const SUPPLY_46_ITEMS = {
  response: [{ ingredient_id: "69", supply_ingredient_num: "1400.00000", supply_ingredient_sum: "16100", ingredient_name: "Чай", ingredient_unit: "p", tax_id: 0 }],
};
const SUPPLIERS = {
  response: [
    { supplier_id: "1", supplier_name: "ООО «Овощебаза»", supplier_phone: "", supplier_adress: "", supplier_comment: "", supplier_code: "", supplier_tin: "7701234567", delete: "0" },
    { supplier_id: "2", supplier_name: "Чай-опт", supplier_tin: "", delete: "0" },
  ],
};
const WASTES = {
  response: [
    { waste_id: 1, total_sum: 2800, user_id: 1, storage_id: 1, date: "2026-11-19 14:30:02", reason_id: 1, reason_name: "Истёк срок годности", delete: 0 },
    { waste_id: 2, total_sum: 791, user_id: 1, storage_id: 1, date: "2026-11-19 15:21:12", reason_id: 1, reason_name: "Испорчено", delete: 1 },
  ],
};
const WASTE_1 = {
  response: {
    waste_id: 1,
    total_sum: 2800,
    user_id: 1,
    storage_id: 1,
    date: "2026-11-19 14:30:02",
    reason_id: 1,
    reason_name: "Истёк срок годности",
    elements: [
      { type: 2, product_id: 30, count: 2, ingredients: [
        { write_off_id: 121, ingredient_id: 16, product_id: 30, modificator_id: 0, prepack_id: 0, weight: 0.3, unit: "kg", cost: 500 },
        { write_off_id: 122, ingredient_id: 15, product_id: 30, modificator_id: 0, prepack_id: 0, weight: 0.1, unit: "kg", cost: 1500 },
      ] },
      { type: 10, product_id: 0, count: 1, ingredients: [
        { write_off_id: 123, ingredient_id: 73, product_id: 0, modificator_id: 0, prepack_id: 0, weight: 1.5, unit: "kg", cost: 800 },
      ] },
      { type: 2, product_id: 999, count: 1, ingredients: [] },
    ],
  },
};
const PRODUCTS = {
  response: [
    { product_id: "139", product_name: "Боржоми", type: "3", unit: "", hidden: "0", category_name: "Вода" },
    { product_id: "30", product_name: "Борщ", type: "2", unit: "", hidden: "0", category_name: "Супы" },
    { product_id: "167", product_name: "Куриный бульон", type: "1", unit: "kg", hidden: "0" },
    { product_id: "31", product_name: "Старое блюдо", type: "2", unit: "", hidden: "1" },
  ],
};
const INGREDIENTS = {
  response: [
    { ingredient_id: "73", ingredient_name: "Авокадо", ingredient_unit: "kg", ingredients_type: "1" },
    { ingredient_id: "16", ingredient_name: "Свёкла", ingredient_unit: "kg" },
    { ingredient_id: "15", ingredient_name: "Говядина", ingredient_unit: "kg" },
    { ingredient_id: "91", ingredient_name: "борщ", ingredient_unit: "l" },
  ],
};
const STORAGES = { response: [{ storage_id: "1", storage_name: "Кухня", storage_adress: "", delete: "0" }, { storage_id: "2", storage_name: "Бар", delete: "0" }] };

function fakePoster(overrides: Record<string, unknown> = {}) {
  const calls: Array<{ method: string; params: Record<string, string> }> = [];
  const responses: Record<string, unknown> = {
    "storage.getSupplies": SUPPLIES,
    "storage.getSuppliers": SUPPLIERS,
    "storage.getWastes": WASTES,
    "storage.getWaste": WASTE_1,
    "menu.getProducts": PRODUCTS,
    "menu.getIngredients": INGREDIENTS,
    "storage.getStorages": STORAGES,
    ...overrides,
  };
  const fetchImpl: FetchLike = async (url) => {
    const parsed = new URL(url);
    const method = parsed.pathname.split("/").pop() ?? "";
    const params = Object.fromEntries(parsed.searchParams.entries());
    calls.push({ method, params });
    const body =
      method === "storage.getSupplyIngredients" ? (params.supply_id === "47" ? SUPPLY_47_ITEMS : SUPPLY_46_ITEMS) : responses[method];
    if (body instanceof Error) throw body;
    return new Response(JSON.stringify(body ?? { error: { code: 42, message: "The variable does not exist" } }), { status: 200 });
  };
  return { calls, fetchImpl };
}

test("AC3: адрес, токен и формат запроса — по документации; даты — Ymd", async () => {
  const fake = fakePoster();
  const client = createPosterClient({ token: TOKEN }, { fetch: fake.fetchImpl });
  await client.supplies("2026-11-01", "2026-11-21");
  await client.storages();
  assert.deepEqual(fake.calls[0], {
    method: "storage.getSupplies",
    params: { token: TOKEN, format: "json", dateFrom: "20261101", dateTo: "20261121" },
  });
  assert.equal(fake.calls[1].method, "storage.getStorages");
  assert.equal(posterDate("2026-01-05"), "20260105");
  assert.throws(() => posterDate("05.01.2026"), PosterError);
  assert.equal(posterAccountNumber(TOKEN), "687409");
  assert.equal(posterAccountNumber("bad"), null);
});

test("AC3: разбор поставок, строк (копейки → рубли), списаний, меню, ингредиентов", () => {
  assert.deepEqual(parseSupplies(SUPPLIES.response).map((s) => [s.id, s.date, s.storageId, s.deleted]), [
    ["48", "2026-11-20", "1", true],
    ["47", "2026-11-19", "1", false],
    ["46", "2026-11-18", "2", false],
  ]);
  assert.deepEqual(parseSupplyItems(SUPPLY_47_ITEMS.response), [
    { ingredientId: "66", name: "Рыба", amount: 3, unit: "kg", sumRub: 150 },
    { ingredientId: "76", name: "Яйца", amount: 30, unit: "p", sumRub: 3.9 },
  ]);
  const waste = parseWaste(WASTE_1.response);
  assert.equal(waste.reason, "Истёк срок годности");
  assert.deepEqual(waste.elements[1], { type: 10, productId: "0", count: 1, ingredients: [{ ingredientId: "73", weight: 1.5, unit: "kg", costRub: 8 }] });
  assert.deepEqual(parseProducts(PRODUCTS.response).map((p) => [p.name, p.type, p.hidden]), [
    ["Боржоми", "product", false],
    ["Борщ", "dish", false],
    ["Куриный бульон", "semi", false],
    ["Старое блюдо", "dish", true],
  ]);
  assert.throws(() => parseWaste({ elements: [] }), PosterError);
});

test("AC3: ошибки токена, частоты и сети — понятным текстом и без токена", async () => {
  const cases: Array<[unknown, RegExp, string]> = [
    [{ error: { code: 11, message: "Bad access token" } }, /не принял токен/, "auth_failed"],
    [{ error: { code: 12, message: "expired" } }, /истёк/, "auth_failed"],
    [{ error: { code: 700, message: "Rate restriction" } }, /частоту/, "rate_limit"],
    [{ error: { code: 54, message: "Access denied" } }, /нет доступа/, "no_access"],
    [{ error: 11 }, /не принял токен/, "auth_failed"],
    [{ unexpected: true }, /без данных/, "bad_response"],
  ];
  for (const [body, message, code] of cases) {
    const client = createPosterClient({ token: TOKEN }, { fetch: async () => new Response(JSON.stringify(body), { status: 200 }) });
    await assert.rejects(client.storages(), (error: unknown) => {
      assert.ok(error instanceof PosterError);
      assert.equal(error.code, code);
      assert.match(error.message, message);
      assert.ok(!error.message.includes(TOKEN.split(":")[1]), "токен не в тексте ошибки");
      return true;
    });
  }
  const network = createPosterClient({ token: TOKEN }, { fetch: async (url) => { throw new Error(`connect ECONNREFUSED ${url}`); } });
  await assert.rejects(network.storages(), (error: unknown) => {
    assert.ok(error instanceof PosterError && error.code === "network");
    assert.ok(!error.message.includes(TOKEN.split(":")[1]), "адрес с токеном не в тексте ошибки");
    return true;
  });
  const http = createPosterClient({ token: TOKEN }, { fetch: async () => new Response("oops", { status: 502 }) });
  await assert.rejects(http.storages(), /HTTP 502/);
  const slow = createPosterClient({ token: TOKEN }, {
    timeoutMs: 5,
    fetch: (_url, init) => new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
  });
  await assert.rejects(slow.storages(), (error: unknown) => error instanceof PosterError && error.code === "timeout");
});

test("AC4: поставка → накладная «Входящих»; списание → строки потерь; меню → справочник с видами", () => {
  const dir = buildPosterDirectory(parseProducts(PRODUCTS.response), [
    { id: "73", name: "Авокадо", unit: "kg" },
    { id: "16", name: "Свёкла", unit: "kg" },
  ], [{ id: "1", name: "ООО «Овощебаза»", inn: "7701234567", deleted: false }]);
  const [, supply47] = parseSupplies(SUPPLIES.response);
  const doc = posterSupplyToDocument(supply47, parseSupplyItems(SUPPLY_47_ITEMS.response), dir.suppliers.get("1"));
  assert.ok(doc);
  assert.equal(doc.kind, "invoice");
  assert.equal(doc.number, "47");
  assert.equal(doc.date, "2026-11-19");
  assert.deepEqual(doc.seller, { name: "ООО «Овощебаза»", inn: "7701234567", kpp: null });
  assert.deepEqual(doc.items.map((item) => [item.name, item.quantity, item.unit, item.price, item.amount]), [
    ["Рыба", 3, "кг", 50, 150],
    ["Яйца", 30, "шт", 0.13, 3.9],
  ]);
  assert.equal(doc.total, 153.9);
  assert.equal(posterSupplyToDocument({ ...supply47, deleted: true }, parseSupplyItems(SUPPLY_47_ITEMS.response), null), null, "удалённая — не поставка");
  assert.equal(posterSupplyToDocument(supply47, [], null), null, "без строк — не поставка");
  assert.equal(
    supplyAccompanyingDocs({ id: "d", source: "poster", number: "47", date: "2026-11-19", seller: doc.seller, basis: null, shippedDate: null }),
    "Поставка № 47 от 19.11.2026 (Poster)",
  );

  assert.deepEqual(posterWasteToLosses(parseWaste(WASTE_1.response), dir), [
    { sourceEntryId: "poster:1:1", date: "2026-11-19", productName: "Борщ", quantity: 2, unit: "шт", costRub: 20, cause: "Истёк срок годности" },
    { sourceEntryId: "poster:1:2", date: "2026-11-19", productName: "Авокадо", quantity: 1.5, unit: "кг", costRub: 8, cause: "Истёк срок годности" },
  ], "позиция без названия в справочнике пропущена");

  assert.deepEqual(posterProductsForDirectory(parseProducts(PRODUCTS.response), INGREDIENTS.response.map((row) => ({ id: row.ingredient_id, name: row.ingredient_name, unit: row.ingredient_unit }))), [
    { name: "Боржоми", unit: null, kind: "raw" },
    { name: "Борщ", unit: "шт", kind: "finished" },
    { name: "Куриный бульон", unit: "кг", kind: "semi" },
    { name: "Авокадо", unit: "кг", kind: "raw" },
    { name: "Свёкла", unit: "кг", kind: "raw" },
    { name: "Говядина", unit: "кг", kind: "raw" },
  ], "скрытое блюдо не берём, ингредиент «борщ» повторяет блюдо — без повтора");
});

test("AC4: загрузка — без повторов, удалённые и «не загружать» пропускаются, справочник с видами", async () => {
  const fake = fakePoster();
  const client = createPosterClient({ token: TOKEN }, { fetch: fake.fetchImpl });
  const known = new Set<string>();
  const saved: Array<{ id: string; building: string | null | undefined }> = [];
  const sink: SyncSink = {
    exists: async (id) => known.has(id),
    save: async ({ externalId, buildingId }) => {
      known.add(externalId);
      saved.push({ id: externalId, building: buildingId });
      return { created: true };
    },
  };
  const lossIds = new Set<string>();
  const added: Array<{ name: string; kind?: string }> = [];
  const run = (options = { invoices: true, writeoffs: true, products: true }) =>
    syncPosterData({
      client,
      fromDate: "2026-11-01",
      toDate: "2026-11-21",
      options,
      sink,
      losses: { exists: async (id) => lossIds.has(id), save: async (loss) => void lossIds.add(loss.sourceEntryId) },
      products: { addMissing: async (items) => (added.push(...items), items.length) },
      // Склад 2 (бар) — «не загружать», склад 1 — точка «b-kitchen».
      storeDecision: (storeId) => (storeId === "2" ? { skip: true, buildingId: null } : { skip: false, buildingId: storeId === "1" ? "b-kitchen" : null }),
    });
  assert.deepEqual(await run(), { created: 1, skipped: 2, failed: 0, losses: 2, products: 6 });
  assert.deepEqual(saved, [{ id: "47", building: "b-kitchen" }], "удалённая 48 и склад «не загружать» пропущены");
  assert.deepEqual([...lossIds].sort(), ["poster:1:1", "poster:1:2"], "удалённое списание 2 пропущено");
  assert.ok(added.some((item) => item.name === "Борщ" && item.kind === "finished"), "блюдо — готовая продукция");

  const before = fake.calls.length;
  assert.deepEqual(await run(), { created: 0, skipped: 3, failed: 0, losses: 0, products: 6 });
  const second = fake.calls.slice(before).map((call) => call.method);
  assert.ok(!second.includes("storage.getSupplyIngredients"), "загруженную поставку повторно не запрашиваем");
  assert.ok(!second.includes("storage.getWaste"), "загруженное списание повторно не запрашиваем");

  const third = fake.calls.length;
  await run({ invoices: false, writeoffs: false, products: false });
  assert.deepEqual(fake.calls.slice(third), [], "всё выключено — ни одного запроса");
  assert.equal(MAX_POSTER_DOCUMENTS_PER_SYNC, 100);
});

test("AC4: ошибка Poster посреди загрузки прерывает её понятной причиной", async () => {
  const fake = fakePoster({ "storage.getSupplies": { error: { code: 700, message: "Rate restriction" } } });
  const sink: SyncSink = { exists: async () => false, save: async () => ({ created: true }) };
  await assert.rejects(
    syncPosterData({
      client: createPosterClient({ token: TOKEN }, { fetch: fake.fetchImpl }),
      fromDate: "2026-11-01",
      toDate: "2026-11-21",
      options: { invoices: true, writeoffs: false, products: false },
      sink,
      losses: { exists: async () => false, save: async () => undefined },
      products: { addMissing: async () => 0 },
    }),
    /частоту/,
  );
});

test("AC2: подсказки блюд — своя память, затем справочник, без повторов и в пределах лимита", () => {
  const values = ["Борщ", "Солянка"];
  appendSuggestionValues(values, ["борщ", "  Плов  ", "", "Солянка ", "Окрошка"], 4);
  assert.deepEqual(values, ["Борщ", "Солянка", "Плов", "Окрошка"]);
  const full = Array.from({ length: NAME_SUGGESTION_LIMIT * 2 }, (_, index) => `Блюдо ${index}`);
  assert.equal(appendSuggestionValues(full, ["Новое"], NAME_SUGGESTION_LIMIT * 2).length, NAME_SUGGESTION_LIMIT * 2, "лимит не превышаем");
  const db = readFileSync(new URL("../name-suggestions-db.ts", import.meta.url), "utf8");
  const ownIndex = db.indexOf("const values = rows.map((row) => row.value);");
  const directoryIndex = db.indexOf('where: { organizationId, isActive: true, kind: "finished" }');
  const poolIndex = db.indexOf("resolveDishSuggestionOrgIds(organizationId)");
  assert.ok(ownIndex >= 0 && ownIndex < directoryIndex && directoryIndex < poolIndex, "свои → справочник → пул");
});

test("AC5: подключение Poster — провайдер, схема токена, маска, все места источника", async () => {
  assert.ok((SUPPLY_PROVIDERS as readonly string[]).includes("poster"));
  assert.equal(posterCredentialsSchema.safeParse({ token: ` ${TOKEN} ` }).success, true);
  for (const bad of ["", "abc", "687409", "687409:", "x:4164553abf6a031302898da7800b59fb"]) {
    assert.equal(posterCredentialsSchema.safeParse({ token: bad }).success, false, bad);
  }
  const view = connectionView("poster", { token: TOKEN }, { boxTitle: null, status: "active", lastSyncAt: null, lastError: null });
  assert.equal(view.account, "Poster № 687409");
  assert.ok(!view.account.includes("4164553abf"), "токен не показываем");

  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  const settingsRoute = read("../../app/api/settings/supply/[provider]/route.ts");
  assert.match(settingsRoute, /provider === "poster"[\s\S]*posterCredentialsSchema\.safeParse\(body\)[\s\S]*createPosterClient\(parsed\.data\)\.storages\(\)/);
  const syncServer = read("./sync.server.ts");
  assert.match(syncServer, /provider === "poster"[\s\S]*syncPosterData\(/);
  assert.match(read("../../app/api/settings/supply/[provider]/stores/route.ts"), /STORE_PROVIDERS = new Set\(\["iiko", "poster"\]\)/);
  assert.match(read("../../app/(dashboard)/edo/page.tsx"), /source === "poster"/);
  assert.match(read("../../app/(dashboard)/edo/[id]/page.tsx"), /doc\.source === "poster" \? "supplyTitle"/);
  assert.match(read("../../app/(dashboard)/losses/page.tsx"), /sourceEntryId\?\.startsWith\("poster:"\)/);
  assert.match(read("../../app/api/edo/sync/route.ts"), /result\.provider === "iiko" \|\| result\.provider === "poster"/);
  assert.match(read("../settings-cards.ts"), /id: "settings_integrations_poster", href: "\/settings\/integrations\/poster"/);
  assert.match(read("../route-titles.ts"), /"\/settings\/integrations\/poster": "settings_integrations_poster"/);

  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const poster = messages.supplyEdo.poster;
    for (const key of ["title", "description", "hint", "token", "tokenHint", "connect", "sync", "synced", "secretsNote", "limitNote"] as const) {
      assert.ok(poster[key].trim(), `${locale}: poster.${key}`);
    }
    for (const key of ["invoices", "writeoffs", "products"] as const) assert.ok(poster.options[key].trim(), `${locale}: options.${key}`);
    for (const key of ["title", "hint", "load", "save", "skip", "none"] as const) assert.ok(poster.stores[key].trim(), `${locale}: stores.${key}`);
    assert.equal(messages.supplyEdo.page.source.poster, "Poster");
    assert.ok(messages.supplyEdo.page.supplyNumber.includes("{number}"));
    assert.ok(messages.supplyEdo.document.supplyTitle.includes("{date}"));
    assert.ok(messages.productionLosses.fromPoster.trim());
    assert.ok(messages.settingsManagement.home.cards.settings_integrations_poster.description.trim());
    assert.equal(messages.navigation.routes.settings_integrations_poster, "Poster");
  }
});

test("AC5: документация — Poster и почему без r_keeper", () => {
  const doc = readFileSync(new URL("../../../docs/pos-integrations.md", import.meta.url), "utf8");
  assert.match(doc, /## Poster/);
  assert.match(doc, /Доступ → Интеграции → Личная интеграция/);
  assert.match(doc, /## r_keeper/);
});
