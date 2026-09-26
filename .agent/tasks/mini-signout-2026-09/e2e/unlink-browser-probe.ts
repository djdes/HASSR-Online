// Разовая проба (не критерий спеки): «Отвязать Telegram» вне Telegram после
// входа по телефону. Отвязка по спеке не менялась («как раньше») — проба
// показывает, остаётся ли после неё сессия в обычном браузере.
// Запуск (dev на 3044): npx tsx .agent/tasks/mini-signout-2026-09/e2e/unlink-browser-probe.ts
import { db } from "./db";
import { PASSWORD, USERS } from "./fixtures";
import { BASE, launch, openPhone } from "./tg";

async function main() {
  await db.user.update({ where: { email: USERS.a.email }, data: { telegramChatId: USERS.a.tg } });
  const browser = await launch();
  try {
    const { ctx, page } = await openPhone(browser, { telegram: false });
    await page.goto(`${BASE}/mini/login`, { waitUntil: "load" });
    const phone = page.locator("#phone");
    await phone.waitFor();
    await page.waitForFunction(() => {
      const el = document.querySelector("#phone");
      return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps"));
    });
    await phone.fill(USERS.a.phone);
    await page.locator("#password").fill(PASSWORD);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.waitForURL((u) => u.pathname !== "/mini/login" && u.pathname !== "/mini", { timeout: 180_000 });
    await page.goto(`${BASE}/mini/me`, { waitUntil: "load" });
    const row = page.getByRole("button", { name: /^Отвязать Telegram/ });
    await row.waitFor();
    await page.waitForFunction(() =>
      [...document.querySelectorAll("button")].some(
        (b) => b.textContent?.startsWith("Отвязать Telegram") && Object.keys(b).some((k) => k.startsWith("__reactProps")),
      ),
    );
    await row.click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox").fill("ОТВЯЗАТЬ");
    await dialog.getByRole("button", { name: "Отвязать", exact: true }).click();
    await page.waitForURL((u) => u.pathname !== "/mini/me", { timeout: 180_000 });
    await page.waitForTimeout(7000);
    const r = await ctx.request.get(`${BASE}/api/mini/session`);
    const link = await db.user.findUniqueOrThrow({ where: { email: USERS.a.email }, select: { telegramChatId: true } });
    const cookies = (await ctx.cookies()).filter((c) => /session-token/.test(c.name)).map((c) => c.name);
    console.log(
      JSON.stringify({
        finalPath: new URL(page.url()).pathname,
        serverSession: r.status() === 401 ? null : ((await r.json()) as { user?: { name?: string } }).user?.name,
        telegramChatId: link.telegramChatId,
        sessionCookies: cookies,
      }),
    );
  } finally {
    await browser.close();
    await db.user.update({ where: { email: USERS.a.email }, data: { telegramChatId: USERS.a.tg } });
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
