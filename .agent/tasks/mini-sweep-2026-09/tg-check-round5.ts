// Проверка пачки по кабинету: выгрузка отчётов не пустая, окно ссылки инспектора, «Сегодня» в режиме назначения.
import { openTelegramSession, db } from "./tg-session"; import JSZip from "jszip";
(async () => {
  const s = await openTelegramSession({ role: "ownerA" }); const p = s.page;
  const x = await p.request.get(`${s.base}/api/reports/excel?templateCode=hygiene&from=2026-09-01&to=2026-09-21`, { timeout: 300000 });
  const buf = await x.body(); let rows = -1; try { const z = await JSZip.loadAsync(buf); const xml = await z.file("xl/worksheets/sheet1.xml")!.async("string"); rows = (xml.match(/<row /g) || []).length; } catch (e) { rows = -2; }
  console.log("excel:", x.status(), x.headers()["content-type"], "строк:", rows);
  const pdf = await p.request.get(`${s.base}/api/reports/pdf?template=hygiene&from=2026-09-01&to=2026-09-21`, { timeout: 300000 }); const pdfEmpty = await p.request.get(`${s.base}/api/reports/pdf?template=hygiene&from=2025-01-01&to=2025-01-31`, { timeout: 300000 });
  console.log("pdf с данными / пустой:", pdf.status(), (await pdf.body()).length, "/", pdfEmpty.status(), (await pdfEmpty.body()).length);
  await p.goto(s.base + "/settings/inspector-portal", { waitUntil: "load", timeout: 300000 }); await p.waitForTimeout(3000);
  await p.getByRole("button", { name: /Создать ссылку/ }).first().click(); await p.waitForTimeout(1200); await p.getByRole("button", { name: /^Создать$/ }).last().click(); await p.waitForTimeout(3500);
  console.log("ссылка инспектора видна:", await p.evaluate(`/Ссылка создана/.test(document.body.innerText)`));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 300)); process.exit(1); });
