import { openTelegramSession, db } from "../tg-session";
import { shot, sleep } from "./lib";
const T = `document.body.innerText`;
(async () => {
  const hyg = await db.journalDocument.findFirst({ where: { organizationId: "e2e-org-a", template: { code: "hygiene" }, status: "active" }, orderBy: { createdAt: "desc" } });
  for (const role of ["managerA", "cookA"] as const) {
    const s = await openTelegramSession({ role, width: 390, height: 844, theme: "light" });
    const p = s.page;
    await p.goto(s.base + `/journals/hygiene/documents/${hyg!.id}`, { timeout: 300000 }); await sleep(p, 13000);
    const row = p.locator("div").filter({ hasText: /^Иван Повар/ }).last();
    const btn = p.getByRole("button", { name: "Заполнить" });
    const cnt = await btn.count();
    console.log(`[${role}] кнопок «Заполнить»: ${cnt}`);
    // третья строка — Иван Повар
    const target = btn.nth(Math.min(2, cnt - 1));
    await target.scrollIntoViewIfNeeded();
    console.log(`[${role}] disabled:`, await target.isDisabled());
    await target.click({ force: true }).catch(e => console.log("клик упал", String(e).slice(0,80)));
    await sleep(p, 3000);
    await shot(p, `45-${role}-row-sheet`);
    const t = ((await p.evaluate(T)) as string);
    console.log(`[${role}] после тапа (хвост):`, t.replace(/\n+/g, " | ").slice(-500));
    // главная нижняя кнопка
    const main = p.getByRole("button", { name: /Заполнить оставшиеся|Заполнить: / });
    if (await main.count()) {
      await main.first().click({ force: true }); await sleep(p, 3000);
      await shot(p, `45-${role}-main-sheet`);
      console.log(`[${role}] после главной кнопки:`, ((await p.evaluate(T)) as string).replace(/\n+/g," | ").slice(-500));
    }
    console.log(`[${role}] ERRORS`, JSON.stringify(s.errors.slice(0,6)));
    await s.close();
  }
})().catch((e) => { console.log("FATAL", String(e).slice(0, 1500)); process.exit(1); });
