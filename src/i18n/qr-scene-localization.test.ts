/* eslint-disable react/no-children-prop -- Typed createElement provider calls require children in props. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { SceneFrame } from "../components/landing/qr-player/scene";
import { CHAPTERS } from "../components/landing/qr-player/chapters";
import { loadMessages, pickMessages } from "./messages";
import { FORMAT_LOCALES } from "./locales";

test("every QR chapter renders its actual messages in all locales and normal/deviation states", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = pickMessages(await loadMessages(locale), ["qrPlayer", "qrScene", "journals", "hygiene"]);
    const errors: string[] = [];
    for (const chapter of CHAPTERS) {
      for (const offset of [0, Math.floor(chapter.duration / 2), chapter.duration - 1]) {
        for (const deviation of [false, true]) {
          const html = renderToStaticMarkup(createElement(NextIntlClientProvider, {
            locale, messages, timeZone: "Europe/Moscow", onError: error => errors.push(`${chapter.id}: ${error.message}`),
            children: createElement(SceneFrame, {
              frame: chapter.from + offset, fridgeTemp: deviation ? 12 : 3.5, bodyTemp: deviation ? 39 : 36.6,
              today: { day: 14, month: 10, year: 2026, daysInMonth: 31,
                monthLabel: new Intl.DateTimeFormat(FORMAT_LOCALES[locale], { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date("2026-10-14T00:00:00Z")) },
              qr: { bare: '<svg xmlns="http://www.w3.org/2000/svg"/>', printed: '<svg xmlns="http://www.w3.org/2000/svg"/>' },
            }),
          }));
          assert.ok(html.length > 100, `${locale}/${chapter.id} must render a scene`);
          assert.doesNotMatch(html, /\{(?:minimum|maximum|value|month|count),?/, "ICU arguments must resolve");
        }
      }
    }
    assert.deepEqual(errors, [], `${locale}: all namespaces and ICU arguments must be supplied`);
  }
});
