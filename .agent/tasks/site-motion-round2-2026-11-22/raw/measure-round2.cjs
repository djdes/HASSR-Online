/*
 * Browser measurements for spec site-motion-round2-2026-11-22 (AC1–AC7, AC9). Local app only.
 *
 *   node measure-round2.cjs <state.json> <out.json> [shots-dir]     env: DOC_URL=/journals/<code>/documents/<id>
 */
const { chromium, devices } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = process.env.BASE_URL || "http://localhost:3005";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error("local server only");
const [STATE, OUT, SHOTS] = process.argv.slice(2);
if (!STATE || !OUT) throw new Error("usage: node measure-round2.cjs <state.json> <out.json> [shots-dir]");
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
function record(id, ok, detail) {
  results.push({ id, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${JSON.stringify(detail).slice(0, 300)}`);
}
async function open(browser, { mobile = false, dark = false, still = false } = {}) {
  const base = mobile ? { ...devices["iPhone 13"] } : { viewport: { width: 1440, height: 900 } };
  const ctx = await browser.newContext({ ...base, storageState: STATE, reducedMotion: still ? "reduce" : "no-preference" });
  await ctx.addCookies([{ name: "wesetup-view", value: "t:normal|c:auto|m:auto|h:on|n:new|d:classic", url: BASE }]);
  await ctx.addInitScript((isDark) => { try { localStorage.setItem("wesetup-app-theme", isDark ? "dark" : "light"); localStorage.setItem("wesetup-theme-mode", isDark ? "dark" : "light"); localStorage.setItem("wesetup-theme-auto-schedule", "0"); } catch {} }, dark);
  const page = await ctx.newPage();
  page.__errors = [];
  page.on("pageerror", (error) => page.__errors.push(String(error).slice(0, 200)));
  await page.route("**/api/journal-documents/__probe-ok", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.route("**/api/journal-documents/__probe-bad", (route) => route.fulfill({ status: 500, contentType: "application/json", body: "{}" }));
  return { ctx, page };
}
async function go(page, url, wait = 2500) {
  await page.goto(BASE + url, { waitUntil: "load", timeout: 240000 });
  await page.waitForTimeout(wait);
}
const shot = async (page, name, clip) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + ".png"), clip }); };

/** Synthetic DOM changes inside the live page: what the runtime sees when a screen updates. */
const SYNTHETIC = async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const box = document.createElement("div");
  box.style.cssText = "position:relative;padding:12px;background:#fff";
  document.querySelector("main").prepend(box);
  const out = {};
  // AC1
  box.innerHTML = '<div id="ph"><div class="skeleton-shimmer" style="height:40px"></div><div class="skeleton-shimmer" style="height:40px"></div></div>';
  await wait(120);
  const content = document.createElement("div");
  content.innerHTML = "<section>one</section><section>two</section><section><div class='fixed' style='position:static'>pinned</div></section>";
  box.querySelector("#ph").remove();
  box.appendChild(content);
  await wait(40);
  out.enter = [...content.children].map((child) => { const a = child.getAnimations()[0]; return a ? { delay: a.effect.getTiming().delay, duration: a.effect.getTiming().duration, keys: Object.keys(a.effect.getKeyframes()[0]).filter((k) => ["opacity", "translate"].includes(k)).sort() } : null; });
  const plain = document.createElement("div"); plain.innerHTML = "<p>a</p><p>b</p>"; box.appendChild(plain); await wait(40);
  out.withoutPlaceholder = [...plain.children].reduce((n, child) => n + child.getAnimations().length, 0);
  // AC2
  const table = document.createElement("table");
  table.innerHTML = "<tbody><tr><td>r1</td><td>x</td></tr><tr><td>r2</td><td>x</td></tr><tr><td>r3</td><td>x</td></tr></tbody>";
  box.appendChild(table); await wait(60);
  const body = table.tBodies[0];
  const row = document.createElement("tr"); row.innerHTML = "<td>new</td><td>x</td>"; body.appendChild(row); await wait(40);
  out.newRow = { marked: row.hasAttribute("data-row-new"), row: getComputedStyle(row).animationName, cell: getComputedStyle(row.cells[0]).animationName };
  for (let i = 0; i < 5; i += 1) { const r = document.createElement("tr"); r.className = "bulk"; r.innerHTML = "<td>bulk</td><td>x</td>"; body.appendChild(r); }
  await wait(40);
  out.bulkMarked = body.querySelectorAll(".bulk[data-row-new]").length;
  body.insertBefore(body.rows[1], body.rows[0]); await wait(40);
  out.movedMarked = body.rows[0].hasAttribute("data-row-new");
  const second = document.createElement("table"); second.innerHTML = '<tbody><tr><td colspan="6">Строк пока нет</td></tr></tbody>'; box.appendChild(second); await wait(60);
  const first = document.createElement("tr"); first.innerHTML = "<td>first</td>"; second.tBodies[0].rows[0].remove(); second.tBodies[0].appendChild(first); await wait(40);
  out.firstRowMarked = first.hasAttribute("data-row-new");
  const list = document.createElement("div"); list.setAttribute("data-motion-list", ""); list.innerHTML = "<div>a</div><div>b</div>"; box.appendChild(list); await wait(60);
  const card = document.createElement("div"); card.textContent = "c"; list.appendChild(card); await wait(40);
  out.listItemMarked = card.hasAttribute("data-row-new");
  await wait(1900);
  out.markCleared = !row.hasAttribute("data-row-new");
  // AC3
  const cell = table.rows[2].cells[0];
  cell.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  await fetch("/api/journal-documents/__probe-bad", { method: "PATCH", body: "{}" }); await wait(80);
  out.savedAfterFailure = document.querySelectorAll("[data-motion-saved]").length;
  await fetch("/api/journal-documents/__probe-ok"); await wait(80);
  out.savedAfterGet = document.querySelectorAll("[data-motion-saved]").length;
  const reply = await fetch("/api/journal-documents/__probe-ok", { method: "PATCH", body: "{}" });
  out.replyUntouched = reply.ok && (await reply.text()) === "{}";
  await wait(120);
  const mark = document.querySelector("[data-motion-saved]");
  const cb = cell.getBoundingClientRect();
  const mb = mark ? mark.getBoundingClientRect() : null;
  out.saved = mark ? { insideCell: mb.left >= cb.left && mb.right <= cb.right + 1 && mb.top >= cb.top && mb.bottom <= cb.bottom + 1, animation: getComputedStyle(mark).animationName, opacity: Number(getComputedStyle(mark).opacity).toFixed(2), background: getComputedStyle(mark).backgroundColor } : null;
  await wait(1600);
  out.savedGone = document.querySelectorAll("[data-motion-saved]").length === 0;
  document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  await fetch("/api/journal-documents/__probe-ok", { method: "PATCH", body: "{}" }); await wait(120);
  out.savedWithoutCell = document.querySelectorAll("[data-motion-saved]").length;
  box.remove();
  return out;
};

const cardInfo = () => {
  const dialog = document.querySelector('[role="dialog"]:not([data-motion-ghost])');
  if (!dialog) return null;
  const card = [...dialog.children].find((child) => /rounded-/.test(child.className) && !/\babsolute\b/.test(child.className)) || dialog;
  const rect = card.getBoundingClientRect();
  return { top: Math.round(rect.top), left: rect.left, width: rect.width, translate: card.style.translate, handle: getComputedStyle(card).backgroundImage.startsWith("url(") };
};

(async () => {
  const executablePath = process.env.MEASURE_CHROMIUM || (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
  const browser = await chromium.launch(executablePath ? { executablePath, args: ["--headless=new", "--no-sandbox"] } : {});

  // ───────── Desktop ─────────
  {
    const { ctx, page } = await open(browser);
    for (const url of ["/ideas", "/batches", "/batches?status=finished", "/settings/print-agent/labels"]) await go(page, url, 1000);
    await go(page, "/settings/organization", 4000);
    const synthetic = await page.evaluate(SYNTHETIC);
    record("AC1.enter-after-placeholder", synthetic.enter.length === 3 && synthetic.enter.every((item) => item && item.duration <= 350) && synthetic.enter.map((item) => item.delay).join() === "0,45,90" && synthetic.enter[0].keys.join() === "opacity,translate" && synthetic.enter[2].keys.join() === "opacity" && synthetic.withoutPlaceholder === 0, { enter: synthetic.enter, withoutPlaceholder: synthetic.withoutPlaceholder });
    record("AC2.new-row", synthetic.newRow.marked && synthetic.newRow.row === "motion-row-in" && synthetic.newRow.cell === "motion-row-new" && synthetic.firstRowMarked && synthetic.listItemMarked && synthetic.markCleared, { newRow: synthetic.newRow, firstRow: synthetic.firstRowMarked, listItem: synthetic.listItemMarked, cleared: synthetic.markCleared });
    record("AC2.not-on-bulk-or-reorder", synthetic.bulkMarked === 0 && synthetic.movedMarked === false, { bulkMarked: synthetic.bulkMarked, movedMarked: synthetic.movedMarked });
    record("AC3.saved-mark", synthetic.saved && synthetic.saved.insideCell && synthetic.saved.animation === "motion-saved" && synthetic.savedGone && synthetic.replyUntouched, { saved: synthetic.saved, gone: synthetic.savedGone, replyUntouched: synthetic.replyUntouched });
    record("AC3.silent-otherwise", synthetic.savedAfterFailure === 0 && synthetic.savedAfterGet === 0 && synthetic.savedWithoutCell === 0, { afterFailure: synthetic.savedAfterFailure, afterGet: synthetic.savedAfterGet, withoutCell: synthetic.savedWithoutCell });

    // AC4: a hand-built window plays out.
    await page.locator('button:has-text("Завершить")').first().click();
    await page.waitForSelector('[role="dialog"]'); await page.waitForTimeout(700);
    await page.locator('[role="dialog"] input:visible').first().fill("Проверка копии");
    await page.evaluate(() => {
      window.__ghost = []; const t0 = performance.now();
      const tick = () => {
        const ghost = document.querySelector("[data-motion-ghost]");
        const real = document.querySelectorAll('[role="dialog"]:not([data-motion-ghost])').length;
        if (ghost) {
          const card = [...ghost.children].find((child) => /rounded-/.test(child.className) && !/\babsolute\b/.test(child.className)) || ghost;
          const cs = getComputedStyle(card);
          window.__ghost.push({ t: Math.round(performance.now() - t0), real, opacity: Number(cs.opacity), scale: parseFloat(cs.scale) || 1, backdrop: Number(getComputedStyle(ghost).opacity), pointer: cs.pointerEvents, inert: ghost.hasAttribute("inert"), hidden: ghost.getAttribute("aria-hidden"), ids: ghost.querySelectorAll("[id], [name]").length, own: cs.animationName, value: ghost.querySelector("input") ? ghost.querySelector("input").value : null });
        } else if (window.__ghost.length && !window.__ghost[window.__ghost.length - 1].gone) window.__ghost.push({ t: Math.round(performance.now() - t0), gone: true });
        if (performance.now() - t0 < 3000) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.locator('[role="dialog"] button[aria-label*="акрыть"], [role="dialog"] button:has(> svg.lucide-x)').first().click();
    await page.waitForTimeout(90);
    await shot(page, "window-playing-out");
    await page.waitForTimeout(1300);
    const ghost = await page.evaluate(() => window.__ghost);
    const frames = ghost.filter((frame) => !frame.gone);
    const gone = ghost.find((frame) => frame.gone);
    const first = frames[0]; const last = frames[frames.length - 1];
    const leftovers = await page.evaluate(() => document.querySelectorAll("[data-motion-ghost]").length);
    record("AC4.window-plays-out", frames.length >= 2 && first.real === 0 && last.opacity < first.opacity && last.scale <= first.scale && gone && gone.t - first.t <= 400 && leftovers === 0, { frames: frames.length, first: { opacity: first && first.opacity, scale: first && first.scale }, last: { opacity: last && last.opacity, scale: last && last.scale, backdrop: last && last.backdrop }, livedMs: gone && first ? gone.t - first.t : null, leftovers });
    record("AC4.copy-is-inert", first && first.pointer === "none" && first.inert && first.hidden === "true" && first.ids === 0 && first.own === "none" && first.value === "Проверка копии", first);

    // AC6: segments flow (client state, link filter).
    const flight = async (url, selector, name) => {
      await go(page, url, 3000);
      const target = page.locator(selector).first();
      const look = await target.evaluate((el) => { const track = el.parentElement; const chosen = track.querySelector('[aria-selected="true"], [aria-current], [aria-checked="true"]'); return { track: getComputedStyle(track).backgroundColor, chosen: chosen ? getComputedStyle(chosen).backgroundColor : null, idle: getComputedStyle(el).backgroundColor, idleBorder: getComputedStyle(el).borderTopWidth }; });
      await page.evaluate(() => { window.__seen = []; const t0 = performance.now(); const tick = () => { const host = document.querySelector("[data-liquid-host]"); if (host) { const cs = getComputedStyle(host, "::" + host.getAttribute("data-liquid-host")); window.__seen.push({ l: parseFloat(cs.left), r: parseFloat(cs.right), bg: cs.backgroundColor }); } if (performance.now() - t0 < 7000) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
      await target.click();
      try { await page.waitForSelector("[data-liquid-host]", { timeout: 6000, state: "attached" }); await page.waitForTimeout(70); await shot(page, name); } catch {}
      await page.waitForTimeout(1300);
      const seen = await page.evaluate(() => window.__seen);
      return { look, frames: seen.length, moved: seen.length ? Math.round(Math.abs(seen[seen.length - 1].l - seen[0].l)) : 0, minInset: seen.length ? Math.min(...seen.flatMap((frame) => [frame.l, frame.r])) : null, shape: seen.length ? seen[0].bg : null, left: await page.evaluate(() => document.querySelectorAll("[data-liquid-host]").length) };
    };
    const ideas = await flight("/ideas", '[role="tab"]:has-text("Новые")', "segments-ideas");
    record("AC6.segments.ideas", ideas.frames > 5 && ideas.moved > 20 && ideas.minInset >= 0 && ideas.left === 0 && ideas.look.idle === "rgba(0, 0, 0, 0)" && ideas.look.idleBorder === "0px" && ideas.look.chosen === "rgb(255, 255, 255)", ideas);
    const batches = await flight("/batches", 'main a:has-text("Готово")', "segments-batches");
    record("AC6.segments.batches-links", batches.frames > 5 && batches.moved > 20 && batches.left === 0 && page.url().includes("status="), { ...batches, url: page.url().replace(BASE, "") });
    const labels = await flight("/settings/print-agent/labels", '[data-label-log-filters] a:has-text("30 дней")', "segments-labels");
    record("AC6.segments.labels", labels.frames > 5 && labels.moved > 20 && labels.left === 0, labels);

    // AC7: empty journal table.
    if (process.env.DOC_URL) {
      await go(page, process.env.DOC_URL, 5000);
      const empty = await page.evaluate(() => { const el = [...document.querySelectorAll("[data-journal-empty]")].find((node) => node.offsetParent); if (!el) return null; const icon = el.querySelector("svg"); return { text: el.textContent.trim(), icon: Boolean(icon), iconPrintHidden: icon ? icon.classList.contains("print:hidden") : null, inCell: Boolean(el.closest("td")), dashed: getComputedStyle(el).borderStyle }; });
      await shot(page, "empty-table");
      record("AC7.empty.table", empty && empty.icon && empty.iconPrintHidden && empty.inCell && empty.text.length > 3, empty);
    }
    record("errors.desktop", page.__errors.length === 0, page.__errors.slice(0, 3));
    await ctx.close();
  }

  // ───────── Dark: the chosen segment is lighter than the track ─────────
  {
    const { ctx, page } = await open(browser, { dark: true });
    await go(page, "/ideas", 3500);
    const look = await page.evaluate(() => { const chosen = document.querySelector('[role="tab"][aria-selected="true"]'); return { theme: document.querySelector(".app-shell").getAttribute("data-app-theme"), track: getComputedStyle(chosen.parentElement).backgroundColor, chosen: getComputedStyle(chosen).backgroundColor }; });
    await shot(page, "segments-dark");
    record("AC6.segments.dark", look.theme === "dark" && /0\.14\)$/.test(look.chosen) && /0\.06\)$/.test(look.track), look);
    await ctx.close();
  }

  // ───────── Phone ─────────
  {
    const { ctx, page } = await open(browser, { mobile: true });
    await go(page, "/settings/organization", 4000);
    await page.locator('button:has-text("Завершить")').first().click();
    await page.waitForSelector('[role="dialog"]'); await page.waitForTimeout(900);
    const sheet = await page.evaluate(cardInfo);
    const cdp = await ctx.newCDPSession(page);
    const x = sheet.left + sheet.width / 2; const y0 = sheet.top + 20;
    const touch = (type, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
    await touch("touchStart", y0);
    for (const dy of [10, 25, 40, 55]) { await touch("touchMove", y0 + dy); await page.waitForTimeout(16); }
    const pulled = await page.evaluate(cardInfo);
    await shot(page, "sheet-pulled");
    await touch("touchEnd");
    await page.waitForTimeout(700);
    const back = await page.evaluate(cardInfo);
    record("AC5.short-pull-springs-back", sheet.handle && pulled.translate === "0px 55px" && pulled.top === sheet.top + 55 && back && back.top === sheet.top && back.translate === "", { sheetTop: sheet.top, handle: sheet.handle, pulled, back });
    // Below the grab zone the sheet does not move.
    await touch("touchStart", sheet.top + 200);
    for (const dy of [30, 60]) { await touch("touchMove", sheet.top + 200 + dy); await page.waitForTimeout(16); }
    const low = await page.evaluate(cardInfo);
    await touch("touchEnd"); await page.waitForTimeout(300);
    record("AC5.only-the-top-zone", low && low.translate === "", low);
    await touch("touchStart", y0);
    for (const dy of [20, 50, 80, 110, 140]) { await touch("touchMove", y0 + dy); await page.waitForTimeout(16); }
    await touch("touchEnd");
    await page.waitForTimeout(50);
    const during = await page.evaluate(() => ({ real: document.querySelectorAll('[role="dialog"]:not([data-motion-ghost])').length, ghost: document.querySelectorAll("[data-motion-ghost]").length }));
    await page.waitForTimeout(900);
    const after = await page.evaluate(() => ({ real: document.querySelectorAll('[role="dialog"]:not([data-motion-ghost])').length, ghost: document.querySelectorAll("[data-motion-ghost]").length }));
    record("AC5.long-pull-closes", during.real === 0 && during.ghost === 1 && after.real === 0 && after.ghost === 0, { during, after });
    // AC7: the cards view of an empty journal.
    if (process.env.DOC_URL) {
      await go(page, process.env.DOC_URL, 5000);
      const empty = await page.evaluate(() => { const el = [...document.querySelectorAll("[data-journal-empty]")].find((node) => node.offsetParent && !node.closest("td")); if (!el) return null; const cs = getComputedStyle(el); return { text: el.textContent.trim(), icon: Boolean(el.querySelector("svg")), border: cs.borderTopStyle + " " + cs.borderTopWidth, background: cs.backgroundColor }; });
      await shot(page, "empty-cards");
      record("AC7.empty.cards", empty && empty.icon && !empty.border.startsWith("dashed") && empty.background !== "rgba(0, 0, 0, 0)", empty);
    }
    record("errors.phone", page.__errors.length === 0, page.__errors.slice(0, 3));
    await ctx.close();
  }

  // ───────── «Без анимации» ─────────
  {
    const { ctx, page } = await open(browser, { still: true });
    await go(page, "/settings/organization", 4000);
    const still = await page.evaluate(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const box = document.createElement("div"); document.querySelector("main").prepend(box);
      box.innerHTML = '<div id="ph"><div class="skeleton-shimmer" style="height:40px"></div></div><table><tbody><tr><td>a</td></tr><tr><td>b</td></tr></tbody></table>';
      await wait(100);
      const content = document.createElement("div"); content.innerHTML = "<section>one</section><section>two</section>"; box.querySelector("#ph").remove(); box.appendChild(content); await wait(40);
      const row = document.createElement("tr"); row.innerHTML = "<td>new</td>"; box.querySelector("tbody").appendChild(row); await wait(40);
      const cell = box.querySelector("td"); cell.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      await fetch("/api/journal-documents/__probe-ok", { method: "PATCH", body: "{}" }); await wait(150);
      const mark = document.querySelector("[data-motion-saved]");
      const out = { flag: document.documentElement.hasAttribute("data-view-still"), entered: [...content.children].reduce((n, child) => n + child.getAnimations().length, 0), rowMarked: row.hasAttribute("data-row-new"), savedShown: Boolean(mark), savedAnimation: mark ? getComputedStyle(mark).animationName : null, savedOpacity: mark ? getComputedStyle(mark).opacity : null };
      box.remove();
      return out;
    });
    await page.locator('button:has-text("Завершить")').first().click();
    await page.waitForSelector('[role="dialog"]'); await page.waitForTimeout(500);
    await page.evaluate(() => { window.__ghosts = 0; new MutationObserver(() => { window.__ghosts += document.querySelectorAll("[data-motion-ghost]").length; }).observe(document.body, { childList: true, subtree: true }); });
    await page.locator('[role="dialog"] button[aria-label*="акрыть"], [role="dialog"] button:has(> svg.lucide-x)').first().click();
    await page.waitForTimeout(500);
    const ghosts = await page.evaluate(() => window.__ghosts);
    record("AC9.still", still.flag && still.entered === 0 && !still.rowMarked && still.savedShown && still.savedAnimation === "none" && still.savedOpacity === "1" && ghosts === 0, { ...still, ghostsSeen: ghosts });
    await ctx.close();
  }

  await browser.close();
  const failed = results.filter((result) => !result.ok);
  fs.writeFileSync(OUT, JSON.stringify({ base: BASE, at: new Date().toISOString(), passed: results.length - failed.length, failed: failed.length, results }, null, 1));
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed → ${OUT}`);
  process.exit(failed.length ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(2); });
