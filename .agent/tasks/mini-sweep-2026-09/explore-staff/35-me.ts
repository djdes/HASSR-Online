import { openTelegramSession } from "../tg-session";
import { shot } from "./lib";
const T = async (p: any) => ((await p.evaluate(`document.body.innerText`)) as string).replace(/\s+/g, " ");
(async () => {
  const s = await openTelegramSession({ role: "cookA", width: 360, height: 640, theme: "light" });
  const p = s.page;
  await p.goto(s.base + "/mini/me", { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(6000);
  await shot(p, "me-light-top");
  await shot(p, "me-light-full", true);
  // theme switch to dark
  await p.getByText("Тёмная", { exact: true }).click();
  await p.waitForTimeout(2500);
  await shot(p, "me-dark-after-switch");
  console.log("html class", await p.evaluate(`document.documentElement.className + ' | ' + document.documentElement.getAttribute('data-theme')`));
  console.log("bg", await p.evaluate(`getComputedStyle(document.body).backgroundColor`));
  console.log("tg header", JSON.stringify(await p.evaluate(`window.__tgHost.headerColor`)), JSON.stringify(await p.evaluate(`window.__tgHost.bgColor`)));
  // navigate to a site page inside shell in dark
  await p.goto(s.base + "/journals/hygiene/documents/cmu3xjc390004ks9mroi7qi9i", { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(9000);
  await shot(p, "doc-dark");
  await p.goto(s.base + "/mini/today", { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(8000);
  await shot(p, "today-dark");
  await p.goto(s.base + "/mini/sections", { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(5000);
  await shot(p, "sections-dark");
  await p.goto(s.base + "/settings/balance", { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(7000);
  await shot(p, "balance-dark");
  await p.goto(s.base + "/journals/hygiene/documents/cmua9qc1z0000t09mzz77qi6f", { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(6000);
  await shot(p, "notfound-dark");
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 600)); process.exit(1); });
