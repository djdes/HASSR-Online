// Снимки «до / после» (телефон, вид «Таблица», сразу после открытия) — рядом, 1x.
//   node D:/wt-build/tmp-docscroll/e2e/composite.cjs → OUT/final/*.png
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { OUT, WT } = require("./lib.cjs");

const sharp = createRequire(path.join(WT, "package.json"))("sharp");
const CODES = ["climate_control", "cold_equipment_control", "cleaning", "hygiene"];
const FINAL = path.join(OUT, "final");

function label(text, width) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="28"><rect width="100%" height="100%" fill="#0b1024"/><text x="10" y="19" font-family="Arial, sans-serif" font-size="15" fill="#ffffff">${text}</text></svg>`;
  return Buffer.from(svg);
}

(async () => {
  fs.mkdirSync(FINAL, { recursive: true });
  for (const code of CODES) {
    const before = path.join(OUT, "shots", "before", `${code}-phoneTable.png`);
    const after = path.join(OUT, "shots", "after", `${code}-phoneTable.png`);
    if (!fs.existsSync(before) || !fs.existsSync(after)) {
      console.log("skip", code);
      continue;
    }
    const b = await sharp(before).resize({ width: 390 }).png().toBuffer();
    const a = await sharp(after).resize({ width: 390 }).png().toBuffer();
    const { height } = await sharp(b).metadata();
    const W = 390 * 2 + 12;
    const out = path.join(FINAL, `${code}-phone-before-after.png`);
    await sharp({ create: { width: W, height: height + 28, channels: 3, background: "#ffffff" } })
      .composite([
        { input: label("До", 390), left: 0, top: 0 },
        { input: label("После", 390), left: 402, top: 0 },
        { input: b, left: 0, top: 28 },
        { input: a, left: 402, top: 28 },
      ])
      .png({ compressionLevel: 9, palette: true })
      .toFile(out);
    console.log(out, fs.statSync(out).size);
  }
  // Отдельные снимки «после»: сдвиг таблицы вбок и шапка на компьютере.
  for (const [src, name] of [
    [path.join(OUT, "shots", "after", "cold_equipment_control-phoneTable-swiped.png"), "cold_equipment_control-phone-after-swiped.png"],
    [path.join(OUT, "shots", "after", "pest_control-phoneTable-swiped.png"), "pest_control-phone-after-swiped.png"],
    [path.join(OUT, "shots", "after", "header-1280-table.png"), "climate_control-desktop-header-row.png"],
    [path.join(OUT, "shots", "after", "header-390-table.png"), "climate_control-phone-header-row.png"],
  ]) {
    if (!fs.existsSync(src)) {
      console.log("skip", src);
      continue;
    }
    const meta = await sharp(src).metadata();
    const out = path.join(FINAL, name);
    await sharp(src)
      .resize({ width: meta.width > 1000 ? meta.width : Math.round(meta.width / 2) })
      .png({ compressionLevel: 9, palette: true })
      .toFile(out);
    console.log(out, fs.statSync(out).size);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
