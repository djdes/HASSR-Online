// Синтетические снимки для e2e «Фотофиксация показаний»: светодиодный контроллер «4.2»,
// стрелочный термометр морозильной камеры и нечитаемый (размытый) дисплей. Своя графика —
// эталонные фотографии клиента в репозиторий и в e2e не попадают. Распознавание в e2e — мок
// диспетчера, картинка нужна как «фото с камеры».
// Запуск: node make-images.cjs <out-dir>
const fs = require("fs");
const path = require("path");
const ROOT = "C:/wt/photofix";
const { createCanvas, GlobalFonts } = require(`${ROOT}/node_modules/@napi-rs/canvas`);

const OUT = process.argv[2];
if (!OUT) throw new Error("usage: node make-images.cjs <out-dir>");
GlobalFonts.registerFromPath(`${ROOT}/src/lib/pdf-fonts/DejaVuSans-Bold.ttf`, "DejaVuBold");
GlobalFonts.registerFromPath(`${ROOT}/src/lib/pdf-fonts/DejaVuSans.ttf`, "DejaVu");

function led(text) {
  const canvas = createCanvas(1200, 900);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#cfd3d6";
  ctx.fillRect(0, 0, 1200, 900);
  ctx.fillStyle = "#1b1e22";
  ctx.beginPath();
  ctx.roundRect(170, 250, 860, 380, 28);
  ctx.fill();
  ctx.fillStyle = "#07080a";
  ctx.beginPath();
  ctx.roundRect(230, 300, 520, 280, 14);
  ctx.fill();
  ctx.fillStyle = "#ff2a1a";
  ctx.shadowColor = "rgba(255,40,20,0.8)";
  ctx.shadowBlur = 24;
  ctx.font = "220px DejaVuBold";
  ctx.fillText(text, 262, 530);
  ctx.shadowBlur = 0;
  for (const [x, y, label] of [[820, 360, "SET"], [920, 360, "▲"], [820, 500, "❄"], [920, 500, "▼"]]) {
    ctx.fillStyle = "#3a3f46";
    ctx.beginPath();
    ctx.arc(x + 30, y + 30, 38, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e8e8e8";
    ctx.font = "26px DejaVu";
    ctx.fillText(label, x + 8, y + 40);
  }
  return canvas;
}

function dial() {
  const canvas = createCanvas(1000, 1000);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#b9c2c9";
  ctx.fillRect(0, 0, 1000, 1000);
  const cx = 500;
  const cy = 500;
  ctx.fillStyle = "#f4f4f1";
  ctx.beginPath();
  ctx.arc(cx, cy, 380, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#d9d9d4";
  ctx.lineWidth = 18;
  ctx.stroke();
  // Шкала −30…+40 °C по дуге 270°: 0 — наверху.
  const angleOf = (t) => ((-90 + (t / 10) * 38) * Math.PI) / 180;
  ctx.fillStyle = "#1c1c1c";
  ctx.strokeStyle = "#1c1c1c";
  for (let t = -30; t <= 40; t += 2) {
    const a = angleOf(t);
    const major = t % 10 === 0;
    ctx.lineWidth = major ? 6 : 3;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * (major ? 300 : 320), cy + Math.sin(a) * (major ? 300 : 320));
    ctx.lineTo(cx + Math.cos(a) * 350, cy + Math.sin(a) * 350);
    ctx.stroke();
    if (major) {
      ctx.font = "52px DejaVuBold";
      const label = String(Math.abs(t));
      const w = ctx.measureText(label).width;
      ctx.fillStyle = t < 0 ? "#1f4fa8" : "#1c1c1c";
      ctx.fillText(label, cx + Math.cos(a) * 235 - w / 2, cy + Math.sin(a) * 235 + 18);
    }
  }
  ctx.fillStyle = "#1f4fa8";
  ctx.font = "34px DejaVu";
  ctx.fillText("FREEZING", cx - 250, cy + 70);
  ctx.fillStyle = "#1c1c1c";
  ctx.fillText("°C", cx - 25, cy + 230);
  // Стрелка на −19 °C.
  const a = angleOf(-19);
  ctx.strokeStyle = "#b3261e";
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(cx - Math.cos(a) * 60, cy - Math.sin(a) * 60);
  ctx.lineTo(cx + Math.cos(a) * 300, cy + Math.sin(a) * 300);
  ctx.stroke();
  ctx.fillStyle = "#b3261e";
  ctx.beginPath();
  ctx.arc(cx, cy, 30, 0, Math.PI * 2);
  ctx.fill();
  return canvas;
}

function blurry() {
  const canvas = led("8.8");
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(210,214,218,0.82)";
  ctx.fillRect(230, 300, 520, 280);
  return canvas;
}

fs.mkdirSync(OUT, { recursive: true });
for (const [name, canvas] of Object.entries({ "led-4.2.jpg": led("4.2"), "dial-freezer.jpg": dial(), "blurry.jpg": blurry() })) {
  fs.writeFileSync(path.join(OUT, name), canvas.toBuffer("image/jpeg", 85));
  console.log(name, fs.statSync(path.join(OUT, name)).size);
}
