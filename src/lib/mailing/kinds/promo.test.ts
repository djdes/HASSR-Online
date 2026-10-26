import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || "test-secret-for-promo-mailing-0123456789";

import { buildRecipientContext } from "@/lib/mailing/queue";
import type { MailingPrepareRecipient, MailingRenderMode } from "@/lib/mailing/templates";

import { createPromoTemplate, promoDateLabel, promoPreheader, type PromoTemplateDeps } from "./promo";
import { PROMO_DESIGNS, defaultPromoPayload, type PromoDesign, type PromoMailPayload } from "./promo-shared";

/** 29.09.2026 12:00 МСК; +30 дней → до 29.10 23:59:59 МСК. */
const NOW = new Date("2026-09-29T09:00:00.000Z");
const ENDS_30 = "2026-10-29T20:59:59.999Z";
const DESIGNS: PromoDesign[] = PROMO_DESIGNS.map((d) => d.key);

const SHARED = {
  OSEN20: { code: "OSEN20", kind: "percent" as const, value: 20, lifetime: false, endsAt: new Date("2026-10-31T20:59:59.999Z") },
  RUB500: { code: "RUB500", kind: "fixed" as const, value: 500, lifetime: false, endsAt: null },
};

function fakeDeps(over: Partial<PromoTemplateDeps> = {}) {
  const calls = {
    create: [] as Array<{ requests: Parameters<PromoTemplateDeps["createCodes"]>[0]; options: Parameters<PromoTemplateDeps["createCodes"]>[1] }>,
    readPromo: [] as string[],
  };
  const deps: PromoTemplateDeps = {
    now: () => NOW,
    async readPromo(code) {
      calls.readPromo.push(code);
      return SHARED[code as keyof typeof SHARED] ?? null;
    },
    async promoAudience(code) {
      if (code === "ANNA10") return { personal: true, maxUses: 1 };
      if (code === "ONCE10") return { personal: false, maxUses: 1 };
      if (code === "OFF10" || code in SHARED) return { personal: false, maxUses: null };
      return null;
    },
    async createCodes(requests, options) {
      calls.create.push({ requests, options });
      return new Map(requests.map((r, i) => [r.key, { id: `pc-${i}`, code: `PR${calls.create.length}N${i}15` }]));
    },
    async formData() {
      return { promoOptions: [], paidTariff: { title: "Подписка", priceRub: 1990 } };
    },
    log: () => {},
    ...over,
  };
  return { deps, calls };
}

function payload(patch: Partial<Omit<PromoMailPayload, "promo">> & { promo?: Partial<PromoMailPayload["promo"]> } = {}): PromoMailPayload {
  const base = defaultPromoPayload(patch.design);
  return { ...base, ...patch, promo: { ...base.promo, ...(patch.promo ?? {}) } };
}

function ctxFor(opts: { mode?: MailingRenderMode; personal?: Record<string, unknown>; track?: boolean; name?: string | null; company?: string | null } = {}) {
  return buildRecipientContext(
    {
      id: "mr1",
      token: "mr1.sig",
      email: "info@romashka.ru",
      name: opts.name === undefined ? "Анна" : opts.name,
      companyName: opts.company === undefined ? "Кафе «Ромашка»" : opts.company,
      sphere: "cafe",
      userId: null,
      organizationId: null,
      contactId: "k1",
      links: [],
      payload: opts.personal ?? null,
    },
    "https://wesetup.ru",
    { track: opts.track ?? true, mode: opts.mode ?? "preview" }
  );
}

function recipient(id: string, patch: Partial<MailingPrepareRecipient> = {}): MailingPrepareRecipient {
  return { id, email: `${id}@example.com`, organizationId: null, companyName: null, sphere: null, personal: {}, ...patch };
}

const SPAM = /бесплатн|!!!|срочно|выиграй/i;

