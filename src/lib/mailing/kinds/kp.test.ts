import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || "test-secret-for-kp-mailing-0123456789";

import { buildRecipientContext } from "@/lib/mailing/queue";
import type { MailingPrepareRecipient, MailingRenderMode } from "@/lib/mailing/templates";
import { sphereLandingPath } from "@/lib/proposal/cta";
import { SAMPLE_NOW, sampleProposalContext } from "@/lib/proposal/sample";
import { verifyProposalToken } from "@/lib/proposal/token";
import type { ProposalPromo } from "@/lib/proposal/types";

import { KP_CHANNEL_TITLE, createKpTemplate, kpPdfFilename, type KpTemplateDeps } from "./kp";
import { defaultKpPayload, type KpPayload } from "./kp-shared";

const NBSP = "\u00a0";
/** 29.09 + 14 дней → до 13.10 23:59:59 по Москве. */
const ENDS_14 = "2026-10-13T20:59:59.999Z";

const SHARED: Record<string, ProposalPromo> = {
  OSEN20: { code: "OSEN20", kind: "percent", value: 20, lifetime: false, endsAt: new Date("2026-10-31T20:59:59.999Z") },
};

function fakeDeps(over: Partial<KpTemplateDeps> = {}) {
  const calls = {
    create: [] as Array<{ requests: Parameters<KpTemplateDeps["createCodes"]>[0]; options: Parameters<KpTemplateDeps["createCodes"]>[1] }>,
    readPromo: [] as string[],
    loadContext: 0,
    pdf: 0,
    logs: [] as string[],
  };
  let now = SAMPLE_NOW;
  const deps: KpTemplateDeps = {
    now: () => now,
    async loadContext(at) {
      calls.loadContext += 1;
      return sampleProposalContext({ now: at });
    },
    async readPromo(code) {
      calls.readPromo.push(code);
      return SHARED[code] ?? null;
    },
    async promoAudience(code) {
      if (code === "ANNA10") return { personal: true, maxUses: 1 };
      if (code === "ONCE10") return { personal: false, maxUses: 1 };
      if (code === "OFF10" || SHARED[code]) return { personal: false, maxUses: null };
      return null;
    },
    async createCodes(requests, options) {
      calls.create.push({ requests, options });
      return new Map(requests.map((r, i) => [r.key, { id: `pc-${i}`, code: `KP${calls.create.length}N${i}10` }]));
    },
    renderPdf() {
      calls.pdf += 1;
      return Buffer.from("%PDF-1.7 fake");
    },
    async formData() {
      return { promoOptions: [], senderName: null };
    },
    log: (level, message) => calls.logs.push(`${level} ${message}`),
    ...over,
  };
  return { deps, calls, setNow: (d: Date) => (now = d) };
}

function payload(patch: Omit<Partial<KpPayload>, "promo"> & { promo?: Partial<KpPayload["promo"]> } = {}): KpPayload {
  const base = defaultKpPayload();
  return { ...base, ...patch, promo: { ...base.promo, ...(patch.promo ?? {}) } };
}

function ctxFor(
  opts: {
    mode?: MailingRenderMode;
    sphere?: string | null;
    company?: string | null;
    name?: string | null;
    personal?: Record<string, unknown>;
    track?: boolean;
  } = {}
) {
  return buildRecipientContext(
    {
      id: "mr1",
      token: "mr1.sig",
      email: "info@romashka.ru",
      name: opts.name === undefined ? "Анна Сергеевна" : opts.name,
      companyName: opts.company === undefined ? "Кафе «Ромашка»" : opts.company,
      sphere: opts.sphere === undefined ? "cafe" : opts.sphere,
      userId: null,
      organizationId: null,
      contactId: "k1",
      links: [],
      payload: opts.personal ?? null,
    },
    "https://wesetup.ru",
    { track: opts.track ?? true, mode: opts.mode ?? "live" }
  );
}

function recipient(id: string, patch: Partial<MailingPrepareRecipient> = {}): MailingPrepareRecipient {
  return { id, email: `${id}@example.com`, organizationId: null, companyName: null, sphere: null, personal: {}, ...patch };
}

