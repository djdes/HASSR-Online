// Вырезает CSS-блок automation-scene из globals.css по якорям, с проверками.
import fs from "node:fs";

const file = "D:/www/Wesetup.ru/src/app/globals.css";
const raw = fs.readFileSync(file, "utf8");
const eol = raw.includes("\r\n") ? "\r\n" : "\n";
const lines = raw.split(/\r?\n/);

const start = lines.findIndex((l) => l.includes("Лендинг — секция «Заполняется само»"));
if (start < 1 || !lines[start - 1].includes("=========")) throw new Error("start anchor not found: " + start);
const blockStart = start - 1; // строка /* ====

const printIdx = lines.findIndex((l, i) => i > start && l.includes("Print styles — для журналов"));
if (printIdx < 2 || !lines[printIdx - 1].includes("=========")) throw new Error("print anchor not found: " + printIdx);
let blockEnd = printIdx - 2; // строка перед /* ==== print
// Съедаем хвостовые пустые строки блока, оставляя одну разделительную.
while (blockEnd > blockStart && lines[blockEnd].trim() === "") blockEnd--;

const removed = lines.slice(blockStart, blockEnd + 1);
if (!removed.some((l) => l.includes("automation-temp-tick")) || !removed.some((l) => l.includes("automation-bounce"))) {
  throw new Error("unexpected block content");
}
if (removed.some((l) => l.includes("qrp-") || l.includes("@media print"))) {
  throw new Error("block overshoot");
}

const next = [...lines.slice(0, blockStart), ...lines.slice(blockEnd + 1)];
fs.writeFileSync(file, next.join(eol), "utf8");
console.log(JSON.stringify({ removedLines: removed.length, blockStart: blockStart + 1, eol: eol === "\r\n" ? "crlf" : "lf" }));
