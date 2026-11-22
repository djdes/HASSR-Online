/*
 * Browser measurements for spec site-motion-2026-11-22 (AC2–AC9, AC11). Local app only.
 *
 *   node measure.cjs <state.json> <out.json> [shots-dir]
 *
 * state.json — Playwright storage state of a signed-in manager (local database);
 * QR_URL — a signed /journal-fill/... link of the same organization (optional).
 */
const { chromium, devices } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = process.env.BASE_URL || "http://localhost:3005";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error("local server only");
const [STATE, OUT, SHOTS] = process.argv.slice(2);
if (!STATE || !OUT) throw new Error("usage: node measure.cjs <state.json> <out.json> [shots-dir]");
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
function record(id, ok, detail) {
  results.push({ id, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${JSON.stringify(detail).slice(0, 260)}`);
}

async function open(browser, { mobile = false, dark = false, design = "classic", still = false, auth = true } = {}) {
  const base = mobile ? { ...devices["iPhone 13"] } : { viewport: { width: 1440, height: 900 } };
  const ctx = await browser.newContext({ ...base, ...(auth ? { storageState: STATE } : {}), reducedMotion: still ? "reduce" : "no-preference" });
  await ctx.addCookies([{ name: "wesetup-view", value: `t:normal|c:auto|m:auto|h:on|n:new|d:${design}`, url: BASE }]);
  await ctx.addInitScript((isDark) => {
    try {
      localStorage.setItem("wesetup-app-theme", isDark ? "dark" : "light");
      localStorage.setItem("wesetup-theme-mode", isDark ? "dark" : "light");
      localStorage.setItem("wesetup-theme-auto-schedule", "0");
    } catch {}
  }, dark);
  const page = await ctx.newPage();
  page.__errors = [];
  page.on("pageerror", (error) => page.__errors.push(String(error).slice(0, 200)));
  return { ctx, page };
}
async function go(page, url, wait = 2500) {
  await page.goto(BASE + url, { waitUntil: "load", timeout: 240000 });
  await page.waitForTimeout(wait);
}
const shot = async (page, name, clip) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + ".png"), clip }); };
const scaleOf = (locator) => locator.evaluate((el) => getComputedStyle(el).scale);
const num = (scale) => (scale === "none" ? 1 : parseFloat(scale));

/** Holds the mouse on an element (without clicking it) and samples its scale. */
async function hold(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(320);
  const held = await scaleOf(locator);
  const press = await locator.evaluate((el) => getComputedStyle(el).getPropertyValue("--press-scale").trim());
  await page.mouse.move(3, 3);
  await page.mouse.up();
  const back = [];
  for (let i = 0; i < 9; i += 1) { await page.waitForTimeout(70); back.push(num(await scaleOf(locator))); }
  return { held: num(held), press: Number(press), peakBack: Math.max(...back), end: back[back.length - 1] };
}

/** Starts frame sampling of the liquid shape inside the page. */
async function watchShape(page) {
  await page.evaluate(() => {
    window.__lq = [];
    // One sampler at a time: an earlier one stops when the next flight is watched.
    const run = (window.__lqRun = (window.__lqRun || 0) + 1);
    const t0 = performance.now();
    const tick = () => {
      if (window.__lqRun !== run) return;
      const host = document.querySelector("[data-liquid-host]");
      if (host) {
        const cs = getComputedStyle(host, "::" + host.getAttribute("data-liquid-host"));
        window.__lq.push({ t: Math.round(performance.now() - t0), l: parseFloat(cs.left), r: parseFloat(cs.right), top: parseFloat(cs.top), b: parseFloat(cs.bottom), dir: host.getAttribute("data-liquid-dir"), bg: cs.backgroundColor, bc: cs.borderBottomColor, bw: cs.borderBottomWidth, w: host.clientWidth, h: host.clientHeight });
      }
      if (performance.now() - t0 < 9000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
/** Reads the flight: where each edge was a moment after the start, and the last frame. */
async function readShape(page) {
  const frames = await page.evaluate(() => window.__lq);
  if (!frames.length) return null;
  const first = frames[0];
  const last = frames[frames.length - 1];
  const at = (ms) => frames.find((frame) => frame.t - first.t >= ms) || last;
  const lead = { right: "r", left: "l", down: "b", up: "top" }[first.dir];
  const trail = { right: "l", left: "r", down: "top", up: "b" }[first.dir];
  const share = (frame, key) => (first[key] === last[key] ? 1 : (frame[key] - first[key]) / (last[key] - first[key]));
  const early = at(110);
  return {
    dir: first.dir,
    frames: frames.length,
    ms: last.t - first.t,
    leadShareAt110ms: Number(share(early, lead).toFixed(2)),
    trailShareAt110ms: Number(share(early, trail).toFixed(2)),
    from: [first.l, first.top, first.r, first.b].map(Math.round),
    to: [last.l, last.top, last.r, last.b].map(Math.round),
    minInset: Math.min(...frames.flatMap((frame) => [frame.l, frame.r, frame.top, frame.b])),
    bg: first.bg,
    border: `${first.bw} ${first.bc}`,
  };
}
async function flight(page, locator, name, clip) {
  await locator.scrollIntoViewIfNeeded();
  await watchShape(page);
  await locator.click();
  let seen = true;
  try {
    await page.waitForSelector("[data-liquid-host]", { timeout: 8000, state: "attached" });
    await page.waitForTimeout(80);
    await shot(page, name + "-mid", clip);
  } catch { seen = false; }
  await page.waitForTimeout(1300);
  await shot(page, name + "-end", clip);
  const shape = seen ? await readShape(page) : null;
  const left = await page.evaluate(() => document.querySelectorAll("[data-liquid-host]").length);
  return { shape, hostsLeftAfter: left };
}
const liquidOk = (f) => Boolean(f.shape) && f.shape.leadShareAt110ms > f.shape.trailShareAt110ms + 0.15 && f.hostsLeftAfter === 0 && f.shape.minInset > -0.75;

(async () => {
  // The project pins its own Playwright: in a cloud session the browser is the preinstalled one.
  const executablePath = process.env.MEASURE_CHROMIUM || (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
  const browser = await chromium.launch(executablePath ? { executablePath, args: ["--headless=new", "--no-sandbox"] } : {});

  // ───────── Desktop, classic, light ─────────
  {
    const { ctx, page } = await open(browser);
    for (const url of ["/settings/organization/documents", "/settings/buildings", "/settings/notifications", "/journals", "/home"]) await go(page, url, 1200); // compile routes
    await go(page, "/settings/notifications", 3000);

    // AC2 press
    const icon = page.locator("main button:not([role=switch]):visible").first();
    const iconHold = await hold(page, icon);
    record("AC2.press.icon", Math.abs(iconHold.held - 0.92) < 0.02 && iconHold.press === 0.92 && iconHold.end > 0.995 && iconHold.peakBack <= 1.02, iconHold);
    const row = page.locator("[data-nav-row]:visible").first();
    const rowHold = await hold(page, row);
    record("AC2.press.row", Math.abs(rowHold.held - 0.985) < 0.01 && rowHold.peakBack <= 1.02, rowHold);
    const plain = page.locator("button:visible, a[class*='rounded']:visible").filter({ hasNot: page.locator("xpath=self::*[@disabled]") });
    let plainHold = null;
    for (let i = 0; i < Math.min(await plain.count(), 60); i += 1) {
      const candidate = plain.nth(i);
      if ((await candidate.evaluate((el) => getComputedStyle(el).getPropertyValue("--press-scale").trim())) === "0.97" || (await candidate.evaluate((el) => getComputedStyle(el).getPropertyValue("--press-scale").trim())) === ".97") { plainHold = await hold(page, candidate); break; }
    }
    record("AC2.press.default", plainHold && Math.abs(plainHold.held - 0.97) < 0.012, plainHold);
    const disabled = page.locator('[role="switch"][disabled]:visible').first();
    if (await disabled.count()) {
      const box = await disabled.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.waitForTimeout(200);
      const held = await scaleOf(disabled); await page.mouse.up();
      record("AC2.press.disabled", held === "none", { held });
    }
    // A control inside a pressed card squeezes alone; a drag handle does not squeeze.
    await page.evaluate(() => {
      const box = document.createElement("div");
      box.id = "press-probe";
      box.style.cssText = "position:fixed;left:300px;top:300px;z-index:99999;background:#fff;padding:12px";
      box.innerHTML = '<a id="pp-card" class="rounded-2xl block" href="#" onclick="return false" style="display:block;padding:24px;background:#eee"><button id="pp-inner" type="button" style="padding:8px 16px">inner</button></a><button id="pp-drag" type="button" aria-roledescription="sortable" style="padding:8px 16px;margin-top:8px">drag</button>';
      document.body.appendChild(box);
    });
    const holdOn = async (selector) => { const box = await page.locator(selector).boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.waitForTimeout(320); const scales = await page.evaluate(() => ({ card: getComputedStyle(document.getElementById("pp-card")).scale, inner: getComputedStyle(document.getElementById("pp-inner")).scale, drag: getComputedStyle(document.getElementById("pp-drag")).scale })); await page.mouse.move(3, 3); await page.mouse.up(); await page.waitForTimeout(150); return scales; };
    const nestedInner = await holdOn("#pp-inner");
    const dragHeld = await holdOn("#pp-drag");
    const cardBox = await page.locator("#pp-card").boundingBox();
    await page.mouse.move(cardBox.x + 6, cardBox.y + 6); await page.mouse.down(); await page.waitForTimeout(320);
    const cardAlone = await page.evaluate(() => getComputedStyle(document.getElementById("pp-card")).scale);
    await page.mouse.move(3, 3); await page.mouse.up();
    await page.evaluate(() => document.getElementById("press-probe").remove());
    record("AC2.press.nested", nestedInner.card === "none" && num(nestedInner.inner) < 0.98 && num(cardAlone) < 0.99, { whileInnerHeld: nestedInner, cardHeldAlone: cardAlone });
    record("AC2.press.drag-handle", dragHeld.drag === "none", { held: dragHeld.drag });
    const tap = await icon.evaluate((el) => getComputedStyle(el).webkitTapHighlightColor);
    record("AC2.tap-highlight", /rgba\(0, 0, 0, 0\)|transparent/.test(tap), { tap });
    // Hover adds no motion: a hovered button keeps its place and size.
    const hoverBox = await icon.boundingBox();
    await page.mouse.move(hoverBox.x + hoverBox.width / 2, hoverBox.y + hoverBox.height / 2);
    await page.waitForTimeout(350);
    const hovered = await icon.evaluate((el) => { const cs = getComputedStyle(el); return { scale: cs.scale, translate: cs.translate, rotate: cs.rotate }; });
    await page.mouse.move(3, 3);
    record("AC2.hover-still", hovered.scale === "none" && hovered.translate === "none" && hovered.rotate === "none", hovered);

    // AC4 toggle
    const toggle = page.locator('[role="switch"]:not([disabled]):visible').first();
    await toggle.scrollIntoViewIfNeeded();
    const knobSelector = '[data-slot="switch-thumb"], span.rounded-full:empty:only-child, div.rounded-full:empty:only-child';
    const before = await toggle.getAttribute("aria-checked");
    const tb = await toggle.boundingBox();
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2); await page.mouse.down(); await page.waitForTimeout(260);
    const heldKnob = await toggle.evaluate((el, sel) => { const knob = el.querySelector(sel); const cs = getComputedStyle(knob); return { scale: cs.scale, tp: cs.transitionProperty, td: cs.transitionDuration }; }, knobSelector);
    await shot(page, "toggle-held", { x: Math.max(0, tb.x - 80), y: Math.max(0, tb.y - 30), width: 240, height: 90 });
    await page.mouse.up();
    const knobFrames = [];
    for (let i = 0; i < 14; i += 1) {
      knobFrames.push(await toggle.evaluate((el, sel) => { const knob = el.querySelector(sel); const r = knob.getBoundingClientRect(); const t = el.getBoundingClientRect(); return { sx: parseFloat(getComputedStyle(knob).scale) || 1, x: Math.round((r.left - t.left) * 10) / 10, right: Math.round((t.right - r.right) * 10) / 10 }; }, knobSelector));
      if (i === 1) await shot(page, "toggle-mid", { x: Math.max(0, tb.x - 80), y: Math.max(0, tb.y - 30), width: 240, height: 90 });
      await page.waitForTimeout(40);
    }
    const after = await toggle.getAttribute("aria-checked");
    const stretch = Math.max(...knobFrames.map((frame) => frame.sx));
    const inside = Math.min(...knobFrames.map((frame) => Math.min(frame.x, frame.right)));
    record("AC4.toggle", before !== after && parseFloat(heldKnob.scale) > 1.15 && stretch > 1.2 && stretch <= 1.4 && inside >= 0 && knobFrames[knobFrames.length - 1].sx === 1 && /translate/.test(heldKnob.tp), { before, after, held: heldKnob.scale, stretch, insideTrackPx: inside, transition: heldKnob.tp, durations: heldKnob.td });
    await toggle.click(); await page.waitForTimeout(700); // put the setting back

    // AC6 liquid: top menu row, sidebar, home tabs
    await go(page, "/settings/organization", 3500);
    const top = await flight(page, page.locator('nav a:has-text("Сведения для документов")').first(), "liquid-topmenu", { x: 256, y: 110, width: 720, height: 70 });
    record("AC6.liquid.topmenu", liquidOk(top) && top.shape.dir === "right", top);
    const side = await flight(page, page.locator('a[data-nav-row]:has-text("Объекты")').first(), "liquid-sidebar", { x: 0, y: 150, width: 256, height: 270 });
    record("AC6.liquid.sidebar", liquidOk(side) && ["up", "down"].includes(side.shape.dir), side);

    // AC8 page fade on that same navigation: check on the next one
    await page.evaluate(() => {
      window.__fade = [];
      const t0 = performance.now();
      const tick = () => {
        const area = document.querySelector("[data-page-area]");
        const child = area && area.children[0];
        const animations = child ? child.getAnimations().filter((a) => a.effect && a.effect.getKeyframes().some((k) => "opacity" in k)) : [];
        if (animations.length) window.__fade.push({ t: Math.round(performance.now() - t0), opacity: Number(getComputedStyle(child).opacity).toFixed(2), duration: animations[0].effect.getTiming().duration, props: Object.keys(animations[0].effect.getKeyframes()[0]).filter((k) => !["offset", "easing", "composite", "computedOffset"].includes(k)) });
        if (performance.now() - t0 < 6000) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.locator('a[data-nav-row]:has-text("Реквизиты")').first().click();
    await page.waitForTimeout(3000);
    const fade = await page.evaluate(() => window.__fade);
    record("AC8.page-fade", fade.length > 0 && fade[0].duration <= 250 && fade[0].props.join() === "opacity" && Number(fade[0].opacity) < 1, { frames: fade.length, first: fade[0], last: fade[fade.length - 1] });
    await go(page, "/settings/organization", 2500);
    const firstLoad = await page.evaluate(() => { const area = document.querySelector("[data-page-area]"); return area ? [...area.children].reduce((n, c) => n + c.getAnimations().length, 0) : -1; });
    record("AC8.first-load-still", firstLoad === 0, { animationsOnPageArea: firstLoad });

    // AC7 menu
    const anim = (selector) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) return null; const cs = getComputedStyle(el); return { name: cs.animationName, duration: cs.animationDuration, easing: cs.animationTimingFunction.slice(0, 24), opacity: Number(cs.opacity).toFixed(2), filter: cs.filter.slice(0, 18) }; }, selector);
    await page.locator("header button").last().click();
    await page.waitForTimeout(50);
    const menuIn = await anim('[data-slot="dropdown-menu-content"]');
    await shot(page, "menu-opening");
    await page.waitForTimeout(450);
    // The menu closes in 0.1 s: sample it inside the page, frame by frame.
    await page.evaluate(() => {
      window.__menuOut = null;
      const tick = () => {
        const el = document.querySelector('[data-slot="dropdown-menu-content"]');
        if (el && el.getAttribute("data-state") === "closed" && !window.__menuOut) { const cs = getComputedStyle(el); window.__menuOut = { name: cs.animationName, duration: cs.animationDuration, easing: cs.animationTimingFunction.slice(0, 24) }; }
        if (el) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    const menuOut = await page.evaluate(() => window.__menuOut);
    record("AC7.menu", menuIn && menuIn.name === "enter" && menuIn.duration === "0.3s" && menuIn.easing.startsWith("linear(") && /blur/.test(menuIn.filter) && menuOut && menuOut.name === "exit" && menuOut.duration === "0.1s", { opening: menuIn, closing: menuOut });

    // AC7 hand-built window + AC3 field inside it
    await page.locator('button:has-text("Завершить")').first().click();
    await page.waitForSelector('[role="dialog"]');
    const cardFrames = [];
    for (let i = 0; i < 6; i += 1) {
      cardFrames.push(await page.evaluate(() => { const dialog = document.querySelector('[role="dialog"]'); const card = [...dialog.children].find((c) => /rounded-/.test(c.className) && !/\babsolute\b/.test(c.className)); const cs = getComputedStyle(card); return { name: cs.animationName, opacity: Number(cs.opacity).toFixed(2), scale: cs.scale, wrapper: getComputedStyle(dialog).animationName }; }));
      if (i === 0) await shot(page, "window-opening");
      await page.waitForTimeout(60);
    }
    record("AC7.window.desktop", cardFrames[0].name === "motion-window-in" && cardFrames[0].wrapper === "motion-fade-in" && Number(cardFrames[0].opacity) < 1 && cardFrames[5].scale === "none", { first: cardFrames[0], last: cardFrames[5] });
    const field = page.locator('[role="dialog"] input:visible').first();
    await field.click();
    const ring = [];
    for (let i = 0; i < 9; i += 1) { await page.waitForTimeout(45); ring.push(await field.evaluate((el) => { const box = el.closest('[class*="focus-within"]') || el; const spreads = (getComputedStyle(box).boxShadow.match(/(-?[\d.]+)px(?=,|$)/g) || []).map(parseFloat); return Math.max(0, ...spreads); })); }
    const fieldStyle = await field.evaluate((el) => { const cs = getComputedStyle(el); return { caret: cs.caretColor, transition: cs.transitionProperty, durations: cs.transitionDuration, placeholderOpacity: getComputedStyle(el, "::placeholder").opacity }; });
    await shot(page, "field-focus");
    record("AC3.field.ring", ring[0] > 0 && ring[0] < ring[ring.length - 1] && Math.max(...ring) <= ring[ring.length - 1] * 1.03 && ring[ring.length - 1] >= 3, { spreadPx: ring });
    record("AC3.field.caret", fieldStyle.caret === "rgb(85, 102, 246)" && /box-shadow/.test(fieldStyle.transition) && fieldStyle.durations.includes("0.42s"), fieldStyle);
    // A bordered field with no focus style of its own: the standard ring (base layer).
    const bare = await page.evaluate(async () => {
      const host = document.querySelector('[role="dialog"]') || document.body;
      const input = document.createElement("input");
      input.className = "border rounded-xl px-3";
      input.placeholder = "probe";
      host.appendChild(input);
      const table = document.createElement("table");
      table.innerHTML = '<tbody><tr><td><input class="border" /></td></tr></tbody>';
      host.appendChild(table);
      input.focus();
      await new Promise((resolve) => setTimeout(resolve, 600));
      const own = getComputedStyle(input);
      const result = { shadow: own.boxShadow, border: own.borderColor, placeholder: getComputedStyle(input, "::placeholder").opacity };
      const cell = table.querySelector("input");
      cell.focus();
      await new Promise((resolve) => setTimeout(resolve, 400));
      result.inTable = getComputedStyle(cell).boxShadow;
      input.remove(); table.remove();
      return result;
    });
    record("AC3.field.default-ring", / 4px$/.test(bare.shadow) && bare.inTable === "none" && Number(bare.placeholder) === 0.6, bare);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);

    // AC5 check mark
    await go(page, "/journals", 3500);
    const onLoad = await page.evaluate(() => document.querySelectorAll("[data-ticked]").length);
    await page.evaluate(() => {
      window.__tick = [];
      const t0 = performance.now();
      const tick = () => {
        const box = document.querySelector('[data-slot="checkbox"]');
        const mark = box && box.querySelector("svg path");
        window.__tick.push({ t: Math.round(performance.now() - t0), state: box && box.getAttribute("data-state"), ticked: box && box.hasAttribute("data-ticked"), offset: mark ? parseFloat(getComputedStyle(mark).strokeDashoffset) : null, name: mark ? getComputedStyle(mark).animationName : null });
        if (performance.now() - t0 < 2500) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const checkbox = page.locator('[data-slot="checkbox"]:visible').first();
    const checkHold = await hold(page, checkbox);
    await checkbox.click();
    await page.waitForTimeout(2600);
    const ticks = (await page.evaluate(() => window.__tick)).filter((frame) => frame.state === "checked");
    const drawn = ticks.filter((frame) => frame.name === "motion-tick");
    record("AC5.check", onLoad === 0 && drawn.length > 3 && drawn[0].offset > 15 && drawn[drawn.length - 1].offset < 1 && ticks[ticks.length - 1].ticked === false && Math.abs(checkHold.held - 0.92) < 0.03, { tickedOnLoad: onLoad, firstOffset: drawn[0] && drawn[0].offset, lastOffset: drawn.length && drawn[drawn.length - 1].offset, drawFrames: drawn.length, attributeRemoved: ticks.length ? !ticks[ticks.length - 1].ticked : null, heldScale: checkHold.held });
    await checkbox.click(); await page.waitForTimeout(500);

    // AC6 segmented control on the home page + synthetic groups (aria-pressed, tab panel, grid, chips)
    await go(page, "/home", 3500);
    const tabs = await flight(page, page.locator('[role="tab"]:has-text("Консалтинг")').first(), "liquid-segments");
    record("AC6.liquid.segments", liquidOk(tabs) && tabs.shape.bg === "rgb(255, 255, 255)", tabs);
    const synthetic = await page.evaluate(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const host = document.createElement("div");
      host.style.cssText = "position:fixed;left:20px;bottom:20px;z-index:99999;background:#fff;padding:8px;";
      const style = "padding:8px 14px;border-radius:10px;border:0;";
      const on = "background:rgb(85,102,246);color:#fff;";
      const off = "background:transparent;color:#333;";
      host.innerHTML = `
        <div id="pp" style="display:flex;gap:4px;padding:4px;background:#f1f1f4;border-radius:12px;width:max-content">
          <button aria-pressed="true" style="${style}${on}">one</button><button aria-pressed="false" style="${style}${off}">two</button><button aria-pressed="false" style="${style}${off}">three</button>
        </div>
        <div id="tt" role="tablist" style="display:flex;gap:4px;margin-top:8px"><button role="tab" aria-selected="true" aria-controls="tp-a" style="${style}${on}">a</button><button role="tab" aria-selected="false" aria-controls="tp-b" style="${style}${off}">b</button></div>
        <div id="tp-b" role="tabpanel">panel b</div>
        <div id="gg" style="display:grid;grid-template-columns:repeat(3,44px);gap:6px;margin-top:8px">${[1, 2, 3, 4, 5, 6].map((d) => `<button aria-pressed="${d === 1}" style="${style}${d === 1 ? on : off}">${d}</button>`).join("")}</div>
        <div id="cc" style="display:flex;gap:4px;margin-top:8px"><button aria-pressed="true" style="${style}${on}">x</button><button aria-pressed="false" style="${style}background:#fff;border:1px solid #ccc">y</button></div>
        <div id="oo" data-liquid="off" style="display:flex;gap:4px;margin-top:8px"><button aria-pressed="true" style="${style}${on}">x</button><button aria-pressed="false" style="${style}${off}">y</button></div>`;
      document.body.appendChild(host);
      await wait(100);
      const swap = (group, from, to, attr) => { const items = group.querySelectorAll("button"); items[from].setAttribute(attr, "false"); items[from].style.cssText = style + off; items[to].setAttribute(attr, "true"); items[to].style.cssText = style + on; };
      const seen = async (group) => { await wait(60); const shown = group.hasAttribute("data-liquid-host"); const masked = [...group.querySelectorAll("button")].some((b) => b.style.getPropertyPriority("background-color") === "important"); return { shown, masked }; };
      const out = {};
      const pressed = host.querySelector("#pp");
      swap(pressed, 0, 2, "aria-pressed");
      out.pressed = await seen(pressed);
      // Retarget while flying: the shape continues from where it is.
      await wait(90);
      const midLeft = parseFloat(getComputedStyle(pressed, "::" + pressed.getAttribute("data-liquid-host")).left);
      swap(pressed, 2, 1, "aria-pressed");
      await wait(30);
      out.retarget = { stillOne: document.querySelectorAll("#pp[data-liquid-host]").length === 1, midLeft, afterLeft: parseFloat(getComputedStyle(pressed, "::" + pressed.getAttribute("data-liquid-host")).left) };
      const tablist = host.querySelector("#tt");
      swap(tablist, 0, 1, "aria-selected");
      await wait(60);
      const panel = host.querySelector("#tp-b");
      const panelAnimation = panel.getAnimations()[0];
      out.panel = panelAnimation ? { props: Object.keys(panelAnimation.effect.getKeyframes()[0]).filter((k) => ["opacity", "filter", "translate"].includes(k)), duration: panelAnimation.effect.getTiming().duration } : null;
      const grid = host.querySelector("#gg");
      swap(grid, 0, 4, "aria-pressed"); // another row and another column
      out.grid = await seen(grid);
      const chips = host.querySelector("#cc");
      const chipItems = chips.querySelectorAll("button");
      chipItems[0].setAttribute("aria-pressed", "false"); chipItems[0].style.cssText = style + "background:#fff;border:1px solid #ccc"; chipItems[1].setAttribute("aria-pressed", "true"); chipItems[1].style.cssText = style + on;
      out.opaqueChips = await seen(chips);
      const optOut = host.querySelector("#oo");
      swap(optOut, 0, 1, "aria-pressed");
      out.optOut = await seen(optOut);
      await wait(900);
      out.cleaned = { hosts: host.querySelectorAll("[data-liquid-host]").length, masks: [...host.querySelectorAll("button")].filter((b) => b.style.getPropertyPriority("background-color") === "important").length, position: pressed.style.position };
      host.remove();
      return out;
    });
    record("AC6.liquid.aria-pressed", synthetic.pressed.shown && synthetic.pressed.masked, synthetic.pressed);
    record("AC6.liquid.retarget", synthetic.retarget.stillOne && synthetic.retarget.midLeft > 5, synthetic.retarget);
    record("AC6.liquid.skips", !synthetic.grid.shown && !synthetic.opaqueChips.shown && !synthetic.optOut.shown, { grid: synthetic.grid, opaqueChips: synthetic.opaqueChips, optOut: synthetic.optOut });
    record("AC6.liquid.cleanup", synthetic.cleaned.hosts === 0 && synthetic.cleaned.masks === 0 && synthetic.cleaned.position === "", synthetic.cleaned);
    record("AC8.tab-panel", synthetic.panel && synthetic.panel.props.length === 3 && synthetic.panel.duration <= 450, synthetic.panel);
    record("errors.desktop", page.__errors.length === 0, page.__errors.slice(0, 3));
    await ctx.close();
  }

  // ───────── Desktop: «Новая» light and dark ─────────
  for (const [label, options, expected] of [["new-light", { design: "new" }, "rgb(236, 236, 239)"], ["new-dark", { design: "new", dark: true }, null], ["classic-dark", { dark: true }, null]]) {
    const { ctx, page } = await open(browser, options);
    await go(page, "/settings/organization/documents", 1500);
    await go(page, "/settings/organization", 3500);
    const theme = await page.evaluate(() => ({ design: document.documentElement.getAttribute("data-view-design"), theme: document.querySelector(".app-shell").getAttribute("data-app-theme") }));
    const target = options.design === "new" ? page.locator('aside a:has-text("Сведения для документов")').first() : page.locator('nav a:has-text("Сведения для документов")').first();
    const result = await flight(page, target, `liquid-${label}`, options.design === "new" ? { x: 12, y: 340, width: 290, height: 230 } : { x: 256, y: 110, width: 720, height: 70 });
    record(`AC6.liquid.${label}`, liquidOk(result) && (!expected || result.shape.bg === expected), { ...theme, ...result });
    const button = page.locator("header button:visible").first();
    const press = await hold(page, button);
    record(`AC2.press.${label}`, press.held < 0.99 && press.end > 0.995, press);
    record(`errors.${label}`, page.__errors.length === 0, page.__errors.slice(0, 3));
    await ctx.close();
  }

  // ───────── Phone: site shell, Mini App shell, QR form ─────────
  {
    const { ctx, page } = await open(browser, { mobile: true });
    await go(page, "/settings/organization", 3500);
    await page.locator('button:has-text("Завершить")').first().click();
    await page.waitForSelector('[role="dialog"]');
    const sheet = [];
    for (let i = 0; i < 6; i += 1) {
      sheet.push(await page.evaluate(() => { const dialog = document.querySelector('[role="dialog"]'); const card = [...dialog.children].find((c) => /rounded-/.test(c.className) && !/\babsolute\b/.test(c.className)); return { name: getComputedStyle(card).animationName, top: Math.round(card.getBoundingClientRect().top) }; }));
      if (i === 1) await shot(page, "sheet-rising");
      await page.waitForTimeout(70);
    }
    const tops = sheet.map((frame) => frame.top);
    record("AC7.window.phone-sheet", sheet[0].name === "motion-sheet-in" && tops[0] > tops[5] + 100 && Math.min(...tops) >= tops[5], { tops });
    await page.keyboard.press("Escape");
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, { mobile: true });
    await go(page, "/mini", 3000); // the phone cabinet switches to the Mini App shell
    await go(page, "/dashboard", 1500);
    await go(page, "/journals", 3500);
    const rail = await page.evaluate(() => { const tab = document.querySelector(".mini-nav-tab"); if (!tab) return null; const cs = getComputedStyle(tab); return { transition: cs.transitionProperty, durations: cs.transitionDuration, shell: Boolean(document.querySelector(".mini-root")) }; });
    record("AC9.mini.nav-rule", rail && /scale/.test(rail.transition) && rail.durations.includes("0.5s"), rail);
    const nav = await flight(page, page.locator("nav.mini-nav-rail a").first(), "liquid-mini-nav", { x: 0, y: 570, width: 390, height: 94 });
    record("AC9.mini.nav-liquid", liquidOk(nav) && nav.shape.bg === "rgb(85, 102, 246)", nav);
    const tab = page.locator("nav.mini-nav-rail a").nth(1);
    const tabHold = await hold(page, tab);
    record("AC9.mini.press", Math.abs(tabHold.held - 0.97) < 0.012 && tabHold.end > 0.995, tabHold);
    const miniInput = await page.evaluate(async () => {
      const root = document.querySelector(".mini-root") || document.body;
      const input = document.createElement("input");
      input.className = "mini-input";
      root.appendChild(input);
      input.focus();
      const spreads = [];
      for (let i = 0; i < 8; i += 1) { await new Promise((resolve) => setTimeout(resolve, 50)); spreads.push(Math.max(0, ...(getComputedStyle(input).boxShadow.match(/(-?[\d.]+)px(?=,|$)/g) || []).map(parseFloat))); }
      const transition = getComputedStyle(input).transitionDuration;
      input.remove();
      return { spreads, transition };
    });
    record("AC9.mini.input", miniInput.spreads[0] > 0 && miniInput.spreads[0] < 4 && Math.abs(miniInput.spreads[7] - 4) < 0.1 && Math.max(...miniInput.spreads) <= 4.12, miniInput);
    record("errors.mini", page.__errors.length === 0, page.__errors.slice(0, 3));
    await ctx.close();
  }
  if (process.env.QR_URL) {
    const ctx = await browser.newContext({ ...devices["iPhone 13"] });
    const page = await ctx.newPage();
    await page.goto(BASE + process.env.QR_URL, { waitUntil: "load", timeout: 240000 });
    await page.waitForTimeout(1000);
    const item = page.locator(".item, .btn").first();
    const press = await hold(page, item);
    const rule = await item.evaluate((el) => ({ transition: getComputedStyle(el).transitionProperty, durations: getComputedStyle(el).transitionDuration, spring: getComputedStyle(document.documentElement).getPropertyValue("--spring").slice(0, 16) }));
    await shot(page, "qr-form");
    record("AC9.qr.press", press.held < 0.99 && press.end > 0.995 && /scale/.test(rule.transition) && rule.spring.startsWith("linear("), { ...press, ...rule });
    await ctx.close();
  }

  // ───────── Public pages: sign-in and the landing ─────────
  {
    const { ctx, page } = await open(browser, { auth: false });
    await go(page, "/login", 2500);
    const email = page.locator("#email");
    await email.click();
    const ring = [];
    for (let i = 0; i < 8; i += 1) { await page.waitForTimeout(50); ring.push(await email.evaluate((el) => { const box = el.closest('[class*="focus-within"]') || el; return Math.max(0, ...(getComputedStyle(box).boxShadow.match(/(-?[\d.]+)px(?=,|$)/g) || []).map(parseFloat)); })); }
    const submit = page.locator('button[type="submit"]').first();
    const press = await hold(page, submit);
    await shot(page, "login-focus");
    record("AC1.login", ring[ring.length - 1] > 0 && ring[0] < ring[ring.length - 1] && press.held < 0.99, { ringSpreadPx: ring, press });
    await go(page, "/", 3000);
    const landing = await page.evaluate(() => { const pick = (selector) => { const el = document.querySelector(selector); return el ? getComputedStyle(el).transitionProperty : null; }; return { submit: pick(".motion-submit"), liquid: pick(".motion-liquid"), fab: pick(".motion-fab") }; });
    record("AC1.landing-keeps-own-motion", /border-radius/.test(landing.submit || "") && landing.liquid === "left, right" && /scale/.test(landing.fab || ""), landing);
    record("errors.public", page.__errors.length === 0, page.__errors.slice(0, 3));
    await ctx.close();
  }

  // ───────── «Без анимации» (system Reduce motion) ─────────
  {
    const { ctx, page } = await open(browser, { still: true });
    await go(page, "/settings/organization/documents", 1500);
    await go(page, "/settings/organization", 3500);
    const flag = await page.evaluate(() => document.documentElement.hasAttribute("data-view-still"));
    const button = page.locator("header button:visible").first();
    const box = await button.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.waitForTimeout(250);
    const held = await scaleOf(button);
    await page.mouse.move(3, 3); await page.mouse.up();
    await page.evaluate(() => { window.__seen = 0; new MutationObserver(() => { window.__seen += document.querySelectorAll("[data-liquid-host]").length; }).observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ["data-liquid-host"] }); });
    await page.locator('nav a:has-text("Сведения для документов")').first().click();
    await page.waitForTimeout(2500);
    const seen = await page.evaluate(() => ({ hosts: window.__seen, pageAnimations: (() => { const area = document.querySelector("[data-page-area]"); return area ? [...area.children].reduce((n, c) => n + c.getAnimations().length, 0) : -1; })() }));
    record("AC11.still", flag && held === "none" && seen.hosts === 0 && seen.pageAnimations === 0, { flag, heldScale: held, ...seen, url: page.url().replace(BASE, "") });
    await ctx.close();
  }

  await browser.close();
  const failed = results.filter((result) => !result.ok);
  fs.writeFileSync(OUT, JSON.stringify({ base: BASE, at: new Date().toISOString(), passed: results.length - failed.length, failed: failed.length, results }, null, 1));
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed → ${OUT}`);
  process.exit(failed.length ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(2); });
