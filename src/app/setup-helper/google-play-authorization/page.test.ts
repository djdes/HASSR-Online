import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { GooglePlayAuthorizationCard } from "@/components/public/google-play-authorization-card";
import { isPng } from "@/lib/closing-documents/requisites";
import {
  GOOGLE_PLAY_AUTH_PACKAGE_ID,
  GOOGLE_PLAY_AUTH_PAGE_PATH,
  GOOGLE_PLAY_AUTH_PDF_PATH,
  GOOGLE_PLAY_AUTH_SIGNATURE_IMAGE_PATH,
  GOOGLE_PLAY_AUTH_STATEMENT_EN,
  GOOGLE_PLAY_AUTH_STATEMENT_RU,
  renderGooglePlayAuthorizationPdf,
  renderGooglePlaySignatureCardPng,
} from "@/lib/setup-helper-play-authorization";

test("Google Play authorization statement includes exact BFS, Volkov, Karakyanova, and package details", () => {
  assert.match(GOOGLE_PLAY_AUTH_STATEMENT_RU, /Волков Денис Владимирович/);
  assert.match(GOOGLE_PLAY_AUTH_STATEMENT_RU, /ООО «БФС»/);
  assert.match(GOOGLE_PLAY_AUTH_STATEMENT_RU, /разрешаю Ольге Каракьяновой публиковать и обновлять приложение «Сетап помощник» в Google Play/);
  assert.ok(GOOGLE_PLAY_AUTH_STATEMENT_RU.includes(GOOGLE_PLAY_AUTH_PACKAGE_ID));
  assert.match(GOOGLE_PLAY_AUTH_STATEMENT_RU, /бесплатно для пользователей/);
  assert.match(GOOGLE_PLAY_AUTH_STATEMENT_RU, /название, значок и скриншоты в карточке магазина/);

  assert.match(GOOGLE_PLAY_AUTH_STATEMENT_EN, /Denis Vladimirovich Volkov/);
  assert.match(GOOGLE_PLAY_AUTH_STATEMENT_EN, /BFS LLC/);
  assert.match(GOOGLE_PLAY_AUTH_STATEMENT_EN, /Olga Karakyanova/);
  assert.ok(GOOGLE_PLAY_AUTH_STATEMENT_EN.includes(GOOGLE_PLAY_AUTH_PACKAGE_ID));
});

test("GooglePlayAuthorizationCard renders statement, composite signature+stamp image, and PDF link", () => {
  const html = renderToStaticMarkup(createElement(GooglePlayAuthorizationCard));
  assert.ok(html.includes(GOOGLE_PLAY_AUTH_PACKAGE_ID));
  assert.ok(html.includes("Волков Денис Владимирович"));
  assert.ok(html.includes("Ольге Каракьяновой"));
  assert.ok(html.includes(`src="${GOOGLE_PLAY_AUTH_SIGNATURE_IMAGE_PATH}"`));
  assert.ok(html.includes(`href="${GOOGLE_PLAY_AUTH_PAGE_PATH}"`));
  assert.ok(html.includes(`href="${GOOGLE_PLAY_AUTH_PDF_PATH}"`));
});

test("renderGooglePlaySignatureCardPng produces a valid non-empty PNG card", async () => {
  const png = await renderGooglePlaySignatureCardPng({ facsimile: null, stamp: null });
  assert.equal(isPng(png), true);
  assert.ok(png.length > 5_000);
});

test("renderGooglePlayAuthorizationPdf generates a valid 1-page PDF on BFS letterhead", () => {
  const pdf = renderGooglePlayAuthorizationPdf({ facsimile: null, stamp: null });
  assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.ok(pdf.length > 10_000);
});

test("authorization block is wired into setup-helper privacy, about page, and LegalRequisites", () => {
  const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");
  assert.match(read("src/app/setup-helper/google-play-authorization/page.tsx"), /GOOGLE_PLAY_AUTH_STATEMENT_RU/);
  assert.match(read("src/app/setup-helper/privacy/page.tsx"), /GooglePlayAuthorizationCard/);
  assert.match(read("src/app/about/page.tsx"), /GooglePlayAuthorizationCard/);
  assert.match(read("src/components/public/legal-article.tsx"), /GooglePlayAuthorizationCard/);
});
