import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildMaxPostBody, buttonHref } from "@/lib/max/channel-post";
import { planTelegramPost } from "@/lib/max/telegram-post";

import { csvToPosts, parseCsv } from "./csv";
import { TEMPLATES, fitFont, titleFromPost, wrapText } from "./templates";

const NOW = new Date("2026-11-25T09:00:00Z");

describe("CSV-импорт (A20)", () => {
  it("кавычки, переносы строк и заголовок", () => {
    const csv = 'дата;время;текст;кнопка;ссылка;рубрика\n01.12.2026;10:00;"**Заголовок**\nстрока; с точкой с запятой";Попробовать;https://wesetup.ru/;promo\n';
    const rows = csvToPosts(csv, NOW);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].error, undefined);
    assert.equal(rows[0].text, "**Заголовок**\nстрока; с точкой с запятой");
    assert.equal(rows[0].scheduledAt?.toISOString(), "2026-12-01T07:00:00.000Z");
    assert.equal(rows[0].rubric, "promo");
  });
  it("ошибки строк", () => {
    const rows = csvToPosts("20.11.2026;10:00;прошлое\n01.12.2026;10:00;текст;кнопка;\n;;черновик без даты", NOW);
    assert.equal(rows[0].error, "время уже прошло");
    assert.equal(rows[1].error, "у кнопки нужны и надпись, и ссылка");
    assert.equal(rows[2].error, undefined);
    assert.equal(rows[2].scheduledAt, null);
  });
  it("запятая как разделитель", () => {
    assert.deepEqual(parseCsv('a,b,"c,d"'), [["a", "b", "c,d"]]);
  });
});

describe("короткая ссылка кнопки (A16) и параметры отправки (A30)", () => {
  it("кнопка ведёт на /api/go/<код> со своей площадкой", () => {
    assert.equal(buttonHref({ buttonUrl: "https://wesetup.ru/", shortCode: "abc12" }, "telegram"), "https://wesetup.ru/api/go/abc12?c=tg");
    assert.match(buttonHref({ buttonUrl: "https://wesetup.ru/", campaign: "x" }, "max"), /utm_source=max/);
    const plan = planTelegramPost({ text: "t", images: [], buttonText: "Б", buttonUrl: "https://wesetup.ru/", shortCode: "abc12" });
    assert.equal(plan.replyMarkup?.inline_keyboard[0][0].url, "https://wesetup.ru/api/go/abc12?c=tg");
  });
  it("без звука в MAX — notify:false", () => {
    assert.equal(buildMaxPostBody({ text: "t", silent: true }).notify, false);
    assert.equal(buildMaxPostBody({ text: "t" }).notify, true);
  });
});

describe("шаблоны картинок (A23)", () => {
  const measure = (s: string) => s.length * 10;
  it("перенос и обрезка многоточием", () => {
    assert.deepEqual(wrapText("один два три четыре", 90, measure, 5), ["один два", "три", "четыре"]);
    const cut = wrapText("один два три четыре пять шесть", 90, measure, 2);
    assert.equal(cut.length, 2);
    assert.ok(cut[1].endsWith("…"));
  });
  it("подбор кегля", () => {
    const fit = fitFont("короткий", 1000, (s, size) => s.length * size * 0.5, [80, 60], 1);
    assert.equal(fit.size, 80);
  });
  it("заголовок из поста без разметки и эмодзи", () => {
    assert.equal(titleFromPost("🧾 **Как пройти проверку?**\nтекст"), "Как пройти проверку?");
    assert.equal(TEMPLATES.length, 4);
  });
});
