/**
 * Крупный снимок рисунков (по умолчанию — головы поваров) для проверки глазами.
 * CHROME=<chrome.exe> npx tsx .agent/tasks/poster-art-decent-2026-10-28/raw/art-zoom.ts <out.png> <viewBox> name...
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright";

import { PosterArt, type PosterArtName } from "@/components/production-control/poster-art";

const [out, viewBox, ...names] = process.argv.slice(2) as [string, string, ...PosterArtName[]];
const COLOR =
  "--pb-text:#0b1024;--pb-secondary:#5566f6;--pb-secondary-ink:#3848c7;--pb-on-secondary:#fff;--pb-bg:#eef1ff;--pb-primary:#5566f6;--pb-primary-ink:#3848c7;--pb-on-primary:#fff";
const MONO =
  "--pb-text:#000;--pb-secondary:#000;--pb-secondary-ink:#000;--pb-on-secondary:#fff;--pb-bg:#fff;--pb-primary:#000;--pb-primary-ink:#000;--pb-on-primary:#fff";

const cell = (name: PosterArtName, vars: string) => {
  const svg = renderToStaticMarkup(createElement(PosterArt, { name })).replace(/viewBox="[^"]*"/, `viewBox="${viewBox}"`);
  return `<div style="${vars};width:420px;height:420px;border:1px solid #c9cde0;border-radius:12px;background:#fff">${svg}</div>`;
};

const html = `<!doctype html><html><head><style>svg{width:100%;height:100%;display:block}body{margin:0}</style></head><body>
<div id="grid" style="display:inline-flex;gap:12px;padding:12px">${names.map((name) => cell(name, COLOR) + cell(name, MONO)).join("")}</div></body></html>`;

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
