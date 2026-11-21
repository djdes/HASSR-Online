import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { loadMessages } from "../../i18n/messages";
import { translatorFor } from "../../i18n/translator";
import { HaccpGoldSeal, sealTextScale } from "./haccp-gold-seal";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

// Правки владельца 20.11.2026: золотая печать «ХАССП / СЕРТИФИЦИРОВАНО» у
// плашки «Разработан при консультации…», строка «14 дней … (до даты)» и окно
// «Открыть оферту?» как в Telegram.

test("gold seal renders the localized words inside the ring in every locale", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const { sealTitle, sealCaption } = (await loadMessages(locale)).landing.hero;
    const html = renderToStaticMarkup(createElement(HaccpGoldSeal, { title: sealTitle, caption: sealCaption }));
    assert.match(html, /^<svg[^>]*aria-hidden="true"/, `${locale}: decorative`);
    assert.ok(html.includes(`>${sealTitle}</text>`), `${locale}: title`);
    assert.ok(html.includes(`>${sealCaption}</text>`), `${locale}: caption`);
    // Words are squeezed with scale(x 1) from a generous width estimate: Safari ignores textLength
    // for glyphs and clipped a gradient fill to the squeezed box (21.11.2026: white «Х» and «П»).
    const scales = [...html.matchAll(/scale\(([\d.]+) 1\)/g)].map((match) => Number(match[1]));
    assert.equal(scales.length, 4, `${locale}: two words in two engraving layers`);
    for (const scale of scales) assert.ok(scale > 0 && scale <= 1, `${locale}: scale ${scale}`);
    assert.doesNotMatch(html, /textLength|lengthAdjust|<use/, `${locale}: no Safari-fragile text features`);
    for (const group of html.match(/<g fill="[^"]*"/g) ?? []) assert.doesNotMatch(group, /url\(/, `${locale}: solid ink, no gradient on text`);
    if (locale !== "ru") assert.doesNotMatch(html, /[А-Яа-яЁё]/, `${locale}: Cyrillic in the seal`);
  }
  const ru = (await loadMessages("ru")).landing.hero;
  assert.equal(ru.sealTitle, "ХАССП");
  assert.equal(ru.sealCaption, "СЕРТИФИЦИРОВАНО");
});

test("seal words fit the ring with any system font: width estimate × scale stays inside", () => {
  for (const [text, size, max] of [["ХАССП", 21, 64], ["HACCP", 21, 64], ["СЕРТИФИЦИРОВАНО", 9, 62], ["SERTIFIKATLANGAN", 9, 62], ["CERTIFIED", 9, 62]] as const) {
    const scale = sealTextScale(text, size, max);
    assert.ok(scale > 0.5 && scale <= 1, `${text}: ${scale}`);
    assert.ok([...text].length * 0.74 * size * scale <= max + 0.05, `${text} fits ${max}`);
  }
  assert.equal(sealTextScale("CERTIFIED", 9, 62), 1, "short words are not squeezed");
});

