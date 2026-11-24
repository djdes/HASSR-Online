import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { buildRecipientContext, withMaxFallback } from "@/lib/mailing/queue";
import { mailingKindOptions, mailingTemplates } from "@/lib/mailing/kinds";
import { validateMessagePayload } from "@/lib/mailing/kinds/message-shared";
import { getMailingTemplate, registerMailingTemplate } from "@/lib/mailing/templates";

describe("точка расширения типов рассылки", () => {
  it("у каждого зарегистрированного типа есть компонент полей формы", () => {
    const kinds = mailingTemplates().map((t) => t.kind);
    assert.ok(kinds.includes("message"), "«Сообщение» зарегистрировано через тот же реестр");
    for (const kind of kinds) {
      const file = path.join(process.cwd(), "src", "components", "mailing", "fields", `${kind}.tsx`);
      assert.ok(fs.existsSync(file), `нет файла полей для типа «${kind}»: ${file}`);
      const source = fs.readFileSync(file, "utf8");
      assert.match(source, /export default function/, `у ${kind}.tsx нет default export`);
    }
  });

  it("список типов для формы — с подписью и данными нового черновика", () => {
    const message = mailingKindOptions().find((k) => k.kind === "message");
    assert.equal(message?.label, "Сообщение");
    assert.equal((message?.defaultPayload as { subject: string }).subject, "");
  });

  it("«КП» подключён той же строкой регистрации — шаблон, поля формы и данные для них", () => {
    const kp = getMailingTemplate("kp");
    assert.equal(kp?.label, "КП");
    assert.equal(typeof kp?.prepare, "function");
    assert.equal(typeof kp?.formData, "function");
    const option = mailingKindOptions().find((k) => k.kind === "kp");
    assert.deepEqual((option?.defaultPayload as { promo: { mode: string } }).promo.mode, "personal");
    assert.ok(fs.existsSync(path.join(process.cwd(), "src", "components", "mailing", "fields", "kp.tsx")));
  });

  it("повторная регистрация другого шаблона под тем же kind — ошибка", () => {
    assert.throws(() => registerMailingTemplate({ kind: "message", label: "Другой", render: async () => ({}) }));
    assert.throws(() => registerMailingTemplate({ kind: "Плохой kind", label: "x", render: async () => ({}) }));
  });
});

describe("тип «Сообщение»", () => {
  const payload = {
    subject: "{имя}, новое в WeSetup",
    body: "Здравствуйте, {имя}!\n\nДля {компания} — [тарифы](https://wesetup.ru/pricing).",
    buttonText: "Открыть кабинет",
    buttonUrl: "/dashboard",
    fallbacks: { name: "коллеги", company: "вашего заведения", sphere: "общепит" },
  };

  it("проверка данных: тема, текст, кнопка", () => {
    assert.equal(validateMessagePayload({ ...payload, subject: " " }).ok, false);
    assert.equal(validateMessagePayload({ ...payload, body: "" }).ok, false);
    assert.equal(validateMessagePayload({ ...payload, buttonUrl: "javascript:alert(1)" }).ok, false);
    assert.equal(validateMessagePayload({ ...payload, buttonUrl: "" }).ok, false);
    assert.equal(validateMessagePayload({ ...payload, buttonText: "", buttonUrl: "" }).ok, true);
    assert.equal(validateMessagePayload(payload).ok, true);
  });

  it("все каналы, переменные, учёт кликов и отписка в письме", async () => {
    const template = getMailingTemplate("message");
    assert.ok(template);
    const { ctx, links } = buildRecipientContext(
      {
        id: "mr1",
        token: "mr1.sig",
        email: "ivan@mail.ru",
        name: "Иван Петров",
        companyName: null,
        sphere: "cafe",
        userId: "u1",
        organizationId: "o1",
        contactId: null,
        links: [],
        payload: null,
      },
      "https://wesetup.ru"
    );
    const r = await template.render(payload, ctx);
    assert.equal(r.email?.subject, "Иван Петров, новое в WeSetup");
    assert.match(r.email?.html ?? "", /Для вашего заведения/);
    assert.match(r.email?.html ?? "", /href="https:\/\/wesetup\.ru\/r\/mr1\.sig\/0"/);
    assert.match(r.email?.html ?? "", /href="https:\/\/wesetup\.ru\/r\/mr1\.sig\/1"[^>]*>Открыть кабинет/);
    assert.match(r.email?.html ?? "", /https:\/\/wesetup\.ru\/unsubscribe\/mr1\.sig/);
    assert.match(r.email?.text ?? "", /Отписаться от новостей и предложений: https:\/\/wesetup\.ru\/unsubscribe\/mr1\.sig/);
    assert.deepEqual(links(), ["https://wesetup.ru/pricing", "/dashboard"]);
    assert.equal(r.inApp?.title, "Иван Петров, новое в WeSetup");
    assert.equal(r.inApp?.url, "/dashboard");
    assert.equal(r.push?.url, "/dashboard");
    assert.match(r.telegram?.text ?? "", /^<b>Иван Петров, новое в WeSetup<\/b>/);
    assert.match(r.telegram?.text ?? "", /<a href="https:\/\/wesetup\.ru\/r\/mr1\.sig\/1">Открыть кабинет<\/a>$/);
  });

  it("короткий текст — в Telegram, MAX, колокольчик и push; письмо — полный", async () => {
    const template = getMailingTemplate("message");
    assert.ok(template);
    const { ctx } = buildRecipientContext(
      {
        id: "mr2",
        token: "mr2.sig",
        email: "ivan@mail.ru",
        name: "Иван",
        companyName: null,
        sphere: "cafe",
        userId: "u1",
        organizationId: "o1",
        contactId: null,
        links: [],
        payload: null,
      },
      "https://wesetup.ru"
    );
    const short = { ...payload, shortBody: "{имя}, коротко: **скидка** до пятницы." };
    assert.equal(validateMessagePayload(short).ok, true);
    assert.equal(validateMessagePayload({ ...payload, shortBody: "я".repeat(1001) }).ok, false);
    const r = withMaxFallback(await template.render(short, ctx));
    assert.match(r.email?.html ?? "", /Для вашего заведения/);
    assert.doesNotMatch(r.email?.html ?? "", /коротко/);
    assert.match(r.telegram?.text ?? "", /Иван, коротко: <b>скидка<\/b> до пятницы\./);
    assert.doesNotMatch(r.telegram?.text ?? "", /Для вашего заведения/);
    assert.equal(r.inApp?.body, "Иван, коротко: скидка до пятницы.");
    assert.equal(r.max?.text, "Иван, новое в WeSetup\n\nИван, коротко: скидка до пятницы.");
    assert.equal(r.max?.buttonText, "Открыть кабинет");
    assert.equal(r.max?.url, "https://wesetup.ru/r/mr2.sig/1");
  });

  it("без короткого текста мессенджеры получают полный", async () => {
    const template = getMailingTemplate("message");
    assert.ok(template);
    const { ctx } = buildRecipientContext(
      { id: "mr3", token: "mr3.sig", email: null, name: "Иван", companyName: null, sphere: null, userId: "u1", organizationId: "o1", contactId: null, links: [], payload: null },
      "https://wesetup.ru"
    );
    const r = withMaxFallback(await template.render({ ...payload, shortBody: "  " }, ctx));
    assert.match(r.telegram?.text ?? "", /Для вашего заведения/);
    assert.match(r.max?.text ?? "", /тарифы \(https:\/\/wesetup\.ru\/r\/mr3\.sig\/0\)/);
  });
});
