import fs from "node:fs";
const SHOT = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore3-journals";
(async () => {
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  for (const name of process.argv.slice(2)) {
    const data = new Uint8Array(fs.readFileSync(`${SHOT}/pdf-${name}.pdf`));
    const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
    console.log("===", name, "pages:", doc.numPages);
    for (let p = 1; p <= Math.min(doc.numPages, 3); p++) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const c = await page.getTextContent();
      const txt = c.items.map((i: any) => i.str).join(" ").replace(/\s+/g, " ");
      console.log(`--- page ${p} (${Math.round(vp.width)}x${Math.round(vp.height)}):`, txt.slice(0, 1800));
    }
  }
})();
