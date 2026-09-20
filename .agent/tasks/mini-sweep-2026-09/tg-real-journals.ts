// Настоящий Telegram: журналы и документы внутри мини-приложения. ТОЛЬКО чтение — переходы по ссылкам и прокрутка.
import fs from "node:fs"; import path from "node:path"; import { chromium } from "playwright";
const OUT = process.env.SWEEP_OUT!; fs.mkdirSync(OUT, { recursive: true });
const PROBE = `(function(){var de=document.documentElement;var tg=window.Telegram.WebApp;
 var tables=Array.from(document.querySelectorAll('main table')).filter(function(t){return t.offsetParent}).map(function(t){var r=t.getBoundingClientRect();var p=t.parentElement,sc=null;while(p&&p!==document.body){var o=getComputedStyle(p).overflowX;if((o==='auto'||o==='scroll')&&p.scrollWidth>p.clientWidth+2){sc=p;break}p=p.parentElement}var moved=null;if(sc){var b=sc.scrollLeft;sc.scrollLeft=b+120;moved=sc.scrollLeft!==b;sc.scrollLeft=b}return {w:Math.round(r.width),wider:r.width>de.clientWidth+2,scroller:!!sc,moved:moved}});
 var nav=document.querySelector('.mini-root nav');var nr=nav?nav.getBoundingClientRect():null;
 var sticky=Array.from(document.querySelectorAll('main .sticky.bottom-0, main [class*="bottom-"][class*="sticky"]')).filter(function(e){return e.offsetParent}).map(function(e){var r=e.getBoundingClientRect();return {bottom:Math.round(r.bottom),underNav:nr?r.bottom>nr.top+2:false}});
 var fabs=Array.from(document.querySelectorAll('body > .fixed, .mini-root .fixed')).filter(function(e){var r=e.getBoundingClientRect();return e.offsetParent!==null&&r.width<90&&r.width>30&&r.height<90}).map(function(e){var r=e.getBoundingClientRect();return Math.round(r.left)+','+Math.round(r.top)});
 return {path:location.pathname,vw:innerWidth,vh:innerHeight,pageSW:de.scrollWidth,shell:!!document.getElementById('mini-root'),back:tg.BackButton.isVisible,tables:tables,sticky:sticky,fabs:fabs,text:(document.querySelector('main')||document.body).innerText.replace(/\\s+/g,' ').slice(0,90)}})()`;
(async () => {
  const b = await chromium.connectOverCDP("http://127.0.0.1:9334"); const page = b.contexts().flatMap((c) => c.pages()).find((p) => /wesetup\.ru/.test(p.url()))!;
  let errs: string[] = []; page.on("pageerror", (e) => errs.push("pageerror " + String(e).slice(0, 140))); page.on("console", (m) => { if (m.type() === "error") errs.push("console " + m.text().slice(0, 140)); });
  page.on("response", (r) => { if (r.status() >= 400 && /wesetup\.ru/.test(r.url()) && !/_next\/static/.test(r.url())) errs.push(`http ${r.status()} ${r.url().replace("https://wesetup.ru", "").slice(0, 70)}`); });
  await page.goto("https://wesetup.ru/mini/journals", { waitUntil: "load" }); await page.waitForTimeout(2500);
  const codes: string[] = await page.evaluate(`Array.from(new Set(Array.from(document.querySelectorAll('a[href^="/mini/journals/"]')).map(function(a){return a.getAttribute('href').split('/')[3]})))`);
  console.log("journals", codes.length); const report: any[] = [];
  for (const code of codes) { errs = []; const t0 = Date.now();
    await page.goto(`https://wesetup.ru/mini/journals/${code}`, { waitUntil: "load" }); await page.waitForTimeout(1800);
    const jl: any = await page.evaluate(PROBE); const doc: string | null = await page.evaluate(`(function(){var a=document.querySelector('a[href^="/mini/documents/"]');return a?a.getAttribute('href'):null})()`);
    const row: any = { code, journal: { ms: Date.now() - t0, text: jl.text, pageSW: jl.pageSW, vw: jl.vw, back: jl.back, errs: errs.splice(0, 3) } };
    if (doc) { const t1 = Date.now(); await page.goto("https://wesetup.ru" + doc, { waitUntil: "load" }); await page.waitForTimeout(2500); const d: any = await page.evaluate(PROBE); await page.screenshot({ path: path.join(OUT, `${code}.png`) }).catch(() => null); row.doc = { ms: Date.now() - t1, ...d, errs: errs.splice(0, 3) }; }
    report.push(row);
    const flags = [jl.pageSW > jl.vw + 2 && "J-OVERFLOW", !jl.back && "J-NOBACK", row.journal.errs.length && "J-ERR " + row.journal.errs[0], !doc && "NO-DOC",
      row.doc && row.doc.pageSW > row.doc.vw + 2 && `D-OVERFLOW ${row.doc.pageSW}`, row.doc && row.doc.tables.some((t: any) => t.wider && (!t.scroller || !t.moved)) && "D-TABLE-STUCK", row.doc && row.doc.sticky.some((s: any) => s.underNav) && "D-STICKY-UNDER-NAV", row.doc && !row.doc.back && "D-NOBACK", row.doc && row.doc.errs.length && "D-ERR " + row.doc.errs[0]].filter(Boolean);
    console.log(code, row.journal.ms + "ms", row.doc ? row.doc.ms + "ms" : "-", flags.length ? flags.join(" | ") : "ok");
    fs.writeFileSync(path.join(OUT, "tg-real-journals.json"), JSON.stringify(report, null, 1)); }
  await page.goto("https://wesetup.ru/mini", { waitUntil: "load" }); await b.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 300)); process.exit(1); });
