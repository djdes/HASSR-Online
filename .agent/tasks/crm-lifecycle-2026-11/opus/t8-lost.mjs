import { login, sql, close, errors, OUT, BASE } from "./lib.mjs";
const note = (s) => console.log(s);
const alexey = await login("alexey");
const p = alexey.page;
await p.goto(`${BASE}/root/crm/funnel`, { waitUntil: "networkidle" });
const src = p.locator('[data-funnel-card="Сеть «Вкусно рядом» e2e"]');
note(`src column: ${await src.evaluate((el) => el.closest("[data-funnel-column]").getAttribute("data-funnel-column"))}`);
await src.dragTo(p.locator('[data-funnel-column="lost"]'));
await p.waitForTimeout(1500);
note(`lost dialog after DnD: ${await p.locator("[data-funnel-lost-reason]").count()}; dialogs: ${await p.locator('[role="dialog"]').count()}`);
if (!(await p.locator("[data-funnel-lost-reason]").count())) {
  // manual mouse DnD fallback
  const a = await src.boundingBox();
  const b = await p.locator('[data-funnel-column="lost"]').boundingBox();
  await p.mouse.move(a.x + 20, a.y + 20);
  await p.mouse.down();
  await p.mouse.move(b.x + 50, b.y + 100, { steps: 20 });
  await p.mouse.up();
  await p.waitForTimeout(1500);
  note(`lost dialog after manual mouse DnD: ${await p.locator("[data-funnel-lost-reason]").count()}`);
}
await p.locator('[data-funnel-card="Сеть «Вкусно рядом» e2e"] [data-funnel-move]').selectOption("lost");
await p.waitForSelector("[data-funnel-lost-reason]");
await p.fill("[data-funnel-lost-reason]", "ПРИЧИНА ДЛЯ ВКУСНО РЯДОМ");
const buttons = await p.locator('[role="dialog"] button').allInnerTexts();
note(`dialog buttons: ${JSON.stringify(buttons)}`);
await p.locator('[role="dialog"] button', { hasText: /Отмена|Отменить/ }).first().click();
await p.waitForTimeout(600);
note(`year select after cancel: ${await p.locator('[data-funnel-card="Сеть «Вкусно рядом» e2e"] [data-funnel-move]').inputValue()}`);
await p.locator('[data-funnel-card="Ресторан «Оплатили» e2e"] [data-funnel-move]').selectOption("lost");
await p.waitForSelector("[data-funnel-lost-reason]");
note(`lost dialog for Оплатили prefilled: "${await p.inputValue("[data-funnel-lost-reason]")}"`);
await p.screenshot({ path: `${OUT}/ui-02-lost-prefilled.png` });
await p.locator('[role="dialog"] button', { hasText: /Отмена|Отменить/ }).first().click();
note(`errors ${errors.length}`);
await close();
