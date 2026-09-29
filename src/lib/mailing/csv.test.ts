import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyImport,
  decodeCsvBytes,
  detectDelimiter,
  guessField,
  normalizeEmailCell,
  parseContacts,
  parseCsvRows,
  parseTags,
  resolveSphere,
} from "@/lib/mailing/csv";

/** Кодировщик Windows-1251 для кириллицы и ASCII — только для теста. */
function cp1251(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x80) out.push(code);
    else if (code >= 0x410 && code <= 0x44f) out.push(code - 0x410 + 0xc0);
    else if (code === 0x401) out.push(0xa8);
    else if (code === 0x451) out.push(0xb8);
    else throw new Error(`нет в тестовом cp1251: ${ch}`);
  }
  return Uint8Array.from(out);
}

describe("кодировка", () => {
  it("UTF-8 с BOM читается как UTF-8, BOM отбрасывается", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("Почта;Имя\nivan@mail.ru;Иван")]);
    const { text, encoding } = decodeCsvBytes(bytes);
    assert.equal(encoding, "utf-8");
    assert.equal(text.startsWith("Почта"), true);
  });

  it("Windows-1251 из Excel определяется по невалидному UTF-8", () => {
    const { text, encoding } = decodeCsvBytes(cp1251("Имя;Почта\nЁлкина Анна;anna@yandex.ru"));
    assert.equal(encoding, "windows-1251");
    const parsed = parseContacts({ text, encoding });
    assert.equal(parsed.rows.length, 1);
    assert.equal(parsed.rows[0].name, "Ёлкина Анна");
    assert.equal(parsed.rows[0].email, "anna@yandex.ru");
  });
});

describe("разделители и кавычки", () => {
  it("определяет ; , и табуляцию", () => {
    assert.equal(detectDelimiter("a;b;c\n1;2;3"), ";");
    assert.equal(detectDelimiter("a,b,c\n1,2,3"), ",");
    assert.equal(detectDelimiter("a\tb\tc\n1\t2\t3"), "\t");
    assert.equal(detectDelimiter("ivan@mail.ru\npetr@mail.ru"), null);
  });

  it("запятая внутри кавычек и удвоенная кавычка — часть значения", () => {
    const rows = parseCsvRows('email,company\n"a@b.ru","Кафе ""Ромашка"", ООО"', ",");
    assert.deepEqual(rows[1], ["a@b.ru", 'Кафе "Ромашка", ООО']);
  });

  it("перевод строки внутри кавычек не рвёт строку", () => {
    const rows = parseCsvRows('email;note\na@b.ru;"строка 1\nстрока 2"\nc@d.ru;x', ";");
    assert.equal(rows.length, 3);
    assert.equal(rows[1][1], "строка 1\nстрока 2");
  });
});

describe("заголовки и сопоставление колонок", () => {
  it("узнаёт русские и английские названия колонок", () => {
    assert.equal(guessField("E-mail"), "email");
    assert.equal(guessField("Эл. почта"), "email");
    assert.equal(guessField("ФИО"), "name");
    assert.equal(guessField("Контактное лицо"), "name");
    assert.equal(guessField("Название компании"), "company");
    assert.equal(guessField("Тип заведения"), "sphere");
    assert.equal(guessField("Город"), "city");
    assert.equal(guessField("Телефон"), "phone");
    assert.equal(guessField("Теги"), "tags");
    assert.equal(guessField("Почтовый адрес"), null);
  });

  it("CSV с заголовком: все поля по местам", () => {
    const text = [
      "Компания;Email;Имя;Сфера;Город;Телефон;Теги",
      "Кафе Ромашка;IVAN@Mail.RU ;Иван Петров;кафе;Казань;+79990000001;выставка, тёплый",
    ].join("\n");
    const parsed = parseContacts({ text });
    assert.equal(parsed.hasHeader, true);
    assert.equal(parsed.delimiter, ";");
    const [row] = parsed.rows;
    assert.equal(row.email, "ivan@mail.ru");
    assert.equal(row.company, "Кафе Ромашка");
    assert.equal(row.name, "Иван Петров");
    assert.equal(row.sphere, "cafe");
    assert.equal(row.city, "Казань");
    assert.equal(row.phone, "+79990000001");
    assert.deepEqual(row.tags, ["выставка", "тёплый"]);
    assert.equal(row.status, "ok");
  });

  it("без заголовка колонку почты находит по содержимому", () => {
    const parsed = parseContacts({ text: "Кафе А,a@a.ru\nКафе Б,b@b.ru" });
    assert.equal(parsed.hasHeader, false);
    assert.equal(parsed.mapping[1], "email");
    assert.deepEqual(
      parsed.rows.map((r) => r.email),
      ["a@a.ru", "b@b.ru"]
    );
  });

  it("ручное сопоставление из предпросмотра важнее автоматического", () => {
    const parsed = parseContacts({ text: "Кафе А,a@a.ru\nКафе Б,b@b.ru" }, { mapping: ["company", "email"] });
    assert.equal(parsed.rows[0].company, "Кафе А");
  });

  it("вставка списка адресов через запятую и точку с запятой — по строке на адрес", () => {
    const parsed = parseContacts({ text: "a@x.ru, b@y.ru; c@z.ru\nd@w.ru" });
    assert.deepEqual(
      parsed.rows.map((r) => r.email),
      ["a@x.ru", "b@y.ru", "c@z.ru", "d@w.ru"]
    );
  });

  it("«Иван <ivan@mail.ru>» — имя и адрес", () => {
    assert.deepEqual(normalizeEmailCell("Иван Петров <Ivan@Mail.ru>"), { email: "ivan@mail.ru", name: "Иван Петров" });
    assert.deepEqual(normalizeEmailCell("mailto:A@B.RU"), { email: "a@b.ru", name: null });
  });
});

