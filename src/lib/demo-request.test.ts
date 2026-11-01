/* eslint-disable react/no-children-prop -- typed createElement calls need children in provider props. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";

import { DemoRequestButton } from "@/components/public/demo-request-button";
import { loadMessages } from "@/i18n/messages";
import {
  DEMO_SERVICE_KEY,
  DEMO_SERVICE_TITLE,
  composeDemoAlert,
  composeDemoComment,
  hasEnoughPhoneDigits,
  type DemoRequest,
} from "@/lib/demo-request";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const request: DemoRequest = {
  name: "Анна <Кафе>",
  phone: "+7 (999) 111-22-33",
  when: "tomorrow",
  topic: "Датчики & холодильники",
  place: "pricing",
  source: { place: "pricing", landing: "/dlya-kafe", referrer: "", utmSource: "yandex", utmMedium: "cpc", utmCampaign: "kafe" },
  organizationName: null,
};

describe("показ за 15 минут — тексты", () => {
  it("сигнал админу: позвонить в течение часа, всё экранировано, источник и кнопка", () => {
    const text = composeDemoAlert(request, escape);
    assert.match(text, /^<b>📅 Показ за 15 минут — позвоните в течение часа<\/b>/);
    assert.match(text, /👤 Анна &lt;Кафе&gt; · 📞 \+7 \(999\) 111-22-33/);
    assert.match(text, /🕐 Когда удобно: завтра/);
    assert.match(text, /💬 Датчики &amp; холодильники/);
    assert.match(text, /🔎 Яндекс Директ · yandex \/ cpc \/ kafe · вход: \/dlya-kafe · кнопка «pricing»/);
    assert.doesNotMatch(text, /🏢/);
  });

  it("комментарий заявки в ROOT и проверка телефона", () => {
    assert.equal(
      composeDemoComment({ ...request, topic: null, source: null }),
      "Когда удобно: завтра\nКнопка: pricing\nИсточник: Нет данных",
    );
    assert.equal(hasEnoughPhoneDigits("+7 999"), false);
    assert.equal(hasEnoughPhoneDigits("+7 (999) 1"), false);
    assert.equal(hasEnoughPhoneDigits("+7 (999) 12"), true);
    assert.equal(DEMO_SERVICE_KEY, "demo-call");
    assert.equal(DEMO_SERVICE_TITLE, "Показ WeSetup за 15 минут");
  });
});

describe("показ за 15 минут — сервер", () => {
  it("ловушка заполнена — «ок» без записи; без согласия и с плохим телефоном — 400", async () => {
    const { POST } = await import("@/app/api/demo-request/route");
    const post = (body: unknown) =>
      POST(new Request("http://localhost/api/demo-request", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

    const trap = await post({ website: "http://spam", name: "Bot", phone: "123" });
    assert.equal(trap.status, 200);
    assert.deepEqual(await trap.json(), { ok: true });

    const noConsent = await post({ name: "Анна", phone: "+79991112233", when: "today" });
    assert.equal(noConsent.status, 400);
    assert.match((await noConsent.json()).error, /согласие/);

    const badPhone = await post({ name: "Анна", phone: "12", when: "today", consent: true });
    assert.equal(badPhone.status, 400);
    assert.match((await badPhone.json()).error, /телефон/);
  });

  it("заявка ложится в общий список заявок, лимит свой, уведомления не роняют заявку", () => {
    const route = read("src/app/api/demo-request/route.ts");
    assert.match(route, /demoRequestRateLimiter\.consume\(`demo:\$\{ip\}`\)/);
    assert.match(route, /db\.serviceRequest\.create\(\{\s*data: \{\s*serviceKey: DEMO_SERVICE_KEY,/);
    assert.match(route, /notifyPlatformAdmin\(composeDemoAlert\(demo, escapeTelegramHtml\)/);
    assert.match(route, /\.catch\(\(\) => false\)/);
    assert.match(route, /adminTgNotifiedAt: tgOk \? new Date\(\) : null/);
  });

  it("кнопка стоит на /pricing, на страницах сфер и в финале главной (ru)", () => {
    assert.match(read("src/app/pricing/page.tsx"), /<DemoRequestButton place="pricing" variant="onDark" \/>/);
    const niche = read("src/components/landing/niche-landing.tsx");
    assert.match(niche, /<DemoRequestButton place=\{`niche:\$\{data\.slug\}`\} variant="onDark" \/>/);
    assert.match(niche, /<DemoRequestButton place=\{`niche:\$\{data\.slug\}:bottom`\} variant="onDark" \/>/);
    assert.match(read("src/app/page.tsx"), /!isAuthed && locale === "ru" \? \(\s*<DemoRequestButton place="home:final"/);
  });
});

describe("показ за 15 минут — кнопка на трёх языках", () => {
  it("подпись из каталога, у en/uz без кириллицы", async () => {
    for (const locale of ["ru", "en", "uz"] as const) {
      const messages = await loadMessages(locale);
      const html = renderToStaticMarkup(
        createElement(NextIntlClientProvider, {
          locale,
          messages,
          timeZone: "Europe/Moscow",
          children: createElement(DemoRequestButton, { place: "test" }),
        }),
      );
      assert.ok(html.includes(messages.publicUi.demoRequest.trigger), locale);
      assert.match(html, /data-demo-request="test"/);
      if (locale !== "ru") assert.doesNotMatch(html, /\p{Script=Cyrillic}/u);
    }
  });
});