describe("«Акция»: пять дизайнов письма", () => {
  const { deps } = fakeDeps();
  const promo = createPromoTemplate(deps);

  for (const design of DESIGNS) {
    describe(design, () => {
      async function render(extra: Partial<PromoMailPayload> = {}) {
        const { ctx, links } = ctxFor();
        const r = await promo.render(payload({ design, ...extra }), ctx);
        return { r, email: r.email!, links };
      }

      it("HTML до 100 КБ, свой документ, только абсолютные адреса, у картинок alt", async () => {
        const { email } = await render();
        assert.ok(Buffer.byteLength(email.html) < 100 * 1024, `размер ${Buffer.byteLength(email.html)}`);
        assert.match(email.html, /^<!DOCTYPE html>/);
        assert.match(email.html, /<meta charset="utf-8">/);
        assert.match(email.html, /name="viewport"/);
        assert.match(email.html, /name="color-scheme" content="light dark"/);
        assert.match(email.html, /fonts\.googleapis\.com\/css2\?family=Manrope/);
        for (const m of email.html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)) {
          assert.match(m[1], /^https?:\/\//, `href: ${m[1]}`);
        }
        for (const m of email.html.matchAll(/<img\b[^>]*>/g)) {
          assert.match(m[0], /\bsrc="https?:\/\/[^"]+"/, m[0]);
          assert.match(m[0], /\balt="[^"]*"/, `нет alt: ${m[0]}`);
        }
        assert.doesNotMatch(email.html, /src="data:|src="\/|href="\/|javascript:/);
      });

      it("отписка — напрямую, кнопка — через учёт кликов на /promo/КОД", async () => {
        const { email, links } = await render();
        assert.ok(email.html.includes('href="https://wesetup.ru/unsubscribe/mr1.sig"'));
        assert.doesNotMatch(email.html, /href="https:\/\/wesetup\.ru\/r\/[^"]*"[^>]*>\s*Отписаться/);
        assert.match(email.html, /href="https:\/\/wesetup\.ru\/r\/mr1\.sig\/0"/);
        assert.deepEqual(links(), ["https://wesetup.ru/promo/ROMASHKA15"]);
        assert.match(email.text, /https:\/\/wesetup\.ru\/unsubscribe\/mr1\.sig/);
        // VML-кнопка для Outlook ведёт туда же.
        const vml = email.html.match(/<v:roundrect[^>]*href="([^"]+)"/);
        assert.equal(vml?.[1], "https://wesetup.ru/r/mr1.sig/0");
      });

      it("без учёта кликов (предпросмотр) кнопка — прямой адрес /promo/КОД", async () => {
        const { ctx } = ctxFor({ track: false });
        const r = await promo.render(payload({ design }), ctx);
        assert.match(r.email!.html, /href="https:\/\/wesetup\.ru\/promo\/ROMASHKA15"/);
      });

      it("прехедер 20–140 знаков, тема ≤ 70 без спам-слов и капса", async () => {
        const { email } = await render();
        const pre = email.preheader ?? "";
        assert.ok(pre.length >= 20 && pre.length <= 140, `прехедер ${pre.length}: ${pre}`);
        assert.ok(email.html.includes(pre.replace(/&/g, "&amp;")), "прехедер в письме");
        assert.ok(email.subject.length <= 70, `тема ${email.subject.length}: ${email.subject}`);
        assert.doesNotMatch(email.subject, SPAM);
        const letters = email.subject.replace(/[^A-Za-zА-Яа-яЁё]/g, "");
        assert.notEqual(letters, letters.toUpperCase(), "тема не капсом");
        assert.match(email.html, new RegExp(`<title>${email.subject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</title>`));
      });

      it("мобильная версия, VML-кнопка, подвал с отпиской, без эмодзи", async () => {
        const { email } = await render();
        assert.match(email.html, /@media only screen and \(max-width:480px\)/);
        assert.match(email.html, /<!--\[if mso\]>[\s\S]*<v:roundrect/);
        assert.match(email.html, /Вы получили письмо, потому что пользуетесь WeSetup или оставляли контакт\./);
        assert.match(email.html, />Отписаться<\/a>/);
        assert.match(email.html, /WeSetup\u00a0— электронные журналы СанПиН и ХАССП/);
        assert.doesNotMatch(email.html, /\p{Extended_Pictographic}/u);
      });

      it("текст письма: подстановки сделаны, чисел и промокода достаточно", async () => {
        const { email } = await render();
        assert.doesNotMatch(email.html, /\{(percent|tariff|days|date|saving|offer|имя|компания)\}/);
        assert.match(email.html, /ROMASHKA15/);
        if (design === "aurora" || design === "countdown" || design === "compare") assert.match(email.html, /1\u00a0691\u00a0₽/);
        assert.match(email.text, /1\u00a0990\u00a0₽ → 1\u00a0691\u00a0₽/);
      });

      it("текстовая версия — без тегов, со ссылкой и отпиской", async () => {
        const { email } = await render();
        assert.doesNotMatch(email.text, /<[a-z/!][^>]*>/i);
        assert.match(email.text, /https:\/\/wesetup\.ru\/r\/mr1\.sig\/0/);
        assert.match(email.text, /Отписаться: https:\/\/wesetup\.ru\/unsubscribe\/mr1\.sig/);
      });
    });
  }

  it("светлые дизайны имеют тёмную схему и тёмный знак для неё; тёмные — белый знак", async () => {
    for (const design of ["coupon", "countdown", "compare", "letter"] as const) {
      const { ctx } = ctxFor();
      const html = (await promo.render(payload({ design }), ctx)).email!.html;
      assert.match(html, /prefers-color-scheme:dark/, design);
    }
    const compare = (await promo.render(payload({ design: "compare" }), ctxFor().ctx)).email!.html;
    assert.match(compare, /brand\/wordmark-dark\.png/);
    assert.match(compare, /brand\/wordmark\.png/);
    const aurora = (await promo.render(payload({ design: "aurora" }), ctxFor().ctx)).email!.html;
    assert.doesNotMatch(aurora, /wordmark-dark\.png/);
    assert.match(aurora, /<meta name="color-scheme"/);
  });

  it("countdown — GIF-таймер до конца кода; без срока — плашка со скидкой", async () => {
    const { ctx } = ctxFor({ personal: { promoCode: "ROMASHKA15", promoEndsAt: ENDS_30 } });
    const html = (await promo.render(payload({ design: "countdown" }), ctx)).email!.html;
    const img = html.match(/<img[^>]*src="([^"]*countdown\.gif[^"]*)"[^>]*>/);
    assert.ok(img, "картинка-таймер");
    assert.match(img![1].replace(/&amp;/g, "&"), /^https:\/\/wesetup\.ru\/api\/mailing\/countdown\.gif\?until=2026-10-29T20%3A59%3A59\.999Z&theme=dark$/);
    assert.match(img![0], /alt="До конца акции 30 дн\."/);
    assert.match(html, /Осталось 30 из 30 дн\./);
    assert.match(html, /Успейте до 29\u00a0октября|Успейте до 29 октября/);

    const open = createPromoTemplate(fakeDeps({ async readPromo() { return { ...SHARED.RUB500 }; } }).deps);
    const html2 = (await open.render(payload({ design: "countdown", promo: { mode: "existing", code: "RUB500" } }), ctxFor().ctx)).email!.html;
    assert.doesNotMatch(html2, /countdown\.gif/);
    assert.match(html2, /Успейте до конца акции/);
  });

  it("личное письмо: имя, маркер на предложении, промокод моноширинно, подпись и P.S.", async () => {
    const html = (await promo.render(payload({ design: "letter" }), ctxFor().ctx)).email!.html;
    assert.match(html, /Анна, здравствуйте!/);
    assert.match(html, /<span class="mark"[^>]*>−15\u00a0% на 30\u00a0дней<\/span>/);
    assert.match(html, /Команда WeSetup/);
    assert.match(html, /P\.S\. Предложение действует до 29 октября\./);
    assert.match(html, /ответьте на это письмо/);
  });

  it("тексты безопасны: чужие значения экранируются, служебные знаки не попадают в разметку", async () => {
    const { ctx } = ctxFor({ company: '<img src=x onerror=alert(1)>"', name: "Ann" });
    for (const design of DESIGNS) {
      const r = await promo.render(payload({ design, headline: "{компания}, привет", lead: "Для {компания}: {offer}" }), ctx);
      assert.doesNotMatch(r.email!.html, /<img src=x/);
      assert.doesNotMatch(r.email!.html, /[\uE000\uE001]/);
      assert.match(r.email!.html, /&lt;img src=x/);
    }
  });

  it("запасные значения: нет имени и компании — «коллеги»", async () => {
    const { ctx } = ctxFor({ name: null, company: null });
    const r = await promo.render(payload({ design: "letter" }), ctx);
    assert.match(r.email!.subject, /^коллеги, персональная скидка для ваше заведение/);
    assert.match(r.email!.html, /Коллеги, здравствуйте!/);
  });
});

