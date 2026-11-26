// Verifier round 2: in-page experiment (no product code changed) — would gluing the pin to the LAST WORD
// inside an inline-block with max-width:100% avoid the mid-word cuts the round-2 markup (pin glued to the
// last character) shows for names that end in a long word? Variants rebuilt in the DOM of the real page:
//   current — the page as served (round 2 markup);
//   wordBlock — head + <span style="display:inline-block;max-width:100%">lastWord<pin/></span>;
//   wordBlockCompact — the same, pin without the 48 px touch box in layout (data-touch-compact, 28 px),
//                      hit area kept by an absolutely positioned ::after (as the repo does for checkboxes).
// Reports cut words, pin alone on a line, overflow. Own test points, deleted at the end.
// Usage (env loaded, next dev on :3000): node ac8-fix-experiment.mjs <outdir>
import fs from "node:fs";
import { BASE, chromium, session, acceptLegal } from "./lib.mjs";

const OUT = process.argv[2] ?? "out";
const NAMES = ["Цех кондитерский", "Цех производственный", "Склад продовольственный", "Столовая общеобразовательная", "Кафе «Шоколадница»", "Магазин «Перекрёсток»", "Кафе «Ромашка»", "Производственный цех №2", "Столовая при заводе на Северной улице", "Сверхдлинноеназваниеобъектабезединогопробела", "Шеф 👨‍🍳", "Цех 12"];
const browser = await chromium.launch();
const owner = await session(browser, "admin@haccp.local", "admin1234");
const made = [];
const out = [];
function variant({ id, name, mode }) {
  const card = document.querySelector(`[data-building-card="${id}"]`);
  const h2 = card.querySelector("h2");
  const pin = [...h2.querySelectorAll("[data-pin-building]")][0];
  if (mode !== "current") {
    const trimmed = name.trimEnd();
    const cut = trimmed.search(/\S+$/);
    const head = trimmed.slice(0, cut);
    const last = trimmed.slice(cut);
    const wrap = document.createElement("span");
    wrap.style.display = "inline-block";
    wrap.style.maxWidth = "100%";
    wrap.append(document.createTextNode(last), pin);
    if (mode === "wordBlockCompact") {
      pin.setAttribute("data-touch-compact", "");
      pin.style.position = "relative";
      pin.classList.add("exp-hit");
    }
    h2.replaceChildren(document.createTextNode(head), wrap);
  }
  const card2 = card.getBoundingClientRect();
  const contentRight = card2.right - parseFloat(getComputedStyle(card).paddingRight);
  const nodes = [];
  let text = "";
  const walker = document.createTreeWalker(h2, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) { nodes.push({ node: n, start: text.length }); text += n.textContent; }
  const at = (pos, isEnd) => {
    for (const { node, start } of nodes) {
      const len = node.textContent.length;
      if (!isEnd && pos >= start && pos < start + len) return [node, pos - start];
      if (isEnd && pos > start && pos <= start + len) return [node, pos - start];
    }
    const l = nodes[nodes.length - 1];
    return [l.node, l.node.textContent.length];
  };
  const cutWords = [];
  let maxRight = 0;
  const re = /\S+/g;
  let m;
  const textRects = [];
  while ((m = re.exec(text))) {
    const r = document.createRange();
    const [a, ao] = at(m.index, false);
    const [b, bo] = at(m.index + m[0].length, true);
    r.setStart(a, ao); r.setEnd(b, bo);
    const rects = [...r.getClientRects()].filter((x) => x.width > 0);
    textRects.push(...rects);
    const tops = [];
    for (const x of rects) if (!tops.some((t) => Math.abs(t - x.top) <= 3)) tops.push(x.top);
    if (tops.length > 1) cutWords.push(m[0]);
    maxRight = Math.max(maxRight, ...rects.map((x) => x.right));
  }
  const p = pin.getBoundingClientRect();
  const pinAlone = !textRects.some((x) => x.top < p.bottom && x.bottom > p.top);
  return { cutWords, pinAlone, overflow: Math.round(Math.max(maxRight, p.right) - contentRight), pinW: Math.round(p.width) };
}
try {
  for (const name of NAMES) {
    if (name === "Кафе «Ромашка»") continue;
    const res = await owner.request.post(`${BASE}/api/settings/buildings`, { data: { name, sphere: "food" } });
    const body = await res.json();
    made.push({ id: body.building.id, name });
  }
  const page = await owner.newPage();
  const seedId = await (async () => {
    await page.goto(`${BASE}/settings/buildings`, { waitUntil: "networkidle", timeout: 240000 });
    return page.evaluate(() => [...document.querySelectorAll("[data-building-card]")].find((c) => c.querySelector("h2")?.getAttribute("aria-label") === "Кафе «Ромашка»")?.getAttribute("data-building-card"));
  })();
  const cards = [...made, { id: seedId, name: "Кафе «Ромашка»" }];
  for (const width of [320, 360, 375, 390, 412, 430, 600, 639]) {
    for (const mode of ["current", "wordBlock", "wordBlockCompact"]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${BASE}/settings/buildings`, { waitUntil: "networkidle", timeout: 240000 });
      await acceptLegal(page);
      await page.addStyleTag({ content: ".exp-hit::after{content:'';position:absolute;inset:-10px}" });
      for (const c of cards) {
        await page.locator(`[data-building-card="${c.id}"]`).evaluate((el) => el.scrollIntoView({ block: "center" }));
        const r = await page.evaluate(variant, { id: c.id, name: c.name, mode });
        out.push({ width, mode, name: c.name, ...r });
      }
    }
  }
} finally {
  for (const c of made) await owner.request.delete(`${BASE}/api/settings/buildings/${c.id}`);
  const lines = [];
  for (const mode of ["current", "wordBlock", "wordBlockCompact"]) {
    const rows = out.filter((r) => r.mode === mode);
    lines.push(`== ${mode}: cut ${rows.filter((r) => r.cutWords.length).length}, pin alone ${rows.filter((r) => r.pinAlone).length}, overflow ${rows.filter((r) => r.overflow > 0).length} (of ${rows.length} card×width)`);
    for (const r of rows) if (r.cutWords.length || r.pinAlone || r.overflow > 0) lines.push(`  ${r.width}px ${JSON.stringify(r.name)} cut=[${r.cutWords.join(",")}] pinAlone=${r.pinAlone} overflow=${r.overflow} pinW=${r.pinW}`);
  }
  console.log(lines.join("\n"));
  fs.writeFileSync(`${OUT}/ac8-fix-experiment.txt`, lines.join("\n") + "\n");
  await browser.close();
}
