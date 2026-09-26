// Test photos for «Фото к замеру»: a readable fridge thermometer display (4.5 °C),
// an unreadable one (boxes instead of digits) and a thermo-hygrometer (21.5 °C / 48 %).
// JPEG, DejaVuSans digits. Usage: node make-display-images.cjs <out-dir>
const fs = require("fs");
const path = require("path");
const ROOT = "C:/wt/tphoto";
const { createCanvas, GlobalFonts } = require(`${ROOT}/node_modules/@napi-rs/canvas`);

const OUT = process.argv[2] || `${ROOT}/.agent/tasks/temp-photo-2026-09/evidence`;
GlobalFonts.registerFromPath(`${ROOT}/src/lib/pdf-fonts/DejaVuSans-Bold.ttf`, "DejaVuBold");
GlobalFonts.registerFromPath(`${ROOT}/src/lib/pdf-fonts/DejaVuSans.ttf`, "DejaVu");

function device(label, drawDisplay) {
  const canvas = createCanvas(900, 600);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#d9d4c8";
  ctx.fillRect(0, 0, 900, 600);
  ctx.fillStyle = "#2b2f36";
  ctx.beginPath();
  ctx.roundRect(120, 90, 660, 420, 36);
  ctx.fill();
  ctx.fillStyle = "#b9c9a8";
  ctx.beginPath();
  ctx.roundRect(180, 150, 540, 250, 16);
  ctx.fill();
  ctx.fillStyle = "#1d2419";
  drawDisplay(ctx);
  ctx.fillStyle = "#e8e8e8";
  ctx.font = "22px DejaVu";
  ctx.fillText(label, 300, 460);
  return canvas;
}

const files = {
  "display-fridge-4.5.jpg": device("FRIDGE THERMO  TH-1", (ctx) => {
    ctx.font = "160px DejaVuBold";
    ctx.fillText("4.5", 250, 340);
    ctx.font = "56px DejaVuBold";
    ctx.fillText("°C", 560, 250);
  }),
  "display-unreadable.jpg": device("FRIDGE THERMO  TH-1", (ctx) => {
    ctx.strokeStyle = "#1d2419";
    ctx.lineWidth = 6;
    for (let i = 0; i < 3; i += 1) ctx.strokeRect(250 + i * 95, 205, 70, 130);
    ctx.strokeRect(560, 205, 70, 60);
  }),
  "display-hygro-21.5.jpg": device("THERMO-HYGRO  HT-2", (ctx) => {
    ctx.font = "120px DejaVuBold";
    ctx.fillText("21.5", 215, 300);
    ctx.font = "44px DejaVuBold";
    ctx.fillText("°C", 520, 230);
    ctx.fillText("48%", 590, 370);
  }),
};

fs.mkdirSync(OUT, { recursive: true });
for (const [name, canvas] of Object.entries(files)) {
  fs.writeFileSync(path.join(OUT, name), canvas.toBuffer("image/jpeg", 85));
  console.log(name, fs.statSync(path.join(OUT, name)).size);
}
