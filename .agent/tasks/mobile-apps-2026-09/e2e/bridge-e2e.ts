// Мост сайта к приложению (Task 7, Task 4, сайт Task 9) на стенде 3021:
// заглушка window.Capacitor + приписка WeSetupApp в User-Agent.
// Запуск: node --import tsx .agent/tasks/mobile-apps-2026-09/e2e/bridge-e2e.ts
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { BASE, PASSWORD, db } from "./server-db";
import { DEFAULT_STUB, installCapacitorStub, type StubConfig } from "./bridge-stub";

const SHOTS = "d:/wt/tmp";
const OWNER = "owner-a@e2e.local";
const OWNER_ID = "cmu2stnc30006wk9mo57z0txk";
const HYGIENE_DOC = "cmu3xjc390004ks9mroi7qi9i";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/128.0.0.0 Mobile Safari/537.36 WeSetupApp/1.0.0 (android)";
const IOS_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) " +
  "Mobile/15E148 WeSetupApp/1.0.0 (ios)";
const PLAIN_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36";
const HIDE_DEV =
  "window.__name=window.__name||function(f){return f};" +
  "try{localStorage.setItem(\"wesetup.last-seen-build-sha\",\"zzz\")}catch(e){};" +
  "document.addEventListener(\"DOMContentLoaded\",function(){var s=document.createElement(\"style\");" +
  "s.textContent=\"nextjs-portal{display:none!important}\";document.head.appendChild(s)})";

type Call = { p: string; m: string; a: unknown; at: string };

async function signIn(ctx: BrowserContext, email: string) {
  const csrf = (await (await ctx.request.get(`${BASE}/api/auth/csrf`)).json()) as { csrfToken: string };
  await ctx.request.post(`${BASE}/api/auth/callback/credentials`, {
    form: { csrfToken: csrf.csrfToken, email, password: PASSWORD, json: "true", callbackUrl: `${BASE}/mini` },
    maxRedirects: 0,
  });
  const cookies = await ctx.cookies(BASE);
  if (!cookies.some((c) => /session/i.test(c.name))) throw new Error(`sign-in failed ${email}`);
}

// Вход ограничен 5 попытками на почту за 5 минут — входим один раз и
// переносим куки в новые контексты. После «Выйти» (сессии отозваны) — заново.
let ownerState: Awaited<ReturnType<BrowserContext["storageState"]>> | null = null;

async function ownerCookies(browser: Browser) {
  if (!ownerState) {
    const tmp = await browser.newContext();
    await signIn(tmp, OWNER);
    ownerState = await tmp.storageState();
    await tmp.close();
  }
  return ownerState;
}

