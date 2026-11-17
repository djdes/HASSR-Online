// Фирменный QR для плаката в приветственном письме (ведёт на главную).
import { writeFileSync } from "node:fs";
import { brandQrPng } from "@/lib/brand-qr";
async function main() {
  const png = await brandQrPng("https://wesetup.ru/?utm_source=welcome_poster", { width: 600, locale: "ru" });
  writeFileSync(process.argv[2], png);
}
void main();
