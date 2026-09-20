import { openTelegramSession } from "../tg-session";
import { shot } from "./lib";
const T = async (p: any) => ((await p.evaluate(`document.body.innerText`)) as string).replace(/\s+/g, " ");
(async () => {
  const s = await openTelegramSession({ role: "cookA", width: 360, height: 640, theme: "light" });
  const p = s.page;
  await p.goto(s.base + "/mini/me", { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(6000);
  // Отвязать Telegram — только открыть окно
  await p.getByText("Отвязать Telegram").click();
  await p.waitForTimeout(2000);
  console.log("UNLINK DIALOG", (await T(p)).slice(-500));
  await shot(p, "me-unlink-dialog");
  await shot(p, "me-unlink-dialog-full", true);
  // close
  const cancel = p.getByRole("button", { name: "Отмена", exact: true }).first();
  if (await cancel.count()) { await cancel.click(); await p.waitForTimeout(1500); }
  console.log("after cancel url", p.url().replace(s.base, ""));
  // Выйти dialog (open only)
  await p.getByText("Выйти", { exact: true }).click();
  await p.waitForTimeout(2000);
  console.log("SIGNOUT DIALOG", (await T(p)).slice(-450));
  await shot(p, "me-signout-dialog");
  const c2 = p.getByRole("button", { name: "Отмена", exact: true }).first();
  if (await c2.count()) await c2.click();
  await p.waitForTimeout(1500);
  // Открыть полную версию сайта
  const full = p.getByText("Открыть полную версию сайта");
  await full.click();
  await p.waitForTimeout(6000);
  console.log("after full-site url", p.url().replace(s.base, ""));
  console.log("TXT", (await T(p)).slice(0, 350));
  await shot(p, "me-full-site");
  console.log("cookies/local", await p.evaluate(`JSON.stringify(Object.keys(localStorage).map(k=>k+'='+localStorage.getItem(k)).slice(0,12))`));
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 700)); process.exit(1); });