describe("«КП»: проверка данных", () => {
  const { deps } = fakeDeps();
  const kp = createKpTemplate(deps);

  it("новый черновик — персональные коды 10 % навсегда на 14 дней, без PDF, сфера «Ресторан»", async () => {
    const p = defaultKpPayload();
    assert.deepEqual(p, {
      defaultSphere: "restaurant",
      promo: { mode: "personal", code: null, kind: "percent", value: 10, lifetime: true, validDays: 14 },
      attachPdf: false,
    });
    assert.equal((await kp.validate!(p)).ok, true);
  });

  it("персональные: скидка 1–100 %, в рублях — до 100 000, срок 1–90 дней", async () => {
    const bad = [
      payload({ promo: { value: 0 } }),
      payload({ promo: { value: 101 } }),
      payload({ promo: { value: 7.5 } }),
      payload({ promo: { kind: "fixed", value: 100_001 } }),
      payload({ promo: { validDays: 0 } }),
      payload({ promo: { validDays: 91 } }),
    ];
    for (const p of bad) assert.equal((await kp.validate!(p)).ok, false, JSON.stringify(p.promo));
    assert.equal((await kp.validate!(payload({ promo: { value: 100, validDays: 90 } }))).ok, true);
    assert.equal((await kp.validate!(payload({ promo: { kind: "fixed", value: 500, validDays: 1 } }))).ok, true);
    const tooBig = await kp.validate!(payload({ promo: { value: 101 } }));
    assert.equal(!tooBig.ok && tooBig.error, "Скидка в процентах — от 1 до 100");
  });

  it("выбранный код: есть, действует, общий и не одноразовый", async () => {
    const check = async (code: string | null) => kp.validate!(payload({ promo: { mode: "existing", code } }));
    const errors = async (code: string | null) => {
      const r = await check(code);
      return r.ok ? null : r.error;
    };
    assert.match((await errors(null)) ?? "", /Выберите промокод/);
    assert.match((await errors("NOPE10")) ?? "", /нет в «Промокодах»/);
    assert.match((await errors("ANNA10")) ?? "", /персональный/);
    assert.match((await errors("ONCE10")) ?? "", /одноразовый/);
    assert.match((await errors("OFF10")) ?? "", /сейчас не действует/);
    const ok = await check("osen20");
    assert.equal(ok.ok, true);
    assert.equal(ok.ok && ok.payload.promo.code, "OSEN20");
  });

  it("без промокода — проверять нечего", async () => {
    assert.equal((await kp.validate!(payload({ promo: { mode: "none", value: 0 } }))).ok, true);
  });
});

describe("«КП»: подготовка персональных кодов", () => {
  it("пользователь — код организации, контакты — без привязки; срок и заметка рассылки", async () => {
    const { deps, calls } = fakeDeps();
    const kp = createKpTemplate(deps);
    const result = await kp.prepare!({ id: "c1", title: "КП октябрь", payload: payload() }, [
      recipient("user", { organizationId: "org1", companyName: "Кафе «Ромашка»", sphere: "cafe" }),
      recipient("kid", { companyName: "Детский сад №5", sphere: "education" }),
      recipient("hotel", { companyName: "Отель «Волна»", sphere: "hotel" }),
    ]);
    assert.equal(calls.create.length, 1);
    const { requests, options } = calls.create[0];
    assert.deepEqual(requests, [
      { key: "user", email: null, organizationId: "org1", companyName: "Кафе «Ромашка»" },
      { key: "kid", email: null, companyName: "Детский сад №5", unlocked: true },
      { key: "hotel", email: null, companyName: "Отель «Волна»", unlocked: true },
    ]);
    assert.equal(options.kind, "percent");
    assert.equal(options.value, 10);
    assert.equal(options.lifetime, true);
    assert.equal(options.endsAt?.toISOString(), ENDS_14);
    assert.equal(options.note, "Рассылка «КП октябрь»");
    assert.equal(options.campaignId, "c1");
    assert.deepEqual(result, {
      user: { promoCode: "KP1N010", promoEndsAt: ENDS_14 },
      kid: { promoCode: "KP1N110", promoEndsAt: ENDS_14 },
      hotel: { promoCode: "KP1N210", promoEndsAt: ENDS_14 },
    });
  });

  it("идемпотентно: у кого код уже есть — не создаём заново", async () => {
    const { deps, calls } = fakeDeps();
    const kp = createKpTemplate(deps);
    const kept = { promoCode: "ROMASHKA10", promoEndsAt: ENDS_14 };
    const partial = await kp.prepare!({ id: "c1", title: "КП", payload: payload() }, [
      recipient("done", { organizationId: "org1", personal: kept }),
      recipient("new"),
    ]);
    assert.deepEqual(calls.create[0].requests.map((r) => r.key), ["new"]);
    assert.deepEqual(Object.keys(partial), ["new"]);
    const again = await kp.prepare!({ id: "c1", title: "КП", payload: payload() }, [
      recipient("done", { personal: kept }),
      recipient("new", { personal: partial.new }),
    ]);
    assert.deepEqual(again, {});
    assert.equal(calls.create.length, 1);
  });

  it("общий код и «без промокода» — персональных кодов нет", async () => {
    const { deps, calls } = fakeDeps();
    const kp = createKpTemplate(deps);
    const all = [recipient("a", { organizationId: "o" }), recipient("b")];
    assert.deepEqual(await kp.prepare!({ id: "c1", title: "", payload: payload({ promo: { mode: "existing", code: "OSEN20" } }) }, all), {});
    assert.deepEqual(await kp.prepare!({ id: "c1", title: "", payload: payload({ promo: { mode: "none" } }) }, all), {});
    assert.equal(calls.create.length, 0);
  });
});

