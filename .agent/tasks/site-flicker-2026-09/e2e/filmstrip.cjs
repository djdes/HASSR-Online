// Кинолента кадров одного прогона: кадры подряд с отметкой времени и темой кадра.
// Запуск: node filmstrip.cjs <папка кадров> <out.png> [заголовок] [maxFrames]
// Папка — d:/wt/tmp-flicker/<label>/frames/<прогон> (jpg + frames.json от flicker-probe.cjs).
const { createRequire } = require("node:module");
const fs = require("node:fs");
const path = require("node:path");

const req = createRequire(path.join("d:/wt/flicker", "package.json"));
const { createCanvas, loadImage, GlobalFonts } = req("@napi-rs/canvas");
// Шрифт с кириллицей для подписей (встроенный sans-serif канвы её не знает).
const FONT = "FilmstripSans";
for (const file of ["C:/Windows/Fonts/arial.ttf", "d:/wt/flicker/src/app/fonts/manrope-variable.ttf"]) {
  if (fs.existsSync(file) && GlobalFonts.registerFromPath(file, FONT)) break;
}

const [dir, out, title = "", maxArg = "10"] = process.argv.slice(2);
const MAX = Number(maxArg);

(async () => {
  const metaPath = path.join(dir, "frames.json");
  let frames;
  if (fs.existsSync(metaPath)) {
    frames = JSON.parse(fs.readFileSync(metaPath, "utf8")).frames;
  } else {
    frames = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".jpg"))
      .sort()
      .map((file) => ({ file, ms: Number((/_(-?\d+)ms/.exec(file) || [])[1]), a: null }));
  }
  frames = frames.filter((f) => f.ms >= -20 && f.ms <= 1600);
  // Ровно MAX кадров: все смены тона/однородности + равномерно остальные.
  const picked = [];
  let prevKey = null;
  for (const f of frames) {
    const key = f.a ? `${f.a.tone}|${f.a.std < 2.5}` : "?";
    if (key !== prevKey) picked.push(f);
    prevKey = key;
  }
  const rest = frames.filter((f) => !picked.includes(f));
  while (picked.length < MAX && rest.length) {
    const i = Math.floor(rest.length / 2);
    picked.push(rest.splice(i, 1)[0]);
  }
  picked.sort((a, b) => a.ms - b.ms);
  const use = picked.slice(0, MAX);
  const imgs = [];
  for (const f of use) imgs.push(await loadImage(fs.readFileSync(path.join(dir, f.file))));
  const w = 260;
  const h = Math.round((imgs[0].height / imgs[0].width) * w);
  const pad = 8;
  const head = title ? 34 : 0;
  const canvas = createCanvas(pad + use.length * (w + pad), head + h + 30 + pad);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (title) {
    ctx.fillStyle = "#0b1024";
    ctx.font = `bold 18px ${FONT}`;
    ctx.fillText(title, pad, 23);
  }
  use.forEach((f, i) => {
    const x = pad + i * (w + pad);
    ctx.drawImage(imgs[i], x, head, w, h);
    ctx.strokeStyle = "#dcdfed";
    ctx.strokeRect(x + 0.5, head + 0.5, w - 1, h - 1);
    ctx.fillStyle = "#0b1024";
    ctx.font = `14px ${FONT}`;
    const tone = f.a ? (f.a.std < 2.5 ? `${f.a.tone}, пусто` : f.a.tone) : "";
    ctx.fillText(`${f.ms} мс  ${tone}`, x + 4, head + h + 20);
  });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, canvas.toBuffer("image/png"));
  console.log(`${out}: ${use.length} кадров`);
})();
