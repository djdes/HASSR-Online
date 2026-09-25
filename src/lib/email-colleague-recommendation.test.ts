import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import {
  buildColleagueRecommendationEmail,
  sendColleagueRecommendationEmail,
  type ColleagueRecommendationEmailParams,
} from "@/lib/email";

const base: ColleagueRecommendationEmailParams = {
  to: "colleague@example.com",
  fromUserName: "Анна Смирнова",
  fromOrganizationName: "Кафе «Ромашка»",
  message: "Привет! Мы ведём журналы в WeSetup.\nПосмотри, ссылка ниже.",
  link: "https://wesetup.ru/r/ABCD2345?email=colleague%40example.com",
  referral: true,
  replyTo: "anna@example.com",
};

describe("buildColleagueRecommendationEmail", () => {
  it("тема и текст — с именем и организацией рекомендующего, ссылка и Reply-To на месте", () => {
    const email = buildColleagueRecommendationEmail(base);
    assert.equal(email.subject, "Анна Смирнова из «Кафе «Ромашка»» советует WeSetup");
    assert.equal(email.replyTo, "anna@example.com");
    assert.match(email.html, /<strong>Анна Смирнова<\/strong> из «Кафе «Ромашка»» советует вам WeSetup/);
    assert.match(email.html, /Привет! Мы ведём журналы в WeSetup\.\nПосмотри, ссылка ниже\./);
    assert.match(email.html, /— Анна Смирнова, Кафе «Ромашка»/);
    assert.ok(email.html.includes('href="https://wesetup.ru/r/ABCD2345?email=colleague%40example.com"'));
    assert.ok(email.html.includes("начислят бонус"), "реферальная ссылка — упоминаем бонус");
    assert.ok(email.html.includes("ответ получит Анна Смирнова"));
  });

  it("текст, имя и организация экранируются — HTML пользователя не исполняется", () => {
    const email = buildColleagueRecommendationEmail({
      ...base,
      fromUserName: 'Иван <img src=x onerror="alert(1)">',
      fromOrganizationName: "Ромашка & Co <script>",
      message: '<script>alert("xss")</script> и <a href="https://evil.example">ссылка</a>',
    });
    assert.equal(email.html.includes("<script>"), false);
    assert.equal(email.html.includes("<img src=x"), false);
    assert.equal(email.html.includes('<a href="https://evil.example"'), false);
    assert.ok(email.html.includes("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"));
    assert.ok(email.html.includes("Ромашка &amp; Co &lt;script&gt;"));
    assert.ok(email.html.includes("Иван &lt;img src=x onerror=&quot;alert(1)&quot;&gt;"));
  });

  it("тема — одна строка без управляющих символов и не бесконечная", () => {
    const email = buildColleagueRecommendationEmail({
      ...base,
      fromUserName: "Анна\r\nBcc: spam@example.com",
      fromOrganizationName: "О".repeat(300),
    });
    assert.equal(/[\r\n]/.test(email.subject), false);
    assert.ok(email.subject.startsWith("Анна Bcc: spam@example.com из «"));
    assert.ok(email.subject.length < 200);
  });

  it("обычная ссылка — без обещания бонуса; без имени и Reply-To — нейтральные формулировки", () => {
    const email = buildColleagueRecommendationEmail({
      ...base,
      fromUserName: null,
      link: "https://wesetup.ru/register?email=colleague%40example.com",
      referral: false,
      replyTo: null,
      message: "",
    });
    assert.equal(email.subject, "Коллега из «Кафе «Ромашка»» советует WeSetup");
    assert.ok(email.html.includes("Ваш коллега из «Кафе «Ромашка»» советует вам WeSetup"));
    assert.ok(email.html.includes('href="https://wesetup.ru/register?email=colleague%40example.com"'));
    assert.equal(email.html.includes("бонус"), false);
    assert.equal(email.html.includes("ответ получит"), false);
    assert.equal(email.html.includes("white-space:pre-wrap"), false, "пустое сообщение — без блока цитаты");
    assert.equal(email.replyTo, null);
  });
});

describe("sendColleagueRecommendationEmail без SMTP (dev)", () => {
  let savedHost: string | undefined;
  beforeEach(() => {
    savedHost = process.env.SMTP_HOST;
    // Никогда не шлём настоящих писем из тестов: пустой SMTP_HOST = dev-режим.
    process.env.SMTP_HOST = "";
  });
  afterEach(() => {
    if (savedHost === undefined) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = savedHost;
    mock.restoreAll();
  });

  it("письмо целиком уходит в лог сервера вместе с Reply-To и не считается отправленным", async () => {
    const info = mock.method(console, "info", () => undefined);
    const accepted = await sendColleagueRecommendationEmail(base);
    assert.equal(accepted, false);
    const lines = info.mock.calls.map((call) => String(call.arguments[0]));
    assert.ok(lines.some((line) => line.includes("письмо не отправлено на colleague@example.com")));
    assert.ok(lines.some((line) => line === "[email/dev] Subject: Анна Смирнова из «Кафе «Ромашка»» советует WeSetup"));
    assert.ok(lines.some((line) => line === "[email/dev] Reply-To: anna@example.com"));
    assert.ok(lines.some((line) => line.startsWith("[email/dev] Body:") && line.includes("https://wesetup.ru/r/ABCD2345?email=colleague%40example.com")));
  });
});
