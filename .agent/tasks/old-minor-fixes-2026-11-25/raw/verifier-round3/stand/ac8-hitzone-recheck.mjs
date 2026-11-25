// Verifier round 3: re-measure the phone pin's hit zone without the two artefacts seen in ac8-layout.mjs
// (1) the page scrolls itself back to the top once shortly after load → wait, then re-scroll until the
//     heading is really in the viewport; (2) in short viewports the fixed page chrome (top bar, floating
//     bottom bar with «Добавить объект») covers part of the zone → page-level fixed/sticky elements are
//     hidden (visibility) while measuring, and listed separately.
// Per card: zone width/height by elementFromPoint scan through the centre, the four zone corners (±23.5 px)
// hit, four points just outside (±25.5 px) do not, the ::before box, in-flow controls overlapping the zone,
// and whether the card's own controls still get taps at their edges.
// Usage (env loaded, next dev on :3000): node ac8-hitzone-recheck.mjs <outdir>
import fs from "node:fs";
import { BASE, chromium, devices, db, ownerState, acceptLegal } from "./lib3.mjs";

const OUT = process.argv[2] ?? "out";
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
];
const NAMES = [
  "Кафе «Сладкоежка»", "Кулинария «Вкусноежка»", "Цех полуфабрикатов", "Склад-овощехранилище", "Цех мясоперерабатывающий",
  "Кафе-кондитерская", "Ресторан «Белуга» 2", "Столовая №1", "Кофейня Coffee&Breakfast", "Choyxona", "Кондитерская",
  "Овощехранилище", "Мясоперерабатывающий", "ООО «Продторг»", "Кафе «Шоколадница»", "Цех №2 (кондитерский)",
  "Муниципальное бюджетное общеобразовательное учреждение общеобразовательная школа №15 имени Героя Советского Союза",
];

function zone({ id }) {
  const card = document.querySelector(`[data-building-card="${id}"]`);
  const pin = [...card.querySelectorAll("[data-pin-building]")].find((p) => getComputedStyle(p).display !== "none" && p.getBoundingClientRect().width > 0);
  if (!pin) return { error: "no visible pin" };
  // Hide page-level fixed/sticky chrome (outside the cards) while measuring.
  const hidden = [];
  for (const el of document.querySelectorAll("body *")) {
    if (el.closest("[data-building-card]")) continue;
    const pos = getComputedStyle(el).position;
    if ((pos === "fixed" || pos === "sticky") && getComputedStyle(el).visibility !== "hidden") {
      hidden.push([el, el.style.visibility]);
      el.style.visibility = "hidden";
    }
  }
  try {
    const pr = pin.getBoundingClientRect();
    const cx = pr.left + pr.width / 2;
    const cy = pr.top + pr.height / 2;
    const inView = pr.top - 26 > 0 && pr.bottom + 26 < innerHeight;
    const hit = (x, y) => document.elementFromPoint(x, y)?.closest("[data-pin-building]") === pin;
    let left = 0, right = 0, up = 0, down = 0;
    const center = hit(cx, cy);
    while (left < 40 && hit(cx - left - 1, cy)) left++;
    while (right < 40 && hit(cx + right + 1, cy)) right++;
    while (up < 40 && hit(cx, cy - up - 1)) up++;
    while (down < 40 && hit(cx, cy + down + 1)) down++;
    const corners = [[-23.5, -23.5], [23.5, -23.5], [-23.5, 23.5], [23.5, 23.5]].map(([dx, dy]) => hit(cx + dx, cy + dy));
    const outside = [[-25.5, 0], [25.5, 0], [0, -25.5], [0, 25.5]].map(([dx, dy]) => hit(cx + dx, cy + dy));
    const z = { l: pr.left - 10, r: pr.right + 10, t: pr.top - 10, b: pr.bottom + 10 };
    const overlaps = [];
    for (const el of document.querySelectorAll("a[href], button, input, select, textarea, [role=button], [role=link]")) {
      if (el === pin || pin.contains(el) || el.contains(pin)) continue;
      const st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const ix = Math.min(r.right, z.r) - Math.max(r.left, z.l);
      const iy = Math.min(r.bottom, z.b) - Math.max(r.top, z.t);
      if (ix > 0 && iy > 0) overlaps.push(`${el.tagName.toLowerCase()}:${(el.getAttribute("aria-label") ?? el.textContent).trim().slice(0, 30)} ${ix.toFixed(1)}×${iy.toFixed(1)}`);
    }
    const stolen = [];
    for (const el of card.querySelectorAll("button:not([data-pin-building]), a[href]")) {
      const r = el.getBoundingClientRect();
      if (!r.width || getComputedStyle(el).display === "none") continue;
      for (const [x, y] of [[r.left + 0.5, r.top + 0.5], [r.left + 0.5, r.bottom - 0.5], [r.left + r.width / 2, r.top + r.height / 2]]) {
        if (y < 0 || y > innerHeight) continue;
        if (document.elementFromPoint(x, y)?.closest("[data-pin-building]") === pin) stolen.push((el.getAttribute("aria-label") ?? el.textContent).trim().slice(0, 30));
      }
    }
    // Gap between the zone and the nearest card control to the right (the pencil), on the zone's rows.
    let gapToRightControl = null;
    for (const el of card.querySelectorAll("button:not([data-pin-building]), a[href]")) {
      const r = el.getBoundingClientRect();
      if (!r.width || r.left < pr.right || r.bottom < z.t || r.top > z.b) continue;
      const g = r.left - z.r;
      if (gapToRightControl === null || g < gapToRightControl) gapToRightControl = +g.toFixed(1);
    }
    const b = getComputedStyle(pin, "::before");
    return { inView, center, w: left + right + 1, h: up + down + 1, corners, outside, overlaps, stolen, gapToRightControl, before: `${b.position} ${b.top} ${b.right} ${b.bottom} ${b.left} ${b.content}`, hiddenChrome: hidden.length };
  } finally {
    for (const [el, v] of hidden) el.style.visibility = v;
  }
}

