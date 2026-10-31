import assert from "node:assert/strict";
import test from "node:test";

import { createDiadocClient, DiadocError, isUpdDocument, type FetchLike } from "./diadoc";
import { createSabyIncomingApi, isAllowedSabyFileUrl, pickUpdAttachment } from "./saby-incoming";
import { syncDiadocDocuments, syncSabyDocuments, type SyncSink } from "./sync";
import { toCp1251, UPD_501, UPD_503 } from "./upd-fixtures";

type Call = { url: string; init: RequestInit };

/** Подделка Диадока: вход, ящики, две страницы входящих, файлы. */
function fakeDiadoc(options: { password?: string; expireFirstToken?: boolean } = {}) {
  const calls: Call[] = [];
  let issued = 0;
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const path = url.replace("https://diadoc-api.kontur.ru", "");
    const auth = String((init.headers as Record<string, string>).Authorization ?? "");
    if (path.startsWith("/V3/Authenticate")) {
      const body = JSON.parse(String(init.body));
      if (body.password !== (options.password ?? "secret")) return new Response("Unauthorized", { status: 401 });
      issued += 1;
      return new Response(`token-${issued}`, { status: 200 });
    }
    if (options.expireFirstToken && auth.includes("ddauth_token=token-1")) return new Response("", { status: 401 });
    if (path === "/GetMyOrganizations") {
      return Response.json({
        Organizations: [
          { FullName: "МБОУ СОШ № 8", Inn: "5001234567", Boxes: [{ BoxId: "box-1@diadoc.ru", Title: "Основной" }] },
        ],
      });
    }
    if (path.startsWith("/V3/GetDocuments")) {
      const query = new URL(url).searchParams;
      assert.equal(query.get("filterCategory"), "Any.Inbound");
      assert.equal(query.get("fromDocumentDate"), "01.10.2026");
      if (!query.get("afterIndexKey")) {
        return Response.json({
          HasMoreResults: true,
          Documents: [
            { MessageId: "m1", EntityId: "e1", TypeNamedId: "UniversalTransferDocument", DocumentNumber: "МД-1031", DocumentDate: "31.10.2026", FileName: "ON_NSCHFDOPPR_1.xml", IndexKey: "k1" },
            { MessageId: "m2", EntityId: "e2", TypeNamedId: "Nonformalized", FileName: "Договор.pdf", IndexKey: "k2" },
          ],
        });
      }
      assert.equal(query.get("afterIndexKey"), "k2");
      return Response.json({
        HasMoreResults: false,
        Documents: [
          { MessageId: "m3", EntityId: "e3", TypeNamedId: "UniversalTransferDocument", FileName: "ON_NSCHFDOPPR_2.xml", IndexKey: "k3" },
          { MessageId: "m4", EntityId: "e4", TypeNamedId: "UniversalTransferDocument", FileName: "ON_NSCHFDOPPR_3.xml", IndexKey: "k4" },
        ],
      });
    }
    if (path.startsWith("/V4/GetEntityContent")) {
      const entity = new URL(url).searchParams.get("entityId");
      if (entity === "e1") return new Response(Buffer.from(toCp1251(UPD_501)));
      if (entity === "e3") return new Response(Buffer.from(UPD_503, "utf-8"));
      return new Response("<html>не УПД</html>");
    }
    return new Response("not found", { status: 404 });
  };
  return { calls, fetchImpl };
}

function memorySink(existing: string[] = []): SyncSink & { saved: string[] } {
  const known = new Set(existing);
  const saved: string[] = [];
  return {
    saved,
    async exists(id) {
      return known.has(id);
    },
    async save({ externalId, parsed }) {
      known.add(externalId);
      saved.push(`${externalId}=${parsed.number}`);
      return { created: true };
    },
  };
}

const creds = { apiClientId: "dev-key", login: "chef@school.ru", password: "secret" };

test("Diadoc: login header, boxes, paging, UPD only, broken file counted, existing skipped", async () => {
  const fake = fakeDiadoc();
  const client = createDiadocClient(creds, { fetch: fake.fetchImpl });
  assert.deepEqual(await client.listBoxes(), [{ boxId: "box-1@diadoc.ru", title: "Основной", orgName: "МБОУ СОШ № 8", inn: "5001234567" }]);
  const auth = fake.calls[0];
  assert.equal((auth.init.headers as Record<string, string>).Authorization, "DiadocAuth ddauth_api_client_id=dev-key");
  assert.equal((fake.calls[1].init.headers as Record<string, string>).Authorization, "DiadocAuth ddauth_api_client_id=dev-key,ddauth_token=token-1");

  const sink = memorySink(["m4:e4"]);
  const counters = await syncDiadocDocuments({ client, boxId: "box-1@diadoc.ru", fromDate: "2026-10-01", sink });
  assert.deepEqual(sink.saved, ["m1:e1=МД-1031", "m3:e3=17"]);
  assert.deepEqual(counters, { created: 2, skipped: 1, failed: 0 });
  // Договор-PDF не скачивается вовсе.
  assert.equal(fake.calls.some((call) => call.url.includes("entityId=e2")), false);
});

