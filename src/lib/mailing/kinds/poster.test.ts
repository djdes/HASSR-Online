import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mailingKindOptions } from "@/lib/mailing/kinds";
import { buildRecipientContext, withMaxFallback } from "@/lib/mailing/queue";
import { getMailingTemplate } from "@/lib/mailing/templates";

import {
  checkPosterTexts,
  coercePosterPayload,
  defaultPosterPayload,
  posterAlt,
  posterCardPresets,
  posterRub,
  posterTextsKey,
  validatePosterPayload,
  type PosterMailPayload,
} from "./poster-shared";

const BG = "bg-4451e2e2-d236-4b04-9194-b7de0d4d72c4.jpg";
const IMAGE = "poster-0123456789abcdef01234567.jpg";

function composed(patch: Partial<PosterMailPayload["poster"]> = {}): PosterMailPayload {
  const base = defaultPosterPayload();
  const poster = { ...base.poster, background: BG, image: IMAGE, ...patch };
  return { ...base, poster: { ...poster, imageKey: posterTextsKey(poster) } };
}

function context(id: string) {
  return buildRecipientContext(
    { id, token: `${id}.sig`, email: "ivan@mail.ru", name: "Иван", companyName: "Кафе «Ромашка»", sphere: "cafe", userId: "u1", organizationId: "o1", contactId: null, links: [], payload: null },
    "https://wesetup.ru"
  );
}

describe("«Постер»: данные и проверка", () => {
  it("зарегистрирован с подписью и данными нового черновика", () => {
    const option = mailingKindOptions().find((k) => k.kind === "poster");
    assert.equal(option?.label, "Постер");
    const payload = option?.defaultPayload as PosterMailPayload;
    assert.equal(payload.poster.word, "ХАССП");
    assert.equal(payload.poster.cardValue, "14 дней");
    assert.equal(validatePosterPayload(payload).ok, true, "черновик без постера проходит — шапка будет живой вёрсткой");
  });

  it("надписи: одно слово, длина, без разметки", () => {
    assert.equal(checkPosterTexts({ word: "ХАССП" }).ok, true);
    assert.equal(checkPosterTexts({ word: "" }).ok, false);
    assert.equal(checkPosterTexts({ word: "ДВА СЛОВА" }).ok, false);
    assert.equal(checkPosterTexts({ word: "ОЧЕНЬДЛИННОЕСЛОВО" }).ok, false);
    assert.equal(checkPosterTexts({ word: "ХАССП", kicker: "<b>x</b>" }).ok, false);
    assert.equal(checkPosterTexts({ word: "ХАССП", cta: "{имя}" }).ok, false);
    const spaced = checkPosterTexts({ word: " ХАССП ", kicker: "  Электронные   журналы " });
    assert.ok(spaced.ok && spaced.texts.kicker === "Электронные журналы" && spaced.texts.word === "ХАССП");
  });

  it("письмо не уйдёт с устаревшим или чужим постером", () => {
    assert.equal(validatePosterPayload(composed()).ok, true);
    const stale = composed();
    stale.poster.word = "ЖУРНАЛЫ";
    const staleResult = validatePosterPayload(stale);
    assert.ok(!staleResult.ok && /Обновить надписи/.test(staleResult.error));
    assert.equal(validatePosterPayload({ ...composed(), poster: { ...composed().poster, image: "" } }).ok, false, "фон без собранного постера");
    assert.equal(validatePosterPayload(composed({ image: "../../.env" })).ok, false);
    assert.equal(validatePosterPayload(composed({ background: "https://evil.example/bg.jpg" })).ok, false);
  });

  it("тема, заголовок, текст и кнопка — как у «Сообщения»", () => {
    const base = defaultPosterPayload();
    assert.equal(validatePosterPayload({ ...base, subject: " " }).ok, false);
    assert.equal(validatePosterPayload({ ...base, headline: "" }).ok, false);
    assert.equal(validatePosterPayload({ ...base, body: "" }).ok, false);
    assert.equal(validatePosterPayload({ ...base, buttonUrl: "javascript:alert(1)" }).ok, false);
    assert.equal(validatePosterPayload({ ...base, buttonText: "", buttonUrl: "" }).ok, true);
  });

  it("черновик с мусором приводится к форме, неизвестные экран и сцена — по умолчанию", () => {
    const c = coercePosterPayload({ poster: { screen: "hack", scene: 5, word: "ЖУРНАЛЫ" }, subject: 1 });
    assert.equal(c.poster.screen, "grid");
    assert.equal(c.poster.scene, "restaurant");
    assert.equal(c.poster.word, "ЖУРНАЛЫ");
    assert.equal(c.subject, defaultPosterPayload().subject);
  });

  it("alt пересказывает надписи, карточка — только правда из тарифов", () => {
    const alt = posterAlt(defaultPosterPayload().poster);
    assert.match(alt, /^ХАССП — электронные журналы\./);
    assert.match(alt, /Бесплатно: 14 дней\./);
    assert.match(alt, /Подключите за день: \+7 \(495\) 109-65-43, wesetup\.ru\./);
    assert.equal(posterRub(2990), "2 990 ₽");
    assert.equal(posterRub(12990), "12 990 ₽");
    assert.deepEqual(
      posterCardPresets({ standardMonthRub: 2990 }).map((p) => p.value),
      ["14 дней", "без бумаг", "2 990 ₽"]
    );
    assert.equal(posterCardPresets(null).length, 2);
  });
});

