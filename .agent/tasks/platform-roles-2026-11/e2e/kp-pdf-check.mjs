// PDF КП коммерческого директора: текст подписи (pdfjs-dist).
import { chromium } from "playwright";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
await page.fill('input[placeholder="name@company.com"]', "alexey@wesetup.ru");
await page.fill('input[type="password"]', "LocalUser-2026!");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.startsWith("/login"));
const b64 = await page.evaluate(async () => {
  const preview = await (await fetch("/api/root/proposals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sphere: "restaurant", sender: { name: "Алексей", position: "Коммерческий директор", phone: "+7 900 000-00-00" } }) })).json();
  const bytes = new Uint8Array(await (await fetch(preview.pdfUrl)).arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
});
await browser.close();
const pdf = await getDocument({ data: new Uint8Array(Buffer.from(b64, "base64")) }).promise;
let text = "";
for (let index = 1; index <= pdf.numPages; index += 1) {
  const content = await (await pdf.getPage(index)).getTextContent();
  text += content.items.map((item) => item.str).join(" ") + "\n";
}
console.log("pdf pages", pdf.numPages, "| has «Коммерческий директор»:", text.replace(/\s+/g, " ").includes("Коммерческий директор"), "| has «Алексей»:", text.includes("Алексей"));
