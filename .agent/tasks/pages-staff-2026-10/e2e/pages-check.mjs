// Обход новых страниц «Сотрудников»: три роли × сайт 1440×900, телефон 390×800 и Mini App.
// Запуск из корня worktree: node .agent/tasks/pages-staff-2026-10/e2e/pages-check.mjs
//   ROLES=owner,headchef  KINDS=desktop,mobile,mini  — выборочно.
import {
  PAGES,
  ROLES,
  goto,
  horizontalOverflow,
  launch,
  newContext,
  notes,
  problem,
  problems,
  shot,
  signIn,
  watchErrors,
  writeJson,
} from "./lib.mjs";

const onlyRoles = process.env.ROLES ? process.env.ROLES.split(",") : null;
const kinds = process.env.KINDS ? process.env.KINDS.split(",") : ["desktop", "mobile", "mini"];
const results = { startedAt: new Date().toISOString(), roles: {} };

async function check(browser, role, kind) {
  const context = await newContext(browser, kind);
  const page = await context.newPage();
  const tag = `${role.id}/${kind}`;
  watchErrors(page, tag);
  await signIn(page, role.email);
  const out = {};
  for (const item of PAGES) {
    const response = await goto(page, item.href);
    const status = response?.status() ?? 0;
    const finalPath = new URL(page.url()).pathname;
    const h1 = await page.locator("main h1, h1").first().innerText({ timeout: 5_000 }).catch(() => "");
    const errorBoundary = await page.getByText(/Что-то пошло не так|Something went wrong|Application error/i).count();
    const overflow = kind === "desktop" ? null : await horizontalOverflow(page).catch((error) => ({ error: error.message }));
    const entry = { status, finalPath, h1, errorBoundary, overflow };
    if (kind === "desktop") {
      const sidebar = page.locator("[data-app-sidebar]");
      entry.menu = await sidebar
        .locator('nav[data-section-menu="staff"] [data-menu-item]')
        .evaluateAll((els) => els.map((el) => ({ id: el.getAttribute("data-menu-item"), current: el.getAttribute("aria-current") === "page" })))
        .catch(() => []);
    }
    if (kind === "mini") {
      entry.miniTitle = await page.locator("header").first().innerText({ timeout: 3_000 }).catch(() => "");
    }
    out[item.id] = entry;
    if (status >= 500) problem(`${tag} ${item.href}: HTTP ${status}`);
    if (errorBoundary > 0) problem(`${tag} ${item.href}: страница упала в error boundary`);
    if (role.id === "cook") {
      if (finalPath === item.href) problem(`${tag} ${item.href}: повара пустило на страницу`);
    } else {
      if (finalPath !== item.href) problem(`${tag} ${item.href}: увело на ${finalPath}`);
      if (!h1) problem(`${tag} ${item.href}: нет заголовка h1`);
      if (overflow?.overflow) problem(`${tag} ${item.href}: горизонтальная прокрутка ${JSON.stringify(overflow)}`);
      if (kind === "desktop") {
        const active = entry.menu?.find((menuItem) => menuItem.current);
        if (active?.id !== item.id) problem(`${tag} ${item.href}: в меню подсвечен ${active?.id ?? "ничего"}, ждали ${item.id}`);
      }
    }
    const fullPage = kind !== "mini";
    await shot(page, `${kind}-${role.id}-${item.id}`, { fullPage });
    console.log(`  ${tag} ${item.id}: ${status} → ${finalPath} h1=«${h1}»${overflow?.overflow ? " OVERFLOW" : ""}`);
    if (role.id === "cook") {
      // Повару хватит одной-двух страниц на вид; остальные проверяем без снимков.
    }
  }
  await context.close();
  return out;
}

const browser = await launch();
try {
  for (const role of ROLES) {
    if (onlyRoles && !onlyRoles.includes(role.id)) continue;
    console.log(`== ${role.title} (${role.email})`);
    results.roles[role.id] = {};
    for (const kind of kinds) {
      results.roles[role.id][kind] = await check(browser, role, kind);
      writeJson(`pages-check${onlyRoles ? "-" + onlyRoles.join("-") : ""}.json`, { ...results, problems });
    }
  }
} finally {
  await browser.close();
}
writeJson(`pages-check${onlyRoles ? "-" + onlyRoles.join("-") : ""}.json`, { ...results, finishedAt: new Date().toISOString(), problems, notes });
console.log(problems.length ? `ПРОБЛЕМЫ: ${problems.length}` : "Проблем нет");
