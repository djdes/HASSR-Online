// Verifier round 2 (independent): AC8 object card on /settings/buildings with the round-2 markup.
// For every test name and width: words cut mid-word (ranges across the name head text node AND the
// nowrap tail span, so a word split right before its last letter is caught), pin on the line of the
// last character, nothing past the card's right edge, no page h-scroll, one focusable pin per card,
// visual order (≥640: name → sphere → pin). The same names are also measured in a simulation of
// origin/master's markup (same page, header DOM rebuilt to master's structure and classes) to tell
// regressions from cuts master also had. Own test points, deleted at the end.
// Usage (env loaded, next dev on :3000): node ac8-names.mjs <outdir>
import fs from "node:fs";
import { BASE, chromium, db, session, acceptLegal } from "./lib.mjs";

const OUT = process.argv[2] ?? "out";
fs.mkdirSync(`${OUT}/screens`, { recursive: true });
const WIDTHS = (process.env.AC8_WIDTHS ?? "320,360,375,390,412,430,480,600,639,640,700,1024,1280").split(",").map(Number);
const STAMP = new Date().toISOString().slice(11, 19).replace(/:/g, "");
// Names: ends in a long word, a quote, a number, an emoji, a single very long word, ordinary ones.
const NAMES = [
  ["long-last", "Цех кондитерский"],
  ["long-last", "Цех заготовочный"],
  ["long-last", "Кухня центральная"],
  ["long-last", "Цех производственный"],
  ["long-last", "Склад продовольственный"],
  ["long-last", "Столовая общеобразовательная"],
  ["long-last", "Пищеблок больничный"],
  ["long-last", "Цех мясо-рыбный"],
  ["long-last", "Кафе «Шоколадница»"],
  ["long-last", "Магазин «Перекрёсток»"],
  ["long-last", "Пекарня «Хлебосольная»"],
  ["long-last", "Кафе «Кофемания»"],
  ["long-last", "Столовая «Домашняя»"],
  ["long-last", "Кафе «Теремок»"],
  ["quote", "Бар \"Север\""],
  ["quote", "Ресторан «Белый журавль»"],
  ["number", "Производственный цех №2"],
  ["number", "Цех 12"],
  ["number", "Склад 2024"],
  ["emoji", "Кафе 🍰"],
  ["emoji", "Шеф 👨‍🍳"],
  ["emoji", "Пекарня ❤️"],
  ["emoji", "Кухня 👍🏽"],
  ["emoji", "Россия 🇷🇺"],
  ["very-long-word", "Сверхдлинноеназваниеобъектабезединогопробела"],
  ["very-long-word", "Производственнокондитерский"],
  ["ordinary", "Столовая при заводе на Северной улице"],
  ["ordinary", "Кондитерский цех"],
  ["ordinary", "Центральная кухня"],
  ["ordinary", "Столовая «Берёзка»"],
  ["short", "А"],
  ["short", "Кабинет 7"],
  ["decomposed", "Цех мясной"],
];
const { client, q } = await db();
const ADMIN = (await q(`select id, "organizationId", "pinnedBuildingIds" from "User" where email='admin@haccp.local'`))[0];
const browser = await chromium.launch();
const owner = await session(browser, "admin@haccp.local", "admin1234");
const made = [];
const report = { widths: {}, regressions: [], improvements: [], bothCut: [], pinProblems: [], overflow: [], focus: [], order: [], misc: [] };

