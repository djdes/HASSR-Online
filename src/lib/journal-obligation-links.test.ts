import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMiniAppAuthBootstrapPath,
  buildMiniAppUrl,
  buildMiniObligationEntryUrl,
  normalizeMiniAppBaseUrl,
  resolveJournalObligationTargetPath,
  sanitizeMiniAppRedirectPath,
} from "@/lib/journal-obligation-links";

test("resolveJournalObligationTargetPath sends entry journals to the site new page", () => {
  assert.equal(
    resolveJournalObligationTargetPath({
      journalCode: "cleaning",
      isDocument: false,
      activeDocumentId: null,
    }),
    "/journals/cleaning/new"
  );
});

test("resolveJournalObligationTargetPath rejects entry journals with an active document id", () => {
  assert.throws(() =>
    resolveJournalObligationTargetPath({
      journalCode: "cleaning",
      isDocument: false,
      activeDocumentId: "doc-1",
    } as never)
  );
});

test("resolveJournalObligationTargetPath keeps document journals on the journal page", () => {
  assert.equal(
    resolveJournalObligationTargetPath({
      journalCode: "hygiene",
      isDocument: true,
      activeDocumentId: "doc-1",
    }),
    "/journals/hygiene"
  );
});

test("sanitizeMiniAppRedirectPath keeps internal mini app paths", () => {
  assert.equal(
    sanitizeMiniAppRedirectPath("/mini/today"),
    "/mini/today"
  );
});

test("sanitizeMiniAppRedirectPath keeps internal site paths with query", () => {
  // Мини-приложение открывает страницы кабинета в своей оболочке,
  // поэтому возврат после входа обязан работать и на адрес сайта.
  assert.equal(
    sanitizeMiniAppRedirectPath("/journals/hygiene/new?from=bot"),
    "/journals/hygiene/new?from=bot"
  );
  assert.equal(sanitizeMiniAppRedirectPath("/dashboard"), "/dashboard");
});

test("sanitizeMiniAppRedirectPath rejects external redirects", () => {
  assert.equal(
    sanitizeMiniAppRedirectPath("https://evil.example/phish"),
    null
  );
  assert.equal(sanitizeMiniAppRedirectPath("//evil.example/phish"), null);
});

test("sanitizeMiniAppRedirectPath rejects api handlers", () => {
  assert.equal(sanitizeMiniAppRedirectPath("/api/auth/signout"), null);
  assert.equal(sanitizeMiniAppRedirectPath("/api"), null);
});

test("sanitizeMiniAppRedirectPath normalises traversal to an internal path", () => {
  assert.equal(sanitizeMiniAppRedirectPath("/mini/../dashboard"), "/dashboard");
  assert.equal(sanitizeMiniAppRedirectPath("/mini/../../etc/passwd"), "/etc/passwd");
});

test("buildMiniAppAuthBootstrapPath preserves a validated exact target for mini auth bootstrap", () => {
  assert.equal(
    buildMiniAppAuthBootstrapPath("/mini/o/ob-123"),
    "/mini?next=%2Fmini%2Fo%2Fob-123"
  );
});

test("buildMiniAppAuthBootstrapPath falls back to bare mini home for invalid targets", () => {
  assert.equal(
    buildMiniAppAuthBootstrapPath("https://evil.example/phish"),
    "/mini"
  );
});

test("buildMiniObligationEntryUrl appends the obligation path to the mini base url", () => {
  assert.equal(
    buildMiniObligationEntryUrl("https://wesetup.ru/mini", "ob-123"),
    "https://wesetup.ru/mini/o/ob-123"
  );
});

test("buildMiniObligationEntryUrl trims trailing slashes from the mini base url", () => {
  assert.equal(
    buildMiniObligationEntryUrl("https://wesetup.ru/mini/", "ob-123"),
    "https://wesetup.ru/mini/o/ob-123"
  );
});

test("normalizeMiniAppBaseUrl accepts either site root or mini root", () => {
  assert.equal(
    normalizeMiniAppBaseUrl("https://wesetup.ru"),
    "https://wesetup.ru/mini"
  );
  assert.equal(
    normalizeMiniAppBaseUrl("https://wesetup.ru/mini/"),
    "https://wesetup.ru/mini"
  );
});

test("buildMiniAppUrl avoids duplicate /mini segments", () => {
  assert.equal(
    buildMiniAppUrl("https://wesetup.ru/mini", "/mini/journals/hygiene"),
    "https://wesetup.ru/mini/journals/hygiene"
  );
  assert.equal(
    buildMiniAppUrl("https://wesetup.ru", "/mini/equipment"),
    "https://wesetup.ru/mini/equipment"
  );
});

test("buildMiniAppUrl opens site pages off the same origin", () => {
  // Цель обязательства теперь путь сайта — кнопка бота обязана открыть
  // `https://wesetup.ru/journals/hygiene`, а не приклеить его к `/mini`.
  assert.equal(
    buildMiniAppUrl("https://wesetup.ru/mini", "/journals/hygiene"),
    "https://wesetup.ru/journals/hygiene"
  );
  assert.equal(
    buildMiniAppUrl("https://wesetup.ru", "/journals/hygiene/new"),
    "https://wesetup.ru/journals/hygiene/new"
  );
});

test("buildMiniAppUrl falls back to the mini home for external targets", () => {
  assert.equal(
    buildMiniAppUrl("https://wesetup.ru/mini", "https://evil.example/phish"),
    "https://wesetup.ru/mini"
  );
});
