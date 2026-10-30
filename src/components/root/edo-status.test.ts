/* eslint-disable react/no-children-prop -- In this .test.ts file, provider props require children for typed createElement calls. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";

import { loadMessages } from "../../i18n/messages";
import type { EdoRecipientCheckView } from "../../lib/edo/send-core";
import { EdoSendButton } from "./edo-send-button";
import { EdoRecipientNote, EdoSignLink, EdoStatusChip } from "./edo-status";

const check = (kind: EdoRecipientCheckView["kind"]): EdoRecipientCheckView => ({
  organizationId: "org",
  name: "Client",
  inn: "7707083893",
  kpp: "773601001",
  isIp: false,
  kind,
  operator: kind === "roaming" ? "Kontur" : "",
  participantId: kind === "none" ? "" : "2BM-1",
  statusText: "",
});

test("ЭДО: чипы статусов, проверка получателя и кнопка рендерятся на всех языках без пропусков", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const failures: string[] = [];
    const children = [
      ...[null, 0, 3, 4, 6, 7, 9, 10, 22, 23, 99].map((code, i) =>
        createElement(EdoStatusChip, { key: `s${i}`, stateCode: code, deletedAt: null, error: code === null && i > 0 ? "x" : null }),
      ),
      createElement(EdoStatusChip, { key: "del", stateCode: 0, deletedAt: "2026-10-29", error: null }),
      ...(["saby", "roaming", "invited", "none"] as const).map((kind) => createElement(EdoRecipientNote, { key: kind, check: check(kind) })),
      createElement(EdoSignLink, { key: "link", href: "https://online.saby.ru/doc/1" }),
      createElement(EdoSendButton, { key: "btn", organizationId: "org", kind: "upd", sourceId: "1" }),
    ];
    const html = renderToStaticMarkup(
      createElement(NextIntlClientProvider, {
        locale,
        timeZone: "Europe/Moscow",
        messages: { rootEdo: messages.rootEdo },
        onError: (error) => failures.push(error.message),
        children,
      }),
    );
    assert.deepEqual(failures, [], locale);
    assert.ok(html.includes(messages.rootEdo.status.draft), `${locale}: draft label`);
    assert.ok(html.includes(messages.rootEdo.sign.open), `${locale}: sign link`);
    assert.equal((html.match(/data-testid="edo-recipient-note"/g) ?? []).length, 4);
    assert.match(html, /href="https:\/\/online\.saby\.ru\/doc\/1"[^>]*target="_blank"/);
    if (locale !== "ru") assert.doesNotMatch(html, /[А-Яа-яЁё]/, `${locale}: no Russian text`);
  }
});