async function appContext(
  browser: Browser,
  opts: { ua?: string; stub?: Partial<StubConfig> | null; theme?: "light" | "dark"; signedIn?: boolean } = {}
) {
  const ctx = await browser.newContext({
    storageState: opts.signedIn === false ? undefined : await ownerCookies(browser),
    // Сервис-воркер мини-приложения перезапрашивает навигации сам, и
    // Playwright не подставляет в них User-Agent контекста — сервер видел
    // бы браузер, а не приложение. См. отчёт (orchestratorTodo про mini-sw).
    serviceWorkers: "block",
    userAgent: opts.ua ?? ANDROID_UA,
    viewport: { width: 360, height: 740 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });
  await ctx.addInitScript(HIDE_DEV);
  if (opts.theme) {
    await ctx.addInitScript(`try{localStorage.setItem("wesetup-app-theme","${opts.theme}")}catch(e){}`);
  }
  if (opts.stub !== null) {
    await ctx.addInitScript(installCapacitorStub, { ...DEFAULT_STUB, ...(opts.stub ?? {}) });
  }
  return ctx;
}

const calls = (page: Page) => page.evaluate(() => ((window as unknown as { __calls?: Call[] }).__calls ?? []) as Call[]);
const fire = (page: Page, plugin: string, event: string, payload: unknown) =>
  page.evaluate(([p, e, x]) => (window as unknown as { __fire: (a: unknown, b: unknown, c: unknown) => number }).__fire(p, e, x), [plugin, event, payload] as const);
const has = (list: Call[], p: string, m: string) => list.some((c) => c.p === p && c.m === m);
const path = (page: Page) => new URL(page.url()).pathname;

/** Ждать, пока значение станет истинным (первый запрос к роуту в dev компилируется долго). */
async function poll<T>(fn: () => Promise<T>, ms = 60000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function waitCalls(page: Page, ok: (l: Call[]) => boolean, ms = 90000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (ok(await calls(page))) return;
    await page.waitForTimeout(500);
  }
}

async function goto(page: Page, url: string) {
  await page.goto(`${BASE}${url}`, { waitUntil: "load", timeout: 300000 });
  await page.waitForTimeout(1500);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const out: Record<string, unknown> = {};
  await db.mobileDevice.deleteMany({ where: { token: { startsWith: "fcm-e2e-" } } });
  try {
    // 1. Лист про уведомления → разрешение → токен → POST → строка в базе.
    {
      const ctx = await appContext(browser, { stub: { permission: "prompt" }, theme: "light" });
      const page = await ctx.newPage();
      await goto(page, "/dashboard");
      await page.getByTestId("push-explainer").waitFor({ timeout: 15000 });
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${SHOTS}/bridge-push-explainer.png` });
      const posts: string[] = [];
      page.on("request", (r) => {
        if (r.url().includes("/api/mobile/devices")) posts.push(`${r.method()} ${r.postData() ?? ""}`);
      });
      await page.getByTestId("push-explainer-enable").click();
      await page.waitForTimeout(2000);
      const list = await calls(page);
      const seq = list.filter((c) => c.p === "FirebaseMessaging" && ["requestPermissions", "getToken"].includes(c.m)).map((c) => c.m);
      out.pushSeq = seq;
      out.pushPosts = posts;
      const row = await poll(() => db.mobileDevice.findUnique({ where: { token: DEFAULT_STUB.token } }));
      out.pushRow = row ? { userId: row.userId, platform: row.platform, pushEnabled: row.pushEnabled } : null;
      assert.deepEqual(seq, ["requestPermissions", "getToken"]);
      assert.ok(posts.some((p) => p.startsWith("POST") && p.includes(DEFAULT_STUB.token)));
      assert.equal(row?.userId, OWNER_ID);
      assert.equal(row?.platform, "android");
      out.explainerGone = await page.getByTestId("push-explainer").count();
      assert.equal(out.explainerGone, 0);
      out.statusBar = list.filter((c) => c.p === "StatusBar").map((c) => c.a);
      assert.ok((out.statusBar as { style: string }[]).some((a) => a.style === "DARK"));

      // Нажатие на уведомление → переход.
      await fire(page, "FirebaseMessaging", "notificationActionPerformed", {
        actionId: "tap",
        notification: { data: { url: "https://wesetup.ru/journals/hygiene" } },
      });
      await page.waitForURL("**/journals/hygiene", { timeout: 60000 });
      out.notificationNav = path(page);

      // Следующая загрузка: лист не показывается снова, телефон уже зарегистрирован.
      await page.waitForTimeout(1500);
      out.explainerAgain = await page.getByTestId("push-explainer").count();
      assert.equal(out.explainerAgain, 0);

      // «Назад» Android: на вложенном экране — history.back, на домашнем — свернуть.
      await goto(page, "/dashboard");
      await page.evaluate(() => {
        const a = document.createElement("a");
        a.href = "/journals/hygiene";
        a.id = "e2e-nested";
        a.textContent = "nested";
        document.body.appendChild(a);
      });
      await page.locator("#e2e-nested").click();
      await page.waitForURL("**/journals/hygiene", { timeout: 60000 });
      await page.waitForTimeout(1500);
      await fire(page, "App", "backButton", { canGoBack: true });
      await page.waitForURL("**/dashboard", { timeout: 60000 });
      out.backNested = path(page);
      await page.waitForTimeout(1500);
      const before = (await calls(page)).filter((c) => c.m === "minimizeApp").length;
      await fire(page, "App", "backButton", { canGoBack: true });
      await page.waitForTimeout(500);
      const after = (await calls(page)).filter((c) => c.m === "minimizeApp").length;
      out.backHomeMinimize = after - before;
      assert.equal(out.backHomeMinimize, 1);
      await ctx.close();
    }

    // 2. Печать, файлы, ссылки.
    {
      const ctx = await appContext(browser, { stub: { permission: "denied" } });
      const page = await ctx.newPage();
      // Печать страницы инструкции журнала (window.print → WebPrint.print).
      await goto(page, "/journals/hygiene/guide");
      await page.getByRole("button", { name: "Распечатать журнал" }).first().click();
      await page.waitForTimeout(500);
      out.printCalls = (await calls(page)).filter((c) => c.p === "WebPrint" && c.m === "print").length;
      assert.ok((out.printCalls as number) >= 1, "WebPrint.print");
      // window.print() из любого места страницы.
      await page.evaluate(() => window.print());
      await page.waitForTimeout(300);
      out.printCalls2 = (await calls(page)).filter((c) => c.p === "WebPrint" && c.m === "print").length;
      assert.equal(out.printCalls2, (out.printCalls as number) + 1);

      // PDF документа журнала (ссылка target=_blank на /api/...pdf).
      await goto(page, `/journals/hygiene/documents/${HYGIENE_DOC}`);
      const pdfLink = page.getByTestId("print-pdf-link").first();
      if (await pdfLink.count()) {
        await pdfLink.click();
        await waitCalls(page, (l) => l.some((c) => c.p === "Share"));
        const fsCalls = (await calls(page)).filter((c) => c.p === "Filesystem");
        out.docPdf = fsCalls.map((c) => (c.a as { path: string }).path);
        out.docPdfPath = path(page);
        assert.ok((out.docPdf as string[]).some((p) => p.endsWith(".pdf")), "PDF документа через Filesystem");
      }

      // Отчёт Excel и PDF на /reports.
      await goto(page, "/reports");
      await page.locator('[role="combobox"]').first().click();
      await page.getByRole("option").first().click();
      await page.waitForTimeout(300);
      const btnExcel = page.getByRole("button", { name: /Excel/i }).first();
      await btnExcel.click();
      await waitCalls(page, (l) => l.filter((c) => c.p === "Share").length >= 2);
      const btnPdf = page.getByRole("button", { name: /PDF/i }).first();
      await btnPdf.click();
      await waitCalls(page, (l) => l.filter((c) => c.p === "Share").length >= 3);
      const list = await calls(page);
      out.reportFiles = list.filter((c) => c.p === "Filesystem").map((c) => c.a);
      out.reportShares = list.filter((c) => c.p === "Share").map((c) => c.a);
      await page.screenshot({ path: `${SHOTS}/bridge-reports-after.png` });
      const names = (out.reportFiles as { path: string }[]).map((a) => a.path);
      assert.ok(names.some((n) => n.endsWith(".xlsx")), "xlsx");
      assert.ok(names.some((n) => n.endsWith(".pdf")), "pdf");
      assert.ok((out.reportShares as { files: string[] }[]).some((s) => s.files[0].endsWith(".xlsx")));

      // Blob-ссылка, не вставленная в страницу.
      await page.evaluate(() => {
        const blob = new Blob(["a;b\n1;2"], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "detached.csv";
        a.click();
        URL.revokeObjectURL(url);
      });
      await page.waitForTimeout(1500);
      const blobCall = (await calls(page)).filter((c) => c.p === "Filesystem").pop()?.a as { path: string; data: string };
      out.detachedBlob = blobCall;
      assert.equal(blobCall.path, "detached.csv");
      assert.equal(blobCall.data, Buffer.from("a;b\n1;2").toString("base64"));

      // mailto и чужой сайт → AppLauncher; своя ссылка без target — не трогаем.
      await page.evaluate(() => {
        const add = (id: string, href: string, target?: string) => {
          const a = document.createElement("a");
          a.id = id;
          a.href = href;
          a.textContent = id;
          a.style.cssText = "position:fixed;left:10px;z-index:99999;background:#fff;display:block";
          a.style.top = `${120 + document.querySelectorAll("[data-e2e-link]").length * 30}px`;
          a.setAttribute("data-e2e-link", "");
          if (target) a.target = target;
          document.body.appendChild(a);
        };
        add("e2e-mail", "mailto:support@wesetup.ru");
        add("e2e-ext", "https://example.com/page");
        add("e2e-blank", "/journals", "_blank");
        add("e2e-plain", "/mini/me");
        (window as unknown as { __prevented: boolean[] }).__prevented = [];
        window.addEventListener("click", (e) => (window as unknown as { __prevented: boolean[] }).__prevented.push(e.defaultPrevented));
      });
      await page.locator("#e2e-mail").click();
      await page.locator("#e2e-ext").click();
      await page.waitForTimeout(500);
      out.openUrl = (await calls(page)).filter((c) => c.p === "AppLauncher").map((c) => (c.a as { url: string }).url);
      assert.deepEqual(out.openUrl, ["mailto:support@wesetup.ru", "https://example.com/page"]);
      out.pagesAfterExternal = ctx.pages().length;
      assert.equal(out.pagesAfterExternal, 1);

      // Своя ссылка target=_blank → здесь же, без новой вкладки.
      await page.locator("#e2e-blank").click();
      await page.waitForURL("**/journals", { timeout: 60000 });
      out.blankNav = path(page);
      out.pagesAfterBlank = ctx.pages().length;
      assert.equal(out.pagesAfterBlank, 1);

      // window.open на свой экран → здесь же.
      await page.waitForTimeout(1500);
      await page.evaluate(() => window.open("/mini/sections", "_blank"));
      await page.waitForURL("**/mini/sections", { timeout: 60000 });
      out.windowOpenNav = path(page);

      // Обычная своя ссылка — без перехвата (preventDefault только от next/link нет — это <a>).
      await page.waitForTimeout(1500);
      await page.evaluate(() => {
        const a = document.createElement("a");
        a.id = "e2e-plain2";
        a.href = "/mini/me";
        a.textContent = "plain";
        a.style.cssText = "position:fixed;top:140px;left:10px;z-index:99999;background:#fff";
        document.body.appendChild(a);
        (window as unknown as { __prevented: boolean[] }).__prevented = [];
        window.addEventListener("click", (e) => (window as unknown as { __prevented: boolean[] }).__prevented.push(e.defaultPrevented));
      });
      const fsBefore = (await calls(page)).length;
      await page.locator("#e2e-plain2").click();
      await page.waitForURL("**/mini/me", { timeout: 60000 });
      out.plainNav = path(page);
      const newCalls = (await calls(page)).slice(fsBefore).filter((c) => ["Filesystem", "AppLauncher", "Share"].includes(c.p));
      out.plainIntercepted = newCalls.length;
      assert.equal(out.plainIntercepted, 0);
      await ctx.close();
    }

    // 3. Ссылка, которой открыли приложение (холодный запуск Android) и appUrlOpen.
    {
      const ctx = await appContext(browser, {
        stub: { permission: "denied", launchUrl: "https://wesetup.ru/journals/hygiene?from=link" },
      });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/dashboard`, { waitUntil: "load", timeout: 300000 });
      await page.waitForURL("**/journals/hygiene?from=link", { timeout: 60000 });
      out.launchNav = new URL(page.url()).pathname + new URL(page.url()).search;
      // Второй раз за тот же запуск — не уводит.
      await goto(page, "/dashboard");
      await page.waitForTimeout(1500);
      out.launchOnce = path(page);
      assert.equal(out.launchOnce, "/dashboard");
      await fire(page, "App", "appUrlOpen", { url: `${BASE}/mini/me` });
      await page.waitForURL("**/mini/me", { timeout: 60000 });
      out.appUrlOpenNav = path(page);
      // Чужой домен — никуда.
      await page.waitForTimeout(1500);
      await fire(page, "App", "appUrlOpen", { url: "https://evil.example/mini/today" });
      await page.waitForTimeout(1500);
      out.foreignDeepLink = path(page);
      assert.equal(out.foreignDeepLink, "/mini/me");
      await ctx.close();
    }

    // 4. Профиль: переключатель (разрешено) и запрет; тарифы скрыты; выход — DELETE до выхода.
    for (const theme of ["light", "dark"] as const) {
      const ctx = await appContext(browser, { stub: { permission: "granted" }, theme });
      const page = await ctx.newPage();
      await goto(page, "/mini/me");
      const section = page.getByTestId("app-push-settings");
      await section.waitFor({ timeout: 20000 });
      await page.getByTestId("app-push-toggle").waitFor({ timeout: 20000 });
      // Тема профиля хранится на сервере — переключаем кнопкой и возвращаем светлую.
      if (theme === "dark") {
        await page.getByRole("radio", { name: /Тёмная/ }).click();
        await page.waitForTimeout(800);
      }
      await section.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${SHOTS}/bridge-profile-granted-${theme}.png` });
      if (theme === "dark") {
        out.statusBarDark = (await calls(page)).filter((c) => c.p === "StatusBar").map((c) => c.a);
        await page.getByRole("radio", { name: /Светлая/ }).click();
        await page.waitForTimeout(800);
      }
      if (theme === "light") {
        out.tariffRowInApp = await page.getByText("Тарифы и оплата").count();
        assert.equal(out.tariffRowInApp, 0);
        const before = await db.mobileDevice.findUnique({ where: { token: DEFAULT_STUB.token } });
        out.toggleBefore = before?.pushEnabled;
        await page.getByTestId("app-push-toggle").click();
        await page.waitForTimeout(1500);
        const afterRow = await db.mobileDevice.findUnique({ where: { token: DEFAULT_STUB.token } });
        out.toggleAfter = afterRow?.pushEnabled;
        assert.equal(out.toggleBefore, true);
        assert.equal(out.toggleAfter, false);
        await page.getByTestId("app-push-toggle").click();
        await page.waitForTimeout(1500);
        out.toggleBack = (await db.mobileDevice.findUnique({ where: { token: DEFAULT_STUB.token } }))?.pushEnabled;
        assert.equal(out.toggleBack, true);

        // Выход: DELETE /api/mobile/devices раньше выхода NextAuth.
        const order: string[] = [];
        page.on("request", (r) => {
          const u = r.url();
          if (u.includes("/api/mobile/devices") && r.method() === "DELETE") order.push("DELETE devices");
          if (u.includes("/api/auth/signout") || u.includes("/api/auth/sign-out") || u.includes("signout")) order.push(`signout ${new URL(u).pathname}`);
        });
        await page.getByRole("button", { name: /Выйти/ }).first().click();
        await page.getByRole("button", { name: "Выйти" }).last().click();
        await page.waitForURL("**/mini/login**", { timeout: 60000 });
        out.signOutOrder = order;
        assert.equal(order[0], "DELETE devices");
        ownerState = null;
        out.rowAfterSignOut = await db.mobileDevice.count({ where: { token: DEFAULT_STUB.token } });
        assert.equal(out.rowAfterSignOut, 0);
      }
      await ctx.close();
    }
    {
      const ctx = await appContext(browser, { stub: { permission: "denied" }, theme: "light" });
      const page = await ctx.newPage();
      await goto(page, "/mini/me");
      await page.getByTestId("app-push-denied").waitFor({ timeout: 20000 });
      await page.getByTestId("app-push-settings").scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${SHOTS}/bridge-profile-denied-light.png` });
      await page.getByTestId("app-push-open-settings").click();
      await page.waitForTimeout(300);
      out.openSettings = has(await calls(page), "WebPrint", "openSettings");
      assert.equal(out.openSettings, true);
      await ctx.close();
    }

    // 5. Голосовой ввод → SpeechRecognition.start.
    {
      // Все журналы e2e-организации — документы; поле с голосом есть только
      // у полевых журналов (DynamicForm). Временный полевой журнал в e2e-базе.
      await db.journalTemplate.upsert({
        where: { code: "e2e_voice" },
        create: { code: "e2e_voice", name: "E2E голос", fields: [{ key: "note", label: "Заметка", type: "textarea" }] },
        update: {},
      });
      const ctx = await appContext(browser, { stub: { permission: "denied" } });
      const page = await ctx.newPage();
      await goto(page, "/journals/e2e_voice/new");
      const mic = page.locator('button[title="Голосовой ввод"]').first();
      out.voicePath = path(page);
      out.voiceButtons = await mic.count();
      if (out.voiceButtons) {
        await mic.click();
        await page.waitForTimeout(800);
        const list = await calls(page);
        out.voiceCalls = list.filter((c) => c.p === "SpeechRecognition").map((c) => c.m);
        out.voiceText = await page.locator("textarea").first().inputValue();
        assert.ok((out.voiceCalls as string[]).includes("start"));
        assert.ok(String(out.voiceText).includes("проверка голоса"));
      }
      assert.ok((out.voiceButtons as number) > 0, "кнопка голоса есть");
      await page.screenshot({ path: `${SHOTS}/bridge-voice.png` });
      await ctx.close();
      await db.journalTemplate.delete({ where: { code: "e2e_voice" } });
    }

    // 6. Вход: ключ скрыт на Android, есть на iOS; «Аккаунт удалён».
    {
      const android = await appContext(browser, { stub: null, signedIn: false });
      const p1 = await android.newPage();
      await goto(p1, "/login");
      out.passkeyAndroid = await p1.getByTestId("passkey-login-button").count();
      await goto(p1, "/mini/login?deleted=1");
      out.miniDeleted = await p1.getByTestId("mini-login-account-deleted").count();
      await p1.screenshot({ path: `${SHOTS}/bridge-mini-login-deleted.png` });
      await android.close();
      const ios = await appContext(browser, { ua: IOS_UA, stub: { platform: "ios" }, signedIn: false });
      const p2 = await ios.newPage();
      await goto(p2, "/login?deleted=1");
      out.passkeyIos = await p2.getByTestId("passkey-login-button").count();
      out.loginDeleted = await p2.getByTestId("login-account-deleted").count();
      await ios.close();
      assert.equal(out.passkeyAndroid, 0);
      assert.equal(out.passkeyIos, 1);
      assert.equal(out.miniDeleted, 1);
      assert.equal(out.loginDeleted, 1);
    }

    // 7. Безопасные зоны: вырез 47px сверху — шапка под ним; viewport-fit=cover только в приложении.
    {
      const ctx = await appContext(browser, { stub: { permission: "denied", topInset: 47 }, theme: "light" });
      const page = await ctx.newPage();
      await goto(page, "/dashboard");
      out.viewportApp = await page.locator('meta[name="viewport"]').getAttribute("content");
      await goto(page, "/mini/me");
      out.viewportAppMini = await page.locator('meta[name="viewport"]').getAttribute("content");
      assert.ok(String(out.viewportAppMini).includes("viewport-fit=cover"));
      await goto(page, "/dashboard");
      out.topbarPaddingApp = await page.locator("header.mini-topbar").first().evaluate((el) => getComputedStyle(el).paddingTop);
      out.miniSafeT = await page.evaluate(() => getComputedStyle(document.getElementById("mini-root")!).getPropertyValue("--mini-safe-t"));
      await page.screenshot({ path: `${SHOTS}/bridge-safe-area-47.png` });
      assert.ok(String(out.viewportApp).includes("viewport-fit=cover"));
      assert.equal(out.topbarPaddingApp, "47px");
      await ctx.close();
    }

    // 8. Без приписки приложения: ничего из этого не происходит.
    {
      // Даже если кто-то подложил window.Capacitor — без приписки мост молчит.
      const ctx = await appContext(browser, { ua: PLAIN_UA, stub: { permission: "prompt" } });
      const page = await ctx.newPage();
      await goto(page, "/mini/me");
      await page.waitForTimeout(2000);
      out.plainSheet = await page.getByTestId("push-explainer").count();
      out.plainProfileSection = await page.getByTestId("app-push-settings").count();
      out.plainTariffRow = await page.getByText("Тарифы и оплата").count();
      out.plainPrintNative = await page.evaluate(() => /\[native code\]/.test(String(window.print)));
      out.plainOpenNative = await page.evaluate(() => /\[native code\]/.test(String(window.open)));
      out.plainAnchorClickNative = await page.evaluate(() => /\[native code\]/.test(String(HTMLAnchorElement.prototype.click)));
      out.plainViewport = await page.locator('meta[name="viewport"]').getAttribute("content");
      out.plainTopbarPadding = await page.locator("header.mini-topbar").first().evaluate((el) => getComputedStyle(el).paddingTop);
      out.plainMiniSafeT = await page.evaluate(() => getComputedStyle(document.getElementById("mini-root")!).getPropertyValue("--mini-safe-t"));
      const dl = page.waitForEvent("download", { timeout: 10000 }).then((d) => d.suggestedFilename()).catch(() => null);
      await page.evaluate(() => {
        const url = URL.createObjectURL(new Blob(["x"], { type: "text/csv" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = "plain.csv";
        a.click();
      });
      out.plainDownload = await dl;
      out.plainCalls = (await calls(page)).filter((c) => c.m !== "addListener").map((c) => `${c.p}.${c.m}`);
      assert.equal(out.plainSheet, 0);
      assert.equal(out.plainProfileSection, 0);
      assert.equal(out.plainTariffRow, 1);
      assert.equal(out.plainPrintNative, true);
      assert.equal(out.plainOpenNative, true);
      assert.equal(out.plainAnchorClickNative, true);
      assert.ok(!String(out.plainViewport).includes("viewport-fit"));
      assert.equal(out.plainDownload, "plain.csv");
      assert.deepEqual(out.plainCalls, []);
      await ctx.close();
    }
    out.result = "PASS";
  } catch (err) {
    out.result = "FAIL";
    out.error = err instanceof Error ? err.stack : String(err);
    throw err;
  } finally {
    fs.writeFileSync(".agent/tasks/mobile-apps-2026-09/e2e/bridge-e2e.json", JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
    await db.mobileDevice.deleteMany({ where: { token: { startsWith: "fcm-e2e-" } } });
    await browser.close();
    await db.$disconnect();
  }
}

main().catch(() => process.exit(1));
