// Verifier (independent) AC8: object card header on «Объекты» — icon, name and pin stay on one row on
// 320–639 px (a long name wraps inside it), sphere/«Офис» after it; from 640 px the order is
// name, sphere, pin. Two own test points (long and short name) + the existing office card.
// Usage (env loaded, next dev on :3000): node ac8-card-layout.mjs <outdir>
import fs from "node:fs";
import { BASE, chromium, db, reporter, session, acceptLegal } from "./lib.mjs";

const OUT = process.argv[2] ?? "out";
fs.mkdirSync(`${OUT}/screens`, { recursive: true });
const { check, finish } = reporter(`${OUT}/ac8-results.json`);
const { client, q } = await db();
const ADMIN = (await q(`select id, "organizationId", "lastActiveBuildingId" from "User" where email='admin@haccp.local'`))[0];
const LONG = "Столовая при машиностроительном заводе на Северной промышленной улице";
const SHORT = "Кафе Ю";
// The office is not listed on «Объекты» (checked: no [data-building-office] on the page), so the
// office badge cannot be measured here; it sits in the same place as the sphere chip.
const OFFICE = null;
const browser = await chromium.launch();
const owner = await session(browser, "admin@haccp.local", "admin1234");
const made = [];
const rows = [];

async function measure(page, name) {
  const heading = page.locator("h2", { hasText: name }).first();
  await heading.waitFor({ state: "attached", timeout: 120000 });
  await heading.evaluate((h2) => h2.scrollIntoView({ block: "center" }));
  await heading.waitFor({ state: "visible", timeout: 60000 });
  await page.waitForTimeout(800);
  return heading.evaluate((h2) => {
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right) }; };
    const group = h2.closest("[data-building-title]");
    const row = group?.parentElement;
    const icon = group?.querySelector("svg");
    const pin = row?.querySelector("[data-pin-building]");
    const chip = row?.querySelector("[data-building-sphere],[data-building-office]");
    const lineHeight = parseFloat(getComputedStyle(h2).lineHeight) || 27;
    return {
      groupDisplay: group ? getComputedStyle(group).display : null,
      pinInGroup: Boolean(group && pin && group.contains(pin)),
      pinOpacity: pin ? getComputedStyle(pin).opacity : null,
      nameLines: Math.round(h2.getBoundingClientRect().height / lineHeight),
      name: r(h2), icon: r(icon), pin: r(pin), chip: r(chip),
      docW: document.documentElement.scrollWidth, vw: window.innerWidth,
    };
  });
}

// Words of every card name split across lines (mid-word breaks), in the current layout and in a
// simulation of the previous one (group dissolved on phones too: icon, name, pin, sphere as flex items).
async function brokenWords(page) {
  return page.evaluate(() => {
    const out = [];
    for (const h2 of document.querySelectorAll("[data-building-card] h2")) {
      const node = h2.firstChild;
      if (!node || node.nodeType !== 3) continue;
      const text = node.textContent;
      const re = /\S+/g; let m;
      while ((m = re.exec(text))) {
        const range = document.createRange();
        range.setStart(node, m.index); range.setEnd(node, m.index + m[0].length);
        const lines = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
        if (lines.size > 1) out.push(`${m[0]} (${h2.textContent.trim().slice(0, 28)})`);
      }
    }
    return out;
  });
}

const overlapsV = (a, b) => a && b && a.top < b.bottom && a.bottom > b.top;
const sameLine = (a, b) => a && b && Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) < 16;

