import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_AI_DIGEST_CONFIG, normalizeAiDigestConfig, validateAiDigestConfig } from "./config";
import {
  buildAiDigestPrompt,
  fallbackNarrative,
  formatDelta,
  formatRub,
  parseAiDigestReply,
  renderDigest,
  type DigestMetrics,
  type MailingWeek,
  type SalesWeek,
} from "./report";
import { dueSlot, latestSlot, nextSlot, reportPeriod, slotKey, slotLabel } from "./schedule";

const SUNDAY_23_59 = { weekday: 7 as const, time: "23:59" };

describe("ai-digest schedule", () => {
  // 2026-11-29 — воскресенье. 23:59 МСК = 20:59 UTC.
  const slotUtc = new Date("2026-11-29T20:59:00.000Z");

  it("находит последний слот вс 23:59 по Москве", () => {
    assert.equal(latestSlot(new Date("2026-11-29T21:00:30.000Z"), SUNDAY_23_59).toISOString(), slotUtc.toISOString());
    // За минуту до слота — прошлое воскресенье.
    assert.equal(latestSlot(new Date("2026-11-29T20:58:00.000Z"), SUNDAY_23_59).toISOString(), "2026-11-22T20:59:00.000Z");
    assert.equal(nextSlot(new Date("2026-11-25T10:00:00.000Z"), SUNDAY_23_59).toISOString(), slotUtc.toISOString());
    assert.equal(slotKey(slotUtc), "2026-11-29T23:59");
    assert.equal(slotLabel(slotUtc), "вс 29.11 в 23:59");
  });

  it("слот пора отправить один раз и только в пределах окна", () => {
    const now = new Date("2026-11-29T20:59:20.000Z");
    assert.equal(dueSlot(now, SUNDAY_23_59, new Set())?.toISOString(), slotUtc.toISOString());
    assert.equal(dueSlot(now, SUNDAY_23_59, new Set(["2026-11-29T23:59"])), null);
    // Понедельник 00:30 — крон опоздал, ещё досылаем.
    assert.ok(dueSlot(new Date("2026-11-29T21:30:00.000Z"), SUNDAY_23_59, new Set()));
    // Через сутки — уже нет.
    assert.equal(dueSlot(new Date("2026-11-30T21:00:00.000Z"), SUNDAY_23_59, new Set()), null);
  });

  it("в воскресенье описывает текущую неделю, в другие дни — прошлую", () => {
    const sunday = reportPeriod(slotUtc);
    assert.equal(sunday.label, "23.11–29.11.2026");
    assert.equal(sunday.previousLabel, "16.11–22.11.2026");
    assert.equal(sunday.start.toISOString(), "2026-11-22T21:00:00.000Z");
    assert.equal(sunday.end.toISOString(), "2026-11-29T21:00:00.000Z");
    const wednesday = reportPeriod(new Date("2026-11-25T09:00:00.000Z"));
    assert.equal(wednesday.label, "16.11–22.11.2026");
  });
});

describe("ai-digest config", () => {
  it("заполняет недостающее значениями по умолчанию", () => {
    const config = normalizeAiDigestConfig({ schedule: { weekday: 9, time: "25:00" }, channels: { max: false } });
    assert.deepEqual(config.schedule, DEFAULT_AI_DIGEST_CONFIG.schedule);
    assert.equal(config.channels.max, false);
    assert.equal(config.channels.email, true);
  });

  it("проверяет шаблон: переменные, каналы, время", () => {
    assert.equal(validateAiDigestConfig(DEFAULT_AI_DIGEST_CONFIG).ok, true);
    const unknown = validateAiDigestConfig({ ...DEFAULT_AI_DIGEST_CONFIG, shortTemplate: "Выручка {revenu}" });
    assert.equal(unknown.ok, false);
    assert.match(unknown.ok ? "" : unknown.error, /\{revenu\}/);
    const noChannels = validateAiDigestConfig({ ...DEFAULT_AI_DIGEST_CONFIG, channels: { email: false, telegram: false, max: false } });
    assert.equal(noChannels.ok, false);
    const badTime = validateAiDigestConfig({ ...DEFAULT_AI_DIGEST_CONFIG, schedule: { weekday: 7, time: "24:10" } });
    assert.equal(badTime.ok, false);
  });
});

function sales(revenue: number, orders: number, extra: Partial<SalesWeek> = {}): SalesWeek {
  return {
    revenue,
    orders,
    avgCheck: orders ? revenue / orders : null,
    autopayOrders: 0,
    invoiceOrders: 0,
    discountedOrders: 0,
    discountRub: 0,
    payingOrgs: orders,
    newPayingOrgs: 0,
    topUps: { count: 0, revenue: 0 },
    refunds: { count: 0, revenue: 0 },
    tariffs: [{ key: "standard_month", title: "Стандарт <месяц>", orders, revenue }],
    ...extra,
  };
}

