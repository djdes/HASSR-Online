import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { EdoInputError, entityOrgRef, isIpInn, matchOurOrg, parseCachedOrgs, parseOurOrgs } from "./orgs";

describe("entityOrgRef", () => {
  test("ООО — по ИНН, КПП и полному названию", () => {
    assert.deepEqual(
      entityOrgRef({ inn: " 5018215599 ", kpp: "501801001", isIp: false, fullName: "ООО «БФС»", shortName: "БФС", director: "" }),
      { kind: "ul", inn: "5018215599", kpp: "501801001", name: "ООО «БФС»" },
    );
  });

  test("ИП — ФИО из названия с префиксом, иначе из руководителя", () => {
    assert.deepEqual(
      entityOrgRef({ inn: "500100732259", kpp: "", isIp: true, fullName: "Индивидуальный предприниматель Петров Пётр Петрович", shortName: "", director: "" }),
      { kind: "ip", inn: "500100732259", lastName: "Петров", firstName: "Пётр", middleName: "Петрович", name: "Индивидуальный предприниматель Петров Пётр Петрович" },
    );
    const byDirector = entityOrgRef({ inn: "500100732259", kpp: "", isIp: true, fullName: "Кофейня Уют", shortName: "Уют", director: "Иванова Анна" });
    assert.equal(byDirector.kind, "ip");
    assert.ok(byDirector.kind === "ip" && byDirector.lastName === "Иванова" && byDirector.middleName === "");
  });

  test("ИП с одними инициалами и неверный ИНН — EdoInputError", () => {
    assert.throws(
      () => entityOrgRef({ inn: "500100732259", kpp: "", isIp: true, fullName: "ИП Петров П.П.", shortName: "Кофейня", director: "Петров П. П." }),
      EdoInputError,
    );
    assert.throws(() => entityOrgRef({ inn: "123", kpp: "", isIp: false, fullName: "ООО", shortName: "", director: "" }), EdoInputError);
  });

  test("isIpInn — 12 цифр", () => {
    assert.ok(isIpInn("500100732259"));
    assert.equal(isIpInn("5018215599"), false);
  });
});

describe("parseOurOrgs", () => {
  test("живая форма: НашаОрганизация[] с СвЮЛ / СвФЛ и флагом ЭДО", () => {
    const orgs = parseOurOrgs({
      НашаОрганизация: [
        { СвЮЛ: { ИНН: "5018215599", КПП: "501801001", Название: "ООО \"БФС\"" }, ДокументооборотПодключен: "Да" },
        { СвФЛ: { ИНН: 500100732259, Фамилия: "Волков", Имя: "Олег", Отчество: "И" }, ДокументооборотПодключен: "Нет" },
        { Что: "без ИНН" },
      ],
    });
    assert.deepEqual(orgs, [
      { inn: "5018215599", kpp: "501801001", name: "ООО \"БФС\"", edoEnabled: true },
      { inn: "500100732259", kpp: "", name: "Волков Олег И", edoEnabled: false },
    ]);
  });

  test("одиночный объект и голый массив тоже принимаются; мусор — пустой список", () => {
    assert.equal(parseOurOrgs({ НашаОрганизация: { СвЮЛ: { ИНН: "1" } } }).length, 1);
    assert.equal(parseOurOrgs([{ ИНН: "2", ДокументооборотПодключен: true }])[0].edoEnabled, true);
    assert.deepEqual(parseOurOrgs(null), []);
  });

  test("кэш из БД: только точная форма", () => {
    assert.deepEqual(parseCachedOrgs([{ inn: "1", kpp: "", name: "А", edoEnabled: true }, { inn: 2 }, "x"]), [
      { inn: "1", kpp: "", name: "А", edoEnabled: true },
    ]);
    assert.deepEqual(parseCachedOrgs(null), []);
  });
});

describe("matchOurOrg", () => {
  const bfs = { inn: "5018215599", kpp: "501801001", name: "ООО БФС", edoEnabled: true };

  test("ровно одна с ЭДО — ready; КПП пустой с одной стороны не мешает", () => {
    assert.deepEqual(matchOurOrg([bfs], "5018215599", "501801001"), { kind: "ready", org: bfs });
    assert.equal(matchOurOrg([bfs], "5018215599", "").kind, "ready");
  });

  test("ЭДО выключен, нет такой, несколько с ЭДО", () => {
    assert.equal(matchOurOrg([{ ...bfs, edoEnabled: false }], "5018215599", "").kind, "edo_off");
    assert.equal(matchOurOrg([bfs], "7700000000", "").kind, "missing");
    assert.equal(matchOurOrg([], "", "").kind, "missing");
    assert.equal(matchOurOrg([bfs, { ...bfs, kpp: "502401001" }], "5018215599", "").kind, "ambiguous");
    assert.equal(matchOurOrg([bfs, { ...bfs, kpp: "502401001" }], "5018215599", "501801001").kind, "ready");
  });
});
