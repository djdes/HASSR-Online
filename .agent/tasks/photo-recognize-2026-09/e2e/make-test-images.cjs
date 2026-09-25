// Generates AC1 / e2e test images (Cyrillic text rendered with DejaVuSans).
const fs = require("fs");
const path = require("path");
const { createCanvas, GlobalFonts } = require("C:/wt/qrforms/node_modules/@napi-rs/canvas");

const OUT = "C:/wt/qrforms/.agent/tasks/photo-recognize-2026-09/evidence";
GlobalFonts.registerFromPath("C:/wt/qrforms/src/lib/pdf-fonts/DejaVuSans.ttf", "DejaVu");
GlobalFonts.registerFromPath("C:/wt/qrforms/src/lib/pdf-fonts/DejaVuSans-Bold.ttf", "DejaVuBold");

function paper(width, height) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fbfaf5";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#1a1a1a";
  return { canvas, ctx };
}

// 1) Readable menu: dish | yield | time.
const MENU = [
  ["Солянка сборная мясная", "250/15", "08:40"],
  ["Гречка по-купечески", "180", "10:15"],
  ["Кисель клюквенный", "200", "07:25"],
  ["Запеканка творожная с изюмом", "150/10", "11:50"],
  ["Биточки рыбные", "90", "12:05"],
];
{
  const { canvas, ctx } = paper(1000, 560);
  ctx.font = "34px DejaVuBold";
  ctx.fillText("МЕНЮ НА 25 СЕНТЯБРЯ", 60, 80);
  ctx.font = "22px DejaVu";
  ctx.fillStyle = "#555";
  ctx.fillText("Наименование блюда", 60, 140);
  ctx.fillText("Выход, г", 640, 140);
  ctx.fillText("Время", 820, 140);
  ctx.fillStyle = "#1a1a1a";
  ctx.font = "28px DejaVu";
  MENU.forEach(([name, yieldValue, time], i) => {
    const y = 200 + i * 70;
    ctx.fillText(`${i + 1}. ${name}`, 60, y);
    ctx.fillText(yieldValue, 640, y);
    ctx.fillText(time, 820, y);
  });
  fs.writeFileSync(path.join(OUT, "ac1-menu-readable.png"), canvas.toBuffer("image/png"));
}

// 2) Unreadable: the same layout, every character drawn as an empty box (tofu).
{
  const { canvas, ctx } = paper(1000, 560);
  ctx.strokeStyle = "#1a1a1a";
  ctx.lineWidth = 2;
  const boxes = (text, x, y, size) => {
    let cx = x;
    for (const ch of text) {
      if (ch === " ") {
        cx += size * 0.45;
        continue;
      }
      ctx.strokeRect(cx, y - size * 0.8, size * 0.55, size * 0.85);
      cx += size * 0.68;
    }
  };
  boxes("МЕНЮ НА 25 СЕНТЯБРЯ", 60, 80, 34);
  boxes("Наименование блюда", 60, 140, 22);
  boxes("Выход", 640, 140, 22);
  boxes("Время", 820, 140, 22);
  MENU.forEach(([name, yieldValue, time], i) => {
    const y = 200 + i * 70;
    boxes(`${i + 1}. ${name}`.slice(0, 24), 60, y, 28);
    boxes(yieldValue, 640, y, 28);
    boxes(time, 820, y, 28);
  });
  fs.writeFileSync(path.join(OUT, "ac1-menu-unreadable.png"), canvas.toBuffer("image/png"));
}

// 3) Invoice (raw materials) for the full-path worker test and the site e2e.
{
  const { canvas, ctx } = paper(1200, 620);
  ctx.font = "30px DejaVuBold";
  ctx.fillText("ТОВАРНАЯ НАКЛАДНАЯ № 418 от 24.09.2026", 50, 70);
  ctx.font = "24px DejaVu";
  ctx.fillText("Поставщик: ООО «Северная ферма»", 50, 120);
  ctx.fillStyle = "#555";
  ctx.font = "20px DejaVu";
  const cols = [50, 100, 470, 820, 960];
  ["№", "Наименование", "Изготовитель", "Кол-во", "Годен до"].forEach((h, i) => ctx.fillText(h, cols[i], 180));
  ctx.fillStyle = "#1a1a1a";
  ctx.font = "22px DejaVu";
  const ROWS = [
    ["1", "Молоко питьевое 3,2%", "АО «Вологодский МК»", "12 л", "30.09.2026"],
    ["2", "Творог 9%", "ООО «Агрокомплекс»", "5 кг", "01.10.2026"],
    ["3", "Сметана 20%", "АО «Вологодский МК»", "3 кг", "05.10.2026"],
    ["4", "Филе куриное охл.", "ООО «Приосколье»", "8 кг", "28.09.2026"],
  ];
  ROWS.forEach((row, i) => {
    const y = 240 + i * 60;
    row.forEach((cell, c) => ctx.fillText(cell, cols[c], y));
  });
  ctx.strokeStyle = "#999";
  ctx.beginPath();
  ctx.moveTo(50, 195);
  ctx.lineTo(1150, 195);
  ctx.stroke();
  ctx.font = "22px DejaVu";
  ctx.fillText("Итого: 4 позиции. Сумма 18 740,00 руб.", 50, 520);
  fs.writeFileSync(path.join(OUT, "ac1-invoice.png"), canvas.toBuffer("image/png"));
}

for (const f of fs.readdirSync(OUT)) console.log(f, fs.statSync(path.join(OUT, f)).size);
