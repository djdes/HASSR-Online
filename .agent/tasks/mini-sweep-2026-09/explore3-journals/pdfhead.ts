import fs from "node:fs";
const SHOT = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore3-journals";
const ZZ = JSON.parse(fs.readFileSync(SHOT + "/zz5.json", "utf8"));
(async () => {
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  for (const code of Object.keys(ZZ)) {
    const f = `${SHOT}/pdf-${code}.pdf`;
    if (!fs.existsSync(f)) continue;
    const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(f)), useSystemFonts: true }).promise;
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    const c = await page.getTextContent();
    const txt = c.items.map((i: any) => i.str).join(" ").replace(/\s+/g, " ");
    const per = /Периодичность контроля\s*(.{0,110})/.exec(txt);
    console.log(`### ${code} | pages=${doc.numPages} | ${Math.round(vp.width)}x${Math.round(vp.height)}`);
    console.log("   head:", txt.slice(0, 220));
    console.log("   periodicity:", per ? per[1] : "(нет)");
  }
})();
