import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  checkCounterpartyEdo,
  counterpartyInfoParams,
  normalizeParticipantId,
  operatorCodeFromParticipantId,
  operatorLabel,
  parseCounterpartyInfo,
} from "./counterparty";
import type { OrgRef } from "./orgs";
import { SabyRpcError } from "./rpc";
import type { SabyCaller } from "./session";

const ul: OrgRef = { kind: "ul", inn: "7601000985", kpp: "760601001", name: "СК Премьер, ОАО" };
const ip: OrgRef = { kind: "ip", inn: "500100732259", lastName: "Петров", firstName: "Пётр", middleName: "Петрович", name: "ИП Петров" };

describe("counterpartyInfoParams", () => {
  test("Участник: СвЮЛ с названием и ДопПоля для списка ящиков", () => {
    assert.deepEqual(counterpartyInfoParams(ul), {
      Участник: { СвЮЛ: { ИНН: "7601000985", КПП: "760601001", Название: "СК Премьер, ОАО" }, ДопПоля: "СписокИдентификаторов" },
    });
    assert.deepEqual(counterpartyInfoParams(ip, false), {
      Участник: { СвФЛ: { ИНН: "500100732259", Фамилия: "Петров", Имя: "Пётр", Отчество: "Петрович" } },
    });
  });
});

describe("parseCounterpartyInfo", () => {
  test("ответ живого Saby из теста magdv/sbis: приглашён, но без аккаунта", () => {
    const r = parseCounterpartyInfo({
      Идентификатор: [
        {
          ИдентификаторУчастника: "2BE-0123456789abcdef",
          Основной: "Да",
          Роуминг: "Нет",
          Оператор: { Идентификатор: "2BE", Название: "ООО \"Компания \"Тензор\"" },
          СостояниеПодключения: { Код: "2", Описание: "Без аккаунта (отправлено приглашение)" },
        },
      ],
      СвЮЛ: { ИНН: "7601000985", КПП: "760601001", КодСтраны: "643", Название: "СК Премьер, ОАО" },
    });
    assert.equal(r.kind, "invited");
    assert.equal(r.name, "СК Премьер, ОАО");
    assert.equal(r.inn, "7601000985");
    assert.equal(r.box?.operatorCode, "2BE");
    assert.equal(r.box?.statusText, "Без аккаунта (отправлено приглашение)");
  });

  test("подключён в Saby напрямую", () => {
    const r = parseCounterpartyInfo({
      Идентификатор: [{ ИдентификаторУчастника: "2BE-aaa", Основной: "Да", Роуминг: "Нет", Оператор: { Идентификатор: "2BE" }, СостояниеПодключения: { Код: "1", Описание: "Подключен" } }],
    });
    assert.equal(r.kind, "saby");
    assert.equal(operatorLabel(r.box!.operatorCode, r.box!.operatorName), "Saby (Тензор)");
  });

  test("основной ящик в роуминге у Контура — выбирается основной, а не первый", () => {
    const r = parseCounterpartyInfo({
      Идентификатор: [
        { ИдентификаторУчастника: "2BE-old", Основной: "Нет", Роуминг: "Нет", Оператор: { Идентификатор: "2BE" } },
        { ИдентификаторУчастника: "2BM-xyz", Основной: "Да", Роуминг: "Да", Оператор: { Идентификатор: "2BM", Название: "АО «ПФ «СКБ Контур»" } },
      ],
    });
    assert.equal(r.kind, "roaming");
    assert.equal(r.box?.participantId, "2BM-xyz");
    assert.equal(r.boxes.length, 2);
    assert.equal(operatorLabel(r.box!.operatorCode, r.box!.operatorName), "АО «ПФ «СКБ Контур»");
  });

  test("без ДопПоля: ID строкой — оператор по префиксу", () => {
    assert.equal(parseCounterpartyInfo({ Идентификатор: "2BM-xyz" }).kind, "roaming");
    assert.equal(parseCounterpartyInfo({ Идентификатор: "2BE-xyz" }).kind, "saby");
    assert.equal(operatorLabel("2BM", ""), "Контур.Диадок");
    assert.equal(operatorLabel("2ZZ", ""), "оператор 2ZZ");
  });

  test("пустой идентификатор (не подключён или отказался) и мусор — none", () => {
    assert.equal(parseCounterpartyInfo({ Идентификатор: "", СвЮЛ: { ИНН: "1" } }).kind, "none");
    assert.equal(parseCounterpartyInfo({ Идентификатор: [] }).kind, "none");
    assert.equal(parseCounterpartyInfo(null).kind, "none");
  });

  test("ID участника: нормализация и код оператора", () => {
    assert.equal(normalizeParticipantId(" 2bm-12 ab "), "2BM-12ab");
    assert.equal(normalizeParticipantId("не id"), null);
    assert.equal(operatorCodeFromParticipantId("2al-1"), "2AL");
  });
});

describe("checkCounterpartyEdo", () => {
  test("-32602 на ДопПоля — один повтор без него", async () => {
    const seen: unknown[] = [];
    const call: SabyCaller = async <T,>(_method: string, params: unknown): Promise<T> => {
      seen.push(params);
      if (seen.length === 1) throw new SabyRpcError(200, "-32602", "Неверные параметры");
      return { Идентификатор: "2BE-1" } as T;
    };
    const r = await checkCounterpartyEdo(call, ul);
    assert.equal(r.kind, "saby");
    assert.equal(seen.length, 2);
    assert.equal(((seen[1] as { Участник: Record<string, unknown> }).Участник).ДопПоля, undefined);
  });

  test("другая ошибка пробрасывается без повтора", async () => {
    let calls = 0;
    const call: SabyCaller = async () => {
      calls++;
      throw new SabyRpcError(200, "{X}", "Нет прав");
    };
    await assert.rejects(checkCounterpartyEdo(call, ul));
    assert.equal(calls, 1);
  });
});