describe("проверка адресов и дубли", () => {
  it("плохие адреса и несуществующие домены не загружаются, дубль — отдельно", () => {
    const text = [
      "email;name",
      "ivan@mail.ru;Иван",
      "IVAN@mail.ru;Иван ещё раз",
      "без-собаки;Пётр",
      "anna@gmail.ru;Анна",
      ";Пусто",
      "olga@yandex.by;Ольга",
    ].join("\n");
    const parsed = parseContacts({ text });
    const byLine = new Map(parsed.rows.map((r) => [r.line, r]));
    assert.equal(byLine.get(2)?.status, "ok");
    assert.equal(byLine.get(3)?.status, "duplicate");
    assert.equal(byLine.get(4)?.status, "invalid");
    assert.match(byLine.get(5)?.error ?? "", /не существует/);
    assert.equal(byLine.get(5)?.status, "invalid");
    assert.equal(byLine.get(6)?.status, "invalid");
    // Похоже на опечатку популярного домена — загружаем с предупреждением.
    assert.equal(byLine.get(7)?.status, "ok");
    assert.ok(byLine.get(7)?.warning);
    assert.deepEqual(parsed.summary, { total: 6, ok: 2, invalid: 3, duplicates: 1, warnings: 1 });
  });

  it("стоп-лист и уже загруженные — отдельными строками итога", () => {
    const parsed = parseContacts({ text: "email\nnew@a.ru\nold@a.ru\nstop@a.ru\nbad" });
    const { counts, rows } = classifyImport(parsed.rows, new Set(["old@a.ru"]), new Set(["stop@a.ru"]));
    assert.deepEqual(counts, { new: 1, exists: 1, suppressed: 1, invalid: 1, duplicate: 0 });
    assert.equal(rows.find((r) => r.email === "stop@a.ru")?.cls, "suppressed");
  });
});

describe("сфера и теги", () => {
  it("сфера по коду, по названию и по части названия", () => {
    assert.equal(resolveSphere("restaurant"), "restaurant");
    assert.equal(resolveSphere("Кафе / Кофейня"), "cafe");
    assert.equal(resolveSphere("кофейня"), "cafe");
    assert.equal(resolveSphere("Пекарня"), "bakery");
    assert.equal(resolveSphere("school"), "education");
    assert.equal(resolveSphere("космодром"), null);
    assert.equal(resolveSphere(""), null);
  });

  it("нераспознанная сфера — предупреждение, а не отказ", () => {
    const parsed = parseContacts({ text: "email;сфера\na@a.ru;космодром" });
    assert.equal(parsed.rows[0].status, "ok");
    assert.equal(parsed.rows[0].sphere, null);
    assert.match(parsed.rows[0].warning ?? "", /не распознана/);
  });

  it("теги: нижний регистр, без повторов", () => {
    assert.deepEqual(parseTags("VIP, vip | Выставка ;  "), ["vip", "выставка"]);
  });
});
