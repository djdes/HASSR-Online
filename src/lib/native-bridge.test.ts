import test from "node:test";
import assert from "node:assert/strict";

import {
  backButtonAction,
  classifyLink,
  deepLinkPath,
  downloadFileName,
  fileNameFromContentDisposition,
  normalizeAppUrl,
  parsePushAskState,
  pushExplainerAction,
  statusBarStyle,
} from "./native-bridge";
import { normalizePushUrl } from "./mobile-push";

const O = "https://wesetup.ru";

test("внутренние ссылки не перехватываются", () => {
  assert.equal(classifyLink("/journals/hygiene", O, false), "internal");
  assert.equal(classifyLink("https://wesetup.ru/settings", O, false), "internal");
  assert.equal(classifyLink("/mini/today?tab=1#x", O, false), "internal");
  assert.equal(classifyLink("#top", O, false), "internal");
  assert.equal(classifyLink("", O, false), "internal");
  assert.equal(classifyLink("javascript:void(0)", O, false), "internal");
  // Вход и выход NextAuth — не файлы.
  assert.equal(classifyLink("/api/auth/signout", O, false), "internal");
});

test("файлы открываются через «Поделиться» (Review Focus 4)", () => {
  assert.equal(classifyLink("/api/reports/pdf?template=hygiene", O, false), "download");
  assert.equal(classifyLink("/api/reports/excel?templateCode=hygiene", O, false), "download");
  assert.equal(classifyLink("/api/journal-documents/abc/pdf", O, false), "download");
  assert.equal(classifyLink("https://wesetup.ru/api/staff/export", O, false), "download");
  assert.equal(classifyLink("/api/closing-documents/x/pdf", O, false), "download");
  assert.equal(classifyLink("/exports/list.csv", O, false), "download");
  assert.equal(classifyLink("/docs/guide.PDF?v=2", O, false), "download");
  assert.equal(classifyLink("blob:https://wesetup.ru/123", O, true), "download");
  assert.equal(classifyLink("blob:https://wesetup.ru/123", O, false), "download");
  assert.equal(classifyLink("data:text/csv;base64,YQ==", O, true), "download");
  assert.equal(classifyLink("/journals/hygiene", O, true), "download");
});

test("чужие сайты — в браузер, почта и звонки — в систему", () => {
  assert.equal(classifyLink("https://tasksflow.ru/x", O, false), "external");
  assert.equal(classifyLink("https://t.me/wesetupbot", O, false), "external");
  // Чужой файл тоже не наш: скачивать его с нашими куками незачем.
  assert.equal(classifyLink("https://example.com/file.pdf", O, true), "external");
  assert.equal(classifyLink("mailto:support@wesetup.ru", O, false), "system");
  assert.equal(classifyLink("tel:+79990000000", O, false), "system");
  assert.equal(classifyLink("sms:+79990000000", O, false), "system");
  assert.equal(classifyLink("tg://resolve?domain=wesetupbot", O, false), "system");
});

test("имя файла из Content-Disposition: filename* важнее filename", () => {
  assert.equal(
    fileNameFromContentDisposition(
      "attachment; filename=\"report.xlsx\"; filename*=UTF-8''%D0%9E%D1%82%D1%87%D1%91%D1%82.xlsx"
    ),
    "Отчёт.xlsx"
  );
  assert.equal(fileNameFromContentDisposition('attachment; filename="report 1.pdf"'), "report 1.pdf");
  assert.equal(fileNameFromContentDisposition("attachment; filename=plain.csv"), "plain.csv");
  assert.equal(fileNameFromContentDisposition("inline"), null);
  assert.equal(fileNameFromContentDisposition(null), null);
});

