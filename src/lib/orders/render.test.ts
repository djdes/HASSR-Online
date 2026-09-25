import assert from "node:assert/strict";
import test from "node:test";

import { findOrderTemplate, ORDER_TEMPLATES } from "@/lib/orders/catalog";
import {
  basisInGenitive,
  BLANK,
  defaultOrderValues,
  fillPlaceholders,
  formatOrderDate,
  renderOrder,
} from "@/lib/orders/render";
import { buildOrgSnapshot, cityFromAddress } from "@/lib/orders/org-snapshot";

const FULL_ORG = {
  name: "ООО «Ромашка»",
  inn: "7701234567",
  address: "109012, г Москва, ул Ильинка, д 4",
  legalProfileJson: {
    inn: "7701234567",
    type: "LEGAL",
    nameShort: "ООО «Ромашка»",
    nameFull: "Общество с ограниченной ответственностью «Ромашка»",
    opfShort: "ООО",
    opfFull: null,
    kpp: null,
    ogrn: "1027700132195",
    ogrnDate: null,
    address: "109012, г Москва, ул Ильинка, д 4",
    management: { name: "Петров Пётр Петрович", post: "Генеральный директор" },
    okvedMain: null,
    okvedsExtra: [],
    status: "ACTIVE",
    registrationDate: null,
    liquidationDate: null,
    employeeCount: null,
    capital: null,
    branchCount: null,
    finance: null,
    founders: [],
    phones: [],
    emails: [],
    fetchedAt: "2026-09-01T00:00:00.000Z",
  },
};

test("каждый шаблон каталога уникален и заполним", () => {
  const codes = new Set<string>();
  for (const template of ORDER_TEMPLATES) {
    assert.equal(codes.has(template.code), false, `дубль кода ${template.code}`);
    codes.add(template.code);
    assert.ok(template.title.length > 0);
    assert.ok(template.body.length > 0, `${template.code}: пустое тело`);
    assert.ok(template.basis.length > 0, `${template.code}: нет оснований`);
    // Ключи полей уникальны внутри шаблона — иначе форма перетрёт сама себя.
    const keys = template.fields.map((field) => field.key);
    assert.equal(new Set(keys).size, keys.length, `${template.code}: дубль поля`);
  }
});

test("СанПиН общепита в основаниях — действующий 4282-26 и его пункты", () => {
  const CURRENT = "СанПиН 2.3/2.4.4282-26";
  let checked = 0;
  for (const template of ORDER_TEMPLATES) {
    for (const item of template.basis) {
      if (!item.startsWith("СанПиН 2.3/2.4")) continue;
      checked += 1;
      assert.ok(
        item === CURRENT || item.startsWith(`${CURRENT}, `),
        `${template.code}: основание ссылается не на действующий СанПиН — ${item}`
      );
      // Нумерация 4282-26 сквозная, пункты 1–65. Номер вида «2.18» —
      // это пункт отменённого предшественника, в новых правилах его нет.
      for (const number of item.slice(CURRENT.length).match(/\d+(?:\.\d+)*/g) ?? []) {
        assert.match(number, /^\d+$/, `${template.code}: номер «${number}» не из 4282-26`);
        const point = Number(number);
        assert.ok(point >= 1 && point <= 65, `${template.code}: пункта ${point} в 4282-26 нет`);
      }
    }
  }
  // Ссылки на санитарные правила не должны просто исчезнуть из приказов.
  assert.ok(checked >= 8, `оснований на СанПиН общепита осталось ${checked}`);
});

test("каждый плейсхолдер тела известен: реквизиты или поле формы", () => {
  const orgKeys = new Set([
    "orgName",
    "orgShortName",
    "orgInn",
    "orgAddress",
    "directorName",
    "directorPost",
    "city",
    "number",
    "issuedAt",
  ]);
  for (const template of ORDER_TEMPLATES) {
    const fieldKeys = new Set(template.fields.map((field) => field.key));
    for (const line of template.body) {
      for (const match of line.matchAll(/\{\{(\w+)\}\}/g)) {
        const key = match[1];
        assert.ok(
          orgKeys.has(key) || fieldKeys.has(key),
          `${template.code}: неизвестный плейсхолдер ${key}`
        );
      }
    }
  }
});

test("реквизиты организации подставляются в текст приказа", () => {
  const template = findOrderTemplate("haccp-responsible");
  assert.ok(template);
  const rendered = renderOrder({
    template,
    org: buildOrgSnapshot(FULL_ORG),
    values: {
      responsibleName: "Иванова Ольга Петровна",
      responsiblePost: "Шеф-повар",
      effectiveDate: "2026-09-15",
    },
    number: "12-ОД",
    issuedAt: "2026-09-10",
  });

  assert.equal(rendered.heading, "ПРИКАЗ № 12-ОД");
  assert.equal(rendered.dateLine, "10 сентября 2026 г.");
  assert.equal(rendered.city, "г. Москва");
  assert.equal(rendered.signature.post, "Генеральный директор");
  assert.equal(rendered.signature.name, "Петров Пётр Петрович");
  assert.deepEqual(rendered.missingFields, []);

  const text = rendered.body.join(" ");
  assert.match(text, /Шеф-повар Иванова Ольга Петровна/);
  assert.match(text, /ООО «Ромашка»/);
  // Дата поля печатается по-русски, а не как значение из <input type="date">.
  assert.match(text, /15 сентября 2026 г\./);
  assert.doesNotMatch(text, /2026-09-15/);
});

