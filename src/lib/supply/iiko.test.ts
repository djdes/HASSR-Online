import assert from "node:assert/strict";
import test from "node:test";

import { createIikoClient, IikoError, parseIncomingInvoices, parseProducts, parseSuppliers, parseUnits, parseWriteoffs, sha1, type FetchLike } from "./iiko";
import { buildIikoDirectory, iikoInvoiceToDocument, iikoProductsForDirectory, iikoWriteoffToLosses } from "./iiko-map";
import { assertPublicServerUrl, isPrivateAddress, UnsafeUrlError } from "./safe-url";
import { syncIikoData, type SyncSink } from "./sync";

export const IIKO_INVOICES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<incomingInvoiceDtoes>
  <document>
    <id>inv-1</id>
    <incomingDocumentNumber>МД-1031</incomingDocumentNumber>
    <documentNumber>0045</documentNumber>
    <incomingDate>2026-10-31T00:00:00</incomingDate>
    <dateIncoming>2026-10-31T09:40:00</dateIncoming>
    <status>PROCESSED</status>
    <supplier>sup-1</supplier>
    <items>
      <item><num>1</num><product>p-milk</product><productArticle>00012</productArticle><amount>40.000</amount><amountUnit>u-l</amountUnit><price>78.5</price><sum>3140</sum></item>
      <item><num>2</num><product>p-curd</product><amount>5.5</amount><price>310</price><sum>1705</sum></item>
    </items>
  </document>
  <document>
    <id>inv-2</id>
    <documentNumber>0046</documentNumber>
    <dateIncoming>2026-10-30T18:00:00</dateIncoming>
    <status>DELETED</status>
    <supplier>sup-1</supplier>
    <items><item><num>1</num><product>p-milk</product><amount>1</amount></item></items>
  </document>
