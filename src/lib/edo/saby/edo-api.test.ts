import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { attachmentIdFor, createSabyEdoApi, draftParams, isDocNotFound, toSabyDate, type SabyDraftInput } from "./edo-api";
import { EdoInputError, type OrgRef } from "./orgs";
import { SabyRpcError } from "./rpc";
import type { SabyCaller } from "./session";

const ours: OrgRef = { kind: "ul", inn: "5018215599", kpp: "501801001", name: "ООО «БФС»" };
const client: OrgRef = { kind: "ul", inn: "7707083893", kpp: "773601001", name: "ПАО Сбербанк" };
const ip: OrgRef = { kind: "ip", inn: "500100732259", lastName: "Петров", firstName: "Пётр", middleName: "", name: "ИП Петров" };

const input = (over: Partial<SabyDraftInput> = {}): SabyDraftInput => ({
  id: "11111111-2222-4333-8444-555555555555",
  type: "ДоговорДок",
  ours,
  recipient: { by: "requisites", org: client },
  number: " 2810-1 ",
  date: "2026-10-28",
  files: [{ name: "Договор.pdf", base64: "JVBERg==" }],
  ...over,
});

/** Подделка вызывателя: отвечает по имени метода, запоминает вызовы. */
function fakeCaller(answers: Record<string, unknown | ((params: unknown) => unknown)>) {
  const calls: Array<{ method: string; params: unknown }> = [];
  const call: SabyCaller = async <T,>(method: string, params: unknown): Promise<T> => {
    calls.push({ method, params });
    const a = answers[method];
    const value = typeof a === "function" ? (a as (p: unknown) => unknown)(params) : a;
    if (value instanceof Error) throw value;
    return value as T;
  };
  return { call, calls };
}

describe("draftParams", () => {
  test("ООО-получатель по реквизитам с названием, наша — без названия; дата ДД.ММ.ГГГГ", () => {
    const p = draftParams(input()) as { Документ: Record<string, unknown> };
    assert.deepEqual(p.Документ.НашаОрганизация, { СвЮЛ: { ИНН: "5018215599", КПП: "501801001" } });
    assert.deepEqual(p.Документ.Контрагент, { СвЮЛ: { ИНН: "7707083893", КПП: "773601001", Название: "ПАО Сбербанк" } });
    assert.equal(p.Документ.Тип, "ДоговорДок");
    assert.equal(p.Документ.Номер, "2810-1");
    assert.equal(p.Документ.Дата, "28.10.2026");
    assert.equal(p.Документ.Идентификатор, "11111111-2222-4333-8444-555555555555");
    const att = p.Документ.Вложение as Array<{ Идентификатор: string; Файл: { Имя: string; ДвоичныеДанные: string } }>;
    assert.equal(att.length, 1);
    assert.deepEqual(att[0].Файл, { Имя: "Договор.pdf", ДвоичныеДанные: "JVBERg==" });
    assert.equal(att[0].Идентификатор, attachmentIdFor("11111111-2222-4333-8444-555555555555"));
  });

  test("ИП — СвФЛ без пустого отчества; по ID участника — только Идентификатор", () => {
    const p1 = draftParams(input({ recipient: { by: "requisites", org: ip } })) as { Документ: Record<string, unknown> };
    assert.deepEqual(p1.Документ.Контрагент, { СвФЛ: { ИНН: "500100732259", Фамилия: "Петров", Имя: "Пётр" } });
    const p2 = draftParams(input({ recipient: { by: "participant", id: "2BM-abc" } })) as { Документ: Record<string, unknown> };
    assert.deepEqual(p2.Документ.Контрагент, { Идентификатор: "2BM-abc" });
  });

  test("ошибки ввода — до вызова Saby", () => {
    assert.throws(() => draftParams(input({ files: [] })), EdoInputError);
    assert.throws(() => draftParams(input({ number: "  " })), EdoInputError);
    assert.throws(() => draftParams(input({ date: "28.10.2026" })), EdoInputError);
    assert.throws(() => draftParams(input({ recipient: { by: "participant", id: " " } })), EdoInputError);
    assert.throws(() => toSabyDate("2026/10/28"), EdoInputError);
  });

  test("id вложения — стабильный UUID v5-вида, не равен id документа, разный по номеру вложения", () => {
    const a = attachmentIdFor("doc-1");
    assert.equal(a, attachmentIdFor("doc-1"));
    assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(a, "doc-1");
    assert.notEqual(attachmentIdFor("doc-1", 1), a);
  });
});

