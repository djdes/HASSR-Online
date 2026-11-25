// Verifier round 2 (independent): AC8 accessibility and desktop behaviour of the object card pin.
// - heading accessible name = the object name (aria-label), at phone and desktop widths;
// - exactly one pin in the accessibility tree and in the Tab order per card at every width, focus order
//   inside the card; the pin inside the heading is announced as a toggle button with the object name;
// - keyboard: Enter on the focused pin toggles it (aria-pressed), focus stays on it;
// - mouse click on the phone pin (inside the heading) pins/unpins;
// - desktop (1280): unpinned pin invisible until hover / focus-within, pinned pin always visible.
// Own test point, deleted at the end; the owner's pinned list restored.
// Usage (env loaded, next dev on :3000): node ac8-a11y.mjs <outdir>
import fs from "node:fs";
import { BASE, chromium, db, reporter, session, acceptLegal } from "./lib.mjs";

const OUT = process.argv[2] ?? "out";
const { check, finish } = reporter(`${OUT}/ac8-a11y-results.json`);
const { client, q } = await db();
const ADMIN = (await q(`select id, "pinnedBuildingIds" from "User" where email='admin@haccp.local'`))[0];
const browser = await chromium.launch();
const owner = await session(browser, "admin@haccp.local", "admin1234");
const NAME = `Кафе «Проверка» ${new Date().toISOString().slice(11, 19)}`;
let point = null;
const notes = [];
try {
  const made = await owner.request.post(`${BASE}/api/settings/buildings`, { data: { name: NAME, sphere: "food" } });
  point = (await made.json()).building;
  check("setup: test point", Boolean(point?.id), String(made.status()));
  const page = await owner.newPage();
  const cardSel = `[data-building-card="${point.id}"]`;
  const open = async (width) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${BASE}/settings/buildings`, { waitUntil: "networkidle", timeout: 240000 });
    await acceptLegal(page);
    await page.locator(cardSel).evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(300);
  };
  const tabStops = async () => {
    // Start right before the card: a temporary focusable sentinel, then Tab through the card.
    await page.locator(cardSel).evaluate((card) => {
      const s = document.createElement("button");
      s.id = "verifier-sentinel";
      s.textContent = "sentinel";
      s.style.position = "absolute";
      s.style.opacity = "0";
      card.prepend(s);
      s.focus();
    });
    const stops = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      // The pin fades in (transition 150 ms) on focus — read its opacity after the transition.
      await page.waitForTimeout(250);
      const info = await page.evaluate((sel) => {
        const el = document.activeElement;
        const card = document.querySelector(sel);
        if (!el || !card.contains(el)) return null;
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          label: el.getAttribute("aria-label") ?? el.textContent.trim().slice(0, 40),
          pin: el.hasAttribute("data-pin-building"),
          inH2: Boolean(el.closest("h2")),
          visible: r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden",
          opacity: getComputedStyle(el).opacity,
        };
      }, cardSel);
      if (!info) break;
      stops.push(info);
    }
    await page.evaluate(() => document.getElementById("verifier-sentinel")?.remove());
    return stops;
  };

  for (const width of [320, 390, 639, 640, 1024, 1280]) {
    await open(width);
    const heading = page.getByRole("heading", { level: 2, name: NAME, exact: true });
    check(`${width}px: exactly one h2 named «${NAME}» (accessible name = object name)`, (await heading.count()) === 1, String(await heading.count()));
    const pinButtons = page.locator(cardSel).getByRole("button", { name: `Закрепить «${NAME}» первым`, exact: true });
    check(`${width}px: exactly one pin button in the accessibility tree`, (await pinButtons.count()) === 1, String(await pinButtons.count()));
    const snapshot = await page.locator(cardSel).ariaSnapshot();
    fs.appendFileSync(`${OUT}/ac8-a11y-snapshots.txt`, `== ${width}px\n${snapshot.split("\n").slice(0, 8).join("\n")}\n`);
    const stops = await tabStops();
    const pinStops = stops.filter((s) => s.pin);
    check(`${width}px: Tab reaches the pin exactly once, and it is visible when focused`, pinStops.length === 1 && pinStops[0].visible && pinStops[0].opacity === "1", JSON.stringify(stops.map((s) => `${s.tag}${s.pin ? "[pin" + (s.inH2 ? " in h2" : "") + "]" : ""}:${s.label}`)));
    check(`${width}px: the focused pin is ${width < 640 ? "inside" : "outside"} the heading`, pinStops[0]?.inH2 === width < 640, JSON.stringify(pinStops[0] ?? null));
  }

  // Keyboard toggle at 390: focus the pin, Enter → pinned (aria-pressed=true), focus kept; Enter again → unpinned.
  await open(390);
  const pin390 = page.locator(`${cardSel} h2 [data-pin-building]`);
  await pin390.focus();
  const saved = page.waitForResponse((r) => r.url().includes("/api/me/pinned-buildings") && r.request().method() === "POST", { timeout: 30000 });
  await page.keyboard.press("Enter");
  const savedRes = await saved;
  notes.push(`pin POST ${savedRes.status()}`);
  const focusedAfter = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
  check("390px keyboard: focus stays on the pin after Enter", focusedAfter === `Открепить «${NAME}»` || focusedAfter === `Закрепить «${NAME}» первым`, String(focusedAfter));
  await page.waitForFunction((sel) => document.querySelector(`${sel} h2 [data-pin-building]`)?.getAttribute("aria-pressed") === "true", cardSel, { timeout: 30000 }).catch(() => {});
  const pressed = await page.locator(`${cardSel} h2 [data-pin-building]`).getAttribute("aria-pressed");
  const dbPinned = (await q(`select "pinnedBuildingIds" from "User" where id=$1`, [ADMIN.id]))[0].pinnedBuildingIds;
  check("390px keyboard: Enter on the pin inside the heading pins the object (aria-pressed, saved)", pressed === "true" && dbPinned.includes(point.id), `${pressed} ${JSON.stringify(dbPinned)}`);
  const pinnedLabel = await page.locator(`${cardSel} h2 [data-pin-building]`).getAttribute("aria-label");
  check("390px: pinned label «Открепить «…»»", pinnedLabel === `Открепить «${NAME}»`, pinnedLabel);
  await page.waitForTimeout(1500);
  // Pinned card moves to the top after router.refresh(); click (mouse) to unpin.
  await page.locator(cardSel).evaluate((el) => el.scrollIntoView({ block: "center" }));
  const unsaved = page.waitForResponse((r) => r.url().includes("/api/me/pinned-buildings") && r.request().method() === "POST", { timeout: 30000 });
  await page.locator(`${cardSel} h2 [data-pin-building]`).click();
  await unsaved;
  await page.waitForFunction((sel) => document.querySelector(`${sel} h2 [data-pin-building]`)?.getAttribute("aria-pressed") === "false", cardSel, { timeout: 30000 }).catch(() => {});
  const dbAfter = (await q(`select "pinnedBuildingIds" from "User" where id=$1`, [ADMIN.id]))[0].pinnedBuildingIds;
  check("390px mouse: click on the pin inside the heading unpins (saved)", !dbAfter.includes(point.id), JSON.stringify(dbAfter));

  // Desktop hover: unpinned pin hidden until hover/focus; pinned always visible.
  await open(1280);
  const desk = page.locator(`${cardSel} [data-pin-building]:not(h2 [data-pin-building])`);
  const opacity = async () => desk.evaluate((el) => getComputedStyle(el).opacity);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(300);
  const before = await opacity();
  await page.locator(cardSel).hover();
  await page.waitForTimeout(400);
  const hovered = await opacity();
  check("1280px: unpinned pin invisible until the card is hovered, visible on hover", before === "0" && hovered === "1", `${before} → ${hovered}`);
  const mobileHidden = await page.locator(`${cardSel} h2 [data-pin-building]`).evaluate((el) => getComputedStyle(el).display);
  check("1280px: the phone pin inside the heading is display:none", mobileHidden === "none", mobileHidden);
  await desk.click();
  await page.waitForTimeout(1500);
  await page.mouse.move(5, 5);
  await page.locator(cardSel).evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(500);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(300);
  const pinnedOpacity = await page.locator(`${cardSel} [data-pin-building]:not(h2 [data-pin-building])`).evaluate((el) => getComputedStyle(el).opacity);
  check("1280px: pinned pin visible without hover", pinnedOpacity === "1", pinnedOpacity);
  await page.locator(`${cardSel} [data-pin-building]:not(h2 [data-pin-building])`).click();
  await page.waitForTimeout(1000);
} catch (error) {
  check("script error", false, String(error?.stack ?? error).slice(0, 400));
} finally {
  await q(`update "User" set "pinnedBuildingIds"=$2 where id=$1`, [ADMIN.id, ADMIN.pinnedBuildingIds]);
  if (point) {
    const d = await owner.request.delete(`${BASE}/api/settings/buildings/${point.id}`);
    check("cleanup: test point deleted, pinned list restored", d.ok(), String(d.status()));
  }
  const failed = finish();
  await browser.close();
  await client.end();
  process.exitCode = failed ? 1 : 0;
}
