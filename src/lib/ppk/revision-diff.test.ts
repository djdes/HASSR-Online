import { test } from "node:test";
import assert from "node:assert/strict";
import { diffTexts, tokenize } from "./revision-diff";

const after = (segments: { op: string; text: string }[]) => segments.filter((s) => s.op !== "del").map((s) => s.text).join("");
const changed = (segments: { op: string; text: string }[], op: string) => segments.filter((s) => s.op === op).map((s) => s.text.trim());

test("слова и знаки — токены, пробелы и переносы идут со словом", () => {
  assert.deepEqual(
    tokenize("  ХАССП — система.\nНовая строка").map((token) => token.word),
    ["ХАССП", "—", "система", ".", "Новая", "строка"],
  );
  assert.equal(tokenize("  ХАССП — система").map((token) => token.text).join(""), "  ХАССП — система");
});

test("одинаковые тексты и правка только пробелов — без изменений", () => {
  const same = diffTexts("Группа ХАССП собирается раз в квартал.", "Группа ХАССП собирается раз в квартал.");
  assert.deepEqual(same.segments.map((s) => s.op), ["eq"]);
  assert.equal(same.added + same.removed, 0);
  const spaces = diffTexts("Группа ХАССП\nсобирается раз в квартал.", "Группа  ХАССП собирается\n\nраз в квартал.");
  assert.ok(spaces.segments.every((s) => s.op === "eq"));
  assert.equal(spaces.added + spaces.removed, 0);
  // Показываются переносы новой редакции.
  assert.equal(after(spaces.segments), "Группа  ХАССП собирается\n\nраз в квартал.");
});

test("замена, вставка и удаление слов", () => {
  const replaced = diffTexts("Заседание не реже раза в квартал.", "Заседание не реже раза в месяц.");
  assert.deepEqual(changed(replaced.segments, "del"), ["квартал"]);
  assert.deepEqual(changed(replaced.segments, "add"), ["месяц"]);
  assert.equal(replaced.added, 1);
  assert.equal(replaced.removed, 1);
  assert.equal(replaced.mode, "words");

  const inserted = diffTexts("Руководитель утверждает план.", "Руководитель группы ХАССП утверждает план.");
  assert.deepEqual(changed(inserted.segments, "add"), ["группы ХАССП"]);
  assert.equal(inserted.added, 2);
  assert.equal(inserted.removed, 0);

  const removed = diffTexts("Протокол подписывают все члены группы.", "Протокол подписывают члены группы.");
  assert.deepEqual(changed(removed.segments, "del"), ["все"]);
  assert.equal(removed.removed, 1);
});

test("сегменты без удалённого дают новый текст целиком", () => {
  const before = "1. Цель.\nОбеспечить безопасность продукции.\n2. Ответственный: технолог.";
  const next = "1. Цель программы.\nОбеспечить безопасность пищевой продукции.\n2. Ответственный: шеф-повар.\n3. Срок: ежегодно.";
  const diff = diffTexts(before, next);
  assert.equal(after(diff.segments), next);
  assert.ok(diff.added >= 6 && diff.removed >= 1);
});

test("пустой текст: всё добавлено или всё удалено", () => {
  const fromEmpty = diffTexts("", "Новый текст пункта");
  assert.deepEqual(fromEmpty.segments.map((s) => s.op), ["add"]);
  assert.equal(fromEmpty.added, 3);
  const toEmpty = diffTexts("Старый текст", "");
  assert.deepEqual(toEmpty.segments.map((s) => s.op), ["del"]);
  assert.equal(toEmpty.removed, 2);
});

test("очень непохожие тексты — построчно, совсем разные — целиком", () => {
  // Пять строк переписаны целиком: пословно правок больше предела, построчно — 10.
  const long = (i: number, word: string) => Array.from({ length: 12 }, (_, j) => `${word}${i}x${j}`).join(" ");
  const before = Array.from({ length: 30 }, (_, i) => long(i, "старое")).join("\n");
  const next = Array.from({ length: 30 }, (_, i) => (i % 6 === 0 ? long(i, "новое") : long(i, "старое"))).join("\n");
  const lines = diffTexts(before, next, { maxEdits: 20 });
  assert.equal(lines.mode, "lines");
  assert.equal(after(lines.segments), next);
  const whole = diffTexts("альфа бета гамма дельта", "один два три четыре пять", { maxEdits: 1 });
  assert.equal(whole.mode, "whole");
  assert.deepEqual(whole.segments.map((s) => s.op), ["del", "add"]);
});

test("длинный текст с правкой в середине считается быстро", () => {
  const words = Array.from({ length: 6000 }, (_, i) => `слово${i % 97}`);
  const before = words.join(" ");
  const nextWords = [...words];
  nextWords.splice(3000, 2, "вставка", "правка", "ещё");
  const started = Date.now();
  const diff = diffTexts(before, nextWords.join(" "));
  assert.ok(Date.now() - started < 2000, "быстро");
  assert.equal(diff.mode, "words");
  assert.equal(diff.added, 3);
  assert.equal(diff.removed, 2);
});