test("Diadoc: wrong password is a clear auth error without secrets; expired token re-logs in once", async () => {
  const wrong = createDiadocClient({ ...creds, password: "nope" }, { fetch: fakeDiadoc().fetchImpl });
  await assert.rejects(wrong.listBoxes(), (error: unknown) => {
    assert.ok(error instanceof DiadocError);
    assert.equal(error.code, "auth_failed");
    assert.equal(error.message.includes("nope"), false);
    return true;
  });
  const fake = fakeDiadoc({ expireFirstToken: true });
  const client = createDiadocClient(creds, { fetch: fake.fetchImpl });
  assert.equal((await client.listBoxes()).length, 1);
  assert.equal(fake.calls.filter((call) => call.url.includes("/V3/Authenticate")).length, 2);
});

test("Diadoc: UPD recognised by type or by FNS file name", () => {
  const base = { messageId: "m", entityId: "e", number: null, date: null, indexKey: null };
  assert.equal(isUpdDocument({ ...base, typeNamedId: "UniversalTransferDocument", fileName: null }), true);
  assert.equal(isUpdDocument({ ...base, typeNamedId: null, fileName: "ON_NSCHFDOPPR_x.xml" }), true);
  assert.equal(isUpdDocument({ ...base, typeNamedId: "Invoice", fileName: "Счёт.pdf" }), false);
});

test("Saby: incoming sale documents by period, attachments read when missing, UPD picked, others skipped", async () => {
  const calls: Array<{ method: string; params: unknown }> = [];
  const api = createSabyIncomingApi(async <T,>(method: string, params: unknown): Promise<T> => {
    calls.push({ method, params });
    if (method === "СБИС.СписокДокументов") {
      return {
        Документ: [
          { Идентификатор: "d1", Номер: "17", Дата: "30.10.2026", Вложение: [
            { Название: "Извещение", Служебный: "Да", Файл: { Имя: "DP_IZVPOL.xml", Ссылка: "https://online.sbis.ru/f/izv" } },
            { Тип: "УпдДоп", Служебный: "Нет", Файл: { Имя: "ON_NSCHFDOPPR_17.xml", Ссылка: "https://online.sbis.ru/f/upd17" } },
          ] },
          { Идентификатор: "d2", Номер: "А-5", Дата: "29.10.2026" },
          { Идентификатор: "d3", Номер: "3", Дата: "28.10.2026" },
        ],
        Навигация: { ЕстьЕще: "Нет" },
      } as T;
    }
    if (method === "СБИС.ПрочитатьДокумент") {
      const id = (params as { Документ: { Идентификатор: string } }).Документ.Идентификатор;
      return (id === "d2"
        ? { Идентификатор: "d2", Вложение: [{ Тип: "Акт", Служебный: "Нет", Файл: { Имя: "Акт.pdf", Ссылка: "https://online.sbis.ru/f/act" } }] }
        : { Идентификатор: "d3", Вложение: [] }) as T;
    }
    throw new Error(`unexpected ${method}`);
  });
  const downloads: string[] = [];
  const sink = memorySink();
  const counters = await syncSabyDocuments({
    api,
    download: async (url) => {
      downloads.push(url);
      return new TextEncoder().encode(UPD_503);
    },
    fromDate: "2026-10-01",
    toDate: "2026-10-31",
    sink,
  });
  assert.deepEqual(calls[0], {
    method: "СБИС.СписокДокументов",
    params: { Фильтр: { Тип: "ДокОтгрВх", ДатаС: "01.10.2026", ДатаПо: "31.10.2026", Навигация: { РазмерСтраницы: "50", Страница: "0" } } },
  });
  assert.deepEqual(downloads, ["https://online.sbis.ru/f/upd17"]);
  assert.deepEqual(sink.saved, ["d1=17"]);
  assert.deepEqual(counters, { created: 1, skipped: 2, failed: 0 });
});

test("Saby: files only from Saby domains; service attachments are never the UPD", () => {
  assert.equal(isAllowedSabyFileUrl("https://online.sbis.ru/file/1", "production"), true);
  assert.equal(isAllowedSabyFileUrl("https://disk.saby.ru/file/1", "production"), true);
  assert.equal(isAllowedSabyFileUrl("https://evil.example/sbis.ru", "production"), false);
  assert.equal(isAllowedSabyFileUrl("http://online.sbis.ru/file", "production"), false);
  assert.equal(isAllowedSabyFileUrl("http://127.0.0.1:4555/file", "production"), false);
  assert.equal(isAllowedSabyFileUrl("http://127.0.0.1:4555/file", "development"), true);
  assert.equal(
    pickUpdAttachment([{ name: "ON_NSCHFDOPPR_1.xml", url: "https://online.sbis.ru/x", type: null, service: true }]),
    null,
  );
});

test("Diadoc address: a local stub only outside production", async () => {
  const { diadocBaseUrl } = await import("./connections");
  assert.equal(diadocBaseUrl({ NODE_ENV: "development", DIADOC_API_URL: "http://127.0.0.1:4566" }), "http://127.0.0.1:4566");
  assert.equal(diadocBaseUrl({ NODE_ENV: "production", DIADOC_API_URL: "http://127.0.0.1:4566" }), "https://diadoc-api.kontur.ru");
  assert.equal(diadocBaseUrl({ NODE_ENV: "development", DIADOC_API_URL: "https://evil.example" }), "https://diadoc-api.kontur.ru");
  assert.equal(diadocBaseUrl({}), "https://diadoc-api.kontur.ru");
});

