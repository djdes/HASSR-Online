/* eslint-disable react/no-children-prop -- Explicit provider children for SSR tests. */
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { loadMessages } from "@/i18n/messages";
import type { Locale } from "@/i18n/locales";
import {
  SWITCH_TOAST_MS,
  SwitchToastCard,
  shortSwitchName,
  switchWithReturn,
  type SwitchSide,
  type SwitchToastBack,
} from "./switch-toast";

async function renderCard(locale: Locale, back: SwitchToastBack | null) {
  const messages = await loadMessages(locale);
  return {
    messages,
    html: renderToStaticMarkup(
      createElement(NextIntlClientProvider, {
        locale,
        messages: { navigation: messages.navigation },
        timeZone: "Europe/Moscow",
        onError: (error) => {
          throw error;
        },
        children: createElement(SwitchToastCard, { id: 1, message: "Организация: ООО «Б»", back }),
      }),
    ),
  };
}

test("switch toast lives 3 seconds", () => {
  assert.equal(SWITCH_TOAST_MS, 3000);
});

test("card: message, close cross with the 3 s countdown ring, compact return button", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const { html, messages } = await renderCard(locale, { label: "Вернуться в «А»", onClick() {} });
    assert.match(html, /data-switch-toast/);
    assert.ok(html.includes("Организация: ООО «Б»"));
    // Крестик справа сверху — с подписью для дикторов на языке человека.
    assert.ok(html.includes(`aria-label="${messages.navigation.shell.switchToast.close}"`));
    assert.match(html, /absolute top-2 right-2/);
    // Кольцо-отсчёт вокруг крестика: убывает за 3 с (globals.css, toast-countdown).
    assert.match(html, /data-toast-countdown/);
    assert.match(html, /--toast-life:3000ms/);
    // Компактная кнопка возврата: пилюля в одну строку, длинное — с многоточием.
    assert.match(html, /data-switch-toast-back/);
    assert.match(html, /rounded-full/);
    assert.match(html, /truncate/);
    assert.ok(html.includes("Вернуться в «А»"));
  }
});

test("card without a way back has no return button", async () => {
  const { html } = await renderCard("ru", null);
  assert.doesNotMatch(html, /data-switch-toast-back/);
  assert.match(html, /data-toast-countdown/);
});

test("long names are cut with an ellipsis", () => {
  assert.equal(shortSwitchName("Кафе"), "Кафе");
  const long = "Общество с ограниченной ответственностью «Ромашка»";
  const short = shortSwitchName(long);
  assert.ok(short.length <= 26);
  assert.ok(short.endsWith("…"));
});

test("switch → toast with return → return switches back and offers the way forward again", async () => {
  const calls: string[] = [];
  const toasts: Array<{ message: string; back: SwitchToastBack | null }> = [];
  // Переход кабинета: запрос, затем (новая страница пришла) — onDone.
  const refreshAfter = (tag: string, request: () => Promise<boolean>, onDone?: () => void) => {
    calls.push(`transition:${tag}`);
    void request().then((ok) => {
      if (ok) onDone?.();
    });
  };
  const side = (id: string, name: string): SwitchSide => ({
    tag: id,
    go: async () => {
      calls.push(`post:${id}`);
      return true;
    },
    message: `Организация: ${name}`,
    returnLabel: `Вернуться в «${name}»`,
  });
  const show = (message: string, back?: SwitchToastBack | null) => {
    toasts.push({ message, back: back ?? null });
  };

  switchWithReturn(refreshAfter, side("b", "Б"), side("a", "А"), show);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["transition:b", "post:b"]);
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].message, "Организация: Б");
  assert.equal(toasts[0].back?.label, "Вернуться в «А»");

  toasts[0].back?.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["transition:b", "post:b", "transition:a", "post:a"]);
  assert.equal(toasts[1].message, "Организация: А");
  assert.equal(toasts[1].back?.label, "Вернуться в «Б»");
});

test("failed switch shows no toast; no previous side — toast without return", async () => {
  const toasts: string[] = [];
  const refreshAfter = (_tag: string, request: () => Promise<boolean>, onDone?: () => void) => {
    void request().then((ok) => {
      if (ok) onDone?.();
    });
  };
  const failing: SwitchSide = { tag: "x", go: async () => false, message: "x", returnLabel: "x" };
  switchWithReturn(refreshAfter, failing, null, (message) => toasts.push(message));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(toasts, []);

  let back: SwitchToastBack | null | undefined;
  const ok: SwitchSide = { tag: "y", go: async () => true, message: "Торговая точка: Y", returnLabel: "y" };
  switchWithReturn(refreshAfter, ok, null, (_message, toastBack) => {
    back = toastBack;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(back, null);
});
