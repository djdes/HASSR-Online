import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatAgo, formatDue, fromMoscowInput, itemHeadline, toMoscowInput } from "./crm-format";

const now = new Date("2026-11-07T09:00:00Z"); // 12:00 МСК

describe("CRM: подача на экране", () => {
  it("сколько прошло", () => {
    assert.equal(formatAgo(new Date(now.getTime() - 20_000).toISOString(), now), "<1 мин");
    assert.equal(formatAgo(new Date(now.getTime() - 15 * 60_000).toISOString(), now), "15 мин");
    assert.equal(formatAgo(new Date(now.getTime() - 5 * 3_600_000).toISOString(), now), "5 ч");
    assert.equal(formatAgo(new Date(now.getTime() - 3 * 86_400_000).toISOString(), now), "3 дн");
  });

  it("канал и тема без повтора", () => {
    assert.equal(itemHeadline("signup", "Регистрация"), "Регистрация");
    assert.equal(itemHeadline("blank", "Скачал(а) шаблон журнала"), "Скачал(а) шаблон журнала");
    assert.equal(itemHeadline("demo", "Показ WeSetup за 15 минут"), "Показ WeSetup за 15 минут");
    assert.equal(itemHeadline("invoice", "Счёт по ИНН № 42"), "Счёт по ИНН № 42");
    assert.equal(itemHeadline("feedback", "Вопрос в поддержку"), "Обращение с сайта · Вопрос в поддержку");
    assert.equal(itemHeadline("chat", null), "Онлайн-чат");
  });

  it("срок шага и поле даты по Москве", () => {
    assert.equal(formatDue(new Date(now.getTime() - 60_000).toISOString(), now)?.tone, "overdue");
    assert.deepEqual(formatDue("2026-11-07T12:00:00Z", now), { label: "сегодня 15:00", tone: "today" });
    assert.equal(formatDue("2026-11-09T07:00:00Z", now)?.tone, "later");
    assert.equal(toMoscowInput("2026-11-08T07:00:00.000Z"), "2026-11-08T10:00");
    assert.equal(fromMoscowInput("2026-11-08T10:00"), "2026-11-08T07:00:00.000Z");
    assert.equal(fromMoscowInput("завтра"), null);
  });
});
