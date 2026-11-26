// Verifier round 3 (independent probe): AC8 object card on /settings/buildings.
// Own names (none of the round-2 list), own device profiles (Android/iPhone-UA phones, landscape phones,
// tablet, emulated 125–150 % page zoom = narrower CSS viewports, desktop) and own master simulation
// (origin/master dd898d487 header markup rebuilt next to the hidden React nodes, same page, same CSS).
// Per card and profile:
//   cut words (ranges across ALL text nodes of the h2) — branch vs master-sim;
//   pin on the line of the last character, and if not, whether «last word + pin» really is wider
//   than the line (the only case the spec allows);
//   icon alone on the first line (branch vs master-sim, informational);
//   overflow past the card content box / the page;
//   visible pins and pins in the accessibility tree (getByRole) = 1, heading accessible name = the name;
//   phones: the pin's real hit zone (elementFromPoint scan) ≈ 48×48 and whether it covers another control;
//   ≥640 px: reading order name → sphere → pin, same as master-sim.
// Own test points, deleted at the end; owner's pinned list restored.
// Usage (env loaded, next dev on :3000): node ac8-layout.mjs <outdir>
import fs from "node:fs";
import { BASE, chromium, devices, db, ownerState, acceptLegal } from "./lib3.mjs";

const OUT = process.argv[2] ?? "out";
fs.mkdirSync(`${OUT}/screens`, { recursive: true });
const dev = (name) => {
  const { defaultBrowserType, ...rest } = devices[name];
  return rest;
};
const PROFILES = [
  { id: "zoom150-pixel7-275", opts: { viewport: { width: 275, height: 560 }, deviceScaleFactor: 3.9375, isMobile: true, hasTouch: true } },
  { id: "fold-cover-280", opts: { viewport: { width: 280, height: 653 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
  { id: "zoom125-360-288", opts: { viewport: { width: 288, height: 624 }, deviceScaleFactor: 3.75, isMobile: true, hasTouch: true } },
  { id: "galaxy-s9p-320", opts: dev("Galaxy S9+") },
  { id: "galaxy-s24-360", opts: dev("Galaxy S24") },
  { id: "pixel5-393", opts: dev("Pixel 5") },
  { id: "pixel7-412", opts: dev("Pixel 7") },
  { id: "galaxy-a55-480", opts: dev("Galaxy A55") },
  { id: "iphone-se-landscape-568", opts: dev("iPhone SE landscape") },
  { id: "nexus7-600", opts: dev("Nexus 7") },
  { id: "w630", opts: { viewport: { width: 630, height: 900 } } },
  { id: "s9p-landscape-658", opts: dev("Galaxy S9+ landscape") },
  { id: "s8-landscape-740", opts: dev("Galaxy S8 landscape") },
  { id: "w1024", opts: { viewport: { width: 1024, height: 800 } } },
  { id: "w1280", opts: { viewport: { width: 1280, height: 900 } } },
];
const ONLY = process.env.V3_PROFILES ? new Set(process.env.V3_PROFILES.split(",")) : null;
const STAMP = new Date().toISOString().slice(11, 19);
const NAMES = [
  "Кафе «Сладкоежка»",
  "Кулинария «Вкусноежка»",
  "Цех полуфабрикатов",
  "Склад-овощехранилище",
  "Цех мясоперерабатывающий",
  "Завод рыбоперерабатывающий",
  "Комбинат сельскохозяйственный",
  "Кафе-кондитерская",
  "Пиццерия «Додо» (ТЦ Мега)",
  "Ресторан «Белуга» 2",
  "Столовая №1",
  "Детский сад №125 «Солнышко»",
  "Буфет — школьный",
  "Кофейня Coffee&Breakfast",
  "Oshxona «Toshkent»",
  "Choyxona",
  "Кондитерская",
  "Пищекомбинат",
  "Овощехранилище",
  "Мясоперерабатывающий",
  "Ресторан высокой кухни «Восточный экспресс»",
  "Цех  кондитерский",
  "ООО «Продторг»",
  "Кафе «Шоколадница»",
  "Муниципальное бюджетное общеобразовательное учреждение общеобразовательная школа №15 имени Героя Советского Союза",
  "МБОУ СОШ №15 «Общеобразовательная»",
  "Пекарня 🥐🥖",
  "Склад (холодильная камера)",
  "Цех №2 (кондитерский)",
  "Кафе им. А. С. Пушкина.",
  "Столовая «Березка» корпус Б",
];
const SHOT_NAMES = new Set(["Кондитерская", "Цех мясоперерабатывающий", "ООО «Продторг»", "Кафе «Шоколадница»", "Склад-овощехранилище", "Кулинария «Вкусноежка»", "Мясоперерабатывающий"]);

// ---------- in-page code ----------
function inPage({ id, name, mode, phone }) {
  const card = document.querySelector(`[data-building-card="${id}"]`);
  if (!card) return { error: "card not found" };
  const title = card.querySelector("[data-building-title]");
  const row = (title ?? card.querySelector("h2")).parentElement;
  if (mode === "master" && !row.hasAttribute("data-v3-master")) {
    // origin/master dd898d487: <svg size-4 text-[#5566f6]/> <h2 …>{name}</h2> <chip … max-sm:order-last> <PinButton/>
    const svg = row.querySelector("svg");
    const chip = row.querySelector(":scope > [data-building-sphere], :scope > [data-building-office]");
    const desktopPin = [...row.querySelectorAll("[data-pin-building]")].find((b) => b.classList.contains("max-sm:hidden"));
    const sSvg = svg.cloneNode(true);
    for (const c of ["shrink-0", "max-sm:mr-2", "max-sm:inline-block", "max-sm:align-[-0.125em]"]) sSvg.classList.remove(c);
    const sH2 = document.createElement("h2");
    sH2.className = "min-w-0 break-words text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]";
    sH2.textContent = name;
    const sChip = chip.cloneNode(true);
    if (sChip.hasAttribute("data-building-sphere")) sChip.classList.add("max-sm:order-last");
    const sPin = desktopPin ? desktopPin.cloneNode(true) : null;
    if (sPin) sPin.classList.remove("max-sm:hidden", "sm:order-last");
    const sims = [sSvg, sH2, sChip, ...(sPin ? [sPin] : [])];
    for (const el of sims) el.setAttribute("data-v3-sim", "");
    for (const el of row.children) el.style.display = "none";
    row.append(...sims);
    row.setAttribute("data-v3-master", "");
  }
  const sim = mode === "master";
  const pick = (sel) => [...row.querySelectorAll(sel)].filter((el) => sim === el.hasAttribute("data-v3-sim") || (sim && el.closest("[data-v3-sim]")));
  const h2 = sim ? row.querySelector("h2[data-v3-sim]") : title.querySelector("h2");
  const icon = sim ? row.querySelector("svg[data-v3-sim]") : title.querySelector(":scope > svg");
  const chip = sim ? row.querySelector("[data-v3-sim][data-building-sphere], [data-v3-sim][data-building-office]") : row.querySelector(":scope > [data-building-sphere], :scope > [data-building-office]");
  const allPins = sim ? pick("[data-pin-building]") : [...row.querySelectorAll("[data-pin-building]")].filter((p) => !p.hasAttribute("data-v3-sim"));
  const visiblePins = allPins.filter((p) => getComputedStyle(p).display !== "none" && getComputedStyle(p).visibility !== "hidden" && p.getBoundingClientRect().width > 0);
  const pin = visiblePins[0] ?? null;
  const R = (r) => r && { l: +r.left.toFixed(1), r: +r.right.toFixed(1), t: +r.top.toFixed(1), b: +r.bottom.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };

  // Text nodes of the heading → logical string positions.
  const walker = document.createTreeWalker(h2, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let text = "";
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push({ node: n, start: text.length });
    text += n.textContent;
  }
  const locate = (pos, isEnd) => {
    for (const { node, start } of nodes) {
      const len = node.textContent.length;
      if (!isEnd && pos >= start && pos < start + len) return [node, pos - start];
      if (isEnd && pos > start && pos <= start + len) return [node, pos - start];
    }
    return null;
  };
  const rangeRects = (from, to) => {
    const a = locate(from, false);
    const b = locate(to, true);
    if (!a || !b) return [];
    const range = document.createRange();
    range.setStart(a[0], a[1]);
    range.setEnd(b[0], b[1]);
    return [...range.getClientRects()].filter((r) => r.width > 0.1 && r.height > 0.1);
  };
  const distinctLines = (rects) => {
    const mids = [];
    for (const r of rects) {
      const m = (r.top + r.bottom) / 2;
      if (!mids.some((x) => Math.abs(x - m) < 6)) mids.push(m);
    }
    return mids.length;
  };
  const words = [];
  for (const m of text.matchAll(/\S+/g)) {
    const rects = rangeRects(m.index, m.index + m[0].length);
    words.push({ word: m[0], lines: distinctLines(rects), right: rects.length ? Math.max(...rects.map((r) => r.right)) : null });
  }
  const trimmed = text.replace(/\s+$/u, "");
  const graphemes = [...new Intl.Segmenter("ru", { granularity: "grapheme" }).segment(trimmed)];
  const lastG = graphemes[graphemes.length - 1];
  const lcRects = lastG ? rangeRects(lastG.index, trimmed.length) : [];
  const lastChar = lcRects[lcRects.length - 1] ?? null;
  const firstRects = rangeRects(text.search(/\S/u), text.search(/\S/u) + 1);
  const firstChar = firstRects[0] ?? null;

  // Natural width of the last word (what the inline-block holds: after the last space / NBSP / tab / newline).
  const cut = Math.max(trimmed.lastIndexOf(" "), trimmed.lastIndexOf(" "), trimmed.lastIndexOf("\t"), trimmed.lastIndexOf("\n"));
  const lastWord = trimmed.slice(cut + 1);
  const cs = getComputedStyle(h2);
  const probe = document.createElement("span");
  probe.textContent = lastWord;
  Object.assign(probe.style, { position: "absolute", visibility: "hidden", whiteSpace: "nowrap", left: "0", top: "0", font: cs.font, letterSpacing: cs.letterSpacing, fontKerning: cs.fontKerning, fontFeatureSettings: cs.fontFeatureSettings });
  document.body.append(probe);
  const lastWordWidth = probe.getBoundingClientRect().width;
  const seg = lastWord.split(/(?<=[-\u2010\u2013\u2014])/u).pop();
  probe.textContent = seg;
  const lastSegmentWidth = probe.getBoundingClientRect().width;
  probe.remove();

  const pr = pin?.getBoundingClientRect() ?? null;
  const pinOuter = pr ? pr.width + parseFloat(getComputedStyle(pin).marginLeft) + parseFloat(getComputedStyle(pin).marginRight) : null;
  const lineWidth = sim ? row.getBoundingClientRect().width : title.getBoundingClientRect().width;
  const sameLine = (a, b) => a && b && Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) < 10;
  const pinWithLastChar = pr && lastChar ? sameLine(pr, lastChar) : null;
  const ir = icon?.getBoundingClientRect() ?? null;
  const iconAlone = ir && firstChar ? firstChar.top >= ir.bottom - 1 : null;
  const cr = chip?.getBoundingClientRect() ?? null;
  const textRects = nodes.flatMap(({ node }) => {
    const r = document.createRange();
    r.selectNodeContents(node);
    return [...r.getClientRects()].filter((x) => x.width > 0.1);
  });
  const nameBottom = textRects.length ? Math.max(...textRects.map((r) => r.bottom)) : null;
  const nameTop = textRects.length ? Math.min(...textRects.map((r) => r.top)) : null;
  const cardRect = card.getBoundingClientRect();
  const ccs = getComputedStyle(card);
  const contentRight = cardRect.right - parseFloat(ccs.paddingRight) - parseFloat(ccs.borderRightWidth);
  const contentLeft = cardRect.left + parseFloat(ccs.paddingLeft) + parseFloat(ccs.borderLeftWidth);
  const rights = [...textRects.map((r) => r.right), pr?.right ?? -1, cr?.right ?? -1, ir?.right ?? -1];
  const lefts = [...textRects.map((r) => r.left), pr?.left ?? 1e9, cr?.left ?? 1e9, ir?.left ?? 1e9];
  const res = {
    mode,
    lineWidth: +lineWidth.toFixed(1),
    words: words.map((w) => `${w.word}:${w.lines}`),
    cutWords: words.filter((w) => w.lines > 1).map((w) => w.word),
    lines: distinctLines(textRects),
    lastWord,
    lastWordWidth: +lastWordWidth.toFixed(1),
    lastSegment: seg,
    lastSegmentWidth: +lastSegmentWidth.toFixed(1),
    pinOuter: pinOuter && +pinOuter.toFixed(1),
    pinCount: visiblePins.length,
    pinInH2: pin ? h2.contains(pin) : null,
    pinWithLastChar,
    iconAlone,
    pin: R(pr),
    lastChar: R(lastChar),
    chip: R(cr),
    chipBelowName: cr && nameBottom !== null ? cr.top >= nameBottom - 2 : null,
    nameTop,
    overflowRight: +(Math.max(...rights) - contentRight).toFixed(1),
    overflowLeft: +(contentLeft - Math.min(...lefts)).toFixed(1),
    cardOverflow: card.scrollWidth > card.clientWidth + 1,
    docOverflow: document.documentElement.scrollWidth > window.innerWidth + 0.5,
    ariaLabel: h2.getAttribute("aria-label"),
  };
  if (!sim && pr && phone) {
    // Real hit zone: scan through the pin centre horizontally and vertically, and the zone corners.
    const cx = pr.left + pr.width / 2;
    const cy = pr.top + pr.height / 2;
    const hit = (x, y) => document.elementFromPoint(x, y)?.closest("[data-pin-building]") === pin;
    let left = 0, right = 0, up = 0, down = 0;
    while (left < 40 && hit(cx - left - 1, cy)) left++;
    while (right < 40 && hit(cx + right + 1, cy)) right++;
    while (up < 40 && hit(cx, cy - up - 1)) up++;
    while (down < 40 && hit(cx, cy + down + 1)) down++;
    const zw = left + right + 1;
    const zh = up + down + 1;
    const corners = [[-23.5, -23.5], [23.5, -23.5], [-23.5, 23.5], [23.5, 23.5]].map(([dx, dy]) => hit(cx + dx, cy + dy));
    const outside = [[-25.5, 0], [25.5, 0], [0, -25.5], [0, 25.5]].map(([dx, dy]) => hit(cx + dx, cy + dy));
    const before = getComputedStyle(pin, "::before");
    // Other controls whose box intersects the 48×48 zone (expanded pin box), anywhere on the page.
    const zone = { l: pr.left - 10, r: pr.right + 10, t: pr.top - 10, b: pr.bottom + 10 };
    const overlaps = [];
    for (const el of document.querySelectorAll("a[href], button, input, select, textarea, [role=button], [role=link], [tabindex]:not([tabindex='-1'])")) {
      if (el === pin || pin.contains(el) || el.contains(pin)) continue;
      const st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const ix = Math.min(r.right, zone.r) - Math.max(r.left, zone.l);
      const iy = Math.min(r.bottom, zone.b) - Math.max(r.top, zone.t);
      if (ix > 0 && iy > 0) overlaps.push({ tag: el.tagName.toLowerCase(), label: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40), ix: +ix.toFixed(1), iy: +iy.toFixed(1) });
    }
    // Do the card's own controls still get their taps at their edge nearest to the pin?
    const ctrls = [...card.querySelectorAll("button:not([data-pin-building]), a[href]")].filter((el) => getComputedStyle(el).display !== "none" && el.getBoundingClientRect().width > 0);
    const stolen = [];
    for (const el of ctrls) {
      const r = el.getBoundingClientRect();
      for (const [x, y] of [[r.left + 1, r.top + 1], [r.left + 1, r.bottom - 1], [r.left + r.width / 2, r.top + r.height / 2]]) {
        if (y < 0 || y > innerHeight) continue;
        const at = document.elementFromPoint(x, y);
        if (at && at.closest("[data-pin-building]") === pin) stolen.push((el.getAttribute("aria-label") ?? el.textContent).trim().slice(0, 30));
      }
    }
    res.hitZone = { w: zw, h: zh, left, right, up, down, corners, outside, before: { position: before.position, content: before.content, top: before.top, left: before.left, right: before.right, bottom: before.bottom }, overlaps, stolen };
  }
  return res;
}

// ---------- driver ----------
// Screenshot box: the card's header (from 24 px above the h2), full card width, 150 px tall, inside the viewport.
async function shotBox(loc, sim = false) {
  const card = await loc.boundingBox();
  const h2 = await loc.locator(sim ? "h2[data-v3-sim]" : "h2").first().boundingBox();
  if (!card || !h2) return null;
  const vp = loc.page().viewportSize();
  const x = Math.max(0, card.x);
  const y = Math.max(0, h2.y - 24);
  const box = { x, y, width: Math.min(vp.width - x, card.width), height: Math.min(150, vp.height - y) };
  if (box.width <= 0 || box.height <= 0) {
    console.log("shotBox anomaly", JSON.stringify({ card, h2, vp, scrollY: await loc.page().evaluate(() => scrollY) }));
    return null;
  }
  return box;
}
const { client, q } = await db();
const ADMIN = (await q(`select id, "organizationId", "pinnedBuildingIds" from "User" where email='admin@haccp.local'`))[0];
const browser = await chromium.launch();
const state = await ownerState(browser);
const api = await browser.newContext({ storageState: state });
const made = [];
const summary = { regressions: [], improvementsVsMaster: [], bothCut: [], pinAloneJustified: [], pinAloneUnjustified: [], pinNotInH2: [], pinCountNot1: [], a11yPinCountNot1: [], headingName: [], overflow: [], orderDiff: [], iconAloneBranchOnly: [], iconAloneMasterOnly: [], hitZone: [], hitZoneOverlaps: [], chipNotBelowMultiline: [], desktopPinInH2: [], misc: [] };
const lines = [];
try {
  for (const name of NAMES) {
    const res = await api.request.post(`${BASE}/api/settings/buildings`, { data: { name, sphere: "food" } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok() || !body.building?.id) { summary.misc.push(`create failed ${JSON.stringify(name)}: ${res.status()} ${JSON.stringify(body).slice(0, 200)}`); continue; }
    made.push({ id: body.building.id, name: body.building.name, own: true });
    if (body.building.name !== name) summary.misc.push(`API changed name ${JSON.stringify(name)} → ${JSON.stringify(body.building.name)}`);
  }
  const real = await q(`select id, name, kind from "Building" where "organizationId"=$1 and not (id = any($2)) order by "createdAt"`, [ADMIN.organizationId, made.map((m) => m.id)]);
  const cards = [...made, ...real.map((r) => ({ id: r.id, name: r.name, own: false, kind: r.kind }))];
  console.log(`cards: ${cards.length} (own ${made.length})`);
  for (const profile of PROFILES) {
    if (ONLY && !ONLY.has(profile.id)) continue;
    const width = profile.opts.viewport.width;
    const phone = width < 640;
    const ctx = await browser.newContext({ ...profile.opts, storageState: state, locale: "ru-RU" });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/settings/buildings`, { waitUntil: "networkidle", timeout: 240000 });
    await acceptLegal(page);
    await page.locator("[data-building-card]").first().waitFor({ timeout: 120000 });
    const onPage = new Set(await page.$$eval("[data-building-card]", (els) => els.map((e) => e.getAttribute("data-building-card"))));
    const branch = {};
    const a11y = {};
    for (const c of cards) {
      if (!onPage.has(c.id)) { summary.misc.push(`${profile.id}: not on page ${JSON.stringify(c.name)}`); continue; }
      const loc = page.locator(`[data-building-card="${c.id}"]`);
      await loc.evaluate((el) => (el.querySelector("h2") ?? el).scrollIntoView({ block: "center" }));
      await page.waitForTimeout(40);
      branch[c.id] = await page.evaluate(inPage, { id: c.id, name: c.name, mode: "branch", phone });
      a11y[c.id] = {
        pins: await loc.getByRole("button", { name: /^(Закрепить|Открепить) / }).count(),
        headings: await loc.getByRole("heading", { level: 2 }).count(),
        headingSnapshot: (await loc.getByRole("heading", { level: 2 }).first().ariaSnapshot().catch((e) => `ERR ${e.message}`)).split("\n")[0],
      };
      if (SHOT_NAMES.has(c.name) && phone) {
        const box = await shotBox(loc);
        if (box) await page.screenshot({ path: `${OUT}/screens/${profile.id}-${c.name.replace(/[^A-Za-zА-Яа-яЁё0-9]+/g, "-").slice(0, 28)}-branch.png`, clip: box });
      }
    }
    const master = {};
    for (const c of cards) {
      if (!onPage.has(c.id)) continue;
      const loc = page.locator(`[data-building-card="${c.id}"]`);
      await loc.evaluate((el) => (el.querySelector("h2") ?? el).scrollIntoView({ block: "center" }));
      master[c.id] = await page.evaluate(inPage, { id: c.id, name: c.name, mode: "master", phone });
      if (SHOT_NAMES.has(c.name) && phone) {
        const box = await shotBox(loc, true);
        if (box) await page.screenshot({ path: `${OUT}/screens/${profile.id}-${c.name.replace(/[^A-Za-zА-Яа-яЁё0-9]+/g, "-").slice(0, 28)}-master-sim.png`, clip: box });
      }
    }
    for (const c of cards) {
      const b = branch[c.id];
      const m = master[c.id];
      if (!b || !m || b.error || m.error) { if (b || m) summary.misc.push(`${profile.id}: ${c.name} error ${b?.error ?? ""} ${m?.error ?? ""}`); continue; }
      const hasPin = c.kind !== "office";
      const tag = { profile: profile.id, width, name: c.name };
      const bc = new Set(b.cutWords);
      const mc = new Set(m.cutWords);
      for (const w of bc) (mc.has(w) ? summary.bothCut : summary.regressions).push({ ...tag, word: w, lineWidth: b.lineWidth, wordWidth: b.lastWord === w ? b.lastWordWidth : undefined });
      for (const w of mc) if (!bc.has(w)) summary.improvementsVsMaster.push({ ...tag, word: w });
      if (hasPin && b.pinCount !== 1) summary.pinCountNot1.push({ ...tag, visiblePins: b.pinCount });
      if (!hasPin && b.pinCount !== 0) summary.pinCountNot1.push({ ...tag, visiblePins: b.pinCount, note: "office" });
      if (a11y[c.id].pins !== (hasPin ? 1 : 0)) summary.a11yPinCountNot1.push({ ...tag, a11yPins: a11y[c.id].pins });
      const norm = (s) => String(s).replace(/\s+/gu, " ").trim();
      const snapName = (a11y[c.id].headingSnapshot.match(/heading "(.*)" \[level=2\]/u) ?? [])[1];
      if (a11y[c.id].headings !== 1 || norm(snapName ?? "") !== norm(c.name)) summary.headingName.push({ ...tag, headings: a11y[c.id].headings, snapshot: a11y[c.id].headingSnapshot });
      if (b.overflowRight > 0.5 || b.overflowLeft > 0.5 || b.cardOverflow || b.docOverflow) summary.overflow.push({ ...tag, overflowRight: b.overflowRight, overflowLeft: b.overflowLeft, cardOverflow: b.cardOverflow, docOverflow: b.docOverflow, masterOverflowRight: m.overflowRight, masterDocOverflow: m.docOverflow });
      if (phone && hasPin) {
        if (b.pinInH2 !== true) summary.pinNotInH2.push({ ...tag, pinInH2: b.pinInH2 });
        if (b.pinWithLastChar === false) {
          // The unit that travels with the pin: the last word, or its part after the last hyphen (a break opportunity).
          const need = (b.lastSegment !== b.lastWord ? b.lastSegmentWidth : b.lastWordWidth) + b.pinOuter;
          const entry = { ...tag, lastWord: b.lastWord, lastWordWidth: b.lastWordWidth, lastSegment: b.lastSegment, lastSegmentWidth: b.lastSegmentWidth, pinOuter: b.pinOuter, lineWidth: b.lineWidth, wordPlusPin: +need.toFixed(1) };
          (need > b.lineWidth - 0.5 ? summary.pinAloneJustified : summary.pinAloneUnjustified).push(entry);
        }
        if (b.iconAlone && !m.iconAlone) summary.iconAloneBranchOnly.push({ ...tag, firstWordLine: b.lineWidth });
        if (!b.iconAlone && m.iconAlone) summary.iconAloneMasterOnly.push({ ...tag });
        if (b.lines > 1 && b.chipBelowName === false) summary.chipNotBelowMultiline.push({ ...tag, chip: b.chip });
        const hz = b.hitZone;
        if (hz) {
          const ok = hz.w >= 47 && hz.w <= 49 && hz.h >= 47 && hz.h <= 49 && hz.corners.every(Boolean) && !hz.outside.some(Boolean);
          if (!ok) summary.hitZone.push({ ...tag, hitZone: { w: hz.w, h: hz.h, corners: hz.corners, outside: hz.outside, before: hz.before } });
          if (hz.overlaps.length || hz.stolen.length) summary.hitZoneOverlaps.push({ ...tag, overlaps: hz.overlaps, stolen: hz.stolen });
        }
      }
      if (!phone && hasPin) {
        if (b.pinInH2 !== false) summary.desktopPinInH2.push({ ...tag, pinInH2: b.pinInH2 });
        const ord = (x) => [["name", { t: x.nameTop, l: x.lastChar ? 0 : 0 }], ["chip", x.chip && { t: x.chip.t, l: x.chip.l }], ["pin", x.pin && { t: x.pin.t, l: x.pin.l }]];
        const orderOf = (x) => {
          const items = [["name", x.nameTop, -1], ["chip", x.chip?.t, x.chip?.l], ["pin", x.pin?.t, x.pin?.l]].filter((i) => i[1] !== undefined && i[1] !== null);
          items.sort((p, r) => (Math.abs(p[1] - r[1]) > 14 ? p[1] - r[1] : p[2] - r[2]));
          return items.map((i) => i[0]).join("→");
        };
        void ord;
        const bo = orderOf(b);
        const mo = orderOf(m);
        if (bo !== mo || bo !== "name→chip→pin") summary.orderDiff.push({ ...tag, branch: bo, master: mo });
      }
      lines.push(`${profile.id} ${JSON.stringify(c.name)} line=${b.lineWidth} lines=${b.lines} cut=[${b.cutWords}] cutMaster=[${m.cutWords}] pins=${b.pinCount}/a11y${a11y[c.id].pins} inH2=${b.pinInH2} withLast=${b.pinWithLastChar}/master:${m.pinWithLastChar} lastWord=${JSON.stringify(b.lastWord)}:${b.lastWordWidth}+${b.pinOuter} iconAlone=${b.iconAlone}/${m.iconAlone} ovf=${b.overflowRight} doc=${b.docOverflow} chipBelow=${b.chipBelowName}${b.hitZone ? ` zone=${b.hitZone.w}x${b.hitZone.h} corners=${b.hitZone.corners.map(Number).join("")} out=${b.hitZone.outside.map(Number).join("")} ovl=${b.hitZone.overlaps.length} stolen=${b.hitZone.stolen.length}` : ""} heading=${a11y[c.id].headingSnapshot.slice(0, 80)}`);
    }
    console.log(`${profile.id}: measured ${Object.keys(branch).length} cards`);
    await ctx.close();
  }
} catch (error) {
  summary.misc.push(`script error: ${String(error?.stack ?? error).slice(0, 600)}`);
  console.log(error);
} finally {
  for (const c of made) {
    const d = await api.request.delete(`${BASE}/api/settings/buildings/${c.id}`);
    if (!d.ok()) summary.misc.push(`delete failed ${c.name}: ${d.status()}`);
  }
  await q(`update "User" set "pinnedBuildingIds"=$2 where id=$1`, [ADMIN.id, ADMIN.pinnedBuildingIds]);
  const left = await q(`select count(*)::int c from "Building" where id = any($1)`, [made.map((c) => c.id)]);
  summary.misc.push(`cleanup: own points left ${left[0].c} of ${made.length}`);
  fs.writeFileSync(`${OUT}/ac8-layout-lines.txt`, lines.join("\n") + "\n");
  const counts = Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, v.length]));
  fs.writeFileSync(`${OUT}/ac8-layout-summary.json`, JSON.stringify({ stamp: STAMP, counts, ...summary }, null, 1));
  console.log("COUNTS", JSON.stringify(counts));
  for (const k of ["regressions", "pinAloneUnjustified", "pinCountNot1", "a11yPinCountNot1", "headingName", "overflow", "orderDiff", "hitZone", "hitZoneOverlaps", "pinNotInH2", "desktopPinInH2", "chipNotBelowMultiline", "iconAloneBranchOnly", "misc"]) {
    console.log(`${k}:`, JSON.stringify(summary[k]).slice(0, 3000));
  }
  await api.close();
  await browser.close();
  await client.end();
}