function mailings(sent: number, clickers: number): MailingWeek {
  return {
    campaigns: 1,
    sent,
    byChannel: { email: sent, inApp: 0, push: 0, telegram: 0 },
    failed: 0,
    clickers,
    unsubscribes: 1,
    topCampaigns: [{ title: "Год со скидкой", sent, clicks: clickers }],
  };
}

const METRICS: DigestMetrics = {
  periodLabel: "23.11–29.11.2026",
  previousLabel: "16.11–22.11.2026",
  current: { sales: sales(30000, 4), mailings: mailings(200, 3) },
  previous: { sales: sales(20000, 2), mailings: mailings(100, 5) },
};

describe("ai-digest report", () => {
  it("форматирует суммы и изменения", () => {
    assert.equal(formatRub(12345.4).replace(/ /g, " "), "12 345 ₽");
    assert.equal(formatDelta(150, 100), "+50%");
    assert.equal(formatDelta(50, 100), "−50%");
    assert.equal(formatDelta(5, 0), "было 0");
    assert.equal(formatDelta(0, 0), "без изменений");
    assert.equal(formatDelta(null, 100), "оплат не было");
  });

  it("собирает задание ИИ с цифрами обеих недель", () => {
    const prompt = buildAiDigestPrompt(METRICS, DEFAULT_AI_DIGEST_CONFIG);
    assert.ok(prompt.startsWith("type: wesetup_admin_weekly_digest\n---\n"));
    assert.match(prompt, /<org_data>[\s\S]*"revenueRub": 30000[\s\S]*"revenueRub": 20000[\s\S]*<\/org_data>/);
    assert.match(prompt, /ровно 3/);
  });

  it("разбирает ответ ИИ, в том числе в ```json и со строками-рекомендациями", () => {
    const reply = parseAiDigestReply(
      '```json\n{"summary":"Рост выручки.","avgCheckAnalysis":"Чек упал из-за скидок.","recommendations":[{"title":"Годовой тариф","text":"Предложить год."},"Апсейл"],"shortTip":"Продавайте год"}\n```',
      3
    );
    assert.ok(reply);
    assert.equal(reply.summary, "Рост выручки.");
    assert.equal(reply.recommendations.length, 2);
    assert.equal(reply.recommendations[1].title, "Апсейл");
    assert.equal(reply.shortTip, "Продавайте год");
    assert.equal(parseAiDigestReply("не JSON", 3), null);
    assert.equal(parseAiDigestReply('{"foo":1}', 3), null);
  });

  it("рисует письмо и короткий текст по шаблону, экранирует данные", () => {
    const narrative = fallbackNarrative(METRICS, 3);
    assert.equal(narrative.recommendations.length, 3);
    const raw = renderDigest(METRICS, narrative, DEFAULT_AI_DIGEST_CONFIG, { appUrl: "https://wesetup.ru" });
    const nb = (s: string) => s.replace(/ /g, " ");
    const out = { ...raw, subject: nb(raw.subject), bodyHtml: nb(raw.bodyHtml), text: nb(raw.text), telegram: nb(raw.telegram), max: nb(raw.max) };
    assert.equal(out.subject, "Итоги недели 23.11–29.11.2026: выручка 30 000 ₽ (+50%)");
    assert.match(out.bodyHtml, /Стандарт &lt;месяц&gt;/);
    assert.match(out.bodyHtml, /Как поднять средний чек/);
    assert.match(out.text, /Средний чек: 7 500 ₽ \(−25%; было 10 000 ₽\)/);
    assert.ok(out.telegram.startsWith("<b>📊 Неделя 23.11–29.11.2026</b>\n"));
    assert.match(out.max, /Оплат: 4 \(\+100%\), средний чек 7 500 ₽ \(−25%\)/);
    assert.ok(!out.max.includes("<b>"));
    assert.ok(out.max.length < 600, "короткий текст — сильно сокращённый");
  });

  it("убирает строку короткого текста, если переменная пустая, и выключает разделы", () => {
    const narrative = { ...fallbackNarrative(METRICS, 1), shortTip: "", recommendations: [] };
    const config = { ...DEFAULT_AI_DIGEST_CONFIG, sections: { ...DEFAULT_AI_DIGEST_CONFIG.sections, mailings: false, recommendations: false } };
    const out = renderDigest(METRICS, narrative, config, { appUrl: "https://wesetup.ru" });
    assert.ok(!out.max.includes("💡"));
    assert.ok(!out.bodyHtml.includes("Получателей охвачено"));
    assert.ok(!out.bodyHtml.includes("Как поднять средний чек"));
  });
});
