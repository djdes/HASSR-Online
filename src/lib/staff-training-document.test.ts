import assert from "node:assert/strict";
import test from "node:test";

import { loadMessages } from "@/i18n/messages";
import { TRAINING_TOPICS, trainingTopicDescription } from "@/lib/staff-training-document";

test("тема «Принципы ХАССП» — 11-й пункт стандартного набора — есть и с понятным описанием", () => {
  const haccp = TRAINING_TOPICS.find((topic) => topic.value === "haccp");
  assert.ok(haccp);
  assert.equal(haccp.label, "Принципы ХАССП");
  for (const point of ["опасности", "критические контрольные точки", "отклонении", "записи"]) {
    assert.ok(haccp.description.includes(point), point);
  }
  // В строке журнала тема хранится подписью — описание находится по ней.
  assert.equal(trainingTopicDescription("Принципы ХАССП"), haccp.description);
  assert.equal(trainingTopicDescription("haccp"), haccp.description);
  assert.equal(trainingTopicDescription("Своя тема"), null);
});

test("у каждой темы есть описание и перевод подписи на ru/en/uz", async () => {
  assert.equal(new Set(TRAINING_TOPICS.map((topic) => topic.value)).size, TRAINING_TOPICS.length);
  for (const topic of TRAINING_TOPICS) assert.ok(topic.description.length >= 30, topic.value);
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const topics = messages.taskFillSchema.options.staffTraining.topics as Record<string, string>;
    for (const topic of TRAINING_TOPICS) {
      assert.ok(topics[topic.value]?.trim(), `${locale}: нет перевода темы ${topic.value}`);
      if (locale === "ru") assert.equal(topics[topic.value], topic.label);
    }
  }
});
