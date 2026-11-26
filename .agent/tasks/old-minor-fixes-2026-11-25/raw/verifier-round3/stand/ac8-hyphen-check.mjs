// Verifier round 3: «Склад-овощехранилище» at 393 px (Pixel 5) — where the pin goes on the branch and in
// origin/master's markup (rebuilt in the same page), and screenshots of both. Own point, deleted at the end.
// Usage (env loaded, next dev on :3000): node ac8-hyphen-check.mjs <outdir>
import fs from "node:fs";
import { BASE, chromium, devices, ownerState, acceptLegal } from "./lib3.mjs";

const OUT = process.argv[2] ?? "out";
fs.mkdirSync(`${OUT}/screens`, { recursive: true });
const NAME = "Склад-овощехранилище";
const browser = await chromium.launch();
const state = await ownerState(browser);
const api = await browser.newContext({ storageState: state });
const made = (await (await api.request.post(`${BASE}/api/settings/buildings`, { data: { name: NAME, sphere: "food" } })).json()).building;
const describe = () =>
  (sel) => {
    const card = document.querySelector(sel);
    const row = card.querySelector("[data-building-title]")?.parentElement ?? card.querySelector("h2").parentElement;
    const vis = (el) => el && getComputedStyle(el).display !== "none" && el.getBoundingClientRect().width > 0 && !el.closest("[style*='display: none']");
    const h2 = [...row.querySelectorAll("h2")].find(vis);
    const icon = [...row.querySelectorAll("svg")].find((s) => vis(s) && !s.closest("[data-pin-building]"));
    const pin = [...row.querySelectorAll("[data-pin-building]")].find(vis);
    const r = document.createRange();
    r.selectNodeContents(h2);
    const lines = [];
    for (const x of r.getClientRects()) if (x.width > 1 && !lines.some((t) => Math.abs(t - x.top) < 6)) lines.push(Math.round(x.top));
    const box = (el) => { const b = el.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
    return { icon: box(icon), textLineTops: lines.sort((a, b) => a - b), pin: box(pin), rowWidth: Math.round(row.getBoundingClientRect().width) };
  };
try {
  const { defaultBrowserType, ...d } = devices["Pixel 5"];
  const ctx = await browser.newContext({ ...d, storageState: state, locale: "ru-RU" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/settings/buildings`, { waitUntil: "networkidle", timeout: 240000 });
  await acceptLegal(page);
  await page.waitForTimeout(2500);
  const sel = `[data-building-card="${made.id}"]`;
  const loc = page.locator(sel);
  await loc.evaluate((el) => el.querySelector("h2").scrollIntoView({ block: "center" }));
  await page.waitForTimeout(400);
  const branch = await page.evaluate(describe(), sel);
  let box = await loc.boundingBox();
  await page.screenshot({ path: `${OUT}/screens/hyphen-393-branch.png`, clip: { x: box.x, y: Math.max(0, box.y), width: box.width, height: 170 } });
  // origin/master dd898d487 header markup, same page.
  await loc.evaluate((card, name) => {
    const row = card.querySelector("[data-building-title]").parentElement;
    const svg = row.querySelector("svg").cloneNode(true);
    for (const c of ["shrink-0", "max-sm:mr-2", "max-sm:inline-block", "max-sm:align-[-0.125em]"]) svg.classList.remove(c);
    const h2 = document.createElement("h2");
    h2.className = "min-w-0 break-words text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]";
    h2.textContent = name;
    const chip = row.querySelector(":scope > [data-building-sphere]").cloneNode(true);
    chip.classList.add("max-sm:order-last");
    const pin = [...row.querySelectorAll("[data-pin-building]")].find((b) => b.classList.contains("max-sm:hidden")).cloneNode(true);
    pin.classList.remove("max-sm:hidden", "sm:order-last");
    for (const el of row.children) el.style.display = "none";
    row.append(svg, h2, chip, pin);
  }, NAME);
  await page.waitForTimeout(200);
  const master = await page.evaluate(describe(), sel);
  box = await loc.boundingBox();
  await page.screenshot({ path: `${OUT}/screens/hyphen-393-master-sim.png`, clip: { x: box.x, y: Math.max(0, box.y), width: box.width, height: 170 } });
  const pinAlone = (m) => !m.textLineTops.some((t) => Math.abs(t - m.pin[1]) < 14);
  const iconAlone = (m) => !m.textLineTops.some((t) => Math.abs(t - m.icon[1]) < 14);
  console.log(JSON.stringify({ name: NAME, width: 393, branch: { ...branch, pinAlone: pinAlone(branch), iconAlone: iconAlone(branch) }, master: { ...master, pinAlone: pinAlone(master), iconAlone: iconAlone(master) } }, null, 1));
  await ctx.close();
} finally {
  const del = await api.request.delete(`${BASE}/api/settings/buildings/${made.id}`);
  console.log("cleanup delete", del.status());
  await api.close();
  await browser.close();
}
