/*
 * Смоук новинок 21.11.2026 в браузере (iPhone 13): вход руководителя и проход по новым экранам —
 * мастер «Настройка за 3 минуты», журнал приёмки (полоса Меркурия, «ВСД из Меркурия», «Добавить из
 * iiko»), «Входящие ВСД», история партии, страница партии, подключение Poster, подсказки блюд и
 * подпись УКЭП целиком: подставной плагин КриптоПро подписывает PDF настоящим openssl, сервер
 * проверяет подпись и сохраняет, файлы скачиваются. На каждом экране — ошибки страницы, горизонтальная
 * прокрутка и скриншот.
 *
 * Запуск (локальная база — не прод!):
 *   1. env со своей базой: DATABASE_URL=postgresql://…@127.0.0.1/haccp_smoke, NEXTAUTH_URL=http://localhost:3005
 *   2. npx prisma db push && npx tsx prisma/seed.ts
 *   3. SMOKE_DATA="$(npx tsx scripts/smoke/new-features-setup.ts | tail -1)"
 *   4. npx next dev -p 3005   (в другом окне)
 *   5. SMOKE_DATA="$SMOKE_DATA" node scripts/smoke/new-features.smoke.cjs [папка-для-скриншотов]
 */
const { execFileSync } = require("node:child_process");
const { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { chromium, devices } = require("playwright");

const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3005";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.error("smoke: только локальный сервер (SMOKE_BASE_URL на localhost)");
  process.exit(1);
}
const data = JSON.parse(process.env.SMOKE_DATA || "{}");
if (!data.email || !data.documentId) {
  console.error("smoke: нет SMOKE_DATA — запустите scripts/smoke/new-features-setup.ts");
  process.exit(1);
}
const OUT = process.argv[2] || path.join(tmpdir(), "wesetup-smoke");
mkdirSync(OUT, { recursive: true });

