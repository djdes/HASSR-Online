/**
 * Предпросмотр письма КП без сервера: HTML из `renderProposalEmailHtml` на
 * образце данных → Chromium (playwright-core) при 375 и 600 px, светлая и
 * тёмная схема. Картинки письма (адреса https://wesetup.ru/…) подменяются
 * локальными: знак — из public/, QR — `brandQrPng` того же адреса /promo/….
 *
 *   KP_OUT=d:/wt/tmp-kp/email node --import tsx .agent/tasks/proposal-kp/email-preview.ts [sphere...]
 */
import fs from "node:fs";
import path from "node:path";

import { chromium } from "playwright-core";

import { brandQrPng } from "@/lib/brand-qr";
import { buildProposalContent } from "@/lib/proposal/content";
import { proposalPromoUrl } from "@/lib/proposal/cta";
import { renderProposalEmailHtml } from "@/lib/proposal/email";
import { SAMPLE_PROMO_LIFETIME, SAMPLE_PROMO_UNTIL, sampleProposalContext } from "@/lib/proposal/sample";
import type { ProposalVars } from "@/lib/proposal/types";

const OUT = path.resolve(process.env.KP_OUT ?? "d:/wt/tmp-kp/email");

function chromePath(): string {
  const root = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
  const dir = fs
    .readdirSync(root)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))[0];
  return path.join(root, dir, "chrome-win64", "chrome.exe");
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const cases: Array<[string, ProposalVars]> = [
    ["restaurant", { sphere: "restaurant", companyName: "Ресторан «Прага»", recipientName: "Олег Викторович", promo: SAMPLE_PROMO_LIFETIME }],
    ["education", { sphere: "education", companyName: "Детский сад № 5 «Солнышко»", recipientName: "Анна Сергеевна", promo: SAMPLE_PROMO_UNTIL }],
    ["beauty", { sphere: "beauty", companyName: "Салон «Лиса»", promo: null }],
  ];
  const wanted = process.argv.slice(2);
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: ["--no-sandbox", "--use-gl=swiftshader"] });
  try {
    for (const [name, vars] of cases) {
      if (wanted.length && !wanted.includes(name)) continue;
      const content = buildProposalContent(vars, sampleProposalContext());
      const email = renderProposalEmailHtml(content, {
        web: "https://wesetup.ru/kp/sample.token",
        pdf: "https://wesetup.ru/kp/sample.token/pdf",
        unsubscribe: "https://wesetup.ru/unsubscribe/sample",
      });
      fs.writeFileSync(path.join(OUT, `email-${name}.html`), email.html);
      fs.writeFileSync(path.join(OUT, `email-${name}.txt`), email.text);
      console.log(`${name}: ${Buffer.byteLength(email.html)} B, subject «${email.subject}», preheader «${email.preheader}»`);
      for (const scheme of ["light", "dark"] as const) {
        for (const width of [375, 600]) {
          const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
          await context.route(/^https:\/\/wesetup\.ru\//, async (route) => {
            const url = new URL(route.request().url());
            if (url.pathname.startsWith("/brand/")) {
              await route.fulfill({ contentType: "image/png", body: fs.readFileSync(path.join(process.cwd(), "public", url.pathname)) });
              return;
            }
            const qr = /^\/api\/kp\/qr\/([^/]+)$/.exec(url.pathname);
            if (qr) {
              const png = await brandQrPng(proposalPromoUrl(decodeURIComponent(qr[1]), url.searchParams.get("s") as ProposalVars["sphere"]), { width: 600 });
              await route.fulfill({ contentType: "image/png", body: png });
              return;
            }
            await route.fulfill({ status: 404, body: "" });
          });
          const page = await context.newPage();
          await page.setContent(email.html, { waitUntil: "load" });
          await page.waitForTimeout(300);
          await page.screenshot({ path: path.join(OUT, `email-${name}-${width}-${scheme}.png`), fullPage: true });
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
