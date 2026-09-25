// Generates the follow-up test images: a readable and an unreadable thermometer display
// (DejaVuSans for the digits; the unreadable one has boxes instead of digits).
const fs = require("fs");
const path = require("path");
const { createCanvas, GlobalFonts } = require("C:/wt/qrforms/node_modules/@napi-rs/canvas");

const OUT = "C:/wt/qrforms/.agent/tasks/photo-recognize-2026-09/evidence";
GlobalFonts.registerFromPath("C:/wt/qrforms/src/lib/pdf-fonts/DejaVuSans-Bold.ttf", "DejaVuBold");
GlobalFonts.registerFromPath("C:/wt/qrforms/src/lib/pdf-fonts/DejaVuSans.ttf", "DejaVu");

function device(drawDisplay) {
  const canvas = createCanvas(900, 600);
  const ctx = canvas.getContext("2d");
  // Корпус термометра на столе.
  ctx.fillStyle = "#c9c4b8";
  ctx.fillRect(0, 0, 900, 600);
  ctx.fillStyle = "#2b2f36";
  ctx.beginPath();
  ctx.roundRect(120, 90, 660, 420, 36);
  ctx.fill();
  // ЖК-экран.
  ctx.fillStyle = "#b9c9a8";
  ctx.beginPath();
  ctx.roundRect(180, 150, 540, 250, 16);
  ctx.fill();
  ctx.fillStyle = "#1d2419";
  drawDisplay(ctx);
  ctx.fillStyle = "#e8e8e8";
  ctx.font = "22px DejaVu";
  ctx.fillText("FREEZER THERMO  TH-2", 300, 460);
  return canvas;
}

const readable = device((ctx) => {
  ctx.font = "150px DejaVuBold";
  ctx.fillText("-18.5", 215, 335);
  ctx.font = "56px DejaVuBold";
  ctx.fillText("°C", 610, 250);
});
fs.writeFileSync(path.join(OUT, "fu-display-readable.png"), readable.toBuffer("image/png"));

const unreadable = device((ctx) => {
  ctx.strokeStyle = "#1d2419";
  ctx.lineWidth = 6;
  for (let i = 0; i < 4; i += 1) ctx.strokeRect(225 + i * 95, 205, 70, 130);
  ctx.strokeRect(600, 205, 70, 60);
});
fs.writeFileSync(path.join(OUT, "fu-display-unreadable.png"), unreadable.toBuffer("image/png"));

for (const f of ["fu-display-readable.png", "fu-display-unreadable.png"]) console.log(f, fs.statSync(path.join(OUT, f)).size);