test("имя файла: заголовок, затем download, затем адрес; расширение по типу", () => {
  assert.equal(
    downloadFileName({
      contentDisposition: 'attachment; filename="a.pdf"',
      downloadAttr: "b.pdf",
      url: "/api/x/c",
      contentType: "application/pdf",
    }),
    "a.pdf"
  );
  assert.equal(
    downloadFileName({ contentDisposition: null, downloadAttr: "b.xlsx", url: "/api/x", contentType: null }),
    "b.xlsx"
  );
  assert.equal(
    downloadFileName({
      contentDisposition: null,
      downloadAttr: "",
      url: "https://wesetup.ru/exports/list.csv?x=1",
      contentType: "text/csv",
    }),
    "list.csv"
  );
  // Путь без расширения — добавляем по типу ответа.
  assert.equal(
    downloadFileName({
      contentDisposition: null,
      downloadAttr: null,
      url: "/api/journal-documents/abc/pdf",
      contentType: "application/pdf",
    }),
    "pdf.pdf"
  );
  assert.equal(
    downloadFileName({
      contentDisposition: null,
      downloadAttr: null,
      url: "blob:https://wesetup.ru/5f0c-11",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    "WeSetup.xlsx"
  );
  // Слэши и прочие запрещённые в имени файла знаки убираем.
  assert.equal(
    downloadFileName({ contentDisposition: 'attachment; filename="a/b:c?.pdf"', downloadAttr: null, url: "/x", contentType: null }),
    "a_b_c_.pdf"
  );
});

test("ссылки из системы и уведомлений: те же правила, что у normalizePushUrl", () => {
  const hosts = ["localhost:3021"];
  const cases = [
    null,
    "",
    "/journals/hygiene?x=1#a",
    "https://wesetup.ru/mini/today",
    "https://www.wesetup.ru/task-fill/1",
    "http://localhost:3021/mini/me",
    "https://evil.example/mini",
    "//evil.example/x",
    "/\\evil.example",
    "javascript:alert(1)",
    "/api/reports/pdf",
    "/api",
    "mini/today",
    "https://wesetup.ru:bad",
  ];
  for (const href of cases) {
    assert.equal(normalizeAppUrl(href, hosts), normalizePushUrl(href, hosts), String(href));
  }
});

test("deepLinkPath: переход только когда адрес другой", () => {
  const hosts = ["wesetup.ru"];
  assert.equal(deepLinkPath("https://wesetup.ru/journals/hygiene", "/mini?src=app", hosts), "/journals/hygiene");
  assert.equal(deepLinkPath("https://wesetup.ru/mini?src=app", "/mini?src=app", hosts), null);
  // Сам запуск приложения (стартовый адрес) — не ссылка.
  assert.equal(deepLinkPath("https://wesetup.ru/mini", "/journals", hosts), null);
  assert.equal(deepLinkPath("https://evil.example/x", "/journals", hosts), null);
  assert.equal(deepLinkPath(undefined, "/journals", hosts), null);
  assert.equal(deepLinkPath("ru.wesetup.app://open", "/journals", hosts), null);
});

test("лист про уведомления: спросить один раз, «Не сейчас» — ещё раз через неделю", () => {
  const day = 24 * 60 * 60 * 1000;
  const now = 1_800_000_000_000;
  assert.equal(pushExplainerAction("granted", null, now), "register");
  assert.equal(pushExplainerAction("denied", null, now), "none");
  assert.equal(pushExplainerAction("prompt", null, now), "ask");
  assert.equal(pushExplainerAction("prompt-with-rationale", null, now), "ask");
  assert.equal(pushExplainerAction(null, null, now), "none");
  const later1 = { choice: "later" as const, at: now - 3 * day, laterCount: 1 };
  assert.equal(pushExplainerAction("prompt", later1, now), "none");
  assert.equal(pushExplainerAction("prompt", { ...later1, at: now - 8 * day }, now), "ask");
  const later2 = { choice: "later" as const, at: now - 30 * day, laterCount: 2 };
  assert.equal(pushExplainerAction("prompt", later2, now), "none");
  const enabled = { choice: "enabled" as const, at: now - day, laterCount: 0 };
  assert.equal(pushExplainerAction("prompt", enabled, now), "none");
  // Разрешение выдали в настройках телефона — регистрируем при любом ответе раньше.
  assert.equal(pushExplainerAction("granted", later2, now), "register");
});

test("parsePushAskState: мусор в хранилище — как будто не спрашивали", () => {
  assert.equal(parsePushAskState(null), null);
  assert.equal(parsePushAskState("{"), null);
  assert.equal(parsePushAskState('{"choice":"x","at":1}'), null);
  assert.deepEqual(parsePushAskState('{"choice":"later","at":5,"laterCount":1}'), {
    choice: "later",
    at: 5,
    laterCount: 1,
  });
  assert.deepEqual(parsePushAskState('{"choice":"enabled","at":5}'), {
    choice: "enabled",
    at: 5,
    laterCount: 0,
  });
});

test("строка состояния: светлые значки над тёмной шапкой", () => {
  assert.equal(statusBarStyle({ darkHeader: true, theme: "light" }), "DARK");
  assert.equal(statusBarStyle({ darkHeader: false, theme: "light" }), "LIGHT");
  assert.equal(statusBarStyle({ darkHeader: false, theme: "dark" }), "DARK");
});

test("кнопка «назад» Android", () => {
  assert.equal(backButtonAction({ isRoot: true, canGoBack: true }), "minimize");
  assert.equal(backButtonAction({ isRoot: false, canGoBack: true }), "back");
  assert.equal(backButtonAction({ isRoot: false, canGoBack: false }), "home");
});