describe("«Акция»: каналы и пометки", () => {
  const { deps } = fakeDeps();
  const promo = createPromoTemplate(deps);

  it("колокольчик и push — коротко, ссылка на /promo/КОД; Telegram — с кодом и трекинговой ссылкой", async () => {
    const { ctx } = ctxFor();
    const r = await promo.render(payload(), ctx);
    assert.equal(r.inApp?.title, "Стандарт на 15 % дешевле");
    assert.equal(r.inApp?.url, "/promo/ROMASHKA15");
    assert.equal(r.push?.url, "/promo/ROMASHKA15");
    assert.ok((r.push?.body ?? "").length <= 180);
    assert.match(r.inApp?.body ?? "", /Промокод ROMASHKA15\.$/);
    assert.match(r.telegram?.text ?? "", /^<b>Стандарт на 15\u00a0% дешевле<\/b>/);
    assert.match(r.telegram?.text ?? "", /Промокод: <code>ROMASHKA15<\/code> — применится сам по ссылке/);
    assert.match(r.telegram?.text ?? "", /<a href="https:\/\/wesetup\.ru\/r\/mr1\.sig\/0">Забрать скидку 15\u00a0%<\/a>$/);
    assert.equal(r.telegram?.url, "https://wesetup.ru/r/mr1.sig/0");
  });

  it("предпросмотр и тест без кода — пример и пометка; live без кода — ошибка", async () => {
    for (const mode of ["preview", "test"] as const) {
      const r = await promo.render(payload(), ctxFor({ mode }).ctx);
      assert.match(r.notes?.[0] ?? "", /Промокод ROMASHKA15 — пример/);
    }
    await assert.rejects(() => promo.render(payload(), ctxFor({ mode: "live" }).ctx), /нет персонального промокода/);
    const live = await promo.render(payload(), ctxFor({ mode: "live", personal: { promoCode: "KP1N015", promoEndsAt: ENDS_30 } }).ctx);
    assert.equal(live.notes, undefined);
    assert.match(live.email!.html, /KP1N015/);
  });

  it("общий код: условия из самого кода (процент и срок), цена по нему", async () => {
    const r = await promo.render(payload({ design: "compare", promo: { mode: "existing", code: "osen20" } }), ctxFor().ctx);
    // 20 % от 1990 = 398 → 1592; срок кода — 31 октября
    assert.match(r.email!.html, /1\u00a0592\u00a0₽/);
    assert.match(r.email!.html, /Экономия&nbsp;398&nbsp;₽ в месяц|Экономия&nbsp;398&nbsp;₽/);
    assert.match(r.email!.html, /до 31 октября/);
    assert.match(r.email!.html, /\/promo\/OSEN20|r\/mr1\.sig\/0/);
    const fixed = createPromoTemplate(fakeDeps().deps);
    const f = await fixed.render(payload({ design: "compare", promo: { mode: "existing", code: "RUB500" } }), ctxFor().ctx);
    assert.match(f.email!.html, /1\u00a0490\u00a0₽/);
    assert.match(f.email!.html, /до конца акции/);
  });

  it("общий код выключили после запуска — письмо не уходит", async () => {
    const off = createPromoTemplate(fakeDeps({ async readPromo() { return null; } }).deps);
    await assert.rejects(() => off.render(payload({ promo: { mode: "existing", code: "OSEN20" } }), ctxFor().ctx), /не действует/);
  });

  it("promoDateLabel и promoPreheader", () => {
    assert.equal(promoDateLabel(new Date(ENDS_30)), "29 октября");
    assert.equal(promoDateLabel(new Date("2026-10-29T21:00:00.000Z")), "29 октября");
    assert.equal(promoPreheader("Короткий", "Заголовок", "−15 % на 30 дней"), "Заголовок. −15 % на 30 дней.");
    assert.ok(promoPreheader("слово ".repeat(80), "Заголовок", "x").length <= 130);
  });
});