describe("«Постер»: письмо и каналы", () => {
  it("постер сверху с alt и ссылкой, под ним живой текст, кнопка, контакты и отписка", async () => {
    const template = getMailingTemplate("poster");
    assert.ok(template);
    const { ctx, links } = context("mp1");
    const r = await template.render(composed(), ctx);
    const html = r.email?.html ?? "";
    assert.equal(r.email?.subject, "Журналы ХАССП в телефоне — проверка без бумаг");
    assert.match(html, new RegExp(`<img class="p-hero" src="https://wesetup\\.ru/uploads/mailing-poster/${IMAGE}"`));
    assert.match(html, /alt="ХАССП — электронные журналы\. Бесплатно: 14 дней\. Подключите за день: \+7 \(495\) 109-65-43, wesetup\.ru\."/);
    assert.match(html, /Здравствуйте, Иван!/);
    assert.match(html, /<h1[^>]*>Журналы ХАССП — в телефоне, а не в папке<\/h1>/);
    assert.match(html, /href="https:\/\/wesetup\.ru\/r\/mp1\.sig\/0"[^>]*>Попробовать бесплатно/);
    assert.match(html, /href="tel:\+74951096543"/);
    assert.match(html, /admin@wesetup\.ru/);
    assert.match(html, /https:\/\/wesetup\.ru\/unsubscribe\/mp1\.sig/);
    assert.deepEqual(links(), ["https://wesetup.ru/register", "https://wesetup.ru/"]);
    assert.match(r.email?.text ?? "", /Отписаться от новостей и предложений: https:\/\/wesetup\.ru\/unsubscribe\/mp1\.sig/);
    assert.match(r.email?.text ?? "", /Подключите за день: \+7 \(495\) 109-65-43/);
    assert.equal(r.notes, undefined);
    const max = withMaxFallback(r);
    assert.match(max.telegram?.text ?? "", /^<b>Журналы ХАССП — в телефоне, а не в папке<\/b>/);
    assert.equal(max.max?.buttonText, "Попробовать бесплатно");
  });

  it("без собранного постера — шапка живой вёрсткой и пометка для ROOT", async () => {
    const template = getMailingTemplate("poster");
    assert.ok(template);
    const { ctx } = context("mp2");
    const r = await template.render(defaultPosterPayload(), ctx);
    const html = r.email?.html ?? "";
    assert.doesNotMatch(html, /uploads\/mailing-poster/);
    assert.match(html, /class="p-word"[^>]*>ХАССП<\/p>/);
    assert.match(html, /Электронные журналы/);
    assert.ok(r.notes?.some((n) => /Постер ещё не собран/.test(n)));
  });

  it("надписи и тексты экранируются", async () => {
    const template = getMailingTemplate("poster");
    assert.ok(template);
    const { ctx } = context("mp3");
    const payload = { ...defaultPosterPayload(), headline: "<script>alert(1)</script>" };
    const html = (await template.render(payload, ctx)).email?.html ?? "";
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;/);
  });
});
