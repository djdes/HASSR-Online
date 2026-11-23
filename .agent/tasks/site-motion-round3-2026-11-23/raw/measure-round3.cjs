/*
 * Browser measurements for spec site-motion-round3-2026-11-23 (AC1–AC6). Local app only.
 * Chromium with phone emulation: the gestures of iOS Safari itself (rubber band, pull-to-refresh)
 * do not exist here — the checks measure what they depend on (the page is pinned, the handle has
 * `touch-action: none`, the sheet's `touchmove` is cancelled).
 *
 *   node measure-round3.cjs <state.json> <out.json> [shots-dir]
 *   env: DOC_URL=/journals/<code>/documents/<id>   a journal document with an «add» dialog
 *        QR_URL=/journal-fill/<org>/<code>?token=…  a signed QR form link (optional)
 *
 * The signed-in user must still owe the registration profile (no phone): the wizard is the
 * hand-built sheet under test. `POST /api/profile/complete` is answered by the script, nothing is saved.
 */
const { chromium, devices } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = process.env.BASE_URL || "http://localhost:3005";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error("local server only");
const [STATE, OUT, SHOTS] = process.argv.slice(2);
if (!STATE || !OUT) throw new Error("usage: node measure-round3.cjs <state.json> <out.json> [shots-dir]");
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const consoleErrors = [];
function record(id, ok, detail) {
  results.push({ id, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${JSON.stringify(detail).slice(0, 320)}`);
}
async function open(browser, { mobile = false, dark = false, still = false, design = "classic" } = {}) {
  const base = mobile ? { ...devices["iPhone 13"] } : { viewport: { width: 1440, height: 900 } };
  const ctx = await browser.newContext({ ...base, storageState: STATE, reducedMotion: still ? "reduce" : "no-preference" });
  await ctx.addCookies([{ name: "wesetup-view", value: `t:normal|c:auto|m:auto|h:on|n:new|d:${design}`, url: BASE }]);
  await ctx.addInitScript((isDark) => { try { localStorage.setItem("wesetup-app-theme", isDark ? "dark" : "light"); localStorage.setItem("wesetup-theme-mode", isDark ? "dark" : "light"); localStorage.setItem("wesetup-theme-auto-schedule", "0"); } catch {} }, dark);
  const page = await ctx.newPage();
  page.__errors = [];
  page.on("pageerror", (error) => page.__errors.push(String(error).slice(0, 200)));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text().slice(0, 300)); });
  page.__saves = 0;
  await page.route("**/api/profile/complete", (route) => { page.__saves += 1; return route.fulfill({ status: 200, contentType: "application/json", body: "{}" }); });
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
  return { ctx, page, touch };
}
async function go(page, url, wait = 2500) {
  await page.goto(BASE + url, { waitUntil: "load", timeout: 240000 });
  await page.waitForTimeout(wait);
}
const shot = async (page, name, clip) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + ".png"), clip }); };

/** The wizard «Завершите регистрацию»: a hand-built sheet with a handle of its own. */
const WIZARD = '[data-guide="profile-modal"]';
async function openWizard(page) {
  await page.getByRole("button", { name: /^(Завершить|Finish)/i }).first().click();
  await page.waitForSelector(WIZARD);
  await page.waitForTimeout(1700); // the sheet has landed and the handle has nodded
}
/** A window of a journal document built on the `Dialog` primitive («Редактировать списки»). A DOM click: on a phone the button may sit off the screen in a row that scrolls sideways. */
const openAddDialog = (page) => page.evaluate(() => { const names = ["Редактировать списки", "Настройки документа"]; const button = [...document.querySelectorAll("main button")].find((b) => b.offsetParent && names.some((name) => (b.textContent || "").trim() === name || b.getAttribute("aria-label") === name)); if (!button) throw new Error("no dialog button"); button.click(); });
const wizardInfo = () => {
  const card = document.querySelector('[role="dialog"]:not([data-motion-ghost]) [data-guide="profile-modal"]');
  if (!card) return null;
  const rect = card.getBoundingClientRect();
  const grabber = card.querySelector("[data-sheet-grabber]");
  const before = grabber ? getComputedStyle(grabber, "::before") : null;
  const after = grabber ? getComputedStyle(grabber, "::after") : null;
  return {
    top: Math.round(rect.top), left: rect.left, width: rect.width, translate: card.style.translate,
    grabbers: card.querySelectorAll("[data-sheet-grabber]").length,
    oldBars: [...card.querySelectorAll("div")].filter((el) => /(^|\s)h-1(\s|$)/.test(el.className) && /(^|\s)w-10(\s|$)/.test(el.className)).length,
    backgroundImage: getComputedStyle(card).backgroundImage,
    grabber: grabber ? { pulled: grabber.getAttribute("data-pulled"), touchAction: getComputedStyle(grabber).touchAction, display: getComputedStyle(grabber).display, height: grabber.getBoundingClientRect().height, x: grabber.getBoundingClientRect().left + grabber.getBoundingClientRect().width / 2, y: grabber.getBoundingClientRect().top + 10, before: before.rotate, after: after.rotate, halfWidth: before.width, halfHeight: before.height, color: before.backgroundColor, animation: before.animationName, transition: before.transitionDuration } : null,
  };
};
/** Records what happened to every `touchmove` after the sheet's own handler ran. */
const WATCH_MOVES = () => {
  window.__moves = [];
  document.addEventListener("touchmove", (event) => window.__moves.push({ prevented: event.defaultPrevented, cancelable: event.cancelable }), { passive: true });
};
const takeMoves = () => { const moves = window.__moves; window.__moves = []; return moves; };

(async () => {
  const executablePath = fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : null;
  const browser = await chromium.launch(executablePath ? { executablePath, args: ["--headless=new", "--no-sandbox"] } : {});

  // ───────── Phone: the page under a sheet (AC1) ─────────
  {
    const { ctx, page, touch } = await open(browser, { mobile: true, design: "new" });
    await go(page, "/dashboard", 3500);
    const pageState = () => page.evaluate(() => {
      const list = document.querySelector("[data-vaul-drawer] [data-radix-scroll-area-viewport]");
      return { scrollY: Math.round(window.scrollY), position: getComputedStyle(document.body).position, top: document.body.style.top, locked: document.documentElement.hasAttribute("data-body-locked"), coarse: matchMedia("(pointer: coarse)").matches, list: list ? { top: Math.round(list.scrollTop), max: list.scrollHeight - list.clientHeight } : null };
    });
    await page.evaluate(() => window.scrollTo(0, 300));
    await page.waitForTimeout(300);
    const before = await pageState();
    await page.locator("[data-nav-burger]").first().click();
    await page.waitForTimeout(1000);
    const opened = await pageState();
    record("AC1.menu.page-pinned", before.scrollY === 300 && opened.coarse && opened.position === "fixed" && opened.top === "-300px" && opened.locked, { before, opened });
    // The page behind keeps its place on the screen: the body is shifted by the old scroll offset.
    const swipe = async (y0, y1) => { await touch("touchStart", 190, y0); for (let i = 1; i <= 10; i++) { await touch("touchMove", 190, y0 + ((y1 - y0) * i) / 10); await page.waitForTimeout(16); } await touch("touchEnd"); await page.waitForTimeout(450); };
    for (let i = 0; i < 6; i++) await swipe(620, 260);
    const atEnd = await pageState();
    for (let i = 0; i < 3; i++) await swipe(620, 260);
    const pastEnd = await pageState();
    for (let i = 0; i < 9; i++) await swipe(380, 700);
    const atStart = await pageState();
    record("AC1.menu.swipes-past-both-ends", atEnd.list && atEnd.list.top === atEnd.list.max && atEnd.list.max > 0 && pastEnd.top === "-300px" && pastEnd.position === "fixed" && atStart.list.top === 0 && atStart.top === "-300px" && atStart.scrollY === 0, { atEnd, pastEnd, atStart });
    await shot(page, "menu-sheet");
    // AC3 on the vaul sheet: the handle, shown at any width, an arrow while the sheet is pulled.
    const sheetGrabber = () => page.evaluate(() => { const g = document.querySelector("[data-vaul-drawer] [data-sheet-grabber]"); if (!g) return null; const r = g.getBoundingClientRect(); return { always: g.hasAttribute("data-sheet-grabber-always"), pulled: g.getAttribute("data-pulled"), x: r.left + r.width / 2, y: r.top + 10, before: getComputedStyle(g, "::before").rotate, display: getComputedStyle(g).display, drawerTop: Math.round(g.closest("[data-vaul-drawer]").getBoundingClientRect().top) }; });
    const rest = await sheetGrabber();
    await touch("touchStart", rest.x, rest.y);
    for (const dy of [10, 25, 40]) { await touch("touchMove", rest.x, rest.y + dy); await page.waitForTimeout(30); }
    await page.waitForTimeout(350);
    const pulled = await sheetGrabber();
    await shot(page, "menu-sheet-pulled", { x: 0, y: Math.max(0, pulled.drawerTop - 20), width: 390, height: 160 });
    await touch("touchEnd");
    await page.waitForTimeout(900);
    const released = await sheetGrabber();
    record("AC3.bottom-sheet.handle", rest.always && rest.display === "block" && rest.pulled === null && rest.before === "0deg" && pulled.pulled === "" && pulled.before === "22deg" && pulled.drawerTop > rest.drawerTop && released && released.pulled === null && released.drawerTop === rest.drawerTop, { rest, pulled, released });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(900);
    const closed = await pageState();
    record("AC1.menu.scroll-restored", closed.scrollY === 300 && closed.position !== "fixed" && !closed.locked && closed.top === "", closed);
    record("errors.phone.menu", page.__errors.length === 0, page.__errors.slice(0, 3));
    await ctx.close();
  }

  // ───────── Phone: leaving the page from the pinned menu (AC1) ─────────
  {
    const { ctx, page } = await open(browser, { mobile: true, design: "new" });
    const state = () => page.evaluate(() => { const d = document.querySelector("[data-vaul-drawer]"); return { path: location.pathname, scrollY: Math.round(window.scrollY), position: getComputedStyle(document.body).position, top: document.body.style.top, locked: document.documentElement.hasAttribute("data-body-locked"), drawer: d ? d.getAttribute("data-state") : null }; });
    // Bring the row to the middle of the list (away from the row pinned at the bottom), let the list settle, tap.
    const tapLink = async (selector) => { await page.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: "center" }), selector); await page.waitForTimeout(400); const point = await page.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, selector); await page.touchscreen.tap(point.x, point.y); };
    const arrived = (pathname) => page.waitForFunction((expected) => location.pathname === expected, pathname, { timeout: 120000 });
    // An ordinary item: the sheet closes, the page is let go, the new page starts at its top.
    await go(page, "/dashboard", 3500);
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.locator("[data-nav-burger]").first().click();
    await page.waitForTimeout(900);
    await tapLink('[data-vaul-drawer] nav a[href="/journals"]:not([aria-expanded])');
    await arrived("/journals");
    await page.waitForTimeout(2500);
    const plain = await state();
    await page.evaluate(() => window.scrollTo(0, 200));
    const scrolls = await page.evaluate(() => Math.round(window.scrollY));
    record("AC1.menu.link-closes-and-unpins", plain.path === "/journals" && plain.drawer === null && plain.position !== "fixed" && !plain.locked && plain.top === "" && plain.scrollY === 0 && scrolls === 200, { plain, scrolls });
    // A section row opens its page and keeps the menu open: the new page must not inherit the old offset.
    await go(page, "/dashboard", 3500);
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.locator("[data-nav-burger]").first().click();
    await page.waitForTimeout(900);
    // «Журналы»: the row both unfolds and opens `/journals/points`.
    const section = await page.evaluate(() => (document.querySelector('[data-vaul-drawer] nav a[href="/journals/points"][aria-expanded]') ? "/journals/points" : null));
    if (section) {
      const pinned = await state();
      await tapLink(`[data-vaul-drawer] nav a[href="${section}"][aria-expanded]`);
      await arrived(section);
      await page.waitForTimeout(2500);
      const moved = await state();
      if (moved.drawer === "open") {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(900);
      }
      const closed = await state();
      record("AC1.menu.page-change-under-lock", pinned.top === "-400px" && moved.path === section && (moved.drawer !== "open" || (moved.position === "fixed" && moved.top === "0px")) && closed.position !== "fixed" && !closed.locked && closed.scrollY === 0, { section, pinned: pinned.top, moved, closed });
    }
    record("errors.phone.menu-navigation", page.__errors.length === 0, page.__errors.slice(0, 3));
    await ctx.close();
  }

  // ───────── Phone: `Dialog` — pinned page and the handle (AC1, AC3) ─────────
  if (process.env.DOC_URL) {
    const { ctx, page, touch } = await open(browser, { mobile: true });
    await go(page, process.env.DOC_URL, 6000);
    await page.evaluate(() => window.scrollTo(0, 120));
    await openAddDialog(page);
    await page.waitForSelector('[data-slot="dialog-content"]');
    await page.waitForTimeout(1600);
    const info = () => page.evaluate(() => { const d = document.querySelector('[data-slot="dialog-content"]'); if (!d) return null; const g = d.querySelector("[data-sheet-grabber]"); const r = d.getBoundingClientRect(); return { position: getComputedStyle(document.body).position, bodyTop: document.body.style.top, top: Math.round(r.top), x: r.left + r.width / 2, transform: d.style.transform, grabber: g ? { kind: g.getAttribute("data-sheet-grabber"), pulled: g.getAttribute("data-pulled"), before: getComputedStyle(g, "::before").rotate, touchAction: getComputedStyle(g).touchAction, display: getComputedStyle(g).display } : null }; });
    const rest = await info();
    await touch("touchStart", rest.x, rest.top + 30);
    for (const dy of [10, 25, 40]) { await touch("touchMove", rest.x, rest.top + 30 + dy); await page.waitForTimeout(30); }
    await page.waitForTimeout(350);
    const pulled = await info();
    await shot(page, "dialog-pulled");
    for (const dy of [70, 100, 130]) { await touch("touchMove", rest.x, rest.top + 30 + dy); await page.waitForTimeout(30); }
    await page.waitForTimeout(200);
    const armed = await info();
    await touch("touchMove", rest.x, rest.top + 40);
    await touch("touchEnd");
    await page.waitForTimeout(600);
    const released = await info();
    record("AC1.dialog.page-pinned", rest.position === "fixed" && rest.bodyTop === "-120px", { position: rest.position, bodyTop: rest.bodyTop });
    record("AC3.dialog.handle", rest.grabber && rest.grabber.kind === "float" && rest.grabber.display === "block" && rest.grabber.touchAction === "none" && rest.grabber.pulled === null && pulled.grabber.pulled === "" && pulled.grabber.before === "22deg" && armed.grabber.pulled === "armed" && released && released.grabber.pulled === null && released.transform === "", { rest: rest.grabber, pulled: pulled.grabber, armed: armed.grabber.pulled, released: released && released.grabber });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(700);
    const after = await page.evaluate(() => ({ scrollY: Math.round(window.scrollY), position: getComputedStyle(document.body).position }));
    record("AC1.dialog.scroll-restored", after.scrollY === 120 && after.position !== "fixed", after);
    record("errors.phone.dialog", page.__errors.length === 0, page.__errors.slice(0, 3));
    await ctx.close();
  }

  // ───────── Phone: the hand-built sheet — gesture, handle, steps (AC2, AC3, AC4) ─────────
  {
    const { ctx, page, touch } = await open(browser, { mobile: true });
    await go(page, "/dashboard", 3500);
    await openWizard(page);
    await page.evaluate(WATCH_MOVES);
    const sheet = await page.evaluate(wizardInfo);
    await shot(page, "wizard-rest");
    record("AC3.wizard.one-handle", sheet.grabbers === 1 && sheet.oldBars === 0 && sheet.backgroundImage === "none" && sheet.grabber.touchAction === "none" && sheet.grabber.halfWidth === "22.5px" && sheet.grabber.halfHeight === "5px" && sheet.grabber.before === "0deg" && sheet.grabber.after === "0deg" && sheet.grabber.animation === "motion-grabber-nod-a", sheet);

    // A finger on the handle: an arrow; let go: a bar again, the sheet stays, no second nod.
    await touch("touchStart", sheet.grabber.x, sheet.grabber.y);
    await page.waitForTimeout(450);
    const pressed = await page.evaluate(wizardInfo);
    await shot(page, "wizard-handle-pressed", { x: 0, y: Math.max(0, sheet.top - 10), width: 390, height: 150 });
    await touch("touchEnd");
    await page.waitForTimeout(800);
    const let_go = await page.evaluate(wizardInfo);
    record("AC3.wizard.tap-is-arrow-then-bar", pressed.grabber.pulled === "" && pressed.grabber.before === "22deg" && pressed.grabber.after === "-22deg" && pressed.grabber.color !== sheet.grabber.color && let_go && let_go.grabber.pulled === null && let_go.grabber.before === "0deg" && let_go.grabber.after === "0deg" && let_go.top === sheet.top, { pressed: pressed.grabber, released: let_go && let_go.grabber, stillOpen: Boolean(let_go) });

    // A short pull by the header: the sheet follows, every move is taken from the page, then back.
    const x = sheet.left + sheet.width / 2; const y0 = sheet.top + 40;
    await page.evaluate(takeMoves);
    await touch("touchStart", x, y0);
    for (const dy of [10, 25, 40, 55]) { await touch("touchMove", x, y0 + dy); await page.waitForTimeout(40); }
    const pulled = await page.evaluate(wizardInfo);
    const moves = await page.evaluate(takeMoves);
    await touch("touchEnd");
    await page.waitForTimeout(800);
    const back = await page.evaluate(wizardInfo);
    // Chromium does not deliver the very first move inside the touch slop; every move that does arrive is taken.
    record("AC2.pull.moves-are-cancelled", moves.length >= 3 && moves.every((move) => move.cancelable && move.prevented), moves);
    record("AC2.pull.short-springs-back", pulled.translate === "0px 55px" && pulled.top === sheet.top + 55 && pulled.grabber.pulled === "" && pulled.grabber.before === "22deg" && back && back.top === sheet.top && back.translate === "" && back.grabber.pulled === null, { pulled: { translate: pulled.translate, top: pulled.top, handle: pulled.grabber.pulled }, back: back && { top: back.top, translate: back.translate } });

    // Past the closing point the arrow takes the accent.
    await touch("touchStart", x, y0);
    for (const dy of [30, 60, 100, 130]) { await touch("touchMove", x, y0 + dy); await page.waitForTimeout(60); }
    await page.waitForTimeout(250);
    const armed = await page.evaluate(wizardInfo);
    await shot(page, "wizard-armed", { x: 0, y: Math.max(0, armed.top - 10), width: 390, height: 150 });
    for (const dy of [90, 40, 8]) { await touch("touchMove", x, y0 + dy); await page.waitForTimeout(120); }
    await touch("touchEnd");
    await page.waitForTimeout(800);
    const disarmed = await page.evaluate(wizardInfo);
    record("AC3.wizard.armed-past-threshold", armed.grabber.pulled === "armed" && armed.grabber.color === "rgb(85, 102, 246)" && disarmed && disarmed.top === sheet.top && disarmed.grabber.pulled === null, { armed: armed.grabber, back: Boolean(disarmed) });

    // Sideways and upwards the sheet is not taken, and the page keeps the gesture.
    await page.evaluate(takeMoves);
    await touch("touchStart", x, y0);
    for (const dx of [12, 30, 55]) { await touch("touchMove", x + dx, y0 + 2); await page.waitForTimeout(30); }
    const sideways = await page.evaluate(wizardInfo);
    const sideMoves = await page.evaluate(takeMoves);
    await touch("touchEnd"); await page.waitForTimeout(250);
    await touch("touchStart", x, y0);
    for (const dy of [-10, -30]) { await touch("touchMove", x, y0 + dy); await page.waitForTimeout(30); }
    const upwards = await page.evaluate(wizardInfo);
    await touch("touchEnd"); await page.waitForTimeout(250);
    // Below the grab zone nothing moves.
    await touch("touchStart", x, sheet.top + 220);
    for (const dy of [30, 60]) { await touch("touchMove", x, sheet.top + 220 + dy); await page.waitForTimeout(30); }
    const low = await page.evaluate(wizardInfo);
    await touch("touchEnd"); await page.waitForTimeout(300);
    record("AC2.pull.only-down-only-top", sideways.translate === "" && sideMoves.every((move) => !move.prevented) && upwards.translate === "" && low.translate === "" && low.top === sheet.top, { sideways: sideways.translate, sideMoves, upwards: upwards.translate, low: low.translate });

    // AC4: a step answers a tap. The profile is not filled in (no phone): stay, mark, say why.
    const steps = () => page.evaluate(() => ({ step: document.querySelector("[data-setup-stepper]")?.getAttribute("data-setup-step"), buttons: [...document.querySelectorAll("[data-setup-step-button]")].map((b) => [b.getAttribute("data-setup-step-button"), b.disabled]), invalid: [...document.querySelectorAll("[data-field-invalid]")].map((el) => ({ label: el.firstElementChild.textContent.trim(), animation: getComputedStyle(el).animationName })), toasts: [...document.querySelectorAll("[data-sonner-toast]")].map((el) => el.textContent.trim()) }));
    const beforeTap = await steps();
    await page.locator('[data-setup-step-button="staff"]').click();
    await page.waitForTimeout(250);
    const refused = await steps();
    await shot(page, "wizard-step-refused");
    record("AC4.steps.enabled", beforeTap.step === "profile" && beforeTap.buttons.filter(([key, disabled]) => key !== "profile" && !disabled).length === 3, beforeTap.buttons);
    record("AC4.steps.invalid-profile-explains", refused.step === "profile" && page.__saves === 0 && refused.invalid.length >= 1 && refused.invalid.every((field) => field.animation === "motion-field-no") && refused.toasts.some((text) => /Сначала заполните анкету/.test(text)), refused);
    // Filled in correctly: the tap saves the profile and opens the chosen step.
    await page.locator(`${WIZARD} input[placeholder^="+7"]`).first().fill("+7 999 123-45-67");
    await page.waitForTimeout(200);
    await page.locator('[data-setup-step-button="staff"]').click();
    await page.waitForTimeout(900);
    const moved = await steps();
    await page.locator('[data-setup-step-button="profile"]').click();
    await page.waitForTimeout(400);
    const returned = await steps();
    await page.locator('[data-setup-step-button="equipment"]').click();
    await page.waitForTimeout(400);
    const jumped = await steps();
    record("AC4.steps.valid-profile-saves-and-goes", moved.step === "staff" && page.__saves === 1 && returned.step === "profile" && jumped.step === "equipment" && page.__saves === 1, { moved: moved.step, saves: page.__saves, returned: returned.step, jumped: jumped.step });

    // AC2: a long pull closes (the copy of the sheet plays out), then a quick flick closes too.
    await page.locator('[data-setup-step-button="profile"]').click();
    await page.waitForTimeout(400);
    // The «saved» toasts sit over the top of the sheet; a finger would land on them, not on the sheet.
    await page.waitForFunction(() => document.querySelectorAll("[data-sonner-toast]").length === 0, null, { timeout: 20000 });
    const again = await page.evaluate(wizardInfo);
    const count = () => page.evaluate(() => ({ real: document.querySelectorAll('[role="dialog"]:not([data-motion-ghost])').length, ghost: document.querySelectorAll("[data-motion-ghost]").length }));
    await touch("touchStart", x, again.top + 40);
    for (const dy of [20, 50, 80, 110, 140]) { await touch("touchMove", x, again.top + 40 + dy); await page.waitForTimeout(60); }
    await page.waitForTimeout(200);
    await touch("touchEnd");
    await page.waitForTimeout(60);
    const during = await count();
    await page.waitForTimeout(900);
    const after = await count();
    record("AC2.pull.long-closes", during.real === 0 && during.ghost === 1 && after.real === 0 && after.ghost === 0, { during, after });
    record("errors.phone.wizard", page.__errors.length === 0, page.__errors.slice(0, 3));
    await ctx.close();
  }
  {
    const { ctx, page, touch } = await open(browser, { mobile: true });
    await go(page, "/dashboard", 3500);
    await openWizard(page);
    const sheet = await page.evaluate(wizardInfo);
    const x = sheet.left + sheet.width / 2; const y0 = sheet.top + 40;
    // 70 px, less than the closing distance, in three quick moves: a flick. (A debugger command per
    // event takes 30–50 ms here, hence the large steps.)
    await touch("touchStart", x, y0);
    for (const dy of [30, 70]) await touch("touchMove", x, y0 + dy);
    const flickAt = await page.evaluate(() => document.querySelector('[data-guide="profile-modal"]')?.style.translate);
    await touch("touchEnd");
    await page.waitForTimeout(1000);
    const flicked = await page.evaluate(() => document.querySelectorAll('[role="dialog"]:not([data-motion-ghost])').length);
    record("AC2.pull.flick-closes", flicked === 0 && flickAt === "0px 70px", { open: flicked, releasedAt: flickAt });

    // AC3: a hand-built sheet that drew no handle gets one from the runtime; one that cannot be closed does not.
    const injected = await page.evaluate(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const make = (closable) => { const wrap = document.createElement("div"); wrap.setAttribute("role", "dialog"); wrap.className = "fixed inset-0 z-[70] flex items-end"; wrap.innerHTML = `<div class="w-full rounded-t-3xl bg-white" style="height:260px">${closable ? '<button type="button" aria-label="Закрыть" style="margin:16px">x</button>' : "<p style='margin:16px'>no way out</p>"}</div>`; document.body.appendChild(wrap); return wrap; };
      const closable = make(true); const locked = make(false);
      await wait(200);
      const read = (wrap) => { const card = wrap.firstElementChild; const g = card.querySelector("[data-sheet-grabber]"); return { grabber: g ? g.getAttribute("data-sheet-grabber") : null, byRuntime: g ? g.hasAttribute("data-motion-grabber") : false, ariaHidden: g ? g.getAttribute("aria-hidden") : null, position: getComputedStyle(card).position, top: g ? Math.round(g.getBoundingClientRect().top - card.getBoundingClientRect().top) : null, width: g ? g.getBoundingClientRect().width : null }; };
      const out = { closable: read(closable), locked: read(locked) };
      closable.remove(); locked.remove();
      await wait(400);
      return out;
    });
    record("AC3.hand-built.handle-added", injected.closable.grabber === "float" && injected.closable.byRuntime && injected.closable.ariaHidden === "true" && injected.closable.position === "relative" && injected.closable.top === 0 && injected.closable.width === 112 && injected.locked.grabber === null, injected);

    // AC5 + AC3: the assistant — a hand-built sheet with a coloured header and a light handle.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("wesetup:sanpin-chat-open", { detail: null })));
    await page.waitForTimeout(1500);
    const assistant = await page.evaluate(() => { const d = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].find((el) => el.querySelector("[data-tone='light']")); if (!d) return null; const g = d.querySelector("[data-sheet-grabber]"); const chips = [...d.querySelectorAll("button")].filter((b) => b.className.includes("text-left")).map((b) => b.textContent.trim()); return { chips, grabbers: d.querySelectorAll("[data-sheet-grabber]").length, tone: g.getAttribute("data-tone"), color: getComputedStyle(g, "::before").backgroundColor, opacity: getComputedStyle(g).opacity, label: d.getAttribute("aria-label") }; });
    await shot(page, "assistant");
    record("AC5.assistant.starters-are-text", assistant && assistant.chips.length === 4 && assistant.chips.every((text) => !/^starter/i.test(text) && /[А-Яа-яЁё]/.test(text) && text.length > 8), assistant && assistant.chips);
    record("AC3.assistant.light-handle", assistant && assistant.grabbers === 1 && assistant.tone === "light" && assistant.color === "rgb(255, 255, 255)" && assistant.opacity === "0.6", assistant);

    // AC6 on a touch screen: the field gives under the finger.
    await page.keyboard.press("Escape");
    await page.evaluate(() => { for (const el of document.querySelectorAll('[role="dialog"] button[aria-label]')) if (/акрыть|lose/.test(el.getAttribute("aria-label"))) el.click(); });
    await page.waitForTimeout(700);
    const squeeze = await page.evaluate(() => { const box = document.createElement("div"); box.id = "probe-touch"; box.style.cssText = "position:fixed;left:20px;top:120px;z-index:99;background:#fff;padding:12px;width:300px"; box.innerHTML = '<input class="border rounded-xl h-11 px-3 w-full" placeholder="поле">'; document.body.appendChild(box); const r = box.firstElementChild.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, coarse: matchMedia("(hover: none) and (pointer: coarse)").matches }; });
    // Pressed with the pointer of the emulated phone: `:active` from a bare debugger touch is not
    // set by Chromium. The rule under test is the one behind `(hover: none) and (pointer: coarse)`.
    await page.mouse.move(squeeze.x, squeeze.y);
    await page.mouse.down();
    await page.waitForTimeout(160);
    const active = await page.evaluate(() => document.querySelector("#probe-touch input").matches(":active"));
    await page.waitForTimeout(500);
    const held = await page.evaluate(() => getComputedStyle(document.querySelector("#probe-touch input")).scale);
    await page.mouse.up();
    await page.waitForTimeout(100);
    record("AC6.touch.field-gives-under-finger", squeeze.coarse && active && held === "0.985", { coarse: squeeze.coarse, active, held });
    record("errors.phone.misc", page.__errors.length === 0, page.__errors.slice(0, 3));
    await ctx.close();
  }

  // ───────── Computer: no pin, no handle; fields (AC1, AC3, AC6) ─────────
  {
    const { ctx, page } = await open(browser, {});
    await go(page, "/dashboard", 3500);
    await openWizard(page);
    const desk = await page.evaluate(() => { const g = document.querySelector('[data-guide="profile-modal"] [data-sheet-grabber]'); return { grabber: g ? getComputedStyle(g).display : null, coarse: matchMedia("(pointer: coarse)").matches }; });
    record("AC3.desktop.no-handle", desk.grabber === "none" && !desk.coarse, desk);

    // A field in a framed box: the box takes a breath, the caption takes the accent.
    const first = page.locator(`${WIZARD} input`).first();
    const frameInfo = () => page.evaluate(() => { const input = document.activeElement; const frame = input.closest('[class*="focus-within:ring-"]'); const caption = frame.firstElementChild; return { animation: getComputedStyle(frame).animationName, duration: getComputedStyle(frame).animationDuration, caption: getComputedStyle(caption).color, ring: getComputedStyle(frame).boxShadow !== "none" }; });
    const idleCaption = await page.evaluate(() => getComputedStyle(document.querySelector('[data-guide="profile-modal"] input').closest('[class*="focus-within:ring-"]').firstElementChild).color);
    await first.focus();
    await page.waitForTimeout(120);
    const mid = await page.evaluate(() => getComputedStyle(document.activeElement.closest('[class*="focus-within:ring-"]')).scale);
    await page.waitForTimeout(500);
    const framed = await frameInfo();
    await shot(page, "field-focused", { x: 440, y: 200, width: 560, height: 260 });
    record("AC6.framed.breath-and-caption", framed.animation === "motion-field-in" && framed.duration === "0.44s" && Number(mid) > 1 && Number(mid) <= 1.0121 && framed.caption === "rgb(85, 102, 246)" && idleCaption !== framed.caption && framed.ring, { framed, mid, idleCaption });
    await page.keyboard.press("Escape");
    await page.evaluate(() => document.querySelector('[data-guide="profile-modal"] button[aria-label]')?.click());
    await page.waitForTimeout(600);

    // A plain bordered field with a label above it; the same field in a table stays still.
    const plain = await page.evaluate(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const box = document.createElement("div"); box.style.cssText = "padding:16px;background:#fff;width:360px";
      box.innerHTML = '<div id="f1"><label for="p1" class="text-[13px] text-[#6f7282]">Подпись</label><input id="p1" class="border rounded-xl h-11 px-3 w-full" placeholder="подсказка"></div><table><tbody><tr><td><input id="p2" class="border h-9 w-full" placeholder="в таблице"></td></tr></tbody></table>';
      document.querySelector("main").prepend(box);
      const input = box.querySelector("#p1"); const label = box.querySelector("label"); const cell = box.querySelector("#p2");
      const idle = { label: getComputedStyle(label).color, placeholder: getComputedStyle(input, "::placeholder").translate, opacity: getComputedStyle(input, "::placeholder").opacity };
      input.focus(); await wait(60);
      const start = { animation: getComputedStyle(input).animationName, running: input.getAnimations().some((a) => a.animationName === "motion-field-in") };
      await wait(600);
      const focused = { label: getComputedStyle(label).color, placeholder: getComputedStyle(input, "::placeholder").translate, opacity: getComputedStyle(input, "::placeholder").opacity, caret: getComputedStyle(input).caretColor, ring: getComputedStyle(input).boxShadow !== "none" };
      input.setAttribute("aria-invalid", "true"); await wait(60);
      const wrongAnimation = getComputedStyle(input).animationName; await wait(300);
      const wrong = { animation: wrongAnimation, label: getComputedStyle(label).color };
      input.removeAttribute("aria-invalid");
      cell.focus(); await wait(60);
      const inTable = { animation: getComputedStyle(cell).animationName };
      box.remove();
      return { idle, start, focused, wrong, inTable };
    });
    record("AC6.plain.breath-caption-placeholder", plain.start.animation === "motion-field-in" && plain.start.running && plain.focused.label === "rgb(85, 102, 246)" && plain.idle.label !== plain.focused.label && plain.idle.placeholder === "none" && plain.focused.placeholder === "6px" && plain.focused.opacity === "0.6" && plain.focused.ring, plain);
    record("AC6.plain.wrong-shakes-table-stays", plain.wrong.animation === "motion-field-no" && plain.wrong.label === plain.idle.label && plain.inTable.animation === "none", { wrong: plain.wrong, inTable: plain.inTable });

    if (process.env.DOC_URL) {
      await go(page, process.env.DOC_URL, 6000);
      await openAddDialog(page);
      await page.waitForSelector('[data-slot="dialog-content"]');
      await page.waitForTimeout(900);
      const dialog = await page.evaluate(() => ({ position: getComputedStyle(document.body).position, top: document.body.style.top, grabber: getComputedStyle(document.querySelector('[data-slot="dialog-content"] [data-sheet-grabber]')).display }));
      record("AC1.desktop.dialog-not-pinned", dialog.position !== "fixed" && dialog.top === "" && dialog.grabber === "none", dialog);
    }
    record("errors.desktop", page.__errors.length === 0, page.__errors.slice(0, 3));
    await ctx.close();
  }

  // ───────── «Новая» and dark: the accent of the caption follows the design ─────────
  for (const variant of [{ design: "new", dark: false, accent: "rgb(17, 17, 20)" }, { design: "classic", dark: true, accent: "rgb(112, 129, 248)" }]) {
    const { ctx, page } = await open(browser, variant);
    await go(page, "/dashboard", 3500);
    await openWizard(page);
    await page.locator(`${WIZARD} input`).first().focus();
    await page.waitForTimeout(400);
    const look = await page.evaluate(() => { const frame = document.activeElement.closest('[class*="focus-within:ring-"]'); return { caption: getComputedStyle(frame.firstElementChild).color, theme: document.querySelector(".app-shell")?.getAttribute("data-app-theme"), design: document.documentElement.getAttribute("data-view-design") }; });
    await shot(page, `field-${variant.design}${variant.dark ? "-dark" : ""}`, { x: 440, y: 200, width: 560, height: 260 });
    record(`AC6.caption-accent.${variant.design}${variant.dark ? "-dark" : ""}`, look.caption === variant.accent, look);
    await ctx.close();
  }

  // ───────── «Без анимации» (system «Reduce motion») ─────────
  {
    const { ctx, page, touch } = await open(browser, { mobile: true, still: true });
    await go(page, "/dashboard", 3500);
    await openWizard(page);
    const sheet = await page.evaluate(wizardInfo);
    const flag = await page.evaluate(() => document.documentElement.hasAttribute("data-view-still"));
    await page.locator(`${WIZARD} input`).first().focus();
    await page.waitForTimeout(200);
    const field = await page.evaluate(() => { const frame = document.activeElement.closest('[class*="focus-within:ring-"]'); return { animation: getComputedStyle(frame).animationName, placeholder: getComputedStyle(document.activeElement, "::placeholder").translate }; });
    // The sheet is still pulled by the hand and the handle is still an arrow — at once.
    const x = sheet.left + sheet.width / 2; const y0 = sheet.top + 40;
    await touch("touchStart", x, y0);
    for (const dy of [10, 25, 40, 55]) { await touch("touchMove", x, y0 + dy); await page.waitForTimeout(90); }
    const pulled = await page.evaluate(wizardInfo);
    await touch("touchEnd");
    await page.waitForTimeout(80);
    const back = await page.evaluate(() => { const card = document.querySelector('[data-guide="profile-modal"]'); return card ? { translate: card.style.translate, animations: card.getAnimations().length } : null; });
    record("AC6.still.off", flag && field.animation === "none" && field.placeholder === "none", { flag, field });
    record("AC3.still.handle-without-motion", sheet.grabber.animation === "none" && /^(0s|1e-05s)/.test(sheet.grabber.transition) && pulled.translate === "0px 55px" && pulled.grabber.before === "22deg" && back && back.translate === "" && back.animations === 0, { handle: { animation: sheet.grabber.animation, transition: sheet.grabber.transition }, pulled: pulled.translate, back });
    await ctx.close();
  }

  // ───────── The QR form of an employee (standalone page) ─────────
  if (process.env.QR_URL) {
    const { ctx, page, touch } = await open(browser, { mobile: true });
    await page.goto(BASE + process.env.QR_URL, { waitUntil: "load", timeout: 240000 });
    await page.waitForTimeout(1500);
    const field = await page.evaluate(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const input = document.querySelector("input.in:not([hidden])");
      if (!input || !input.offsetParent) return null;
      input.focus(); await wait(60);
      const out = { animation: getComputedStyle(input).animationName, running: input.getAnimations().length > 0 };
      input.blur();
      return out;
    });
    if (field) record("AC6.qr.field-breath", field.animation === "qr-field-in" && field.running, field);
    const opener = page.locator("[data-emp-open]").first();
    if (await opener.count()) {
      await opener.click();
      await page.waitForTimeout(600);
      await page.evaluate(WATCH_MOVES);
      const info = () => page.evaluate(() => { const sheet = document.getElementById("emp-sheet"); const sh = sheet.querySelector(".sh"); const g = sheet.querySelector(".sh-g"); const r = sh.getBoundingClientRect(); return { hidden: sheet.hidden, top: Math.round(r.top), x: r.left + r.width / 2, translate: sh.style.translate, handle: g ? { on: g.classList.contains("on"), armed: g.classList.contains("armed"), before: getComputedStyle(g, "::before").rotate, touchAction: getComputedStyle(g).touchAction } : null }; });
      const rest = await info();
      await touch("touchStart", rest.x, rest.top + 30);
      for (const dy of [10, 25, 40]) { await touch("touchMove", rest.x, rest.top + 30 + dy); await page.waitForTimeout(40); }
      await page.waitForTimeout(350);
      const pulled = await info();
      const moves = await page.evaluate(takeMoves);
      await shot(page, "qr-sheet-pulled");
      await touch("touchEnd");
      await page.waitForTimeout(700);
      const back = await info();
      await touch("touchStart", rest.x, rest.top + 30);
      for (const dy of [30, 60, 100, 130]) { await touch("touchMove", rest.x, rest.top + 30 + dy); await page.waitForTimeout(60); }
      const armed = await info();
      await page.waitForTimeout(200);
      await touch("touchEnd");
      await page.waitForTimeout(400);
      const closed = await info();
      record("AC2.qr.sheet-pull", rest.handle && rest.handle.touchAction === "none" && rest.handle.before === "none" && pulled.translate === "0px 40px" && pulled.handle.on && pulled.handle.before === "22deg" && moves.length >= 2 && moves.every((move) => move.prevented) && !back.hidden && back.top === rest.top && !back.handle.on && armed.handle.armed && closed.hidden, { rest: rest.handle, pulled: { translate: pulled.translate, handle: pulled.handle }, moves, back: { hidden: back.hidden, top: back.top }, armed: armed.handle.armed, closed: closed.hidden });
    } else {
      record("AC2.qr.sheet-pull", true, { skipped: "this QR form has no employee sheet" });
    }
    record("errors.qr", page.__errors.length === 0, page.__errors.slice(0, 3));
    await ctx.close();
  }

  await browser.close();
  // `console.error` of the app while it was driven (React warnings included): none is expected.
  record("errors.console", consoleErrors.length === 0, [...new Set(consoleErrors)].slice(0, 5));
  const failed = results.filter((result) => !result.ok);
  fs.writeFileSync(OUT, JSON.stringify({ base: BASE, at: new Date().toISOString(), passed: results.length - failed.length, failed: failed.length, results }, null, 1));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(2); });
