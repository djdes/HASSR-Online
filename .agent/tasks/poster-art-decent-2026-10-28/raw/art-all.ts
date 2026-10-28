/**
 * Все рисунки плакатов одной сеткой (цвет) — просмотр глазами на двусмысленности.
 * CHROME=<chrome.exe> npx tsx .agent/tasks/poster-art-decent-2026-10-28/raw/art-all.ts <out.png>
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright";

import { PosterArt, type PosterArtName } from "@/components/production-control/poster-art";

const NAMES = (
  "hw-wet hw-soap hw-palms hw-backs hw-interlace hw-thumbs hw-fingertips hw-rinse hw-dry hw-tap-towel hw-timer " +
  "as-dispenser as-palms as-backs as-knuckles as-thumbs as-fingertips chef-correct chef-wrong cc-raw-ready cc-boards " +
  "cc-damaged cc-sanitize ds-jar ds-fridge ds-spoon ds-weight ds-portion di-skin di-throat di-survey di-thermometer " +
  "dz-gloves dz-closed-container dz-ventilation dz-respirator dz-wash-face eggs dishes storage hygiene"
).split(" ") as PosterArtName[];
const COLOR =
  "--pb-text:#0b1024;--pb-secondary:#5566f6;--pb-secondary-ink:#3848c7;--pb-on-secondary:#fff;--pb-bg:#eef1ff;--pb-primary:#5566f6;--pb-primary-ink:#3848c7;--pb-on-primary:#fff";
const [out] = process.argv.slice(2);
const cell = (name: PosterArtName) =>
  `<figure style="margin:0;${COLOR}"><div style="width:240px;height:180px">${renderToStaticMarkup(createElement(PosterArt, { name }))}</div><figcaption style="font:11px Arial;color:#555">${name}</figcaption></figure>`;
const html = `<!doctype html><html><head><style>svg{width:100%;height:100%;display:block}body{margin:0;background:#fff}</style></head><body>
<div id="grid" style="display:grid;grid-template-columns:repeat(5,240px);gap:10px;padding:10px">${NAMES.map(cell).join("")}</div></body></html>`;

async function main() {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    await (await page.$("#grid"))!.screenshot({ path: out });
    console.log("saved", out);
  } finally {
    await browser.close();
  }
}
void main();
