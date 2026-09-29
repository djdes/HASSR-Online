import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EMPTY_REQUISITES } from "@/lib/closing-documents/types";
import { ACTIVE_JOURNAL_CATALOG, JOURNALS_TOTAL } from "@/lib/journal-catalog";
import { ORG_SPHERES, type OrgSphere } from "@/lib/org-profile";
import { EXTRA_USER_PRICE_RUB, SUBSCRIPTION_MAX_USERS } from "@/lib/plan-catalog";
import { FREE_MAX_USERS } from "@/lib/plan-limits";
import { rulesFor } from "@/lib/sphere-journal-rules";

import { JOURNALS_SHOWN_MAX, buildProposalContent, proposalJournals, type ProposalContent } from "./content";
import { SAMPLE_PROMO_LIFETIME, SAMPLE_PROMO_UNTIL, sampleProposalContext } from "./sample";
import { PROPOSAL_SPHERES, proposalAlsoPhone, proposalSphereCopy } from "./spheres";

const CATALOG = new Set<string>(ACTIVE_JOURNAL_CATALOG.map((item) => item.code));
const SPHERES = ORG_SPHERES.map((item) => item.value) as OrgSphere[];

/** Весь текст КП одной строкой — для проверок слов. */
function allText(content: ProposalContent): string {
  return [
    content.eyebrow,
    content.addressee,
    content.title,
    content.lead,
    ...content.steps.flatMap((step) => [step.title, step.text]),
    content.stepsNote,
    content.benefitsTitle,
    ...content.benefits.flatMap((item) => [item.title, item.text]),
    content.journalsTitle,
    ...content.journalsRequired.map((item) => `${item.name} ${item.note ?? ""}`),
    ...content.journalsRecommended.map((item) => item.name),
    content.journalsMore,
    content.journalsTotal,
    content.offer.title,
    ...content.offer.rows.flatMap((row) => [row.title, row.price, row.oldPrice, row.badge, row.text]),
    ...content.offer.notes,
    content.offer.howTo,
    content.offer.payment,
    content.offer.ctaLabel,
    content.subject,
    content.preheader,
  ]
    .filter(Boolean)
    .join("\n");
}

