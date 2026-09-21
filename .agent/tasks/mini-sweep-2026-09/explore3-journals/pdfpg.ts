import fs from "node:fs";
const SHOT = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore3-journals";
(async () => {
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const name = process.argv[2]; const pages = process.argv.slice(3).map(Number);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(`${SHOT}/pdf-${name}.pdf`)), useSystemFonts: true }).promise;
  console.log(name, "pages:", doc.numPages);
  for (const p of pages) {
    const page = await doc.getPage(p);
    const c = await page.getTextContent();
    console.log(`--- p${p}:`, c.items.map((i: any) => i.str).join(" ").replace(/\s+/g, " ").slice(0, 900));
  }
})();