describe("«КП»: письмо и каналы", () => {
  const personal = { promoCode: "ROMASHKA10", promoEndsAt: ENDS_14 };

  it("письмо с персональным кодом, отпиской и ссылками через учёт кликов", async () => {
    const { deps, calls } = fakeDeps();
    const kp = createKpTemplate(deps);
    const { ctx, links } = ctxFor({ personal });
    const r = await kp.render(payload(), ctx);
    const email = r.email!;
    assert.equal(email.subject, "Кафе «Ромашка»: журналы СанПиН с телефона");
    assert.match(email.html, /ROMASHKA10/);
    assert.match(email.html, /действует до 13\u00a0октября: при оплате до этого дня скидка остаётся навсегда/);
    // Кнопка, веб-версия, PDF — через /r/, отписка — напрямую.
    assert.match(email.html, /href="https:\/\/wesetup\.ru\/r\/mr1\.sig\/0"/);
    assert.match(email.html, /https:\/\/wesetup\.ru\/unsubscribe\/mr1\.sig/);
    assert.doesNotMatch(email.html, /href="https:\/\/wesetup\.ru\/promo\//);
    assert.match(email.text, /https:\/\/wesetup\.ru\/unsubscribe\/mr1\.sig/);
    const stored = links();
    assert.equal(stored[0], "https://wesetup.ru/promo/ROMASHKA10?s=cafe");
    const web = stored.find((u) => /\/kp\/[^/]+$/.test(u));
    assert.ok(web, stored.join(" "));
    assert.ok(stored.includes(`${web}/pdf`));
    const token = verifyProposalToken(web!.split("/kp/")[1]);
    assert.equal(token.ok && token.vars.sphere, "cafe");
    assert.equal(token.ok && token.vars.promo?.code, "ROMASHKA10");
    assert.equal(token.ok && token.vars.promo?.endsAt?.toISOString(), ENDS_14);
    assert.equal(token.ok && token.vars.companyName, "Кафе «Ромашка»");
    assert.equal(token.ok && token.vars.recipientName, "Анна Сергеевна");
    assert.equal(email.attachments, undefined);
    assert.equal(r.notes, undefined);
    assert.equal(calls.pdf, 0);
  });

  it("колокольчик, push и Telegram — коротко, цифры из КП, ссылка на веб-версию", async () => {
    const { deps } = fakeDeps();
    const kp = createKpTemplate(deps);
    const { ctx, links } = ctxFor({ personal });
    const r = await kp.render(payload(), ctx);
    const body = `Команда до 10 сотрудников — 1${NBSP}791${NBSP}₽/мес со скидкой 10${NBSP}% навсегда по промокоду ROMASHKA10 (код действует до 13${NBSP}октября).`;
    assert.equal(r.inApp?.title, KP_CHANNEL_TITLE);
    assert.equal(r.inApp?.title, "Предложение WeSetup для вашей команды");
    assert.ok(r.inApp?.body.startsWith(body), r.inApp?.body);
    assert.match(r.inApp?.body ?? "", /Бесплатно — все .+ для 1 сотрудника\.$/);
    const webIndex = links().findIndex((u) => /\/kp\/[^/]+$/.test(u));
    const tracked = `https://wesetup.ru/r/mr1.sig/${webIndex}`;
    assert.equal(r.inApp?.url, tracked);
    assert.equal(r.push?.title, KP_CHANNEL_TITLE);
    assert.equal(r.push?.body, r.inApp?.body);
    assert.equal(r.push?.url, tracked);
    assert.ok(r.telegram?.text.startsWith(`<b>${KP_CHANNEL_TITLE}</b>\n\n${body}`), r.telegram?.text);
    assert.ok(r.telegram?.text.endsWith(`<a href="${tracked}">Открыть предложение</a>`), r.telegram?.text);
  });

  it("PDF вложением — только по галочке", async () => {
    const { deps, calls } = fakeDeps();
    const kp = createKpTemplate(deps);
    const r = await kp.render(payload({ attachPdf: true }), ctxFor({ personal }).ctx);
    assert.equal(r.email?.attachments?.length, 1);
    assert.equal(r.email?.attachments?.[0].filename, "КП WeSetup — Кафе «Ромашка».pdf");
    assert.equal(r.email?.attachments?.[0].contentType, "application/pdf");
    assert.ok(Buffer.isBuffer(r.email?.attachments?.[0].content));
    assert.equal(calls.pdf, 1);
    assert.equal(kpPdfFilename({ companyName: null, sphereLabel: "Кафе / Кофейня" }), "КП WeSetup — Кафе, Кофейня.pdf");
    assert.equal(kpPdfFilename({ companyName: 'ООО "Вектор": столовая', sphereLabel: "Столовая" }), "КП WeSetup — ООО Вектор столовая.pdf");
  });

  it("сфера получателя, а без неё — сфера по умолчанию", async () => {
    const { deps } = fakeDeps();
    const kp = createKpTemplate(deps);
    const sphereOf = async (sphere: string | null) => {
      const { ctx, links } = ctxFor({ personal, sphere });
      await kp.render(payload({ defaultSphere: "hotel" }), ctx);
      const web = links().find((u) => /\/kp\/[^/]+$/.test(u))!;
      const token = verifyProposalToken(web.split("/kp/")[1]);
      return { sphere: token.ok ? token.vars.sphere : null, cta: links()[0] };
    };
    assert.deepEqual(await sphereOf("education"), { sphere: "education", cta: "https://wesetup.ru/promo/ROMASHKA10?s=education" });
    assert.deepEqual(await sphereOf(null), { sphere: "hotel", cta: "https://wesetup.ru/promo/ROMASHKA10?s=hotel" });
  });

  it("предпросмотр и тест себе — пример кода с пометкой; настоящая отправка без кода — ошибка", async () => {
    const { deps } = fakeDeps();
    const kp = createKpTemplate(deps);
    for (const mode of ["preview", "test"] as const) {
      const r = await kp.render(payload(), ctxFor({ mode, track: mode === "test" }).ctx);
      assert.match(r.email?.html ?? "", /ROMASHKA10/, mode);
      assert.deepEqual(r.notes, ["Промокод ROMASHKA10 — пример: настоящий код создастся при отправке, у каждого получателя свой."]);
    }
    await assert.rejects(kp.render(payload(), ctxFor({ mode: "live" }).ctx), /нет персонального промокода/);
  });

  it("общий код — из «Промокодов» с кэшем; перестал действовать — КП без скидки", async () => {
    const { deps, calls } = fakeDeps();
    const kp = createKpTemplate(deps);
    const p = payload({ promo: { mode: "existing", code: "OSEN20" } });
    const first = await kp.render(p, ctxFor().ctx);
    await kp.render(p, ctxFor({ company: "Ресторан «Север»", sphere: "restaurant" }).ctx);
    assert.match(first.email?.html ?? "", /OSEN20/);
    assert.deepEqual(calls.readPromo, ["OSEN20"]);
    assert.match(first.inApp?.body ?? "", /со скидкой 20\u00a0% до 31\u00a0октября по промокоду OSEN20\./);

    const gone = createKpTemplate(fakeDeps({ readPromo: async () => null }).deps);
    const { ctx, links } = ctxFor();
    const r = await gone.render(payload({ promo: { mode: "existing", code: "OSEN20" } }), ctx);
    assert.doesNotMatch(r.email?.html ?? "", /OSEN20/);
    assert.equal(links()[0], `https://wesetup.ru${sphereLandingPath("cafe")}`);
    assert.doesNotMatch(r.inApp?.body ?? "", /промокод/);
  });

  it("без промокода — цена тарифа и нишевая страница", async () => {
    const { deps } = fakeDeps();
    const kp = createKpTemplate(deps);
    const { ctx, links } = ctxFor();
    const r = await kp.render(payload({ promo: { mode: "none" } }), ctx);
    assert.equal(r.inApp?.body.startsWith(`Команда до 10 сотрудников — 1${NBSP}990${NBSP}₽/мес. Бесплатно — все`), true, r.inApp?.body);
    assert.equal(links()[0], `https://wesetup.ru${sphereLandingPath("cafe")}`);
  });

  it("контекст КП читается раз в минуту, а не на каждое письмо", async () => {
    const { deps, calls, setNow } = fakeDeps();
    const kp = createKpTemplate(deps);
    for (let i = 0; i < 5; i += 1) await kp.render(payload(), ctxFor({ personal }).ctx);
    assert.equal(calls.loadContext, 1);
    setNow(new Date(SAMPLE_NOW.getTime() + 61_000));
    await kp.render(payload(), ctxFor({ personal }).ctx);
    assert.equal(calls.loadContext, 2);
  });
});
