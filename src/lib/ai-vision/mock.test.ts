import assert from "node:assert/strict";
import test from "node:test";

import { resolveVisionMock } from "@/lib/ai-vision/mock";

const REPLY = '{"items":[{"name":"Суп"}]}';

test("на проде мок игнорируется всегда", () => {
  assert.equal(resolveVisionMock({ NODE_ENV: "production", WESETUP_VISION_MOCK_REPLY: REPLY }, "menu"), null);
});

test("без переменной — мока нет", () => {
  assert.equal(resolveVisionMock({ NODE_ENV: "development" }, "menu"), null);
  assert.equal(resolveVisionMock({ NODE_ENV: "development", WESETUP_VISION_MOCK_REPLY: "  " }, "menu"), null);
});

test("сырой ответ — одинаковый для всех видов", () => {
  assert.deepEqual(resolveVisionMock({ NODE_ENV: "development", WESETUP_VISION_MOCK_REPLY: REPLY }, "raw"), {
    outcome: "reply",
    text: REPLY,
    delayMs: 0,
  });
});

test("ответы по видам и default", () => {
  const env = {
    NODE_ENV: "test",
    WESETUP_VISION_MOCK_REPLY: JSON.stringify({ menu: { items: [{ name: "Борщ" }] }, default: "```json\n{\"items\":[]}\n```" }),
    WESETUP_VISION_MOCK_DELAY_MS: "1500",
  };
  assert.deepEqual(resolveVisionMock(env, "menu"), { outcome: "reply", text: '{"items":[{"name":"Борщ"}]}', delayMs: 1500 });
  assert.deepEqual(resolveVisionMock(env, "raw"), { outcome: "reply", text: '```json\n{"items":[]}\n```', delayMs: 1500 });
});

test("ответ из файла (WESETUP_VISION_MOCK_FILE), на проде файл не читается", () => {
  const reads: string[] = [];
  const reader = (path: string) => {
    reads.push(path);
    return JSON.stringify({ raw: REPLY });
  };
  assert.deepEqual(resolveVisionMock({ WESETUP_VISION_MOCK_FILE: "mock.json" }, "raw", reader), {
    outcome: "reply",
    text: REPLY,
    delayMs: 0,
  });
  assert.equal(resolveVisionMock({ NODE_ENV: "production", WESETUP_VISION_MOCK_FILE: "mock.json" }, "raw", reader), null);
  assert.deepEqual(reads, ["mock.json"]);
  assert.equal(resolveVisionMock({ WESETUP_VISION_MOCK_FILE: "missing.json" }, "raw", () => null), null);
});

test("ответы для показания дисплея и проверки фото — по своим ключам", () => {
  const env = {
    WESETUP_VISION_MOCK_REPLY: JSON.stringify({ reading: { value: -18.5, unit: "C", confidence: "high" }, photo_check: "__failed__" }),
  };
  assert.deepEqual(resolveVisionMock(env, "reading"), {
    outcome: "reply",
    text: '{"value":-18.5,"unit":"C","confidence":"high"}',
    delayMs: 0,
  });
  assert.deepEqual(resolveVisionMock(env, "photo_check"), { outcome: "failed", delayMs: 0 });
});

test("особые исходы и потолок паузы", () => {
  const env = { WESETUP_VISION_MOCK_REPLY: JSON.stringify({ menu: "__timeout__", raw: "__failed__" }), WESETUP_VISION_MOCK_DELAY_MS: "999999" };
  assert.deepEqual(resolveVisionMock(env, "menu"), { outcome: "timeout", delayMs: 60_000 });
  assert.deepEqual(resolveVisionMock(env, "raw"), { outcome: "failed", delayMs: 60_000 });
  assert.equal(resolveVisionMock(env, "generic"), null);
});
