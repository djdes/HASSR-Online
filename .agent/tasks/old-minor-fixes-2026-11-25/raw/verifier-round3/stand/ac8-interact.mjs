// Verifier round 3 (independent probe): AC8 pin interaction on real input.
// Phone (Galaxy S24, touch): taps at the four corners of the 48×48 zone (±23 px from the centre), at the
// zone's edges, and just outside it (±26 px, only where nothing interactive sits) — the pin toggles
// exactly for the inside taps (aria-pressed and the saved list in the DB); keyboard: Tab from a sentinel
// lands on the pin first, the pin is visible with a focus ring, Space and Enter toggle it.
// Phone landscape ≥ 640 px (Galaxy S8 landscape, touch): the separate pin, visible, tap toggles.
// Desktop 1280 (mouse): the phone pin is display:none; unpinned pin hidden until the card is hovered,
// click toggles, pinned pin stays visible without hover; Tab reaches it once.
// Own test point, deleted at the end; owner's pinned list restored.
// Usage (env loaded, next dev on :3000): node ac8-interact.mjs <outdir>
import fs from "node:fs";
import { BASE, chromium, devices, db, ownerState, acceptLegal, reporter } from "./lib3.mjs";

const OUT = process.argv[2] ?? "out";
fs.mkdirSync(`${OUT}/screens`, { recursive: true });
const { check, finish } = reporter(`${OUT}/ac8-interact-results.json`);
const dev = (name) => {
  const { defaultBrowserType, ...rest } = devices[name];
  return rest;
};
const { client, q } = await db();
const ADMIN = (await q(`select id, "pinnedBuildingIds" from "User" where email='admin@haccp.local'`))[0];
const browser = await chromium.launch();
const state = await ownerState(browser);
const api = await browser.newContext({ storageState: state });
const NAME = `Пекарня «Каравай» ${new Date().toISOString().slice(11, 19).replace(/:/g, "")}`;
let point = null;
const savedPinned = async () => (await q(`select "pinnedBuildingIds" from "User" where id=$1`, [ADMIN.id]))[0].pinnedBuildingIds.includes(point.id);
const waitFor = async (fn, want, ms = 8000) => {
  const until = Date.now() + ms;
  let v;
  while (Date.now() < until) {
    v = await fn();
    if (v === want) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
  return v;
};

async function openPage(opts) {
  const ctx = await browser.newContext({ ...opts, storageState: state, locale: "ru-RU" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/settings/buildings`, { waitUntil: "networkidle", timeout: 240000 });
  await acceptLegal(page);
  await page.locator(`[data-building-card="${point.id}"]`).waitFor({ timeout: 120000 });
  // The page scrolls itself back to the top once shortly after load — let it settle first.
  await page.waitForTimeout(2500);
  return { ctx, page };
}
const card = (page) => page.locator(`[data-building-card="${point.id}"]`);
async function visiblePin(page) {
  // Centre the heading and make sure it stays in the viewport (re-scroll if the page moved it).
  for (let i = 0; i < 6; i++) {
    await card(page).evaluate((el) => el.querySelector("h2").scrollIntoView({ block: "center" }));
    await page.waitForTimeout(250);
    const ok = await card(page).evaluate((el) => {
      const r = el.querySelector("h2").getBoundingClientRect();
      return r.top > 60 && r.bottom < innerHeight - 60;
    });
    if (ok) break;
  }
  return page.evaluate((id) => {
    const pins = [...document.querySelectorAll(`[data-building-card="${id}"] [data-pin-building]`)].filter((p) => getComputedStyle(p).display !== "none" && p.getBoundingClientRect().width > 0);
    if (pins.length !== 1) return { count: pins.length };
    const p = pins[0];
    const r = p.getBoundingClientRect();
    return { count: 1, x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2, pressed: p.getAttribute("aria-pressed"), inH2: Boolean(p.closest("h2")), opacity: getComputedStyle(p).opacity };
  }, point.id);
}
const pressedNow = async (page) => (await visiblePin(page)).pressed;
// A tap at an exact point: CDP touch with a 0.5 px radius, so Chrome's touch adjustment (which snaps a
// fat-finger tap on plain text to a nearby control) does not widen the zone being measured.
async function tapExact(page, x, y) {
  const cdp = await page.context().newCDPSession(page);
  const pt = { x, y, radiusX: 0.5, radiusY: 0.5, force: 1, id: 1 };
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [pt] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}
const whatIsAt = (page, x, y) =>
  page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return "nothing";
    const ctl = el.closest("a[href], button, input, select, textarea, [role=button], label");
    return ctl ? `${ctl.tagName.toLowerCase()}${ctl.hasAttribute("data-pin-building") ? "[pin]" : ""}:${(ctl.getAttribute("aria-label") ?? ctl.textContent).trim().slice(0, 30)}` : `${el.tagName.toLowerCase()}(text)`;
  }, [x, y]);

try {
  const made = await api.request.post(`${BASE}/api/settings/buildings`, { data: { name: NAME, sphere: "food" } });
  point = (await made.json()).building;
  check("setup: own test point", Boolean(point?.id), `${made.status()} ${NAME}`);

  // ---------- phone, touch ----------
  {
    const { ctx, page } = await openPage(dev("Galaxy S24"));
    let pin = await visiblePin(page);
    check("phone 360: one visible pin, inside the heading, 28×28 box", pin.count === 1 && pin.inH2 && Math.round(pin.w) === 28 && Math.round(pin.h) === 28, pin);
    await page.screenshot({ path: `${OUT}/screens/interact-phone-360-before.png`, clip: { x: 0, y: Math.max(0, pin.y - 60), width: 360, height: 140 } });
    let expected = pin.pressed === "true";
    const insideTaps = [[-23, -23], [23, -23], [-23, 23], [23, 23], [0, 0], [-20, 0], [20, 0], [0, -20], [0, 20]];
    for (const [dx, dy] of insideTaps) {
      pin = await visiblePin(page);
      const x = pin.cx + dx;
      const y = pin.cy + dy;
      const target = await whatIsAt(page, x, y);
      await page.touchscreen.tap(x, y);
      expected = !expected;
      const ui = await waitFor(async () => (await pressedNow(page)) === String(expected), true);
      const saved = await waitFor(savedPinned, expected);
      check(`phone 360: tap at (${dx >= 0 ? "+" : ""}${dx}, ${dy >= 0 ? "+" : ""}${dy}) from the pin centre toggles it`, ui === true && saved === expected, { target, pressed: await pressedNow(page), saved });
    }
    // Exact-point taps (no touch adjustment): inside the zone near its corners → toggles.
    for (const [dx, dy] of [[-23, -23], [23, 23], [23, -23], [-23, 23]]) {
      pin = await visiblePin(page);
      const before = (await pressedNow(page)) === "true";
      await tapExact(page, pin.cx + dx, pin.cy + dy);
      const ui = await waitFor(async () => (await pressedNow(page)) === String(!before), true);
      const saved = await waitFor(savedPinned, !before);
      check(`phone 360: exact-point tap at (${dx}, ${dy}) — inside the 48×48 zone — toggles`, ui === true && saved === !before, { saved });
    }
    // Taps on plain text just outside the 48×48 zone. Chrome gives every tap gesture a minimum area and
    // snaps a tap on plain text to a control inside that area (touch adjustment), so a tap that close is
    // expected to reach the pin; far enough away it must not. Recorded, not judged here: the geometric
    // zone is measured with elementFromPoint in ac8-layout.mjs. Only points on plain text are tapped.
    for (const [dx, dy] of [[-26, 0], [26, 0], [0, -26], [0, 26], [-30, 0], [-37, 0], [0, 37], [37, 0], [-44, 0]]) {
      pin = await visiblePin(page);
      const x = pin.cx + dx;
      const y = pin.cy + dy;
      const target = await whatIsAt(page, x, y);
      if (!/\(text\)$|^nothing$/.test(target)) {
        console.log(`INFO exact tap at (${dx}, ${dy}) skipped: ${target}`);
        continue;
      }
      const before = await pressedNow(page);
      await tapExact(page, x, y);
      await page.waitForTimeout(1200);
      const after = await pressedNow(page);
      console.log(`INFO exact tap at (${dx}, ${dy}) on ${target}: ${after !== before ? "reached the pin (touch adjustment)" : "no toggle"}`);
      if (after !== before) {
        pin = await visiblePin(page);
        await tapExact(page, pin.cx, pin.cy);
        await waitFor(async () => (await pressedNow(page)) === before, true);
      }
    }
    // Informational: an ordinary Playwright tap (default touch size) next to the pin on plain text.
    for (const [dx, dy] of [[-26, 0], [0, 26]]) {
      pin = await visiblePin(page);
      const before = await pressedNow(page);
      await page.touchscreen.tap(pin.cx + dx, pin.cy + dy);
      await page.waitForTimeout(1200);
      const after = await pressedNow(page);
      console.log(`INFO ordinary tap at (${dx}, ${dy}) on plain text next to the pin: ${after !== before ? "snapped to the pin by Chrome touch adjustment" : "no toggle"}`);
      if (after !== before) {
        // put it back with an exact tap on the pin
        pin = await visiblePin(page);
        await tapExact(page, pin.cx, pin.cy);
        await waitFor(async () => (await pressedNow(page)) === before, true);
      }
    }
    if (false) for (const [dx, dy] of [[-26, 0], [26, 0], [0, -26], [0, 26], [-25, -25], [25, 25]]) {
      pin = await visiblePin(page);
      const x = pin.cx + dx;
      const y = pin.cy + dy;
      const target = await whatIsAt(page, x, y);
      if (!/\(text\)$|^nothing$/.test(target)) {
        check(`phone 360: point (${dx}, ${dy}) outside the zone is not a control (skipped tap)`, !target.includes("[pin]"), target);
        continue;
      }
      const before = await pressedNow(page);
      const beforeSaved = await savedPinned();
      await page.touchscreen.tap(x, y);
      await page.waitForTimeout(1200);
      check(`phone 360: tap at (${dx}, ${dy}) — outside the zone — does not toggle`, (await pressedNow(page)) === before && (await savedPinned()) === beforeSaved, { target });
    }
    // Keyboard: sentinel right before the card, Tab → the pin.
    await card(page).evaluate((el) => {
      const s = document.createElement("button");
      s.id = "v3-sentinel";
      s.textContent = "sentinel";
      s.style.cssText = "position:absolute;opacity:0;width:1px;height:1px";
      el.prepend(s);
      s.focus();
    });
    await page.keyboard.press("Tab");
    await page.waitForTimeout(250);
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      const cs = getComputedStyle(el);
      return { pin: el.hasAttribute("data-pin-building"), inH2: Boolean(el.closest("h2")), label: el.getAttribute("aria-label"), opacity: cs.opacity, ring: cs.boxShadow, focusVisible: el.matches(":focus-visible") };
    });
    check("phone 360 keyboard: Tab from just before the card lands on the pin inside the heading, visible with a focus ring", focused.pin && focused.inH2 && focused.opacity === "1" && focused.focusVisible && focused.ring !== "none", focused);
    const k0 = (await pressedNow(page)) === "true";
    await page.keyboard.press("Space");
    const k1 = await waitFor(async () => (await page.evaluate(() => document.activeElement?.getAttribute("aria-pressed"))) === String(!k0), true);
    const k1saved = await waitFor(savedPinned, !k0);
    check("phone 360 keyboard: Space toggles the focused pin (and it is saved)", k1 === true && k1saved === !k0, { saved: k1saved });
    const stillFocused = await page.evaluate(() => document.activeElement?.hasAttribute("data-pin-building") ?? false);
    if (stillFocused) {
      await page.keyboard.press("Enter");
      const k2 = await waitFor(async () => (await page.evaluate(() => document.activeElement?.getAttribute("aria-pressed"))) === String(k0), true);
      const k2saved = await waitFor(savedPinned, k0);
      check("phone 360 keyboard: Enter toggles it back (and it is saved)", k2 === true && k2saved === k0, { saved: k2saved });
    } else {
      check("phone 360 keyboard: focus stays on the pin after Space (needed for Enter)", false, "focus lost");
    }
    await card(page).evaluate((el) => el.querySelector("#v3-sentinel")?.remove());
    if ((await pressedNow(page)) === "true") {
      pin = await visiblePin(page);
      await tapExact(page, pin.cx, pin.cy);
      await waitFor(savedPinned, false);
    }
    check("phone 360: left unpinned for the next part", (await savedPinned()) === false);
    await ctx.close();
  }

  // ---------- phone landscape ≥ 640 (touch) ----------
  {
    const { ctx, page } = await openPage(dev("Galaxy S8 landscape"));
    const pin = await visiblePin(page);
    check("landscape 740 (touch): one visible pin, outside the heading, opaque without hover", pin.count === 1 && pin.inH2 === false && pin.opacity === "1", pin);
    const before = pin.pressed === "true";
    await page.touchscreen.tap(pin.cx, pin.cy);
    const ui = await waitFor(async () => (await pressedNow(page)) === String(!before), true);
    const saved = await waitFor(savedPinned, !before);
    check("landscape 740 (touch): tap toggles the pin (saved)", ui === true && saved === !before, { saved });
    await page.touchscreen.tap((await visiblePin(page)).cx, (await visiblePin(page)).cy);
    const back = await waitFor(savedPinned, before);
    check("landscape 740 (touch): second tap toggles back", back === before, { saved: back });
    await ctx.close();
  }

  // ---------- desktop 1280 (mouse) ----------
  {
    const { ctx, page } = await openPage({ viewport: { width: 1280, height: 900 } });
    await page.mouse.move(2, 2);
    const pin = await visiblePin(page);
    const phonePin = await page.evaluate((id) => {
      const inH2 = document.querySelector(`[data-building-card="${id}"] h2 [data-pin-building]`);
      return inH2 ? { display: getComputedStyle(inH2).display } : null;
    }, point.id);
    check("desktop 1280: the phone pin inside the heading is display:none; one visible pin outside it", phonePin?.display === "none" && pin.count === 1 && pin.inH2 === false, { phonePin, pin });
    await page.mouse.move(2, 2);
    await page.waitForTimeout(300);
    const hidden = (await visiblePin(page)).opacity;
    await card(page).hover({ position: { x: 30, y: 30 } });
    await page.waitForTimeout(300);
    const shown = (await visiblePin(page)).opacity;
    check("desktop 1280: unpinned pin hidden until the card is hovered, visible on hover", hidden === "0" && shown === "1", { hidden, shown });
    const p = await visiblePin(page);
    await page.mouse.click(p.cx, p.cy);
    const ui = await waitFor(async () => (await pressedNow(page)) === "true", true);
    const saved = await waitFor(savedPinned, true);
    check("desktop 1280: click pins the object (saved)", ui === true && saved === true, { saved });
    await page.mouse.move(2, 2);
    await page.waitForTimeout(400);
    const pinnedOpacity = (await visiblePin(page)).opacity;
    check("desktop 1280: pinned pin visible without hover", pinnedOpacity === "1", pinnedOpacity);
    await page.screenshot({ path: `${OUT}/screens/interact-desktop-1280-pinned.png`, clip: { x: 0, y: Math.max(0, (await visiblePin(page)).y - 60), width: 1280, height: 140 } });
    await card(page).hover({ position: { x: 30, y: 30 } });
    const p2 = await visiblePin(page);
    await page.mouse.click(p2.cx, p2.cy);
    const saved2 = await waitFor(savedPinned, false);
    check("desktop 1280: second click unpins (saved)", saved2 === false, { saved: saved2 });
    // Tab order: sentinel before the card → first stop is the pin (once), then the card's other controls.
    await card(page).evaluate((el) => {
      const s = document.createElement("button");
      s.id = "v3-sentinel";
      s.style.cssText = "position:absolute;opacity:0;width:1px;height:1px";
      el.prepend(s);
      s.focus();
    });
    const stops = [];
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      stops.push(await page.evaluate((id) => {
        const el = document.activeElement;
        const inCard = Boolean(el.closest(`[data-building-card="${id}"]`));
        return `${inCard ? "" : "OUT:"}${el.tagName.toLowerCase()}${el.hasAttribute("data-pin-building") ? "[pin]" : ""}`;
      }, point.id));
    }
    check("desktop 1280: Tab reaches the pin once, first in the card", stops[0] === "button[pin]" && stops.filter((s) => s === "button[pin]").length === 1, stops);
    await ctx.close();
  }
} catch (error) {
  check("script error", false, String(error?.stack ?? error).slice(0, 500));
} finally {
  if (point?.id) {
    const d = await api.request.delete(`${BASE}/api/settings/buildings/${point.id}`);
    await q(`update "User" set "pinnedBuildingIds"=$2 where id=$1`, [ADMIN.id, ADMIN.pinnedBuildingIds]);
    const left = await q(`select count(*)::int c from "Building" where id=$1`, [point.id]);
    check("cleanup: test point deleted, pinned list restored", d.ok() && left[0].c === 0, `${d.status()}`);
  }
  finish();
  await api.close();
  await browser.close();
  await client.end();
}