// In-page measurement of one card. mode: "branch" | "master" (header DOM rebuilt to master's markup).
function measureCard({ id, name, mode }) {
  const card = document.querySelector(`[data-building-card="${id}"]`);
  if (!card) return { error: "card not found" };
  const row = card.querySelector("[data-building-title]")?.parentElement ?? card.querySelector("h2")?.parentElement;
  if (mode === "master" && !row.dataset.simMaster) {
    // origin/master: [svg size-4][h2 name][chip max-sm:order-last][pin] in one flex-wrap row.
    const title = row.querySelector("[data-building-title]");
    const svg = title.querySelector("svg");
    const h2 = title.querySelector("h2");
    const desktopPin = [...title.querySelectorAll("[data-pin-building]")].find((b) => b.className.includes("max-sm:hidden"));
    const chip = row.querySelector("[data-building-sphere],[data-building-office]");
    const newSvg = svg.cloneNode(true);
    newSvg.setAttribute("class", (svg.getAttribute("class") ?? "").replace(/\b(shrink-0|max-sm:mr-2|max-sm:inline-block|max-sm:align-\[-0\.125em\])\b/g, "").replace(/\s+/g, " ").trim());
    const newH2 = document.createElement("h2");
    newH2.className = "min-w-0 break-words text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]";
    newH2.textContent = name;
    const newPin = desktopPin ? desktopPin.cloneNode(true) : null;
    if (newPin) newPin.className = newPin.className.replace("max-sm:hidden", "").replace("sm:order-last", "").replace(/\s+/g, " ").trim();
    const newChip = chip.cloneNode(true);
    if (newChip.hasAttribute("data-building-sphere")) newChip.classList.add("sim-order-last");
    row.replaceChildren(newSvg, newH2, newChip, ...(newPin ? [newPin] : []));
    row.dataset.simMaster = "1";
  }
  const h2 = row.querySelector("h2");
  const cardRect = card.getBoundingClientRect();
  const cs = getComputedStyle(card);
  const contentRight = cardRect.right - parseFloat(cs.paddingRight);
  // Text nodes of the heading (head + tail span); logical string → (node, offset).
  const walker = document.createTreeWalker(h2, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let text = "";
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push({ node: n, start: text.length });
    text += n.textContent;
  }
  const at = (pos, isEnd) => {
    for (const { node, start } of nodes) {
      const len = node.textContent.length;
      if (!isEnd && pos >= start && pos < start + len) return [node, pos - start];
      if (isEnd && pos > start && pos <= start + len) return [node, pos - start];
    }
    const last = nodes[nodes.length - 1];
    return [last.node, last.node.textContent.length];
  };
  const lineTops = (rects) => {
    const tops = [];
    for (const r of rects) {
      if (r.width === 0 && r.height === 0) continue;
      if (!tops.some((t) => Math.abs(t - r.top) <= 3)) tops.push(r.top);
    }
    return tops;
  };
  const words = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(text))) {
    const range = document.createRange();
    const [sn, so] = at(m.index, false);
    const [en, eo] = at(m.index + m[0].length, true);
    range.setStart(sn, so);
    range.setEnd(en, eo);
    const rects = [...range.getClientRects()];
    const tops = lineTops(rects);
    const width = rects.reduce((s, r) => s + r.width, 0);
    words.push({ word: m[0], lines: tops.length, width: Math.round(width), right: Math.round(Math.max(...rects.map((r) => r.right))) });
  }
  // Last character's rect (grapheme-agnostic: last code point) and the visible pin.
  const trimmed = text.replace(/\s+$/, "");
  const lastRange = document.createRange();
  // Last grapheme cluster (an emoji sequence or a letter + combining mark is one «character» on screen).
  const graphemes = [...new Intl.Segmenter("ru", { granularity: "grapheme" }).segment(trimmed)];
  const [ln, lo] = at(graphemes[graphemes.length - 1].index, false);
  const [le, leo] = at(trimmed.length, true);
  lastRange.setStart(ln, lo);
  lastRange.setEnd(le, leo);
  const lastRects = [...lastRange.getClientRects()].filter((r) => r.width > 0);
  const lastChar = lastRects[lastRects.length - 1] ?? null;
  const pins = [...row.querySelectorAll("[data-pin-building]")];
  const visiblePins = pins.filter((p) => getComputedStyle(p).display !== "none" && p.getBoundingClientRect().width > 0);
  const pin = visiblePins[0] ?? null;
  const pr = pin?.getBoundingClientRect() ?? null;
  const chip = row.querySelector("[data-building-sphere],[data-building-office]");
  const cr = chip?.getBoundingClientRect() ?? null;
  const hr = h2.getBoundingClientRect();
  const allRects = [...h2.getClientRects()];
  const h2Right = Math.max(hr.right, ...words.map((w) => w.right));
  // Lines of the heading: distinct tops of all text rects.
  const textLines = lineTops(nodes.flatMap(({ node }) => {
    const r = document.createRange();
    r.selectNodeContents(node);
    return [...r.getClientRects()].filter((x) => x.width > 0);
  })).sort((a, b) => a - b);
  const pinLineHasText = pr && lastChar ? lastChar.top < pr.bottom && lastChar.bottom > pr.top : null;
  return {
    text,
    nodes: nodes.length,
    words,
    cutWords: words.filter((w) => w.lines > 1).map((w) => w.word),
    lines: textLines.length,
    pinCount: visiblePins.length,
    pinInH2: pin ? h2.contains(pin) : null,
    pinWithLastChar: pinLineHasText,
    pinRect: pr && { left: Math.round(pr.left), right: Math.round(pr.right), top: Math.round(pr.top), bottom: Math.round(pr.bottom), w: Math.round(pr.width), h: Math.round(pr.height) },
    lastChar: lastChar && { left: Math.round(lastChar.left), right: Math.round(lastChar.right), top: Math.round(lastChar.top), bottom: Math.round(lastChar.bottom) },
    h2: { left: Math.round(hr.left), right: Math.round(hr.right), top: Math.round(hr.top), bottom: Math.round(hr.bottom), w: Math.round(hr.width) },
    chip: cr && { left: Math.round(cr.left), right: Math.round(cr.right), top: Math.round(cr.top), bottom: Math.round(cr.bottom) },
    rowWidth: Math.round(row.getBoundingClientRect().width),
    contentRight: Math.round(contentRight),
    overflowPx: Math.round(Math.max(h2Right, pr?.right ?? 0, cr?.right ?? 0) - contentRight),
    cardOverflow: card.scrollWidth > card.clientWidth + 1,
    docOverflow: document.documentElement.scrollWidth > window.innerWidth,
    h2AriaLabel: h2.getAttribute("aria-label"),
    lineBoxes: allRects.length,
  };
}

