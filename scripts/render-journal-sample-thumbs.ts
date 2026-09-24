/**
 * Рисует превью первой страницы образца каждого журнала в PNG.
 *
 * Зачем файлы, а не рендер на лету: карточек на /journals-info больше
 * десятка, и встроить в каждую по полумегабайтному PDF — значит
 * положить страницу. Образцы детерминированы (период зафиксирован в
 * фикстурах), поэтому картинка не «протухает» сама.
 *
 * Когда перезапускать: после любой правки печатной формы. Нужен
 * запущенный сайт и локальный Chromium от Playwright.
 *
 *   npx tsx scripts/render-journal-sample-thumbs.ts http://localhost:3010
 *
 * Только часть журналов (новые коды, без перерисовки остальных и бланков):
 *   ONLY_CODES=daily_samples,vitaminization npx tsx scripts/render-journal-sample-thumbs.ts http://localhost:3010
 */
import fs from "fs";
import path from "path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { chromium } from "playwright-core";
import { SAMPLE_JOURNAL_CODES } from "../src/lib/journal-sample-fixtures";
import { PAPER_JOURNALS } from "../src/lib/sphere-journal-rules";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = path.join(process.cwd(), "public", "journal-samples");
const TMP = path.join(process.cwd(), ".sample-thumbs-tmp");
const ONLY_CODES = (process.env.ONLY_CODES ?? "")
  .split(",")
  .map((code) => code.trim())
  .filter(Boolean);

function chromiumPath(): string {
  const root = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
  const dir = fs
    .readdirSync(root)
    .filter((d) => d.startsWith("chromium-") && !d.includes("headless"))
    .sort()
    .pop();
  if (!dir) throw new Error("Chromium от Playwright не найден");
  return path.join(root, dir, "chrome-win64", "chrome.exe");
}

/**
 * Карточкам журналов (`/journals`, `/dashboard`, `/settings/journals`)
 * отдаётся WebP: сетка из 35-40 образцов в PNG весила 2,7 МБ и на
 * телефоне грузилась дольше самой страницы. 768px хватает карточке
 * шириной 180-280 CSS-px даже на 2×-экране, WebP-82 даёт ещё ~3×.
 * PNG остаётся: он источник и открывается «в полный размер».
 */
const THUMB_WIDTH = 768;
const THUMB_HEIGHT = 539;

async function writeWebp(name: string) {
  const png = path.join(OUT, `${name}.png`);
  const image = await loadImage(fs.readFileSync(png));
  const canvas = createCanvas(THUMB_WIDTH, THUMB_HEIGHT);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT);
  ctx.drawImage(image, 0, 0, THUMB_WIDTH, THUMB_HEIGHT);
  fs.writeFileSync(
    path.join(OUT, `${name}.webp`),
    canvas.toBuffer("image/webp", 82),
  );
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });

  const browser = await chromium.launch({
    executablePath: chromiumPath(),
    args: ["--use-gl=swiftshader", "--no-sandbox"],
  });

  /** Один PDF → один PNG. Геометрия одна на все бланки: A4 landscape. */
  async function shoot(url: string, name: string) {
    const res = await fetch(url);
    if (!res.ok) {
      console.log(`FAIL ${name}: HTTP ${res.status}`);
      return;
    }
    const pdf = path.join(TMP, `${name}.pdf`);
    fs.writeFileSync(pdf, Buffer.from(await res.arrayBuffer()));

    const page = await browser.newPage({
      viewport: { width: 1240, height: 950 },
      deviceScaleFactor: 1,
    });
    // Встроенный просмотрщик Chromium сам рисует страницу — этого
    // достаточно, отдельный растеризатор PDF тянуть не нужно.
    await page.goto("file:///" + pdf.split(path.sep).join("/") + "#toolbar=0&view=Fit");
    await page.waitForTimeout(3500);
    // При #toolbar=0&view=Fit страница занимает почти весь кадр —
    // срезаем только тонкую серую рамку просмотрщика.
    await page.screenshot({
      path: path.join(OUT, `${name}.png`),
      clip: { x: 6, y: 6, width: 1228, height: 862 },
    });
    await page.close();
    await writeWebp(name);
    console.log(`OK   ${name}`);
  }

  const codes = ONLY_CODES.length
    ? SAMPLE_JOURNAL_CODES.filter((code) => ONLY_CODES.includes(code))
    : SAMPLE_JOURNAL_CODES;
  for (const code of codes) {
    await shoot(`${BASE}/api/journal-samples/${code}/pdf?inline=1`, code);
  }

  // Бумажные бланки. Префикс paper_ — потому что id бланков живут в
  // своём пространстве имён и в теории могут совпасть с кодом
  // электронного журнала.
  for (const journal of ONLY_CODES.length ? [] : PAPER_JOURNALS) {
    await shoot(
      `${BASE}/api/journal-samples/paper/${journal.id}/pdf?inline=1`,
      `paper_${journal.id}`,
    );
  }

  await browser.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\nготово → public/journal-samples/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
