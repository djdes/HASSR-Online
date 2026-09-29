import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildProposalContent } from "./content";
import { renderProposalEmailHtml } from "./email";
import { SAMPLE_PROMO_LIFETIME, SAMPLE_PROMO_UNTIL, sampleProposalContext } from "./sample";
import type { ProposalPromo, ProposalVars } from "./types";

const WEB = "https://wesetup.ru/kp/abc.def";
const PDF = `${WEB}/pdf`;
const UNSUB = "https://wesetup.ru/unsubscribe/tok123";
const track = (url: string) => `https://wesetup.ru/r/tok123/${encodeURIComponent(url)}`;

function render(vars: ProposalVars, opts: { unsubscribe?: string | null; tracked?: boolean } = {}) {
  const content = buildProposalContent(vars, sampleProposalContext());
  return {
    content,
    email: renderProposalEmailHtml(content, {
      web: WEB,
      pdf: PDF,
      unsubscribe: opts.unsubscribe === undefined ? UNSUB : opts.unsubscribe,
      trackUrl: opts.tracked === false ? undefined : track,
    }),
  };
}

function attrs(html: string, name: "href" | "src"): string[] {
  return [...html.matchAll(new RegExp(`${name}="([^"]*)"`, "g"))].map((match) => match[1].replace(/&amp;/g, "&"));
}

const CASES: Array<[ProposalVars["sphere"], ProposalPromo | null]> = [
  ["restaurant", SAMPLE_PROMO_LIFETIME],
  ["education", SAMPLE_PROMO_UNTIL],
  ["beauty", null],
];

describe("письмо с КП", () => {
  for (const [sphere, promo] of CASES) {
    const label = `${sphere} ${promo ? promo.code : "без промокода"}`;

    it(`${label}: размер, абсолютные ссылки и картинки, alt`, () => {
      const { email } = render({ sphere, companyName: "Кафе «Ромашка»", recipientName: "Анна Сергеевна", promo });
      assert.ok(Buffer.byteLength(email.html, "utf8") < 100 * 1024, "HTML больше 100 КБ");
      for (const url of [...attrs(email.html, "href"), ...attrs(email.html, "src")]) {
        assert.match(url, /^(https:\/\/|mailto:|tel:)/, `не абсолютная ссылка: ${url}`);
      }
      assert.equal(/data:/i.test(email.html), false, "data:-картинка");
      const images = email.html.match(/<img\b[^>]*>/g) ?? [];
      assert.ok(images.length >= 1);
      for (const img of images) assert.match(img, /\balt="[^"]+"/, `картинка без alt: ${img}`);
    });

    it(`${label}: trackUrl — у всех ссылок, кроме отписки`, () => {
      const { email } = render({ sphere, promo });
      const hrefs = attrs(email.html, "href");
      assert.ok(hrefs.includes(UNSUB), "нет ссылки отписки");
      for (const href of hrefs) {
        if (href === UNSUB) continue;
        assert.ok(href.startsWith("https://wesetup.ru/r/tok123/"), `ссылка без учёта клика: ${href}`);
      }
      assert.ok(email.text.includes(UNSUB));
    });

    it(`${label}: прехедер, тема, текстовая версия`, () => {
      const { email, content } = render({ sphere, promo });
      assert.ok(email.preheader.length > 20 && email.preheader.length <= 140);
      assert.ok(email.html.includes(email.preheader.replace(/&/g, "&amp;").replace(/«/g, "«")));
      assert.ok(email.subject.length <= 70, `длинная тема: ${email.subject}`);
      assert.equal(/[A-ZА-ЯЁ]{5,}/.test(email.subject), false, `капс в теме: ${email.subject}`);
      assert.equal(/бесплатн|скидк|акци|срочно|выгод|!/i.test(email.subject), false, `спам-слово в теме: ${email.subject}`);
      assert.ok(email.text.includes(track(content.offer.ctaUrl)), "в тексте нет ссылки CTA");
      assert.ok(email.text.includes(content.offer.rows[1].title));
      assert.equal(/<[a-z]/i.test(email.text), false, "в текстовой версии разметка");
    });
  }

  it("QR-картинка — только с промокодом и только адрес /api/kp/qr", () => {
    const withPromo = render({ sphere: "cafe", promo: SAMPLE_PROMO_LIFETIME }).email.html;
    assert.ok(withPromo.includes('src="https://wesetup.ru/api/kp/qr/ROMASHKA10?s=cafe"'));
    const without = render({ sphere: "cafe", promo: null }).email.html;
    assert.equal(without.includes("/api/kp/qr/"), false);
  });

  it("кнопка «пуленепробиваемая»: ячейка с заливкой и VML для Outlook", () => {
    const { email } = render({ sphere: "cafe", promo: SAMPLE_PROMO_LIFETIME });
    assert.match(email.html, /<v:roundrect[^>]+href="https:\/\/wesetup\.ru\/r\/tok123\//);
    assert.match(email.html, /<td align="center" bgcolor="#5566f6"/);
  });

  it("телефон и тёмная схема: медиазапросы есть", () => {
    const { email } = render({ sphere: "cafe", promo: SAMPLE_PROMO_LIFETIME });
    assert.match(email.html, /@media only screen and \(max-width:480px\)/);
    assert.match(email.html, /@media \(prefers-color-scheme:dark\)/);
    assert.match(email.html, /<meta name="color-scheme" content="light dark">/);
  });

  it("без отписки и учёта кликов — ссылки как есть", () => {
    const { email, content } = render({ sphere: "hotel", promo: null }, { unsubscribe: null, tracked: false });
    assert.equal(email.html.includes("Отписаться"), false);
    assert.ok(attrs(email.html, "href").includes(content.offer.ctaUrl));
  });

  it("название компании экранируется", () => {
    const { email } = render({ sphere: "cafe", companyName: `<script>alert("x")</script> & Co` });
    assert.equal(email.html.includes("<script>alert"), false);
    assert.ok(email.html.includes("&lt;script&gt;"));
  });
});
