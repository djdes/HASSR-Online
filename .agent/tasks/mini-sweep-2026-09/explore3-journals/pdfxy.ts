import fs from "node:fs";
const SHOT = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore3-journals";
(async () => {
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(`${SHOT}/pdf-${process.argv[2]}.pdf`)), useSystemFonts: true }).promise;
  const page = await doc.getPage(Number(process.argv[3] || 2));
  const c = await page.getTextContent();
  for (const i of c.items as any[]) if (i.str.trim()) console.log(Math.round(i.transform[4]), Math.round(i.transform[5]), JSON.stringify(i.str));
})();