let failed = 0;
const results = [];
function check(label, ok, extra) {
  if (!ok) failed += 1;
  results.push({ label, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${!ok && extra !== undefined ? ` — ${typeof extra === "string" ? extra : JSON.stringify(extra)}` : ""}`);
}

/** Шум dev-сервера и браузера, к новинкам не относится. */
const NOISE = /Download the React DevTools|\[HMR\]|\[Fast Refresh\]|favicon|Failed to load resource: the server responded with a status of 40[134]|translation-overrides|webpack-hmr|Third-party cookie/i;

/** Подставной плагин КриптоПро: API как у cadesplugin_api.js, подпись — настоящим openssl в Node. */
const FAKE_PLUGIN = `
(() => {
  const cert = {
    get Thumbprint() { return Promise.resolve("SMOKE01"); },
    get SubjectName() { return Promise.resolve("CN=Смоуков Тест Тестович, SN=Смоуков, G=Тест Тестович, O=ООО Смоук"); },
    get IssuerName() { return Promise.resolve("CN=Смоук УЦ"); },
    get ValidToDate() { return Promise.resolve(new Date(Date.now() + 86400000).toISOString()); },
    HasPrivateKey: async () => true,
  };
  let content = "";
  const store = { Open: async () => {}, Close: async () => {}, get Certificates() { return Promise.resolve({ get Count() { return Promise.resolve(1); }, Item: async () => cert }); } };
  const signer = { propset_Certificate: async () => {}, propset_CheckCertificate: async () => {}, propset_Options: async () => {} };
  const data = {
    propset_ContentEncoding: async () => {},
    propset_Content: async (value) => { content = value; },
    SignCades: async (_signer, type, detached) => window.__smokeSign(content, type, detached),
  };
  const plugin = {
    CreateObjectAsync: async (name) => (name === "CAdESCOM.Store" ? store : name === "CAdESCOM.CPSigner" ? signer : data),
    CAPICOM_CURRENT_USER_STORE: 2, CAPICOM_MY_STORE: "My", CAPICOM_STORE_OPEN_MAXIMUM_ALLOWED: 2,
    CAPICOM_CERTIFICATE_INCLUDE_END_ENTITY_ONLY: 2, CADESCOM_BASE64_TO_BINARY: 1, CADESCOM_CADES_BES: 1,
  };
  window.cadesplugin = Object.assign(Promise.resolve(), plugin);
})();
`;

function opensslSign(base64) {
  const dir = mkdtempSync(path.join(tmpdir(), "smoke-ukep-"));
  try {
    writeFileSync(path.join(dir, "doc.pdf"), Buffer.from(base64, "base64"));
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(dir, "k.pem"), "-out", path.join(dir, "c.pem"), "-days", "2", "-utf8", "-subj", "/O=ООО Смоук/title=Управляющий/SN=Смоуков/GN=Тест Тестович/CN=Смоуков Тест Тестович"], { stdio: "ignore" });
    execFileSync("openssl", ["cms", "-sign", "-binary", "-in", path.join(dir, "doc.pdf"), "-signer", path.join(dir, "c.pem"), "-inkey", path.join(dir, "k.pem"), "-outform", "DER", "-out", path.join(dir, "doc.sig"), "-md", "sha256"], { stdio: "ignore" });
    return readFileSync(path.join(dir, "doc.sig")).toString("base64");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  // Свой Chromium, если версия playwright проекта не совпала со скачанными браузерами.
  const executablePath = process.env.SMOKE_CHROMIUM || (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
  const browser = await chromium.launch(executablePath ? { executablePath, args: ["--headless=new", "--no-sandbox"] } : {});
  const context = await browser.newContext({ ...devices["iPhone 13"], locale: "ru-RU" });
  const page = await context.newPage();
  let pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error" && !NOISE.test(message.text())) pageErrors.push(message.text());
  });
  const signCalls = [];
  await page.exposeFunction("__smokeSign", (content, type, detached) => {
    signCalls.push({ type, detached, size: content.length });
    return opensslSign(content);
  });
  await page.addInitScript(FAKE_PLUGIN);

  /**
   * Дождаться, пока страница встанет. У компании с офисом (быстрая настройка
   * открывает его вместе с первым объектом) шапка сама меняет объект уже после
   * загрузки: в журналах включает единственный объект, в настройках — «Выберите
   * объект» (`PointSectionSync`). Пока смена идёт, страница спрятана под скелетом
   * `[data-content-pending]`, и текст за фиксированную паузу мог не успеть
   * появиться. Не дождались — проверка ниже упадёт с тем, что на экране.
   */
  async function settle(expectText) {
    await page
      .waitForFunction(
        (text) => !document.querySelector("[data-content-pending]") && (!text || document.body.innerText.toLocaleLowerCase("ru").includes(text)),
        expectText ? expectText.toLocaleLowerCase("ru") : "",
        { timeout: 60_000, polling: 250 },
      )
      .catch(() => undefined);
  }

  /** Экран: открыть, дождаться, проверить ошибки и прокрутку, снять скриншот. */
  async function screen(name, url, expectText) {
    pageErrors = [];
    // Не «networkidle»: страницы держат долгое соединение /api/live, сеть не затихает.
    const response = await page.goto(`${BASE}${url}`, { waitUntil: "load", timeout: 180_000 });
    await page.waitForTimeout(1500);
    await settle(expectText);
    await page.evaluate(() => document.querySelectorAll("nextjs-portal").forEach((node) => node.remove()));
    const status = response ? response.status() : 0;
    const text = await page.locator("body").innerText();
    check(`${name}: открывается (HTTP ${status})`, status === 200 && !page.url().includes("/login"), page.url());
    // Без учёта регистра: innerText отдаёт заголовки с CSS uppercase заглавными.
    if (expectText) check(`${name}: есть «${expectText}»`, text.toLocaleLowerCase("ru").includes(expectText.toLocaleLowerCase("ru")), text.slice(0, 300));
    await shot(name);
    return text;
  }
  /** Нажать с повтором: сразу после компиляции маршрута dev-сервер ещё перерисовывает страницу. */
  async function tap(locator) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        // Значок dev-сервера Next.js («N Issues») — не часть приложения: на телефоне он ложится на
        // кнопки внизу окна («Подписать УКЭП») и перехватывает нажатие. Ошибки страницы смоук
        // ловит сам (`pageErrors`), значок для этого не нужен — убираем, как перед снимками.
        await page.evaluate(() => document.querySelectorAll("nextjs-portal").forEach((node) => node.remove()));
        await locator.click({ timeout: 10_000 });
        return;
      } catch (error) {
        if (attempt >= 3) {
          // Что было на экране в момент сбоя — для разбора.
          await page.screenshot({ path: path.join(OUT, `fail-${Date.now()}.png`) }).catch(() => undefined);
          throw error;
        }
        await page.waitForTimeout(1_000);
      }
    }
  }
  /** Первый заход в журнал: сама открывается «Инструкция» — закрываем, как человек («Понятно»). */
  async function dismissGuide() {
    const ok = page.getByRole("button", { name: "Понятно" }).first();
    if (await ok.isVisible({ timeout: 2_500 }).catch(() => false)) {
      await ok.click();
      await page.waitForTimeout(400);
    }
  }
  async function shot(name) {
    // Чистый снимок: без фокуса на «Перейти к содержимому», с начала страницы, без значка dev-сервера.
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      window.scrollTo(0, 0);
      document.querySelectorAll("nextjs-portal").forEach((node) => node.remove());
    });
    await page.waitForTimeout(200);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${name}: нет горизонтальной прокрутки`, overflow <= 1, { overflow });
    check(`${name}: нет ошибок страницы`, pageErrors.length === 0, pageErrors.slice(0, 3));
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  }

  // Вход
  await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 180_000 });
  await page.fill("#email", data.email);
  await page.fill("#password", data.password);
  await Promise.all([page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 120_000 }), page.locator('button[type="submit"]').first().click()]);
  check("вход руководителя", !page.url().includes("/login"), page.url());

  // 1. Настройка за 3 минуты
  await screen("01-quick-setup", "/settings/onboarding-template", "Кафе до 30 мест");
  await tap(page.getByTestId("quick-setup-kind-cafe-small"));
  await page.getByTestId("quick-setup-questions").waitFor({ timeout: 30_000 });
  pageErrors = [];
  await shot("02-quick-setup-questions");
  await tap(page.getByTestId("quick-setup-apply"));
  await page.getByTestId("quick-setup-result").waitFor({ timeout: 120_000 });
  pageErrors = [];
  const result = await page.getByTestId("quick-setup-result").innerText();
  check("мастер: кабинет настроен", /Кабинет настроен/.test(result), result.slice(0, 200));
  await shot("03-quick-setup-done");

  // 2. Журнал приёмки: полоса Меркурия, меню, iiko
  const docUrl = `/journals/incoming_control/documents/${data.documentId}`;
  await page.goto(`${BASE}${docUrl}`, { waitUntil: "load", timeout: 180_000 });
  await page.waitForTimeout(1500);
  await dismissGuide();
  await screen("04-acceptance", docUrl, "ждут приёмки");
  await dismissGuide();
  const strip = page.getByTestId("acceptance-mercury-strip");
  check("журнал: полоса Меркурия — 2 ждут, 1 просрочен", (await strip.count()) === 1 && /2 ВСД ждут приёмки/.test(await strip.innerText()) && /просрочено: 1/.test(await strip.innerText()));
  check("журнал: «Оформить» ведёт на «Входящие ВСД»", (await strip.locator("a").getAttribute("href")) === "/mercury");
  await tap(page.locator("button:visible", { hasText: /^Добавить$/ }).first());
  await page.waitForTimeout(600);
  const menuText = await page.locator("body").innerText();
  check("журнал: в меню «ВСД из Меркурия» и «Добавить из iiko»", menuText.includes("ВСД из Меркурия") && menuText.includes("Добавить из iiko"));
  await tap(page.getByText("Добавить из iiko").first());
  const iikoDialog = page.locator('[role="dialog"]').last();
  await iikoDialog.waitFor({ timeout: 10_000 });
  check("журнал: iiko подключён — во «Входящие накладные»", (await iikoDialog.locator("a").first().getAttribute("href")) === "/edo");
  pageErrors = [];
  await shot("05-acceptance-iiko");
  await page.keyboard.press("Escape");

  // 3. Подпись УКЭП целиком
  await page.goto(`${BASE}${docUrl}`, { waitUntil: "load", timeout: 180_000 });
  await page.waitForTimeout(1500);
  await dismissGuide();
  pageErrors = [];
  const more = page.getByRole("button", { name: /Ещё действия|More actions|Boshqa amallar/ }).first();
  await tap(more);
  await tap(page.getByText("Подпись УКЭП").first());
  const ukep = page.locator("[data-ukep-dialog]");
  await ukep.waitFor({ timeout: 15_000 });
  await tap(ukep.locator("[data-ukep-start]"));
  await ukep.locator("[data-ukep-sign]").waitFor({ timeout: 20_000 });
  await tap(ukep.locator("[data-ukep-sign]"));
  await ukep.locator("[data-ukep-signatures] li").first().waitFor({ timeout: 120_000 });
  const signedText = await ukep.locator("[data-ukep-signatures]").innerText();
  check("УКЭП: плагин подписал PDF (CAdES-BES, откреплённая)", signCalls.length === 1 && signCalls[0].type === 1 && signCalls[0].detached === true, signCalls);
  check("УКЭП: сервер принял, подписант из сертификата", signedText.includes("Смоуков Тест Тестович") && signedText.includes("ООО Смоук"), signedText.slice(0, 200));
  await shot("06-ukep-signed");
  const links = await ukep.locator("[data-ukep-signatures] a").evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute("href")));
  const pdfHref = links.find((href) => href.endsWith("file=pdf"));
  const sigHref = links.find((href) => href.endsWith("file=sig"));
  // API-маршруты в next dev компилируются при первом запросе — ждём, как и страницы.
  const pdfRes = await page.request.get(`${BASE}${pdfHref}`, { timeout: 180_000 });
  const sigRes = await page.request.get(`${BASE}${sigHref}`, { timeout: 180_000 });
  const pdfBody = await pdfRes.body();
  check("УКЭП: PDF скачивается", pdfRes.status() === 200 && pdfRes.headers()["content-type"] === "application/pdf" && pdfBody.subarray(0, 5).toString() === "%PDF-", { status: pdfRes.status() });
  check("УКЭП: подпись .sig скачивается", sigRes.status() === 200 && /pkcs7-signature/.test(sigRes.headers()["content-type"] || "") && (await sigRes.body()).length > 500, { status: sigRes.status() });
  await page.keyboard.press("Escape");

  // 4. Входящие ВСД, история партии, партия
  await screen("07-mercury", "/mercury", "Ждут гашения");
  // Оформленный ВСД — на вкладке «Погашено»: там ссылка на историю его партии.
  await tap(page.getByRole("button", { name: /^Погашено/ }).first());
  const historyLink = page.getByRole("link", { name: "История партии" }).first();
  await historyLink.waitFor({ timeout: 10_000 });
  check("«Входящие ВСД»: у погашенного ВСД ссылка «История партии»", (await historyLink.getAttribute("href")) === `/journals/traceability/${encodeURIComponent(data.batchKey)}`);
  pageErrors = [];
  await shot("07b-mercury-processed");
  await screen("08-traceability", `/journals/traceability/${encodeURIComponent(data.batchKey)}`, "Приёмка по ВСД");
  const trace = await page.locator("body").innerText();
  check("история партии: партия, ВСД, ссылка на журнал приёмки", trace.includes("Говядина охлаждённая") && trace.includes("Открыть журнал приёмки") && trace.includes("Открыть партию"));
  await screen("09-batch", `/batches/${data.batchId}`, "История партии");

  // 5. Poster
  await screen("10-poster", "/settings/integrations/poster", "Poster № 687409");
  const posterText = await page.locator("body").innerText();
  check("Poster: токен не показывается", !posterText.includes("4164553abf6a031302898da7800b59fb"));

  // 6. Подсказки блюд бракеража
  const suggestions = await page.request.get(`${BASE}/api/name-suggestions?scope=dish`, { timeout: 180_000 });
  const values = (await suggestions.json()).values || [];
  check("бракераж: блюдо из справочника в подсказках", values.includes("Борщ с говядиной"), values.slice(0, 5));

  await browser.close();
  console.log(`\nСкриншоты: ${OUT}`);
  console.log(failed === 0 ? `RESULT: all ${results.length} checks passed` : `RESULT: ${failed} of ${results.length} check(s) failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("FAIL crash", error);
  process.exit(1);
});
