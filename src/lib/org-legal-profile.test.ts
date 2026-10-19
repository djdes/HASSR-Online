import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLegalProfile,
  humanizeName,
  partyPersonName,
  readLegalProfile,
} from "./org-legal-profile";

const sber = {
  type: "LEGAL",
  inn: "7707083893",
  kpp: "773601001",
  ogrn: "1027700132195",
  ogrn_date: 1029974400000,
  name: {
    short_with_opf: "ПАО СБЕРБАНК",
    full_with_opf: "ПУБЛИЧНОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО \"СБЕРБАНК РОССИИ\"",
  },
  opf: { short: "ПАО", full: "Публичное акционерное общество", type: "2014" },
  address: { value: "г Москва, ул Вавилова, д 19" },
  management: { name: "ГРЕФ ГЕРМАН ОСКАРОВИЧ", post: "ПРЕЗИДЕНТ, ПРЕДСЕДАТЕЛЬ ПРАВЛЕНИЯ" },
  okved: "64.19",
  okveds: [
    { main: true, code: "64.19", name: "Денежное посредничество прочее" },
    { main: false, code: "66.19", name: "Деятельность вспомогательная прочая в сфере финансовых услуг" },
  ],
  state: { status: "ACTIVE", registration_date: 677376000000 },
  employee_count: 210000,
  capital: { type: "УСТАВНЫЙ КАПИТАЛ", value: 67760844000 },
  branch_count: 88,
  finance: { tax_system: null, income: 1000, expense: 500, revenue: 1500, year: 2024 },
  founders: [{ name: "ЦЕНТРАЛЬНЫЙ БАНК РОССИЙСКОЙ ФЕДЕРАЦИИ", type: "LEGAL", share: { value: 50 } }],
  phones: [{ value: "+7 495 500-55-50" }],
  emails: null,
};

test("buildLegalProfile: реквизиты, руководитель, ОКВЭД, статистика", () => {
  const p = buildLegalProfile(sber, new Date("2026-09-05T00:00:00Z"));
  assert.equal(p.inn, "7707083893");
  assert.equal(p.type, "LEGAL");
  assert.equal(p.nameShort, "ПАО СБЕРБАНК");
  assert.equal(p.kpp, "773601001");
  assert.equal(p.ogrn, "1027700132195");
  assert.equal(p.ogrnDate, "2002-08-22");
  assert.deepEqual(p.management, {
    name: "Греф Герман Оскарович",
    post: "Президент, Председатель Правления",
  });
  assert.deepEqual(p.okvedMain, { code: "64.19", name: "Денежное посредничество прочее" });
  assert.equal(p.okvedsExtra.length, 1);
  assert.equal(p.status, "ACTIVE");
  assert.equal(p.registrationDate, "1991-06-20");
  assert.equal(p.employeeCount, 210000);
  assert.deepEqual(p.capital, { type: "УСТАВНЫЙ КАПИТАЛ", value: 67760844000 });
  assert.equal(p.branchCount, 88);
  assert.equal(p.finance?.revenue, 1500);
  assert.equal(p.finance?.year, 2024);
  assert.equal(p.founders[0].name, "Центральный Банк Российской Федерации");
  assert.deepEqual(p.phones, ["+7 495 500-55-50"]);
  assert.deepEqual(p.emails, []);
  assert.equal(p.fetchedAt, "2026-09-05T00:00:00.000Z");
});

test("buildLegalProfile: ИП без руководителя — имя из fio, пустые блоки не выдумываются", () => {
  const p = buildLegalProfile({
    type: "INDIVIDUAL",
    inn: "500100732259",
    name: {
      full_with_opf: "Индивидуальный предприниматель Мясина Елена Анатольевна",
      short_with_opf: "ИП Мясина Елена Анатольевна",
    },
    fio: { surname: "Мясина", name: "Елена", patronymic: "Анатольевна" },
    okved: "69.20.2",
    state: { status: "LIQUIDATED" },
  });
  assert.equal(p.type, "INDIVIDUAL");
  assert.deepEqual(p.management, { name: "Мясина Елена Анатольевна", post: null });
  assert.equal(p.kpp, null);
  assert.equal(p.finance, null);
  assert.equal(p.capital, null);
  assert.deepEqual(p.okvedMain, { code: "69.20.2", name: null });
});

test("readLegalProfile: полный снимок читается без потерь", () => {
  const full = buildLegalProfile(sber, new Date("2026-09-05T00:00:00Z"));
  assert.deepEqual(readLegalProfile(JSON.parse(JSON.stringify(full))), full);
});

test("readLegalProfile: неполный снимок демо-базы нормализуется, а не роняет страницу", () => {
  // Демо «Столовая «Берёзка»»: в JSON записаны только ИНН, адрес и руководитель.
  const p = readLegalProfile({ inn: "7701234567", address: "г Москва, ул Ленина, д 5", management: { name: "Иванова Анна" } });
  assert.ok(p);
  assert.equal(p.address, "г Москва, ул Ленина, д 5");
  assert.deepEqual(p.management, { name: "Иванова Анна", post: null });
  assert.deepEqual(p.okvedsExtra, []);
  assert.deepEqual(p.founders, []);
  assert.deepEqual(p.phones, []);
  assert.deepEqual(p.emails, []);
  assert.equal(p.okvedMain, null);
  assert.equal(p.finance, null);
  assert.equal(p.capital, null);
  assert.equal(p.type, null);
  assert.equal(p.fetchedAt, "");
  // Мусор в полях не пропускается дальше.
  const messy = readLegalProfile({ inn: "7701234567", okvedsExtra: [null, { code: 5 }, { code: "56.10" }], phones: ["+7 1", 7], capital: { value: "много" } });
  assert.deepEqual(messy?.okvedsExtra, [{ code: "56.10", name: null }]);
  assert.deepEqual(messy?.phones, ["+7 1"]);
  assert.equal(messy?.capital, null);
  // Без ИНН и не-объект — снимка нет.
  assert.equal(readLegalProfile({ address: "x" }), null);
  assert.equal(readLegalProfile([{ inn: "1" }]), null);
  assert.equal(readLegalProfile(null), null);
});

test("humanizeName / partyPersonName", () => {
  assert.equal(humanizeName("ИВАНОВ ИВАН ИВАНОВИЧ"), "Иванов Иван Иванович");
  assert.equal(humanizeName("Греф Герман Оскарович"), "Греф Герман Оскарович");
  assert.equal(humanizeName(""), null);
  assert.equal(partyPersonName({ fio: { surname: "ПЕТРОВ", name: "ПЁТР" } }), "Петров Пётр");
});
