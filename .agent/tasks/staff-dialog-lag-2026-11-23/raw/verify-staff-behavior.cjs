/*
 * Behaviour check of /settings/users after the change (AC3): dialogs, search,
 * selection toolbar, and the timesheet — click, drag, Shift rectangle, keyboard,
 * weekly chips, sorting, month switch, print marks. Every data change is reverted.
 *
 *   BASE=http://localhost:3001 node .agent/tasks/staff-dialog-lag-2026-11-23/raw/verify-staff-behavior.cjs
 */
const { chromium } = require("playwright");
const fs = require("node:fs");
const assert = require("node:assert/strict");

const BASE = process.env.BASE || "http://localhost:3001";
const EMAIL = process.env.EMAIL || "perf-staff-owner@example.test";
const PASSWORD = process.env.PASSWORD || "perf-pass-2026";

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push({ step: name, ok: true });
    console.log(`ok   ${name}`);
  } catch (error) {
    results.push({ step: name, ok: false, error: String(error?.message || error).slice(0, 400) });
    console.log(`FAIL ${name}: ${String(error?.message || error).slice(0, 400)}`);
  }
}

(async () => {
  const executablePath = fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
  const browser = await chromium.launch({ executablePath });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: "ru-RU" });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error" && !/favicon|Failed to load resource/.test(message.text())) pageErrors.push(message.text());
  });
  const requests = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/")) requests.push({ method: request.method(), url: request.url(), body: request.postData() });
  });
  const lastRequest = (method, part) => [...requests].reverse().find((r) => r.method === method && r.url.includes(part));

  await page.goto(`${BASE}/login`);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.press("#password", "Enter");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60000 });
  await page.goto(`${BASE}/settings/users`, { waitUntil: "networkidle", timeout: 120000 });

  const dialog = page.locator('[role="dialog"]');
  const editButtons = page.locator('button[aria-label="Редактировать сотрудника"]');

  await step("«Изменить» открывает окно сотрудника, «Отмена» закрывает", async () => {
    await editButtons.nth(1).click();
    await dialog.waitFor({ state: "visible" });
    assert.match(await dialog.innerText(), /Сохранить/);
    await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
  });

  await step("сохранение правки имени: PUT и обновлённый список, затем откат", async () => {
    await editButtons.nth(1).click();
    await dialog.waitFor({ state: "visible" });
    const input = dialog.locator("input").first();
    const original = await input.inputValue();
    await input.fill(`${original} Т`);
    const put = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes("/api/users/"));
    put.catch(() => {});
    await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
    assert.equal((await put).status(), 200);
    await dialog.waitFor({ state: "detached" });
    await page.getByText(`${original} Т`, { exact: false }).first().waitFor({ timeout: 15000 });
    // Revert.
    await editButtons.nth(1).click();
    await dialog.waitFor({ state: "visible" });
    await dialog.locator("input").first().fill(original);
    const put2 = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes("/api/users/"));
    put2.catch(() => {});
    await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
    assert.equal((await put2).status(), 200);
    await dialog.waitFor({ state: "detached" });
  });

  await step("поиск по ФИО: результаты и «Изменить» из результатов", async () => {
    const search = page.locator('input[type="search"]').first();
    await search.fill("Бубнова");
    const results = page.locator('[data-testid="staff-search-results"] li');
    await results.first().waitFor();
    assert.ok((await results.count()) >= 1);
    await results.first().getByRole("button").click();
    await dialog.waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    await search.fill("");
    await page.locator('[data-testid="staff-search-results"]').waitFor({ state: "detached" });
  });

  await step("«Пригласить в Telegram» открывает окно приглашения", async () => {
    await page.locator('button[aria-label="Пригласить в Telegram"]').first().click();
    await dialog.waitFor({ state: "visible" });
    await page.waitForTimeout(500);
    assert.ok(lastRequest("POST", "/invite-tg"), "POST invite-tg was sent");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
  });

  await step("галочка у сотрудника: панель действий, «Вход без Telegram», снятие выбора", async () => {
    const checkbox = page.locator('label input[type="checkbox"]').nth(1);
    await checkbox.check();
    const bar = page.getByText(/Выбрано/).first();
    await bar.waitFor();
    await page.getByRole("button", { name: /Вход без Telegram/ }).first().click();
    await dialog.waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    await checkbox.uncheck();
    await bar.waitFor({ state: "detached" });
  });

  await step("«Несколько сразу» и «Инструкция» открываются и закрываются", async () => {
    // A custom overlay (not a Radix dialog): found by its title, closed by its «Закрыть».
    await page.getByRole("button", { name: "Несколько сразу" }).click();
    const bulkTitle = page.getByRole("heading", { name: "Добавить несколько сотрудников" });
    await bulkTitle.waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Закрыть", exact: true }).first().click();
    await bulkTitle.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Инструкция" }).first().click();
    await dialog.waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
  });

  // ---- Timesheet ----
  await step("табель появляется при прокрутке к нему", async () => {
    await page.locator("[data-print-landscape]").first().scrollIntoViewIfNeeded();
    await page.waitForSelector("[data-print-schedule] tbody tr", { timeout: 30000 });
    const rows = await page.locator("[data-print-schedule] tbody tr").count();
    assert.equal(rows, 117);
  });

  const cellAt = (row, col) => page.locator("[data-print-schedule] tbody tr").nth(row).locator("[data-workoff-cell]").nth(col);
  const pressed = async (row, col) => (await cellAt(row, col).getAttribute("aria-pressed")) === "true";
  const bulkBody = () => JSON.parse(lastRequest("POST", "/work-off/bulk")?.body || "{}");
  const waitBulk = () => {
    const promise = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/work-off/bulk"));
    promise.catch(() => {}); // a failed step must not crash the run
    return promise;
  };

  // Pick a working weekday column (Mon–Fri) for row 5, cell not ticked.
  const workingCol = async (row) => {
    for (let col = 0; col < 28; col++) {
      if (!(await pressed(row, col))) return col;
    }
    throw new Error("no working day");
  };

  await step("клик по клетке: отметка сразу, один POST, сохраняется после перезагрузки; повторный клик снимает", async () => {
    const col = await workingCol(5);
    const done = waitBulk();
    await cellAt(5, col).click();
    assert.equal(await pressed(5, col), true);
    assert.equal((await done).status(), 200);
    const body = bulkBody();
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0].enabled, true);
    await page.reload({ waitUntil: "networkidle" });
    await page.locator("[data-print-landscape]").first().scrollIntoViewIfNeeded();
    await page.waitForSelector("[data-print-schedule] tbody tr");
    assert.equal(await pressed(5, col), true, "persisted after reload");
    const undo = waitBulk();
    await cellAt(5, col).click();
    assert.equal((await undo).status(), 200);
    assert.equal(await pressed(5, col), false);
  });

  await step("протяжка по трём клеткам строки: все три в одном POST, обратная протяжка снимает", async () => {
    await page.waitForTimeout(800);
    const col = await workingCol(7);
    const start = await cellAt(7, col).boundingBox();
    const end = await cellAt(7, col + 2).boundingBox();
    const stroke = async () => {
      const done = waitBulk();
      await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
      await page.mouse.down();
      await page.mouse.move(start.x + start.width * 1.5, start.y + start.height / 2, { steps: 4 });
      await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 4 });
      await page.mouse.up();
      return done;
    };
    assert.equal((await stroke()).status(), 200);
    const items = bulkBody().items.filter((item) => item.enabled);
    assert.ok(items.length >= 3, `painted ${items.length}`);
    for (const c of [col, col + 1, col + 2]) assert.equal(await pressed(7, c), true);
    await page.waitForTimeout(1200);
    assert.equal((await stroke()).status(), 200);
    for (const c of [col, col + 1, col + 2]) assert.equal(await pressed(7, c), false);
  });

  await step("Shift-клик: прямоугольник от прошлой клетки", async () => {
    await page.waitForTimeout(1200);
    const col = await workingCol(9);
    const first = waitBulk();
    await cellAt(9, col).click();
    await first;
    await page.waitForTimeout(1200);
    const second = waitBulk();
    await cellAt(10, col + 1).click({ modifiers: ["Shift"] });
    await second;
    const states = [await pressed(9, col), await pressed(9, col + 1), await pressed(10, col), await pressed(10, col + 1)];
    // The rectangle takes the value «opposite of the clicked cell» — all four end up equal.
    assert.ok(states.every((s) => s === states[3]), `rect states ${states}`);
    // Revert: clear whatever the rectangle set.
    await page.waitForTimeout(1200);
    for (const [r, c] of [[9, col], [9, col + 1], [10, col], [10, col + 1]]) {
      if (await pressed(r, c)) {
        const done = waitBulk();
        await cellAt(r, c).click();
        await done;
        await page.waitForTimeout(900);
      }
    }
  });

  await step("клавиатура: Enter отмечает, Пробел снимает (по POST на каждое)", async () => {
    await page.waitForTimeout(800);
    const col = await workingCol(11);
    await cellAt(11, col).focus();
    const on = waitBulk();
    await page.keyboard.press("Enter");
    assert.equal((await on).status(), 200);
    assert.equal(await pressed(11, col), true);
    await page.waitForTimeout(1200);
    await cellAt(11, col).focus();
    const off = waitBulk();
    await page.keyboard.press(" ");
    assert.equal((await off).status(), 200);
    assert.equal(await pressed(11, col), false);
  });

  await step("недельный чип: PATCH и бледные «по правилу» отметки в строке, затем откат", async () => {
    await page.waitForTimeout(800);
    const row = page.locator("[data-print-schedule] tbody tr").nth(13);
    const chips = row.locator('[role="group"] button');
    // Find a weekday that is not a day off yet.
    let index = -1;
    for (let i = 0; i < 5; i++) {
      if ((await chips.nth(i).getAttribute("aria-pressed")) === "false") {
        index = i;
        break;
      }
    }
    assert.ok(index >= 0, "a free weekday");
    const patch = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes("/api/staff/"));
    patch.catch(() => {});
    await chips.nth(index).click();
    assert.equal((await patch).status(), 200);
    assert.equal(await chips.nth(index).getAttribute("aria-pressed"), "true");
    const sent = JSON.parse(lastRequest("PATCH", "/api/staff/").body);
    assert.ok(sent.weeklyDaysOff.includes(index));
    // Days of that weekday are now ticked by the rule (semi-transparent box).
    const ruleBoxes = await row.locator("[data-workoff-cell] span.opacity-50").count();
    assert.ok(ruleBoxes >= 4, `rule boxes ${ruleBoxes}`);
    await page.waitForTimeout(800);
    const back = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes("/api/staff/"));
    back.catch(() => {});
    await chips.nth(index).click();
    assert.equal((await back).status(), 200);
    assert.equal(await chips.nth(index).getAttribute("aria-pressed"), "false");
  });

  await step("сортировка по ФИО: ↑, ↓, исходный порядок", async () => {
    const firstName = async () => (await page.locator("[data-print-schedule] tbody tr").first().locator("td").first().innerText()).trim();
    const original = await firstName();
    const head = page.locator("[data-print-schedule] thead th").first().getByRole("button");
    await head.click();
    const asc = await firstName();
    await head.click();
    const desc = await firstName();
    assert.notEqual(asc, desc);
    await head.click();
    assert.equal(await firstName(), original);
  });

  await step("смена месяца и «Текущий»", async () => {
    const firstHead = async () => (await page.locator("[data-print-schedule] thead th").nth(3).innerText()).trim();
    const current = await firstHead();
    await page.getByRole("button", { name: "Следующий месяц" }).click();
    await page.waitForTimeout(300);
    const next = await firstHead();
    assert.notEqual(next, current);
    assert.match(next, /^01\./);
    await page.getByRole("button", { name: "Текущий", exact: true }).click();
    await page.waitForTimeout(300);
    assert.equal(await firstHead(), current);
  });

  await step("печать: табель виден, отметки — буквой через ::after", async () => {
    await page.emulateMedia({ media: "print" });
    await page.waitForTimeout(300);
    const info = await page.evaluate(() => {
      const wrapper = document.querySelector("[data-offscreen]");
      const cells = [...document.querySelectorAll('[data-workoff-cell][aria-pressed="true"]')].slice(0, 20);
      return {
        visibility: wrapper ? getComputedStyle(wrapper).contentVisibility : null,
        marks: cells.map((cell) => getComputedStyle(cell, "::after").content),
        unpressed: getComputedStyle(document.querySelector('[data-workoff-cell][aria-pressed="false"]'), "::after").content,
      };
    });
    await page.emulateMedia({ media: "screen" });
    assert.equal(info.visibility, "visible");
    assert.ok(info.marks.length > 0 && info.marks.every((m) => m === '"В"'), `marks ${JSON.stringify(info.marks.slice(0, 3))}`);
    assert.ok(["none", "normal", '""'].includes(info.unpressed), `unpressed ${info.unpressed}`);
  });

  await step("табель вдали от экрана: content-visibility hidden, рядом — visible", async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(800);
    const far = await page.evaluate(() => document.querySelector("[data-offscreen]")?.getAttribute("data-offscreen"));
    await page.locator("[data-print-landscape]").first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    const near = await page.evaluate(() => document.querySelector("[data-offscreen]")?.getAttribute("data-offscreen"));
    assert.equal(near, "visible");
    // On a 1080px screen the timesheet starts below the staff columns.
    assert.equal(far, "hidden");
  });

  await step("на странице нет ошибок JS", async () => {
    assert.deepEqual(pageErrors, []);
  });

  console.log(JSON.stringify({ base: BASE, passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length }));
  fs.writeFileSync(process.env.OUT || "/dev/null", JSON.stringify(results, null, 1));
  await browser.close();
  if (results.some((r) => !r.ok)) process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