</incomingInvoiceDtoes>`;

export const IIKO_SUPPLIERS_XML = `<employees><employee><id>sup-1</id><name>ООО «Молочный двор»</name><taxpayerIdNumber>7701234567</taxpayerIdNumber><supplier>true</supplier></employee></employees>`;

export const IIKO_PRODUCTS = [
  { id: "p-milk", name: "Молоко 3,2%", type: "GOODS", mainUnit: "u-l", deleted: false },
  { id: "p-curd", name: "Творог 9%", type: "GOODS", mainUnit: "u-kg", deleted: false },
  { id: "p-cutlet", name: "Котлеты куриные п/ф", type: "PREPARED", mainUnit: "u-kg", deleted: false },
  { id: "p-soup", name: "Суп гороховый", type: "DISH", mainUnit: "u-pcs", deleted: false },
  { id: "p-old", name: "Старый товар", type: "GOODS", mainUnit: "u-kg", deleted: true },
];

export const IIKO_UNITS = [{ id: "u-l", name: "л" }, { id: "u-kg", name: "кг" }, { id: "u-pcs", name: "шт" }];

export const IIKO_WRITEOFFS = {
  result: "SUCCESS",
  response: [
    { id: "wo-1", documentNumber: "17", dateIncoming: "2026-10-31T21:00", status: "PROCESSED", comment: "Истёк срок годности", items: [
      { productId: "p-milk", amount: 2, measureUnitId: "u-l", cost: 157 },
      { productId: "p-unknown", amount: 1 },
    ] },
    { id: "wo-2", dateIncoming: "2026-10-30T21:00", status: "DELETED", items: [{ productId: "p-curd", amount: 1 }] },
  ],
};

/** Подделка сервера iiko; `fail` — на каком пути ответить ошибкой. */
function fakeIiko(options: { password?: string; fail?: string; licenseBusy?: boolean } = {}) {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    const parsed = new URL(url);
    calls.push(`${parsed.pathname}${parsed.pathname === "/resto/api/auth" ? "" : `?key=${parsed.searchParams.get("key")}`}`);
    if (parsed.pathname === "/resto/api/auth") {
      if (options.licenseBusy) return new Response("License limit reached", { status: 500 });
      if (parsed.searchParams.get("pass") !== sha1(options.password ?? "secret")) return new Response("Wrong", { status: 401 });
      return new Response("session-key-1");
    }
    if (parsed.searchParams.get("key") !== "session-key-1") return new Response("", { status: 401 });
    if (options.fail && parsed.pathname === options.fail) return new Response("boom", { status: 500 });
    switch (parsed.pathname) {
      case "/resto/api/logout":
        return new Response("");
      case "/resto/api/v2/entities/products/list":
        return Response.json(IIKO_PRODUCTS);
      case "/resto/api/v2/entities/list":
        return Response.json(IIKO_UNITS);
      case "/resto/api/suppliers":
        return new Response(IIKO_SUPPLIERS_XML);
      case "/resto/api/documents/export/incomingInvoice":
        return new Response(IIKO_INVOICES_XML);
      case "/resto/api/v2/documents/writeoff":
        return Response.json(IIKO_WRITEOFFS);
      default:
        return new Response("not found", { status: 404 });
    }
  };
  return { calls, fetchImpl };
}

const creds = { serverUrl: "https://cafe.iiko.it", login: "api", password: "secret" };

test("iiko: password goes as sha1, session always logs out — also when work fails", async () => {
  const ok = fakeIiko();
  const client = createIikoClient(creds, { fetch: ok.fetchImpl });
  assert.equal((await client.withSession((s) => s.products())).length, 5);
  assert.deepEqual(ok.calls.at(-1), "/resto/api/logout?key=session-key-1");

  const broken = fakeIiko({ fail: "/resto/api/v2/entities/products/list" });
  await assert.rejects(createIikoClient(creds, { fetch: broken.fetchImpl }).withSession((s) => s.products()), /HTTP 500/);
  assert.equal(broken.calls.at(-1), "/resto/api/logout?key=session-key-1", "выход и после ошибки");
});

test("iiko: wrong password and busy license are clear errors without the password", async () => {
  const wrong = createIikoClient({ ...creds, password: "nope" }, { fetch: fakeIiko().fetchImpl });
  await assert.rejects(wrong.withSession(async () => true), (error: unknown) => {
    assert.ok(error instanceof IikoError);
    assert.equal(error.code, "auth_failed");
    assert.equal(error.message.includes("nope"), false);
    return true;
  });
  const busy = createIikoClient(creds, { fetch: fakeIiko({ licenseBusy: true }).fetchImpl });
  await assert.rejects(busy.withSession(async () => true), (error: unknown) => error instanceof IikoError && error.code === "license");
});

test("iiko parsing: invoices, suppliers, products, units, write-offs in both shapes", () => {
  const invoices = parseIncomingInvoices(IIKO_INVOICES_XML);
  assert.equal(invoices.length, 2);
  assert.deepEqual(invoices[0], {
    id: "inv-1",
    number: "МД-1031",
    date: "2026-10-31",
    supplierId: "sup-1",
    status: "PROCESSED",
    items: [
      { num: 1, productId: "p-milk", article: "00012", amount: 40, unitId: "u-l", price: 78.5, sum: 3140 },
      { num: 2, productId: "p-curd", article: null, amount: 5.5, unitId: null, price: 310, sum: 1705 },
    ],
  });
  assert.equal(invoices[1].number, "0046", "без входящего номера — внутренний");
  assert.deepEqual(parseSuppliers(IIKO_SUPPLIERS_XML), [{ id: "sup-1", name: "ООО «Молочный двор»", inn: "7701234567" }]);
  assert.equal(parseProducts(IIKO_PRODUCTS)[4].deleted, true);
  assert.equal(parseUnits(IIKO_UNITS).get("u-kg"), "кг");
  assert.equal(parseWriteoffs(IIKO_WRITEOFFS).length, 2);
  assert.equal(parseWriteoffs(IIKO_WRITEOFFS.response).length, 2);
  assert.throws(() => parseIncomingInvoices("<<<"), IikoError);
});

test("iiko mapping: invoice like a UPD, write-offs to losses, goods and semi-finished to the directory", () => {
  const dir = buildIikoDirectory(parseProducts(IIKO_PRODUCTS), parseUnits(IIKO_UNITS), parseSuppliers(IIKO_SUPPLIERS_XML));
  const [invoice, deleted] = parseIncomingInvoices(IIKO_INVOICES_XML);
  const doc = iikoInvoiceToDocument(invoice, dir);
  assert.ok(doc);
  assert.equal(doc.kind, "invoice");
  assert.deepEqual(doc.seller, { name: "ООО «Молочный двор»", inn: "7701234567", kpp: null });
  assert.deepEqual(doc.items.map((item) => [item.name, item.unit, item.quantity]), [["Молоко 3,2%", "л", 40], ["Творог 9%", "кг", 5.5]]);
  assert.equal(doc.total, 4845);
  assert.equal(iikoInvoiceToDocument(deleted, dir), null, "удалённая накладная — не поставка");

  const losses = parseWriteoffs(IIKO_WRITEOFFS).flatMap((writeoff) => iikoWriteoffToLosses(writeoff, dir));
  assert.deepEqual(losses, [
    { sourceEntryId: "iiko:wo-1:1", date: "2026-10-31", productName: "Молоко 3,2%", quantity: 2, unit: "л", costRub: 157, cause: "Истёк срок годности" },
  ]);
  assert.deepEqual(iikoProductsForDirectory(dir), [
    { name: "Молоко 3,2%", unit: "л" },
    { name: "Творог 9%", unit: "кг" },
    { name: "Котлеты куриные п/ф", unit: "кг" },
  ]);
});

test("iiko sync: one session, invoices without duplicates, losses once, options respected", async () => {
  const fake = fakeIiko();
  const client = createIikoClient(creds, { fetch: fake.fetchImpl });
  const known = new Set<string>();
  const saved: string[] = [];
  const sink: SyncSink = {
    exists: async (id) => known.has(id),
    save: async ({ externalId, parsed }) => {
      known.add(externalId);
      saved.push(`${externalId}=${parsed.number}`);
      return { created: true };
    },
  };
  const lossIds = new Set<string>();
  const added: string[] = [];
  const run = (options = { invoices: true, writeoffs: true, products: true }) =>
    syncIikoData({
      client,
      fromDate: "2026-10-01",
      toDate: "2026-10-31",
      options,
      sink,
      losses: { exists: async (id) => lossIds.has(id), save: async (loss) => void lossIds.add(loss.sourceEntryId) },
      products: { addMissing: async (items) => (added.push(...items.map((item) => item.name)), items.length) },
    });
  assert.deepEqual(await run(), { created: 1, skipped: 1, failed: 0, losses: 1, products: 3 });
  assert.deepEqual(saved, ["inv-1=МД-1031"]);
  assert.equal(fake.calls.filter((call) => call === "/resto/api/auth").length, 1, "одна сессия на всё");
  assert.deepEqual(await run(), { created: 0, skipped: 2, failed: 0, losses: 0, products: 3 });
  const before = fake.calls.length;
  await run({ invoices: false, writeoffs: false, products: false });
  const third = fake.calls.slice(before);
  assert.equal(third.some((call) => call.startsWith("/resto/api/documents")), false);
  assert.equal(third.some((call) => call.startsWith("/resto/api/v2/documents")), false);
});

test("server address: public hosts only; localhost only outside production", async () => {
  for (const ip of ["10.1.2.3", "127.0.0.1", "192.168.0.10", "172.20.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "::ffff:10.0.0.1", "0.0.0.0"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "185.12.4.10", "2a00:1450:4010:c05::8a"]) assert.equal(isPrivateAddress(ip), false, ip);
  const resolve = async (host: string) => (host === "cafe.iiko.it" ? ["185.12.4.10"] : host === "inside.example" ? ["10.0.0.5"] : []);
  assert.equal(await assertPublicServerUrl("https://cafe.iiko.it:443/resto", { NODE_ENV: "production" }, resolve), "https://cafe.iiko.it");
  assert.equal(await assertPublicServerUrl("http://185.12.4.10:8080", { NODE_ENV: "production" }, resolve), "http://185.12.4.10:8080");
  await assert.rejects(assertPublicServerUrl("http://inside.example:8080", { NODE_ENV: "production" }, resolve), UnsafeUrlError);
  await assert.rejects(assertPublicServerUrl("http://127.0.0.1:4577", { NODE_ENV: "production" }, resolve), UnsafeUrlError);
  assert.equal(await assertPublicServerUrl("http://127.0.0.1:4577", { NODE_ENV: "development" }, resolve), "http://127.0.0.1:4577");
  await assert.rejects(assertPublicServerUrl("ftp://cafe.iiko.it", { NODE_ENV: "production" }, resolve), /https:\/\//);
  await assert.rejects(assertPublicServerUrl("https://user:pass@cafe.iiko.it", { NODE_ENV: "production" }, resolve), /не в адресе/);
  await assert.rejects(assertPublicServerUrl("https://unknown.example", { NODE_ENV: "production" }, resolve), UnsafeUrlError);
});