describe("тексты КП — честность по правилам сфер", () => {
  it("PROPOSAL_SPHERES — все сферы анкеты", () => {
    assert.deepEqual(
      PROPOSAL_SPHERES.map((item) => item.sphere),
      SPHERES,
    );
  });

  for (const sphere of SPHERES) {
    it(`${sphere}: преимущества держатся на журналах сферы`, () => {
      const copy = proposalSphereCopy(sphere);
      const rules = rulesFor(sphere);
      const allowed = new Set([...rules.electronicRequired.map((rule) => rule.code), ...rules.electronicRecommended]);
      assert.ok(copy.benefits.length >= 3 && copy.benefits.length <= 5, `${sphere}: 3–5 преимуществ`);
      for (const benefit of copy.benefits) {
        assert.ok(benefit.journals.length > 0, `${sphere} «${benefit.title}»: нет журналов`);
        for (const code of benefit.journals) {
          assert.ok(CATALOG.has(code), `${sphere} «${benefit.title}»: ${code} нет в каталоге`);
          assert.ok(allowed.has(code), `${sphere} «${benefit.title}»: ${code} не входит в правила сферы`);
        }
      }
    });

    it(`${sphere}: «так же с телефона» — журналы, которые у сферы есть`, () => {
      const rules = rulesFor(sphere);
      const allowed = new Set([...rules.electronicRequired.map((rule) => rule.code), ...rules.electronicRecommended]);
      for (const group of proposalAlsoPhone(sphere).groups) {
        assert.ok(group.some((code) => allowed.has(code)), `${sphere}: ни одного из ${group.join(", ")} в правилах сферы`);
      }
      const content = buildProposalContent({ sphere }, sampleProposalContext());
      assert.ok(content.stepsNote.startsWith(`Так же с телефона — ${proposalAlsoPhone(sphere).text}`));
    });

    it(`${sphere}: журналы — сначала обязательные из правил, 6–8 названий и «и ещё N»`, () => {
      const rules = rulesFor(sphere);
      const { required, recommended, more } = proposalJournals(sphere);
      assert.deepEqual(
        required.map((item) => item.code),
        rules.electronicRequired.slice(0, JOURNALS_SHOWN_MAX).map((rule) => rule.code),
      );
      const shown = required.length + recommended.length;
      const total = new Set([...rules.electronicRequired.map((rule) => rule.code), ...rules.electronicRecommended]).size;
      assert.ok(shown >= Math.min(6, total) && shown <= JOURNALS_SHOWN_MAX, `${sphere}: показано ${shown}`);
      assert.equal(shown + more, total);
      for (const item of [...required, ...recommended]) assert.ok(CATALOG.has(item.code));
      for (const item of recommended) assert.equal(item.note, null);
      // Основание не из СанПиН — названо (бракераж в детском саду — «спрашивают при проверках»).
      for (const rule of rules.electronicRequired) {
        const item = required.find((entry) => entry.code === rule.code);
        if (!item) continue;
        if (rule.basis === "practice") assert.match(item.note ?? "", /спрашивают при проверках/, `${sphere} ${rule.code}`);
        if (rule.basis === "haccp") assert.match(item.note ?? "", /ХАССП/, `${sphere} ${rule.code}`);
        if (rule.condition) assert.ok((item.note ?? "").length > 0, `${sphere} ${rule.code}: нет условия`);
      }
    });
  }

  it("в текстах нет «бланк», магазинов приложений, гарантий и отзывов", () => {
    const forbidden = /бланк|app\s*store|google\s*play|rustore|appgallery|в сторах|магазин(е|ах)? приложений|гарант|отзыв/i;
    for (const sphere of SPHERES) {
      for (const promo of [null, SAMPLE_PROMO_LIFETIME, SAMPLE_PROMO_UNTIL]) {
        const content = buildProposalContent(
          { sphere, companyName: "Кафе «Ромашка»", recipientName: "Анна Сергеевна", promo },
          sampleProposalContext(),
        );
        const text = allText(content);
        assert.equal(forbidden.test(text), false, `${sphere}: ${text.match(forbidden)?.[0]}`);
      }
    }
  });

  it("в маркетинговых текстах сферы нет выдуманных цифр", () => {
    for (const sphere of SPHERES) {
      const copy = proposalSphereCopy(sphere);
      const texts = [
        ...copy.benefits.flatMap((item) => [item.title, item.text]),
        copy.poster?.place ?? "",
        copy.poster?.entry ?? "",
        copy.forWhom,
        copy.who,
        copy.team,
      ];
      for (const text of texts) assert.equal(/\d/.test(text), false, `${sphere}: цифра в «${text}»`);
    }
  });

  it("числа предложения — из констант тарифа и каталога", () => {
    const content = buildProposalContent({ sphere: "restaurant", promo: SAMPLE_PROMO_LIFETIME }, sampleProposalContext());
    const [free, team] = content.offer.rows;
    const plain = (text: string) => text.replace(/\u00a0/g, " ");
    assert.match(plain(free.title), new RegExp(`все ${JOURNALS_TOTAL} журнал`));
    assert.match(plain(free.title), new RegExp(`для ${FREE_MAX_USERS} сотрудника`));
    assert.match(plain(team.title), new RegExp(`до ${SUBSCRIPTION_MAX_USERS} сотрудников`));
    assert.match(plain(team.text), new RegExp(`сверх ${SUBSCRIPTION_MAX_USERS} — ${EXTRA_USER_PRICE_RUB} ₽/мес`));
    assert.equal(plain(team.price), "1 791 ₽");
    assert.equal(plain(team.oldPrice ?? ""), "1 990 ₽");
    assert.equal(plain(team.badge ?? ""), "−10 % навсегда");
    assert.match(team.text, /На подписке показание можно снять фото термометра/);
    const salon = buildProposalContent({ sphere: "beauty" }, sampleProposalContext());
    assert.match(salon.offer.rows[1].text, /На подписке показание можно снять фото дисплея прибора/);
  });

  it("заголовок: ХАССП — только пищевым сферам", () => {
    for (const sphere of SPHERES) {
      const content = buildProposalContent({ sphere }, sampleProposalContext());
      const food = sphere !== "beauty" && sphere !== "fitness";
      assert.equal(content.title.includes("ХАССП"), food, sphere);
      assert.ok(content.title.startsWith("Электронные журналы"), sphere);
    }
  });

  it("оплата по счёту — только если счёт реально выставляется", () => {
    const withInvoice = buildProposalContent({ sphere: "cafe" }, sampleProposalContext({ invoiceReady: true }));
    const cardOnly = buildProposalContent({ sphere: "cafe" }, sampleProposalContext({ invoiceReady: false }));
    assert.equal(withInvoice.offer.payment, "Оплата картой или по счёту для юрлиц.");
    assert.equal(cardOnly.offer.payment, "Оплата картой на сайте.");
  });

  it("бесплатный период — строка только до его конца", () => {
    const before = buildProposalContent({ sphere: "cafe" }, sampleProposalContext());
    assert.ok(before.offer.notes.some((note) => /С 1 по 10 октября подписка «до 10 сотрудников» бесплатна для всех/.test(note.replace(/\u00a0/g, " "))));
    const after = buildProposalContent({ sphere: "cafe" }, sampleProposalContext({ now: new Date("2026-10-20T09:00:00.000Z") }));
    assert.equal(after.offer.notes.length, 0);
  });

  it("истёкший промокод: цена без скидки, пометка, CTA — на страницу сферы", () => {
    const content = buildProposalContent(
      { sphere: "cafe", promo: { ...SAMPLE_PROMO_UNTIL, endsAt: new Date("2026-09-01T00:00:00.000Z") } },
      sampleProposalContext(),
    );
    assert.equal(content.offer.promoCode, null);
    assert.equal(content.offer.ctaKind, "landing");
    assert.ok(content.offer.notes.some((note) => note.includes("истёк")));
  });

  it("код «навсегда» со сроком: пояснение про срок активации, без срока — нет", () => {
    // Персональный код рассылки: скидка навсегда, но активировать — до 13 октября включительно.
    const deadline = new Date("2026-10-13T20:59:59.999Z");
    const content = buildProposalContent({ sphere: "cafe", promo: { ...SAMPLE_PROMO_LIFETIME, endsAt: deadline } }, sampleProposalContext());
    assert.equal(content.price.promoTerm, "навсегда");
    assert.ok(
      content.offer.notes.includes("Промокод ROMASHKA10 действует до 13\u00a0октября: при оплате до этого дня скидка остаётся навсегда."),
      content.offer.notes.join(" | "),
    );
    const noDeadline = buildProposalContent({ sphere: "cafe", promo: SAMPLE_PROMO_LIFETIME }, sampleProposalContext());
    assert.ok(!noDeadline.offer.notes.some((note) => note.includes("действует до")));
    const until = buildProposalContent({ sphere: "cafe", promo: SAMPLE_PROMO_UNTIL }, sampleProposalContext());
    assert.ok(!until.offer.notes.some((note) => note.includes("при оплате до этого дня")));
  });

  it("реквизиты: пустые — не показываем, заполненные — ИНН и ОГРН", () => {
    const empty = buildProposalContent({ sphere: "cafe" }, sampleProposalContext({ requisites: { ...EMPTY_REQUISITES } }));
    assert.equal(empty.requisites, null);
    const filled = buildProposalContent({ sphere: "cafe" }, sampleProposalContext());
    assert.ok(filled.requisites?.some((line) => line.includes("ИНН")));
    assert.ok(filled.requisites?.some((line) => line.includes("ОГРН")));
  });

  it("отправитель: из переменных → по умолчанию → «Команда WeSetup»", () => {
    const own = buildProposalContent({ sphere: "cafe", sender: { name: "Олег" } }, sampleProposalContext());
    assert.equal(own.sender?.name, "Олег");
    const saved = buildProposalContent({ sphere: "cafe" }, sampleProposalContext());
    assert.equal(saved.sender?.name, "Анна Петрова, менеджер WeSetup");
    const fallback = buildProposalContent({ sphere: "cafe" }, sampleProposalContext({ defaultSender: null }));
    assert.equal(fallback.sender?.name, "Команда WeSetup");
  });

  it("адресат: компания и имя; приветствие по имени в первом абзаце", () => {
    const content = buildProposalContent(
      { sphere: "education", companyName: "Детский сад № 5", recipientName: "Анна Сергеевна" },
      sampleProposalContext(),
    );
    assert.equal(content.addressee, "Детский сад № 5 · Анна Сергеевна");
    assert.ok(content.lead.startsWith("Анна Сергеевна, здравствуйте!"));
    const anonymous = buildProposalContent({ sphere: "education" }, sampleProposalContext());
    assert.equal(anonymous.addressee, null);
    assert.ok(anonymous.lead.startsWith("Предлагаем"));
  });
});
