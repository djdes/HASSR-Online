import { openTelegramSession, db } from "../tg-session";
import { shot } from "./lib";
const DOC = "cmu3xjc390004ks9mroi7qi9i";
const T = async (p: any) => ((await p.evaluate(`document.body.innerText`)) as string).replace(/\s+/g, " ");
(async () => {
  console.log("BEFORE autoFill:", (await db.journalDocument.findUnique({ where: { id: DOC }, select: { autoFill: true } }))?.autoFill);
  const s = await openTelegramSession({ role: "cookA", width: 360, height: 640, theme: "light" });
  const p = s.page;
  p.on("request", (r) => { if (r.method() !== "GET" && !r.url().includes("_next") && !r.url().includes("_log")) console.log(">>", r.method(), r.url().replace(s.base, "").slice(0, 70), (r.postData() || "").slice(0, 130)); });
  p.on("response", async (r) => { if (r.request().method() !== "GET" && r.url().includes("/api/")) console.log("<<", r.status(), (await r.text().catch(() => "")).slice(0, 160)); });
  await p.goto(s.base + "/journals/hygiene/documents/" + DOC, { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(11000);
  const sw = p.locator("button[role=switch]").first();
  console.log("switch aria", await sw.getAttribute("aria-checked"), "disabled", await sw.isDisabled());
  await sw.click({ force: true });
  await p.waitForTimeout(5000);
  console.log("after click aria", await sw.getAttribute("aria-checked"));
  console.log("TXT tail", (await T(p)).slice(-250));
  await shot(p, "cook-autofill-toggle");
  console.log("AFTER autoFill:", (await db.journalDocument.findUnique({ where: { id: DOC }, select: { autoFill: true } }))?.autoFill);
  // Настройки журнала
  await p.getByRole("button", { name: /Настройки журнала/ }).click().catch((e) => console.log("settings btn err", String(e).slice(0, 80)));
  await p.waitForTimeout(4000);
  console.log("URL", p.url());
  console.log("SETTINGS TXT", (await T(p)).slice(0, 600));
  await shot(p, "cook-journal-settings");
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 600)); process.exit(1); });