describe("createSabyEdoApi", () => {
  test("writeDraft: ответ без кода и ссылки → дочитывает ПрочитатьДокумент; код по умолчанию «0»", async () => {
    const { call, calls } = fakeCaller({
      "СБИС.ЗаписатьДокумент": { Идентификатор: "X" },
      "СБИС.ПрочитатьДокумент": {
        Идентификатор: "X",
        Состояние: { Код: "0", Название: "Документ редактируется" },
        СсылкаДляНашаОрганизация: "https://online.saby.ru/doc/X",
        Контрагент: { СвЮЛ: { ИНН: "7707083893", Название: "ПАО Сбербанк" } },
      },
    });
    const info = await createSabyEdoApi(call).writeDraft(input());
    assert.deepEqual(info.state, { id: "X", code: "0", label: "Документ редактируется", signUrl: "https://online.saby.ru/doc/X" });
    assert.deepEqual(info.counterparty, { name: "ПАО Сбербанк", inn: "7707083893" });
    assert.deepEqual(calls.map((c) => c.method), ["СБИС.ЗаписатьДокумент", "СБИС.ПрочитатьДокумент"]);
  });

  test("writeDraft: сбой дочитывания не превращается в сбой записи", async () => {
    const { call } = fakeCaller({
      "СБИС.ЗаписатьДокумент": { Документ: { Идентификатор: "X" } },
      "СБИС.ПрочитатьДокумент": new SabyRpcError(503, "http_503", "Saby ответил HTTP 503"),
    });
    const info = await createSabyEdoApi(call).writeDraft(input());
    assert.equal(info.state.code, "0");
    assert.equal(info.state.signUrl, null);
  });

  test("readDraft: «Удален: Да» и «документ не найден» — null; отказ входа — ошибка, а не «нет документа»", async () => {
    assert.equal(await createSabyEdoApi(fakeCaller({ "СБИС.ПрочитатьДокумент": { Удален: "Да", Состояние: { Код: "0" } } }).call).readDraft("X"), null);
    const notFound = new SabyRpcError(200, "{00000000-0000-0000-0000-1fa000010007}", "Ошибка адресации");
    assert.equal(await createSabyEdoApi(fakeCaller({ "СБИС.ПрочитатьДокумент": notFound }).call).readDraft("X"), null);
    const login = new SabyRpcError(400, "app_login_failed", "Приложение не найдено!");
    await assert.rejects(createSabyEdoApi(fakeCaller({ "СБИС.ПрочитатьДокумент": login }).call).readDraft("X"));
  });

  test("readDraft: отклонённый документ с примечанием — код и причина", async () => {
    const { call } = fakeCaller({
      "СБИС.ПрочитатьДокумент": { Документ: [{ Идентификатор: "X", Состояние: { Код: 9, Название: "Отклонён", Примечание: "Не тот договор" } }] },
    });
    const info = await createSabyEdoApi(call).readDraft("X");
    assert.equal(info?.state.code, "9");
    assert.equal(info?.state.label, "Отклонён — Не тот договор");
  });

  test("isDocNotFound: текст про документ — да; «не найден метод/сертификат», транспорт — нет", () => {
    assert.ok(isDocNotFound(new SabyRpcError(200, "-32000", "Документ не найден")));
    assert.equal(isDocNotFound(new SabyRpcError(200, "-32601", "Не найден метод")), false);
    assert.equal(isDocNotFound(new SabyRpcError(404, "http_404", "документ не найден")), false);
    assert.equal(isDocNotFound(new Error("Документ не найден")), false);
  });
});