try {
  for (const name of [LONG, SHORT]) {
    const res = await owner.request.post(`${BASE}/api/settings/buildings`, { data: { name, sphere: "food" } });
    const building = (await res.json().catch(() => ({}))).building;
    check(`setup: point «${name.slice(0, 24)}…»`, res.ok() && building?.id, String(res.status()));
    if (building?.id) made.push(building.id);
  }
  const page = await owner.newPage();
  for (const width of [320, 360, 375, 390, 430, 639, 640, 700, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${BASE}/settings/buildings`, { waitUntil: "networkidle", timeout: 240000 });
    await acceptLegal(page);
    for (const [label, name] of [["long", LONG], ["short", SHORT], ...(OFFICE ? [["office", OFFICE]] : [])]) {
      const m = await measure(page, name);
      rows.push({ width, label, ...m });
      const noScroll = m.docW <= m.vw;
      if (width < 640) {
        const ok = m.groupDisplay === "flex" && m.pinInGroup && overlapsV(m.pin, m.name) && m.pin.left >= m.name.right - 1 && overlapsV(m.icon, m.name) && m.icon.right <= m.name.left + 1;
        const chipBelow = m.chip ? m.chip.top >= m.name.bottom - 1 : null;
        const detail = `lines=${m.nameLines} pin@(${m.pin?.left},${m.pin?.top}) name(${m.name.left}-${m.name.right},${m.name.top}-${m.name.bottom}) chip ${chipBelow ? "below" : "same row"} noHScroll=${noScroll}`;
        check(`AC8 ${width}px ${label}: icon, name and pin on one row${label === "long" ? " (name wraps inside), sphere below" : ""}`,
          ok && noScroll && (label !== "long" || (chipBelow && m.nameLines > 1)), detail);
      } else {
        // Reading order of the row: name, chip, pin (pin last — on the same line after the chip, or on a later line).
        const pinAfterChip = m.pin && m.chip && (sameLine(m.pin, m.chip) ? m.pin.left > m.chip.right - 1 : m.pin.top > m.chip.top);
        const chipAfterName = m.chip && (sameLine(m.chip, m.name) ? m.chip.left > m.name.right - 1 : m.chip.top >= m.name.bottom - 1);
        const ok = m.groupDisplay === "contents" && pinAfterChip && chipAfterName && noScroll;
        check(`AC8 ${width}px ${label}: order name → ${label === "office" ? "«Офис»" : "sphere"} → pin, group dissolved`, ok,
          `display=${m.groupDisplay} name(${m.name.left}-${m.name.right},${m.name.top}) chip(${m.chip?.left}-${m.chip?.right},${m.chip?.top}) pin(${m.pin?.left},${m.pin?.top}) pinOpacity=${m.pinOpacity} noHScroll=${noScroll}`);
      }
      const box = await page.locator("h2", { hasText: name }).first().evaluate((h2) => {
        const header = (h2.closest("[data-building-title]")?.parentElement ?? h2).parentElement;
        const r = header.getBoundingClientRect();
        return { x: Math.max(0, r.left - 12), y: Math.max(0, r.top - 12), width: Math.min(window.innerWidth - Math.max(0, r.left - 12), r.width + 24), height: r.height + 24 };
      });
      await page.screenshot({ path: `${OUT}/screens/ac8-${label}-${width}.png`, clip: box });
    }
    if (width < 640) {
      const now = await brokenWords(page);
      await page.addStyleTag({ content: "[data-building-title]{display:contents !important}" }).then((h) => h.evaluate((el) => el.setAttribute("data-verifier-sim", "")));
      await page.waitForTimeout(300);
      const old = await brokenWords(page);
      await page.evaluate(() => document.querySelectorAll("style[data-verifier-sim]").forEach((el) => el.remove()));
      console.log(`INFO ${width}px words broken mid-word across ${await page.locator("[data-building-card] h2").count()} cards — this layout: ${now.length} ${JSON.stringify(now.slice(0, 8))}; previous layout (simulated): ${old.length} ${JSON.stringify(old.slice(0, 8))}`);
      rows.push({ width, label: "broken-words", now, old });
    }
  }
  // Desktop: an unpinned pin shows on hover, as before.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/settings/buildings`, { waitUntil: "networkidle", timeout: 240000 });
  const card = page.locator(`[data-building-card="${made[1]}"]`);
  const pinBtn = card.locator("[data-pin-building]");
  const before = await pinBtn.evaluate((el) => getComputedStyle(el).opacity);
  await card.hover();
  await page.waitForTimeout(400);
  const after = await pinBtn.evaluate((el) => getComputedStyle(el).opacity);
  check("AC8 1280px: unpinned pin hidden until the card is hovered (unchanged)", before === "0" && after === "1", `opacity ${before} → ${after}`);
  await page.close();
} finally {
  for (const id of made) {
    const d = await owner.request.delete(`${BASE}/api/settings/buildings/${id}`);
    check(`cleanup: point ${id} deleted`, d.ok(), String(d.status()));
  }
  await q(`update "User" set "lastActiveBuildingId"=$2 where id=$1`, [ADMIN.id, ADMIN.lastActiveBuildingId]);
  fs.writeFileSync(`${OUT}/ac8-measurements.json`, JSON.stringify(rows, null, 2));
  const failed = finish();
  await browser.close();
  await client.end();
  process.exitCode = failed ? 1 : 0;
}
