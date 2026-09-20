import { openTelegramSession, db, state } from "../tg-session";
import { shot } from "./lib";
const T = async (p: any) => ((await p.evaluate(`document.body.innerText`)) as string).replace(/\s+/g, " ");
(async () => {
  const c = await db.journalTaskClaim.findFirst({ where: { userId: state.users.cleanerA.id, status: "active" } });
  console.log("claim", c?.id);
  const s = await openTelegramSession({ role: "cleanerA", width: 390, height: 844, theme: "light" });
  const p = s.page;
  p.on("response", async (r) => { if (r.request().method() !== "GET" && r.url().includes("/api/")) console.log("<<", r.status(), r.url().replace(s.base, "").slice(0, 60), (await r.text().catch(() => "")).slice(0, 200)); });
  await p.goto(s.base + "/mini/claim/" + c!.id, { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(8000);
  // try complete without anything
  const submit = p.locator("button").filter({ hasText: /Завершить|Нужно фото/ }).last();
  console.log("submit label:", (await submit.innerText()).replace(/\s+/g, " "), "disabled:", await submit.isDisabled());
  await submit.click({ force: true }).catch(() => {});
  await p.waitForTimeout(2500);
  console.log("after click", (await T(p)).slice(-260));
  await shot(p, "cleaner-submit-blocked");
  // tick all checkboxes
  const n = await p.locator("input[type=checkbox]").count();
  console.log("checkboxes", n);
  for (let i = 0; i < n; i++) { await p.locator("input[type=checkbox]").nth(i).click({ force: true }).catch(() => {}); }
  await p.waitForTimeout(1500);
  console.log("submit now:", (await submit.innerText()).replace(/\s+/g, " "), "disabled:", await submit.isDisabled());
  await shot(p, "cleaner-all-checked");
  // photo button
  const ph = p.getByRole("button", { name: /Снять фото/ });
  console.log("photo btn", await ph.count());
  if (await ph.count()) { await ph.first().click(); await p.waitForTimeout(3000); console.log("after photo click", (await T(p)).slice(-350)); await shot(p, "cleaner-photo-sheet"); }
  console.log("popups", JSON.stringify(await p.evaluate(`window.__tgHost.popups`)));
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 700)); process.exit(1); });