test("gold seal references only its own gradients, so two seals never share ids", () => {
  const seal = (key: string) => createElement(HaccpGoldSeal, { key, title: "ХАССП", caption: "СЕРТИФИЦИРОВАНО" });
  const html = renderToStaticMarkup(createElement(Fragment, null, seal("a"), seal("b")));
  const svgs = html.split("</svg>").filter(Boolean);
  assert.equal(svgs.length, 2);
  const idsOf = (svg: string) => new Set([...svg.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
  const [first, second] = svgs.map(idsOf);
  for (const id of first) assert.ok(!second.has(id), `shared id ${id}`);
  for (const svg of svgs) {
    const ids = idsOf(svg);
    const refs = [...svg.matchAll(/url\(#([^)]+)\)|href="#([^"]+)"/g)].map((match) => match[1] ?? match[2]);
    assert.ok(refs.length >= 8);
    for (const ref of refs) assert.ok(ids.has(ref), `dangling reference #${ref}`);
  }
  // Gold stays gold: colours are attributes, not Tailwind classes the night theme repaints.
  assert.doesNotMatch(html, /class="[^"]*(bg|text|fill|stroke)-\[#/);
});

test("seal motion: stamp, shine and sparkles stop under reduced motion and «Без анимации»", () => {
  const css = read("../../app/globals.css");
  for (const name of ["gold-seal-stamp", "gold-seal-shine", "gold-seal-sparkle"]) {
    assert.match(css, new RegExp(`@keyframes ${name}\\b`));
  }
  const reduced = css.slice(css.indexOf(".hero-trust,\n  .gold-seal,"));
  assert.match(reduced, /^\.hero-trust,\n {2}\.gold-seal,\n {2}\.gold-seal-shine,\n {2}\.gold-seal-sparkle,/);
  assert.match(css, /html\[data-view-still\] \.public-theme :is\([^)]*\.gold-seal, \.gold-seal-shine, \.gold-seal-sparkle\)/);
  // Without animation the shine and the sparkles rest out of sight.
  assert.match(css, /\.gold-seal-shine \{\n {2}transform: translateX\(-24px\);/);
  assert.match(css, /\.gold-seal-sparkle \{[^}]*transform: scale\(0\);/);
});

test("hero: the seal replaces the blue badge and the trial line reads «14 дней … (до даты)»", async () => {
  const page = read("../../app/page.tsx");
  assert.match(page, /<HaccpGoldSeal\s+title=\{copy\("landing\.hero\.sealTitle"\)\}\s+caption=\{copy\("landing\.hero\.sealCaption"\)\}/);
  assert.doesNotMatch(page, /BadgeCheck/);
  assert.match(page, /copy\.rich\("landing\.hero\.trialUntil", \{\s+date: trialUntil,\s+trialDays: TRIAL_DAYS,/);
  const expected = {
    ru: "<b>14 дней</b> всё бесплатно (до 04.12.2026). <a>Подробнее</a>",
    en: "Free for <b>14 days</b> (until 04.12.2026). <a>Details</a>",
    uz: "<b>14 kun</b> hammasi bepul (04.12.2026 gacha). <a>Batafsil</a>",
  } as const;
  for (const locale of ["ru", "en", "uz"] as const) {
    const t = await translatorFor(locale);
    const line = t.markup("landing.hero.trialUntil", {
      trialDays: 14,
      date: "04.12.2026",
      strong: (chunks) => `<b>${chunks}</b>`,
      link: (chunks) => `<a>${chunks}</a>`,
    });
    assert.equal(line, expected[locale]);
  }
  assert.equal(
    (await translatorFor("ru")).markup("landing.hero.trialUntil", { trialDays: 21, date: "x", strong: (c) => c, link: (c) => c }),
    "21 день всё бесплатно (до x). Подробнее",
  );
});

test("open-document window: bright «Не переходить» on top, grey «Всё равно перейти» below", async () => {
  const source = read("../legal/legal-consent-checkbox.tsx");
  const no = source.indexOf('data-testid="legal-open-no"');
  const yes = source.indexOf('data-testid="legal-open-yes"');
  assert.ok(no > 0 && yes > no, "the stay button comes first");
  const buttons = source.slice(source.lastIndexOf("<div", no), source.indexOf("</div>", yes));
  assert.match(buttons, /^<div className="mt-1 flex flex-col gap-2\.5">/);
  assert.match(source.slice(no, yes), /autoFocus[\s\S]*w-full[^"]*bg-\[#5566f6\]/);
  assert.match(source.slice(yes), /^[^>]*>[\s\S]*?className="[^"]*w-full[^"]*bg-\[#f1f2f8\][^"]*text-\[#6f7282\]/);
  const words = { ru: ["Не переходить", "Всё равно перейти"], en: ["Don't open", "Open anyway"], uz: ["Ochmaslik", "Baribir ochish"] } as const;
  for (const locale of ["ru", "en", "uz"] as const) {
    const legal = (await loadMessages(locale)).auth.legal;
    assert.deepEqual([legal.openNo, legal.openYes], words[locale]);
  }
});
