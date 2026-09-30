import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { WhatsNewModal } from "@/components/dashboard/whats-new-modal";
import {
  WHATS_NEW_COOKIE,
  legacyWhatsNewAction,
  parseWhatsNewCookie,
  whatsNewCookieString,
  whatsNewMode,
} from "./whats-new-seen";
import { WHATS_NEW_NOTES, notesWithoutPartnerProgram, whatsNewVersion } from "./whats-new-notes";

const V = "abc123";

describe("«Что нового»: решение до первой отрисовки", () => {
  it("не руководитель или окно выключено — окна в разметке нет", () => {
    assert.equal(whatsNewMode({ enabled: false, version: V, seenCookie: "old" }), "hide");
    assert.equal(whatsNewMode({ enabled: false, version: V, seenCookie: undefined }), "hide");
  });

  it("эту версию уже закрыли — окна нет ни при загрузке, ни при переходах", () => {
    assert.equal(whatsNewMode({ enabled: true, version: V, seenCookie: V }), "hide");
  });

  it("заметки изменились — окно приходит в серверной разметке сразу открытым", () => {
    assert.equal(whatsNewMode({ enabled: true, version: V, seenCookie: "old1" }), "show");
  });

  it("куки ещё нет (первый заход после выката) — один раз решает клиент по старой отметке", () => {
    assert.equal(whatsNewMode({ enabled: true, version: V, seenCookie: undefined }), "legacy");
    assert.equal(whatsNewMode({ enabled: true, version: V, seenCookie: "" }), "legacy");
    assert.equal(whatsNewMode({ enabled: true, version: V, seenCookie: "<script>" }), "legacy");
  });

  it("перенос: отметки нет — человек здесь впервые, новинок для него нет", () => {
    assert.deepEqual(legacyWhatsNewAction(null, V), { open: false, cookieVersion: V });
  });

  it("перенос: уже видел эту версию — окно не открывать", () => {
    assert.deepEqual(legacyWhatsNewAction(V, V), { open: false, cookieVersion: V });
  });

  it("перенос: видел прошлую — открыть; в куку прошлую, чтобы до закрытия сервер рисовал окно сам", () => {
    assert.deepEqual(legacyWhatsNewAction("0f1e2d3", V), { open: true, cookieVersion: "0f1e2d3" });
    assert.deepEqual(legacyWhatsNewAction("странное значение", V), { open: true, cookieVersion: "legacy" });
    assert.equal(whatsNewMode({ enabled: true, version: V, seenCookie: "legacy" }), "show");
  });

  it("кука: только безопасные символы, на весь сайт", () => {
    assert.equal(parseWhatsNewCookie(" abc-1.2_x "), "abc-1.2_x");
    assert.equal(parseWhatsNewCookie("a;b"), null);
    assert.match(whatsNewCookieString(V), new RegExp(`^${WHATS_NEW_COOKIE}=${V}; Path=/;`));
    assert.match(whatsNewCookieString("a;b=c"), new RegExp(`^${WHATS_NEW_COOKIE}=legacy;`));
  });

  it("версия — по полному тексту заметок: у организации со скрытым консультантом та же", () => {
    const layout = readFileSync(path.join(process.cwd(), "src/app/(dashboard)/layout.tsx"), "utf8");
    assert.match(layout, /whatsNewVersion\(WHATS_NEW_NOTES\)/);
    assert.doesNotMatch(layout, /whatsNewVersion\(whatsNewNotes\)/);
    // Текст для организации без партнёрской программы другой — а версия для решения одна.
    const filtered = notesWithoutPartnerProgram(WHATS_NEW_NOTES);
    if (JSON.stringify(filtered) !== JSON.stringify(WHATS_NEW_NOTES)) {
      assert.notEqual(whatsNewVersion(filtered), whatsNewVersion(WHATS_NEW_NOTES));
    }
  });
});

describe("окно «Что нового» в серверной разметке", () => {
  const notes = [{ category: "Интерфейс", items: ["Тема без морганий"] }];

  it("show — окно уже в HTML сервера и открыто (не всплывает после гидрации)", () => {
    const html = renderToStaticMarkup(createElement(WhatsNewModal, { buildSha: V, notes, mode: "show" }));
    assert.match(html, /role="dialog"/);
    assert.match(html, /aria-labelledby="whats-new-title"/);
    assert.match(html, /Что нового в WeSetup/);
    assert.match(html, /Тема без морганий/);
  });

  it("legacy — сервер окно не рисует (решит клиент один раз)", () => {
    const html = renderToStaticMarkup(createElement(WhatsNewModal, { buildSha: V, notes, mode: "legacy" }));
    assert.equal(html, "");
  });
});
