import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { splitFirstSentence } from "@/lib/first-sentence";

describe("Первое предложение для «Подробнее»", () => {
  it("режет по точке перед заглавной буквой", () => {
    assert.deepEqual(splitFirstSentence("Мы включили их сразу. Вести можно в электронном виде."), {
      first: "Мы включили их сразу.",
      rest: "Вести можно в электронном виде.",
    });
  });

  it("сокращения с цифрой после точки не режут", () => {
    const text = "Штраф по ст. 6.6 КоАП и п. 44 правил до 50 000 ₽.";
    assert.deepEqual(splitFirstSentence(text), { first: text, rest: "" });
  });

  it("одно предложение — без «Подробнее»", () => {
    assert.deepEqual(splitFirstSentence("Коротко"), { first: "Коротко", rest: "" });
    assert.deepEqual(splitFirstSentence(""), { first: "", rest: "" });
  });

  it("вступление к набору журналов делится после «вы решаете сами.»", async () => {
    const { first, rest } = splitFirstSentence(
      "Для сферы «Ресторан» санитарные правила требуют вести эти записи — мы включили их сразу, остальное вы решаете сами. Вести можно в электронном виде: СанПиН 2.3/2.4.4282-26 прямо это разрешает.",
    );
    assert.match(first, /вы решаете сами\.$/);
    assert.match(rest, /^Вести можно/);
  });
});
