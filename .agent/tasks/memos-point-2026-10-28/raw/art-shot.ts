/**
 * Снимки рисунков плакатов (цвет и «Ч/б») для проверки глазами.
 * Запуск (из корня worktree):
 *   CHROME=<chrome.exe> npx tsx .agent/tasks/memos-point-2026-10-28/raw/art-shot.tsx <out.png> hw-thumbs as-thumbs ...
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright";

import { PosterArt, type PosterArtName } from "@/components/production-control/poster-art";

const [out, ...names] = process.argv.slice(2) as [string, ...PosterArtName[]];

const COLOR =
  "--pb-text:#0b1024;--pb-secondary:#5566f6;--pb-secondary-ink:#3848c7;--pb-on-secondary:#fff;--pb-bg:#eef1ff;--pb-primary:#5566f6;--pb-primary-ink:#3848c7;--pb-on-primary:#fff";
const MONO =
  "--pb-text:#000;--pb-secondary:#000;--pb-secondary-ink:#000;--pb-on-secondary:#fff;--pb-bg:#fff;--pb-primary:#000;--pb-primary-ink:#000;--pb-on-primary:#fff";

const cell = (name: PosterArtName, vars: string, size: number) =>
  `<figure style="margin:0;${vars}"><div style="width:${size}px;height:${(size * 3) / 4}px;border:1px solid #c9cde0;border-radius:12px;padding:6px;background:#fff">${renderToStaticMarkup(
    createElement(PosterArt, { name }),
  )}</div><figcaption style="font:12px Arial;color:#555;margin-top:4px">${name}</figcaption></figure>`;

const html = `<!doctype html><html><head><style>svg{width:100%;height:100%;display:block}body{margin:0;background:#fff}</style></head><body>
<div id="grid" style="display:inline-flex;flex-direction:column;gap:14px;padding:14px">
  <div style="display:flex;gap:14px">${names.map((name) => cell(name, COLOR, 360)).join("")}</div>
  <div style="display:flex;gap:14px">${names.map((name) => cell(name, MONO, 360)).join("")}</div>
  <div style="display:flex;gap:14px">${names.map((name) => cell(name, COLOR, 150)).join("")}</div>
</div></body></html>`;

async function main() {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    await page.setContent(html);
    await (await page.$("#grid"))!.screenshot({ path: out });
    console.log("saved", out);
  } finally {
    await browser.close();
  }
}

void main();
