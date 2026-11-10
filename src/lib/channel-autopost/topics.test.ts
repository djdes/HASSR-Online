import assert from "node:assert/strict";
import test from "node:test";

import {
  KIND_ROTATION,
  addDays,
  allTopics,
  buildImagePrompt,
  moscowDateKey,
  parseGeneratedPost,
  pickTopic,
  publishAtFor,
} from "@/lib/channel-autopost/topics";

test("темы из наших материалов: журналы, возможности и глоссарий со ссылками на сайт", () => {
  const topics = allTopics();
  const kinds = new Set(topics.map((t) => t.kind));
  assert.deepEqual([...kinds].sort(), ["feature", "journal", "term"]);
  assert.ok(topics.filter((t) => t.kind === "journal").length >= 30);
  for (const topic of topics) {
    assert.match(topic.url, /^https:\/\/wesetup\.ru\/(journals-info|features|glossary)\/[a-z0-9_-]+$/);
    assert.ok(topic.material.length > 40, topic.key);
  }
  assert.equal(new Set(topics.map((t) => t.key)).size, topics.length, "ключи уникальны");
});

test("виды тем чередуются по дням, внутри вида — сначала новые, потом самая давняя", () => {
  const days = Array.from({ length: KIND_ROTATION.length }, (_, i) => addDays("2026-11-11", i));
  const kinds = days.map((d) => pickTopic(d, []).kind);
  assert.equal(new Set(kinds).size, 3);

  const day = "2026-11-11";
  const first = pickTopic(day, []);
  const second = pickTopic(day, [first.key]);
  assert.notEqual(second.key, first.key);
  assert.equal(second.kind, first.kind);

  const pool = allTopics().filter((t) => t.kind === first.kind).map((t) => t.key);
  const usedNewestFirst = [...pool].reverse(); // pool[0] — самая давняя
  assert.equal(pickTopic(day, usedNewestFirst).key, pool[0]);
});

test("ответ модели: JSON в заборе, без ссылок в тексте, разумная длина", () => {
  const text = "🧊 **Холодильник: +2…+6 °C**\n\nТемпературу записывают дважды в смену.\n• утром\n• вечером\n\nWeSetup напомнит, если запись пропущена.\n\n#СанПиН #общепит";
  const ok = parseGeneratedPost("```json\n" + JSON.stringify({ text, imagePrompt: "fridge in a kitchen" }) + "\n```");
  assert.deepEqual(ok, { text, imagePrompt: "fridge in a kitchen" });
  assert.equal(parseGeneratedPost(JSON.stringify({ text: text + " https://wesetup.ru", imagePrompt: "x" })), null);
  assert.equal(parseGeneratedPost(JSON.stringify({ text: "коротко", imagePrompt: "x" })), null);
  assert.equal(parseGeneratedPost("не JSON"), null);
  assert.equal(parseGeneratedPost(JSON.stringify({ text: "а".repeat(1200) })), null);
  const noPrompt = parseGeneratedPost(JSON.stringify({ text }));
  assert.ok(noPrompt && noPrompt.imagePrompt.length > 0);
});

test("картинка — без надписей; публикация в 10:00 по Москве", () => {
  const topic = allTopics()[0];
  assert.match(buildImagePrompt(topic, "kitchen"), /no text/i);
  assert.equal(publishAtFor("2026-11-11").toISOString(), "2026-11-11T07:00:00.000Z");
  assert.equal(publishAtFor("2026-11-11", "09:30").toISOString(), "2026-11-11T06:30:00.000Z");
  assert.equal(moscowDateKey(new Date("2026-11-10T21:30:00Z")), "2026-11-11");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});