describe("«Акция»: проверка и подготовка кодов", () => {
  it("validate: ошибки формы и общий код из базы", async () => {
    const { deps } = fakeDeps();
    const promo = createPromoTemplate(deps);
    const err = async (p: PromoMailPayload) => {
      const r = await promo.validate!(p);
      return r.ok ? null : r.error;
    };
    assert.equal(await err(payload()), null);
    assert.match((await err(payload({ discountPercent: 95 }))) ?? "", /Скидка/);
    assert.match((await err(payload({ promo: { mode: "existing", code: null } }))) ?? "", /Выберите промокод/);
    assert.match((await err(payload({ promo: { mode: "existing", code: "NOPE10" } }))) ?? "", /нет в «Промокодах»/);
    assert.match((await err(payload({ promo: { mode: "existing", code: "ANNA10" } }))) ?? "", /персональный/);
    assert.match((await err(payload({ promo: { mode: "existing", code: "ONCE10" } }))) ?? "", /одноразовый/);
    assert.match((await err(payload({ promo: { mode: "existing", code: "OFF10" } }))) ?? "", /сейчас не действует/);
    const ok = await promo.validate!(payload({ promo: { mode: "existing", code: "osen20" } }));
    assert.equal(ok.ok && ok.payload.promo.code, "OSEN20");
  });

  it("prepare personal: код каждому на durationDays, процент, навсегда, заметка рассылки", async () => {
    const { deps, calls } = fakeDeps();
    const promo = createPromoTemplate(deps);
    const result = await promo.prepare!({ id: "c1", title: "Акция октябрь", payload: payload({ promo: { lifetime: true } }) }, [
      recipient("user", { organizationId: "org1", companyName: "Кафе «Ромашка»" }),
      recipient("kid", { companyName: "Детский сад №5" }),
    ]);
    assert.equal(calls.create.length, 1);
    const { requests, options } = calls.create[0];
    assert.deepEqual(requests, [
      { key: "user", email: null, organizationId: "org1", companyName: "Кафе «Ромашка»" },
      { key: "kid", email: null, companyName: "Детский сад №5", unlocked: true },
    ]);
    assert.equal(options.kind, "percent");
    assert.equal(options.value, 15);
    assert.equal(options.lifetime, true);
    assert.equal(options.endsAt?.toISOString(), ENDS_30);
    assert.equal(options.note, "Рассылка «Акция октябрь»");
    assert.equal(options.campaignId, "c1");
    assert.deepEqual(result, {
      user: { promoCode: "PR1N015", promoEndsAt: ENDS_30 },
      kid: { promoCode: "PR1N115", promoEndsAt: ENDS_30 },
    });
  });

  it("prepare идемпотентна: у кого код есть — пропуск; повтор не создаёт новых", async () => {
    const { deps, calls } = fakeDeps();
    const promo = createPromoTemplate(deps);
    const kept = { promoCode: "ROMASHKA15", promoEndsAt: ENDS_30 };
    const first = await promo.prepare!({ id: "c1", title: "A", payload: payload() }, [recipient("done", { personal: kept }), recipient("new")]);
    assert.deepEqual(calls.create[0].requests.map((r) => r.key), ["new"]);
    assert.deepEqual(Object.keys(first), ["new"]);
    const again = await promo.prepare!({ id: "c1", title: "A", payload: payload() }, [
      recipient("done", { personal: kept }),
      recipient("new", { personal: first.new }),
    ]);
    assert.deepEqual(again, {});
    assert.equal(calls.create.length, 1);
  });

  it("общий код — персональных кодов нет; не создано всем — ошибка", async () => {
    const { deps, calls } = fakeDeps();
    const promo = createPromoTemplate(deps);
    assert.deepEqual(await promo.prepare!({ id: "c1", title: "", payload: payload({ promo: { mode: "existing", code: "OSEN20" } }) }, [recipient("a")]), {});
    assert.equal(calls.create.length, 0);
    const short = createPromoTemplate(fakeDeps({ async createCodes() { return new Map(); } }).deps);
    await assert.rejects(() => short.prepare!({ id: "c1", title: "", payload: payload() }, [recipient("a")]), /создано кодов 0 из 1/);
  });

  it("форма: данные нового черновика и formData", async () => {
    const { deps } = fakeDeps();
    const promo = createPromoTemplate(deps);
    assert.equal(promo.kind, "promo");
    assert.equal(promo.label, "Акция");
    assert.equal(promo.defaultPayload!().design, "aurora");
    assert.deepEqual(await promo.formData!(), { promoOptions: [], paidTariff: { title: "Подписка", priceRub: 1990 } });
  });
});