const { client, q } = await db();
const ADMIN = (await q(`select id, "organizationId", "pinnedBuildingIds" from "User" where email='admin@haccp.local'`))[0];
const browser = await chromium.launch();
const state = await ownerState(browser);
const api = await browser.newContext({ storageState: state });
const made = [];
const bad = [];
const lines = [];
let measured = 0;
try {
  for (const name of NAMES) {
    const res = await api.request.post(`${BASE}/api/settings/buildings`, { data: { name, sphere: "food" } });
    const body = await res.json().catch(() => ({}));
    if (res.ok() && body.building?.id) made.push({ id: body.building.id, name });
  }
  const real = await q(`select id, name, kind from "Building" where "organizationId"=$1 and kind <> 'office' and not (id = any($2)) order by "createdAt"`, [ADMIN.organizationId, made.map((m) => m.id)]);
  const cards = [...made, ...real];
  for (const profile of PROFILES) {
    const ctx = await browser.newContext({ ...profile.opts, storageState: state, locale: "ru-RU" });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/settings/buildings`, { waitUntil: "networkidle", timeout: 240000 });
    await acceptLegal(page);
    await page.waitForTimeout(2500);
    for (const c of cards) {
      const loc = page.locator(`[data-building-card="${c.id}"]`);
      if (!(await loc.count())) continue;
      let r = null;
      for (let i = 0; i < 5; i++) {
        await loc.evaluate((el) => {
          const pin = [...el.querySelectorAll("[data-pin-building]")].find((p) => getComputedStyle(p).display !== "none");
          (pin ?? el.querySelector("h2")).scrollIntoView({ block: "center" });
        });
        await page.waitForTimeout(60);
        r = await page.evaluate(zone, { id: c.id });
        if (r.inView) break;
        await page.waitForTimeout(400);
      }
      measured++;
      const ok = r && !r.error && r.inView && r.center && r.w >= 47 && r.w <= 49 && r.h >= 47 && r.h <= 49 && r.corners.every(Boolean) && !r.outside.some(Boolean) && !r.overlaps.length && !r.stolen.length;
      const line = `${profile.id} ${JSON.stringify(c.name)} zone=${r?.w}x${r?.h} center=${r?.center} corners=${r?.corners?.map(Number).join("")} out=${r?.outside?.map(Number).join("")} overlaps=${JSON.stringify(r?.overlaps)} stolen=${JSON.stringify(r?.stolen)} gapToRightControl=${r?.gapToRightControl} before=${r?.before} chromeHidden=${r?.hiddenChrome} inView=${r?.inView}${r?.error ? ` ERROR ${r.error}` : ""}`;
      lines.push(line);
      if (!ok) bad.push(line);
    }
    console.log(`${profile.id}: done`);
    await ctx.close();
  }
} catch (error) {
  bad.push(`script error: ${String(error?.stack ?? error).slice(0, 500)}`);
} finally {
  for (const c of made) await api.request.delete(`${BASE}/api/settings/buildings/${c.id}`);
  await q(`update "User" set "pinnedBuildingIds"=$2 where id=$1`, [ADMIN.id, ADMIN.pinnedBuildingIds]);
  const left = await q(`select count(*)::int c from "Building" where id = any($1)`, [made.map((c) => c.id)]);
  fs.writeFileSync(`${OUT}/ac8-hitzone-recheck-lines.txt`, lines.join("\n") + "\n");
  const gaps = lines.map((l) => Number((l.match(/gapToRightControl=(-?[\d.]+)/) ?? [])[1])).filter((n) => !Number.isNaN(n));
  console.log(`measured ${measured}, not ok ${bad.length}, own points left ${left[0].c}/${made.length}, min gap zone→right control ${gaps.length ? Math.min(...gaps) : "n/a"} px`);
  for (const b of bad.slice(0, 40)) console.log("NOT OK", b);
  await api.close();
  await browser.close();
  await client.end();
}