test("без legalProfileJson приказ печатается на названии и прочерках", () => {
  const template = findOrderTemplate("sanitary-responsible");
  assert.ok(template);
  const rendered = renderOrder({
    template,
    org: buildOrgSnapshot({
      name: "ИП Сидоров",
      inn: null,
      address: null,
      legalProfileJson: null,
    }),
    values: {},
    number: "",
    issuedAt: "2026-09-10",
  });

  assert.equal(rendered.heading, `ПРИКАЗ № ${BLANK}`);
  assert.equal(rendered.city, BLANK);
  assert.equal(rendered.signature.post, "Руководитель");
  assert.equal(rendered.signature.name, BLANK);
  // Незаполненные обязательные поля перечислены для подсветки в форме.
  assert.deepEqual(rendered.missingFields, [
    "Ф. И. О. ответственного",
    "Должность ответственного",
  ]);
  // Но текст всё равно собран — с прочерками вместо значений.
  assert.match(rendered.body.join(" "), new RegExp(BLANK));
  assert.match(rendered.body.join(" "), /ИП Сидоров/);
});

test("многострочное поле разворачивается в отдельные абзацы", () => {
  const template = findOrderTemplate("haccp-team");
  assert.ok(template);
  const rendered = renderOrder({
    template,
    org: buildOrgSnapshot(FULL_ORG),
    values: {
      leaderName: "Иванова О. П.",
      leaderPost: "Шеф-повар",
      members: "Повар Петрова А. А.\nКладовщик Сидоров И. И.",
    },
    number: "3",
    issuedAt: new Date(2026, 8, 10),
  });

  assert.ok(rendered.body.includes("Повар Петрова А. А."));
  assert.ok(rendered.body.includes("Кладовщик Сидоров И. И."));
});

test("незаполненный плейсхолдер становится прочерком, а не скобками", () => {
  assert.equal(fillPlaceholders("Кто: {{who}}", {}), `Кто: ${BLANK}`);
  assert.equal(fillPlaceholders("Кто: {{who}}", { who: "  " }), `Кто: ${BLANK}`);
  assert.equal(fillPlaceholders("Кто: {{who}}", { who: "Пётр" }), "Кто: Пётр");
});

test("дата не уезжает на день назад из-за часового пояса", () => {
  assert.equal(formatOrderDate("2026-01-01"), "1 января 2026 г.");
  assert.equal(formatOrderDate("2026-12-31"), "31 декабря 2026 г.");
  assert.equal(formatOrderDate(null), BLANK);
});

test("город берётся из юридического адреса, иначе null", () => {
  assert.equal(cityFromAddress("109012, г Москва, ул Ильинка, д 4"), "Москва");
  assert.equal(cityFromAddress("456000, с Кулешовка, ул Мира"), "Кулешовка");
  assert.equal(cityFromAddress("просто строка"), null);
  assert.equal(cityFromAddress(null), null);
});

test("значения по умолчанию заполняют даты сегодняшним днём", () => {
  const template = findOrderTemplate("journals-intro");
  assert.ok(template);
  const values = defaultOrderValues(template, new Date(2026, 8, 10));
  assert.equal(values.effectiveDate, "2026-09-10");
  assert.equal(values.journalList, "");
});

test("основания в преамбуле — в родительном падеже: «требованиями приказа Минздрава»", () => {
  assert.equal(basisInGenitive("Приказ Минздрава России № 29н"), "приказа Минздрава России № 29н");
  assert.equal(basisInGenitive("Федеральный закон № 52-ФЗ"), "Федерального закона № 52-ФЗ");
  assert.equal(basisInGenitive("Трудовой кодекс РФ, статья 221"), "Трудового кодекса РФ, статья 221");
  assert.equal(basisInGenitive("СанПиН 2.3/2.4.4282-26, пункт 5"), "СанПиН 2.3/2.4.4282-26, пункт 5");
  for (const template of ORDER_TEMPLATES) {
    const order = renderOrder({
      template,
      org: buildOrgSnapshot({ name: "ООО Ромашка", inn: null, address: null, legalProfileJson: null }),
      values: {},
      number: "1",
      issuedAt: "2026-09-26",
    });
    assert.doesNotMatch(order.preamble, /требованиями (Приказ|Федеральный закон|Трудовой кодекс)/, template.code);
  }
});