try {
  for (const [kind, name] of NAMES) {
    const res = await owner.request.post(`${BASE}/api/settings/buildings`, { data: { name, sphere: kind === "short" && name === "Кабинет 7" ? "medical" : "food" } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok() || !body.building?.id) { report.misc.push(`create failed for ${name}: ${res.status()}`); continue; }
    made.push({ id: body.building.id, name: body.building.name, kind, requested: name });
    if (body.building.name !== name) report.misc.push(`name normalized by API: ${JSON.stringify(name)} → ${JSON.stringify(body.building.name)}`);
  }
  // Every real card of the demo org too (seed «Кафе «Ромашка»», stand points of earlier runs).
  const real = await q(`select id, name from "Building" where "organizationId"=$1 and not (id = any($2)) order by "createdAt"`, [ADMIN.organizationId, made.map((c) => c.id)]);
  const cards = [...made, ...real.map((r) => ({ id: r.id, name: r.name, kind: "real" }))];
  const page = await owner.newPage();
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${BASE}/settings/buildings`, { waitUntil: "networkidle", timeout: 240000 });
    await acceptLegal(page);
    await page.addStyleTag({ content: "@media (width < 40rem) { .sim-order-last { order: 9999 } }" });
    await page.locator("[data-building-card]").first().waitFor({ timeout: 120000 });
    const onPage = new Set(await page.evaluate(() => [...document.querySelectorAll("[data-building-card]")].map((el) => el.getAttribute("data-building-card"))));
    for (const c of cards) if (!onPage.has(c.id) && !report.misc.includes(`not on the page: ${c.name}`)) report.misc.push(`not on the page: ${c.name}`);
    const rows = {};
    for (const mode of ["branch", "master"]) {
      for (const c of cards.filter((x) => onPage.has(x.id))) {
        const loc = page.locator(`[data-building-card="${c.id}"]`);
        await loc.evaluate((el) => el.scrollIntoView({ block: "center" }));
        await page.waitForTimeout(60);
        const r = await page.evaluate(measureCard, { id: c.id, name: c.name, mode });
        rows[`${mode}:${c.id}`] = r;
      }
      if (mode === "branch") {
        // Screenshots of a few cards (branch).
        for (const c of cards.filter((x) => ["Цех кондитерский", "Цех производственный", "Кафе «Ромашка»", "Сверхдлинноеназваниеобъектабезединогопробела", "Шеф 👨‍🍳", "Столовая при заводе на Северной улице", "Кафе «Шоколадница»", "Столовая общеобразовательная", "Цех мясно\u0438\u0306", "Пекарня ❤️", "Россия 🇷🇺", "Цех мясо-рыбный"].includes(x.name))) {
          if (![320, 360, 375, 390, 640, 1280].includes(width)) continue;
          const loc = page.locator(`[data-building-card="${c.id}"]`);
          await loc.evaluate((el) => el.scrollIntoView({ block: "center" }));
          await page.waitForTimeout(150);
          const slug = c.name.replace(/[^A-Za-zА-Яа-яЁё0-9]+/g, "-").slice(0, 24);
          const box = await loc.boundingBox();
          if (box) await page.screenshot({ path: `${OUT}/screens/ac8-${width}-${slug}-branch.png`, clip: { x: Math.max(0, box.x), y: Math.max(0, box.y), width: Math.min(width - Math.max(0, box.x), box.width), height: Math.min(box.height, 260) } });
        }
      }
    }
    // Screenshot of the same cards in the master simulation (DOM already rebuilt).
    for (const c of cards.filter((x) => ["Цех кондитерский", "Цех производственный", "Кафе «Ромашка»", "Кафе «Шоколадница»", "Столовая общеобразовательная"].includes(x.name))) {
      if (![320, 360, 375, 390].includes(width)) continue;
      const loc = page.locator(`[data-building-card="${c.id}"]`);
      await loc.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(150);
      const slug = c.name.replace(/[^A-Za-zА-Яа-яЁё0-9]+/g, "-").slice(0, 24);
      const box = await loc.boundingBox();
      if (box) await page.screenshot({ path: `${OUT}/screens/ac8-${width}-${slug}-master-sim.png`, clip: { x: Math.max(0, box.x), y: Math.max(0, box.y), width: Math.min(width - Math.max(0, box.x), box.width), height: Math.min(box.height, 260) } });
    }
    report.widths[width] = {};
    for (const c of cards.filter((x) => onPage.has(x.id))) {
      const b = rows[`branch:${c.id}`];
      const mm = rows[`master:${c.id}`];
      report.widths[width][c.name] = { branch: b, master: mm };
      const bc = new Set(b.cutWords ?? []);
      const mc = new Set(mm.cutWords ?? []);
      for (const w of bc) (mc.has(w) ? report.bothCut : report.regressions).push({ width, name: c.name, word: w, rowWidth: b.rowWidth, wordWidth: b.words.find((x) => x.word === w)?.width });
      for (const w of mc) if (!bc.has(w)) report.improvements.push({ width, name: c.name, word: w });
      if (b.pinCount !== 1) report.focus.push({ width, name: c.name, visiblePins: b.pinCount });
      if (width < 640 && (b.pinInH2 !== true || b.pinWithLastChar !== true)) report.pinProblems.push({ width, name: c.name, pinInH2: b.pinInH2, pinWithLastChar: b.pinWithLastChar, pin: b.pinRect, lastChar: b.lastChar });
      if (width >= 640 && b.pinInH2 !== false) report.pinProblems.push({ width, name: c.name, pinInH2: b.pinInH2 });
      if (b.overflowPx > 0 || b.cardOverflow || b.docOverflow) report.overflow.push({ width, name: c.name, overflowPx: b.overflowPx, cardOverflow: b.cardOverflow, docOverflow: b.docOverflow });
      if (width >= 640 && b.pinRect && b.chip) {
        // Reading order by rows, then left: name → chip → pin.
        const items = [["name", b.h2], ["chip", b.chip], ["pin", b.pinRect]].sort((x, y) => (Math.abs(x[1].top - y[1].top) > 12 ? x[1].top - y[1].top : x[1].left - y[1].left));
        const order = items.map((i) => i[0]).join("→");
        const mItems = mm.pinRect && mm.chip ? [["name", mm.h2], ["chip", mm.chip], ["pin", mm.pinRect]].sort((x, y) => (Math.abs(x[1].top - y[1].top) > 12 ? x[1].top - y[1].top : x[1].left - y[1].left)).map((i) => i[0]).join("→") : "?";
        if (order !== mItems) report.order.push({ width, name: c.name, branch: order, master: mItems });
      }
      if (width < 640 && b.chip && b.h2 && b.lines > 1 && !(b.chip.top >= b.h2.bottom - 4)) report.order.push({ width, name: c.name, note: "phone: multi-line name, chip not below the name", chip: b.chip, h2: b.h2 });
    }
    const lines = [];
    for (const c of cards.filter((x) => onPage.has(x.id))) {
      const b = rows[`branch:${c.id}`];
      const mm = rows[`master:${c.id}`];
      lines.push(`${width}px ${JSON.stringify(c.name)} row=${b.rowWidth} lines=${b.lines} cut(branch)=[${(b.cutWords ?? []).join(",")}] cut(master)=[${(mm.cutWords ?? []).join(",")}] pinInH2=${b.pinInH2} pinWithLast=${b.pinWithLastChar} pins=${b.pinCount} overflow=${b.overflowPx} aria=${JSON.stringify(b.h2AriaLabel)}`);
    }
    console.log(lines.join("\n"));
    fs.appendFileSync(`${OUT}/ac8-names.txt`, lines.join("\n") + "\n");
  }
} catch (error) {
  report.misc.push(`script error: ${String(error?.stack ?? error).slice(0, 400)}`);
  console.log(error);
} finally {
  for (const c of made) {
    const d = await owner.request.delete(`${BASE}/api/settings/buildings/${c.id}`);
    if (!d.ok()) report.misc.push(`delete failed ${c.name}: ${d.status()}`);
  }
  await q(`update "User" set "pinnedBuildingIds"=$2 where id=$1`, [ADMIN.id, ADMIN.pinnedBuildingIds]);
  const left = await q(`select count(*)::int c from "Building" where id = any($1)`, [made.map((c) => c.id)]);
  report.misc.push(`cleanup: test points left ${left[0].c} of ${made.length}`);
  fs.writeFileSync(`${OUT}/ac8-names-report.json`, JSON.stringify({ ...report, widths: undefined }, null, 2));
  fs.writeFileSync(`${OUT}/ac8-names-measurements.json`, JSON.stringify(report.widths, null, 1));
  console.log("\nREGRESSIONS (cut on branch, not in master-sim):", JSON.stringify(report.regressions, null, 0));
  console.log("IMPROVEMENTS (cut in master-sim, not on branch):", JSON.stringify(report.improvements, null, 0));
  console.log("BOTH CUT:", JSON.stringify(report.bothCut, null, 0));
  console.log("PIN PROBLEMS:", JSON.stringify(report.pinProblems, null, 0));
  console.log("OVERFLOW:", JSON.stringify(report.overflow, null, 0));
  console.log("FOCUS (visible pins != 1):", JSON.stringify(report.focus, null, 0));
  console.log("ORDER:", JSON.stringify(report.order, null, 0));
  console.log("MISC:", JSON.stringify(report.misc, null, 0));
  await browser.close();
  await client.end();
}
