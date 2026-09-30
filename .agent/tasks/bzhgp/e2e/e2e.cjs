// E2E bzhgp: в журнале бракеража готовой продукции время подписи комиссии =
// время бракеража строки + 1 минута (экран 1280/390, Mini App, QR, PDF, Word),
// настоящий момент — в подписи, журнале подписей и журнале действий, старые
// подписи в базе не переписаны.
// Запуск: node d:/wt/tmp-bzhgp/e2e.cjs (стенд :3195 должен работать).
const fs = require("node:fs");
const path = require("node:path");
const L = require("./lib.cjs");

const PASSWORD = "Bzhgp2026!";
const MEMBER_PIN = "5931";
// Браузер как у кухни в России: русская локаль (время 24 ч) и пояс Москвы.
const RU = { locale: "ru-RU", timezoneId: "Europe/Moscow" };
const results = { startedAt: new Date().toISOString(), checks: [], pageErrors: [], facts: {} };

function check(name, ok, detail) {
  results.checks.push({ name, ok: Boolean(ok), ...(ok ? {} : { detail }) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` :: ${JSON.stringify(detail).slice(0, 600)}`}`);
}

async function docConfig(docId) {
  return (await L.sql(`select config from "JournalDocument" where id = $1`, [docId]))[0].config;
}

async function rowText(page, name) {
  return (await page.locator("tbody tr", { hasText: name }).first().innerText()).replace(/\s+/g, " ");
}

/** Карточка на телефоне раскрывается кнопкой с заголовком; открыта одна за раз. */
async function expandCard(page, title) {
  const btn = page.locator("button[aria-expanded]", { hasText: title }).first();
  await btn.waitFor({ timeout: 240000 });
  if ((await btn.getAttribute("aria-expanded")) !== "true") await btn.click();
  await page.waitForTimeout(500);
  const card = btn.locator("xpath=ancestor::div[contains(@class,'rounded-2xl')][1]");
  return { card, text: (await card.innerText()).replace(/\s+/g, " ") };
}

/** JSON с ключами по алфавиту: jsonb в базе переставляет ключи. */
function canon(value) {
  if (Array.isArray(value)) return value.map(canon);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canon(value[key])]));
  }
  return value;
}

(async () => {
  const run = Date.now().toString(36);
  const today = L.moscowToday();
  const t = (hhmm) => `${today} ${hhmm}`;
  const email = `bz-owner-${run}@example.com`;
  results.facts.today = today;
  const browser = await L.launch();
  try {
    // ---------------------------------------------------------------- посев
    const setup = await browser.newContext();
    const reg = await setup.request.post(`${L.BASE}/api/auth/instant-register`, {
      data: { email, consent: true },
      headers: { "x-forwarded-for": "10.95.0.11", "x-real-ip": "10.95.0.11" },
      timeout: 240000,
    });
    const regBody = await reg.json().catch(() => null);
    if (reg.status() !== 200 || !regBody || regBody.created !== true) {
      throw new Error(`instant-register: ${reg.status()} ${JSON.stringify(regBody)}`);
    }
    const [owner] = await L.sql('select id, "organizationId" from "User" where email = $1', [email]);
    const orgId = owner.organizationId;
    await L.sql(`update "User" set name = $1, "passwordHash" = $2, "showWhatsNew" = false where id = $3`, [
      "Иванова Анна Андреевна",
      L.hash(PASSWORD),
      owner.id,
    ]);
    // Новая организация создаётся с выключенными журналами (выбор при онбординге) — БЖГП включаем.
    await L.sql(
      `update "Organization" set name = $1, "subscriptionPlan" = 'paid', "subscriptionEnd" = now() + interval '30 days',
         "disabledJournalCodes" = "disabledJournalCodes" - 'finished_product' where id = $2`,
      ["Столовая «Бракераж»", orgId]
    );
    await L.sql(
      `update "Account" set "subscriptionPlan" = 'paid', "subscriptionEnd" = now() + interval '30 days'
         where id = (select "accountId" from "Organization" where id = $1)`,
      [orgId]
    );

    const put = await L.api(setup, "PUT", "/api/settings/brakerage-commission/finished_product", {
      members: [{ employeeId: owner.id, role: "Председатель" }],
    });
    check("посев: руководитель — председатель комиссии", put.status === 200, put);
    const member = await L.api(setup, "POST", "/api/settings/brakerage-commission/finished_product/members", {
      fullName: "Петров Пётр Петрович",
      pin: MEMBER_PIN,
    });
    const memberId = member.body && member.body.user && member.body.user.id;
    check("посев: член комиссии с ПИН в составе", member.status === 200 && Boolean(memberId), member);

    const monthStart = `${today.slice(0, 8)}01`;
    const lastDay = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate();
    const created = await L.api(setup, "POST", "/api/journal-documents", {
      templateCode: "finished_product",
      title: "Бракеражный журнал",
      dateFrom: monthStart,
      dateTo: `${today.slice(0, 8)}${String(lastDay).padStart(2, "0")}`,
    });
    const docId = created.body && created.body.document && created.body.document.id;
    check("посев: документ БЖГП создан", created.status === 201 && Boolean(docId), created);
    results.facts.orgId = orgId;
    results.facts.docId = docId;

    // Строки: 12:30 → подпишет председатель на сайте; 12:45 → член комиссии по QR;
    // две старые подписи (до правила, без journalAt); 13:10 → подпись и правка
    // бракеража вручную; строка без времени бракеража.
    const legacyLate = {
      userId: owner.id,
      name: "Иванова Анна Андреевна",
      role: "Председатель",
      signedAt: L.moscowIso(today, "15:10"),
      method: "qr",
      grade: "Отлично",
    };
    const legacyInWindow = {
      userId: memberId,
      name: "Петров Пётр Петрович",
      role: "Член комиссии",
      signedAt: L.moscowIso(today, "13:03"),
      method: "qr",
      grade: "Отлично",
    };
    const blank = {
      organoleptic: "Отлично",
      releaseAllowed: "yes",
      portionWeight: "",
      note: "",
      productTemp: "",
      correctiveAction: "",
      courierTransferTime: "",
      oxygenLevel: "",
      responsiblePerson: "",
      inspectorName: "",
      organolepticValue: "",
      organolepticResult: "",
    };
    const rows = [
      { ...blank, id: "bz-r1", productName: "Суп куриный", productionDateTime: t("12:25"), rejectionTime: t("12:30"), releasePermissionTime: t("12:35") },
      { ...blank, id: "bz-r2", productName: "Котлета говяжья", productionDateTime: t("12:40"), rejectionTime: t("12:45"), releasePermissionTime: t("12:50") },
      { ...blank, id: "bz-r3", productName: "Каша гречневая", productionDateTime: t("07:55"), rejectionTime: t("08:00"), releasePermissionTime: t("08:05"), signatures: [legacyLate] },
      { ...blank, id: "bz-r4", productName: "Компот из сухофруктов", productionDateTime: t("12:55"), rejectionTime: t("13:00"), releasePermissionTime: t("13:05"), signatures: [legacyInWindow] },
      { ...blank, id: "bz-r5", productName: "Салат овощной", productionDateTime: t("13:05"), rejectionTime: t("13:10"), releasePermissionTime: t("13:15") },
      { ...blank, id: "bz-r6", productName: "Хлеб пшеничный", productionDateTime: "", rejectionTime: "", releasePermissionTime: "" },
    ];
    const cfg0 = await docConfig(docId);
    const members = (cfg0.commissionMembers || []).map((m) => m.employeeId);
    check("посев: состав комиссии скопирован в документ", members.includes(owner.id) && members.includes(memberId), cfg0.commissionMembers);
    await L.sql(`update "JournalDocument" set config = $1 where id = $2`, [JSON.stringify({ ...cfg0, rows }), docId]);

    // Подпись на сайте через API (как «Подписать выбранные»): салат и хлеб.
    const apiSign = await L.api(setup, "POST", `/api/journal-documents/${docId}/sign`, {
      entries: [{ rowId: "bz-r5" }, { rowId: "bz-r6" }],
    });
    check("API подписи: 2 строки", apiSign.status === 200 && apiSign.body && apiSign.body.signed === 2, apiSign);
    const afterApi = await docConfig(docId);
    const sig5 = afterApi.rows.find((r) => r.id === "bz-r5").signatures[0];
    const sig6 = afterApi.rows.find((r) => r.id === "bz-r6").signatures[0];
    const r6 = afterApi.rows.find((r) => r.id === "bz-r6");
    check("салат: время подписи в журнале 13:11 (бракераж 13:10 + 1)", sig5.journalAt === t("13:11"), sig5);
    check("хлеб без времени бракеража: journalAt нет — в журнале настоящее время", !("journalAt" in sig6), { sig6, r6 });
    results.facts.r6 = { signedAt: sig6.signedAt, signedAtMoscow: L.moscowHhmm(sig6.signedAt), rejectionTime: r6.rejectionTime };

    // ---------------------------------------------------------------- сайт, 1280
    const desk = await browser.newContext({ ...RU, viewport: { width: 1280, height: 900 } });
    const loginDesk = await L.login(desk, email, PASSWORD);
    check("вход председателя (1280)", loginDesk.session, loginDesk);
    await L.api(desk, "POST", "/api/me/notices", { key: "fill-guide:finished_product" });
    await L.api(desk, "POST", "/api/legal/accept", { consent: true });
    const page = await L.quietPage(desk, "site-1280", results);
    await L.gotoHydrated(page, `/journals/finished_product/documents/${docId}`, "tbody tr");
    await page.locator("tbody tr", { hasText: "Суп куриный" }).first().waitFor({ timeout: 120000 });

    const t0 = Date.now();
    await page.locator("tbody tr", { hasText: "Суп куриный" }).first().getByRole("checkbox").first().click();
    await page.getByTestId("selection-sign").click();
    await page.getByText(/Подписано строк: 1/).first().waitFor({ timeout: 120000 });
    const t1 = Date.now();
    await page.waitForTimeout(800);
    const r1Text = await rowText(page, "Суп куриный");
    check("сайт 1280: бракераж 12:30 → «Иванова А. А. · 12:31»", r1Text.includes("Иванова А. А. · 12:31"), r1Text);

    const cfg1 = await docConfig(docId);
    const sig1 = cfg1.rows.find((r) => r.id === "bz-r1").signatures[0];
    check("строка: journalAt = бракераж + 1 минута", sig1.journalAt === t("12:31"), sig1);
    check(
      "строка: signedAt — настоящий момент нажатия",
      Date.parse(sig1.signedAt) >= t0 - 5000 && Date.parse(sig1.signedAt) <= t1 + 5000,
      { signedAt: sig1.signedAt, t0: new Date(t0).toISOString(), t1: new Date(t1).toISOString() }
    );
    results.facts.r1 = { signedAt: sig1.signedAt, signedAtMoscow: L.moscowHhmm(sig1.signedAt), journalAt: sig1.journalAt };
    // createdAt — timestamp без пояса (Prisma пишет UTC): читаем строкой, иначе pg сдвинет на пояс машины.
    const events = await L.sql(
      `select to_char("createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "createdAt", "entryRef", method
         from "SignatureEvent" where "documentId" = $1 and "rowId" = 'bz-r1'`,
      [docId]
    );
    check(
      "журнал подписей: настоящее время (createdAt) и время в журнале (entryRef.journalAt)",
      events.length === 1 &&
        Math.abs(Date.parse(events[0].createdAt) - Date.parse(sig1.signedAt)) < 5000 &&
        events[0].entryRef.journalAt === t("12:31"),
      events
    );
    results.facts.r1.signatureEventCreatedAt = events[0] && events[0].createdAt;
    const siteAudit = await L.sql(
      `select details, "createdAt", "userName" from "AuditLog" where action = 'journal.brakerage_sign' and "entityId" = $1 and details->>'method' = 'session' order by "createdAt"`,
      [docId]
    );
    const r1Audit = siteAudit.find((a) => (a.details.rows || []).includes("bz-r1"));
    check(
      "журнал действий (сайт): signedAt настоящий, journalTimes 12:31",
      r1Audit &&
        r1Audit.details.signedAt === sig1.signedAt &&
        r1Audit.details.journalTimes.some((j) => j.rowId === "bz-r1" && j.journalAt === t("12:31")),
      siteAudit
    );
    const r3Text = await rowText(page, "Каша гречневая");
    const r4Text = await rowText(page, "Компот из сухофруктов");
    const r5Text = await rowText(page, "Салат овощной");
    const r6Text = await rowText(page, "Хлеб пшеничный");
    check("старая подпись в 15:10 при бракераже 08:00 → 08:01", r3Text.includes("Иванова А. А. · 08:01"), r3Text);
    check("старая подпись в 13:03 при бракераже 13:00 (окно 5 мин) → как есть 13:03", r4Text.includes("Петров П. П. · 13:03"), r4Text);
    check("подпись по API: салат 13:11", r5Text.includes("Иванова А. А. · 13:11"), r5Text);
    check(
      "без времени бракеража — как сейчас: настоящее время подписи",
      r6Text.includes(`Иванова А. А. · ${results.facts.r6.signedAtMoscow}`),
      { r6Text, expected: results.facts.r6.signedAtMoscow }
    );
    await L.shot(page, "1280-table");

    // Окно блюда: «Комиссия» — то же время; правка бракеража вручную → подпись за ним.
    await page.locator("tbody tr", { hasText: "Суп куриный" }).first().getByRole("checkbox").first().click();
    await page.getByTestId("selection-edit").click();
    const status1 = page.getByTestId("commission-row-status");
    await status1.waitFor({ timeout: 60000 });
    const status1Text = (await status1.innerText()).replace(/\s+/g, " ");
    check("окно блюда: «подписал · 12:31»", status1Text.includes("подписал · 12:31"), status1Text);
    await status1.scrollIntoViewIfNeeded();
    await L.shot(page, "1280-dialog-soup");
    await page.getByRole("button", { name: "Отмена" }).click();
    await status1.waitFor({ state: "hidden", timeout: 30000 });
    // Выделение супа осталось — снимаем, иначе «Изменить» откроет его первым.
    const soupBox = page.locator("tbody tr", { hasText: "Суп куриный" }).first().getByRole("checkbox").first();
    if ((await soupBox.getAttribute("aria-checked")) === "true" || (await soupBox.getAttribute("data-state")) === "checked") {
      await soupBox.click();
    }

    await page.locator("tbody tr", { hasText: "Салат овощной" }).first().getByRole("checkbox").first().click();
    await page.getByTestId("selection-edit").click();
    const status5 = page.getByTestId("commission-row-status");
    await status5.waitFor({ timeout: 60000 });
    const before5 = (await status5.innerText()).replace(/\s+/g, " ");
    await page.getByLabel("Время снятия бракеража", { exact: true }).fill("13:20");
    await page.waitForTimeout(300);
    const after5 = (await status5.innerText()).replace(/\s+/g, " ");
    check(
      "правка вручную: бракераж 13:10 → 13:20, подпись 13:11 → 13:21 прямо в окне",
      before5.includes("подписал · 13:11") && after5.includes("подписал · 13:21"),
      { before5, after5 }
    );
    // В кадре — и поле времени бракеража, и блок «Комиссия» с новой подписью.
    await status5.evaluate((el) => el.scrollIntoView({ block: "end" }));
    await L.shot(page, "1280-dialog-salad-edited");
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await status5.waitFor({ state: "hidden", timeout: 60000 });
    await page.waitForTimeout(1500);
    const r5After = await rowText(page, "Салат овощной");
    check("правка вручную: в таблице «Иванова А. А. · 13:21»", r5After.includes("Иванова А. А. · 13:21"), r5After);
    const cfg5 = await docConfig(docId);
    const row5 = cfg5.rows.find((r) => r.id === "bz-r5");
    check(
      "правка вручную: бракераж сохранён 13:20, подпись в базе не тронута (signedAt, journalAt как при подписи)",
      row5.rejectionTime === t("13:20") &&
        row5.signatures[0].signedAt === sig5.signedAt &&
        row5.signatures[0].journalAt === t("13:11"),
      row5
    );

    // ---------------------------------------------------------------- Mini App / телефон, 390
    const phone = await browser.newContext({ ...RU, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const loginPhone = await L.login(phone, email, PASSWORD);
    check("вход председателя (390)", loginPhone.session, loginPhone);
    const mp = await L.quietPage(phone, "mini-390", results);
    await mp.goto(`${L.BASE}/mini/documents/${docId}`, { waitUntil: "domcontentloaded", timeout: 240000 });
    await mp.waitForURL((u) => u.pathname === `/journals/finished_product/documents/${docId}`, { timeout: 240000 });
    check("Mini App: /mini/documents/:id ведёт на ту же страницу сайта", true);
    const soup = await expandCard(mp, "№1 · Суп куриный");
    check("телефон 390: карточка «Суп куриный» — «Иванова А. А. · 12:31»", soup.text.includes("Иванова А. А. · 12:31"), soup.text);
    await soup.card.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await mp.evaluate(() => window.scrollBy(0, -140));
    await L.shot(mp, "390-cards");

    // ---------------------------------------------------------------- QR, член комиссии по ПИН, 390
    const { token } = L.helper(["token", orgId, docId]);
    const qrUrl = `${L.BASE}/journal-fill/${orgId}/finished_product?${new URLSearchParams({ token, employee: memberId })}`;
    const qrCtx = await browser.newContext({ ...RU, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const qp = await L.quietPage(qrCtx, "qr-390", results);
    await qp.goto(qrUrl, { waitUntil: "load", timeout: 240000 });
    await qp.locator("#qr-pin").waitFor({ timeout: 120000 });
    await qp.fill('#qr-pin input[name="pin"]', MEMBER_PIN);
    await Promise.all([qp.waitForLoadState("load"), qp.locator("#qr-pin button[type=submit]").click()]);
    await qp.locator("#bk-form").waitFor({ timeout: 120000 });
    const qrBefore = (await qp.locator("main").innerText()).replace(/\s+/g, " ");
    check("QR: суп — «Подписано: Иванова А. А. · 12:31»", qrBefore.includes("Подписано: Иванова А. А. · 12:31"), qrBefore.slice(0, 800));
    check("QR: подсказка комиссии про минуту после бракеража", qrBefore.includes("в журнале она встанет на минуту позже времени бракеража"), qrBefore.slice(0, 400));
    await qp.locator('input[name="adm:bz-r2"][value="yes"]').evaluate((el) => el.click());
    await L.shot(qp, "390-qr-before-sign", true);
    const q0 = Date.now();
    await qp.locator("[data-sign-btn]").click();
    await qp.locator(".ok").waitFor({ timeout: 120000 });
    const q1 = Date.now();
    const doneText = await qp.locator("main").innerText();
    check("QR: «Подписано: 1»", doneText.includes("Подписано: 1"), doneText.slice(0, 300));
    await qp.goto(qrUrl, { waitUntil: "load", timeout: 240000 });
    if (await qp.locator("#qr-pin").count()) {
      await qp.fill('#qr-pin input[name="pin"]', MEMBER_PIN);
      await Promise.all([qp.waitForLoadState("load"), qp.locator("#qr-pin button[type=submit]").click()]);
    }
    await qp.locator("#bk-form").waitFor({ timeout: 120000 });
    const qrAfter = (await qp.locator("main").innerText()).replace(/\s+/g, " ");
    check("QR: котлета (бракераж 12:45) — «Петров П. П. · 12:46»", qrAfter.includes("Подписано: Петров П. П. · 12:46"), qrAfter.slice(0, 900));
    await L.shot(qp, "390-qr-signed", true);
    // Экран телефона: карточка котлеты с подписью 12:46 наверху.
    await qp.locator(".obj.bk", { hasText: "Котлета говяжья" }).first().evaluate((el) => el.scrollIntoView({ block: "start" }));
    await L.shot(qp, "390-qr-signed-cutlet");
    const cfg2 = await docConfig(docId);
    const sig2 = cfg2.rows.find((r) => r.id === "bz-r2").signatures[0];
    check(
      "QR: journalAt 12:46, signedAt — настоящий момент, метод qr",
      sig2.journalAt === t("12:46") && sig2.method === "qr" && Date.parse(sig2.signedAt) >= q0 - 5000 && Date.parse(sig2.signedAt) <= q1 + 5000,
      sig2
    );
    results.facts.r2 = { signedAt: sig2.signedAt, signedAtMoscow: L.moscowHhmm(sig2.signedAt), journalAt: sig2.journalAt };
    const qrAudit = await L.sql(
      `select details, "userName" from "AuditLog" where action = 'journal.brakerage_sign' and "entityId" = $1 and details->>'method' = 'qr'`,
      [docId]
    );
    check(
      "журнал действий (QR): автор «(QR)», signedAt настоящий, journalTimes 12:46",
      qrAudit.length === 1 &&
        qrAudit[0].userName === "Петров Пётр Петрович (QR)" &&
        qrAudit[0].details.signedAt === sig2.signedAt &&
        qrAudit[0].details.journalTimes.some((j) => j.rowId === "bz-r2" && j.journalAt === t("12:46")),
      qrAudit
    );

    // Сайт на телефоне после QR: котлета тоже 12:46.
    await mp.reload({ waitUntil: "domcontentloaded", timeout: 240000 });
    await L.waitHydrated(mp, "button[aria-expanded]");
    const cutlet = await expandCard(mp, "№2 · Котлета говяжья");
    check("телефон 390: карточка «Котлета говяжья» — «Петров П. П. · 12:46»", cutlet.text.includes("Петров П. П. · 12:46"), cutlet.text);
    await cutlet.card.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await mp.evaluate(() => window.scrollBy(0, -140));
    await L.shot(mp, "390-cards-cutlet");

    // ---------------------------------------------------------------- печать PDF
    const pdfRes = await desk.request.get(`${L.BASE}/api/journal-documents/${docId}/pdf`, { timeout: 240000 });
    const pdfFile = path.join(L.OUT, "bzhgp-journal.pdf");
    fs.writeFileSync(pdfFile, await pdfRes.body());
    check("PDF отдан", pdfRes.status() === 200 && (pdfRes.headers()["content-type"] || "").includes("pdf"), pdfRes.status());
    const pdf = L.helper(["pdf", pdfFile, path.join(L.SHOTS, "pdf")]);
    const pdfText = pdf.pages.join("\n").replace(/\s+/g, " ");
    results.facts.pdfSignatures = pdfText.match(/[А-ЯЁ][а-яё]+ [А-ЯЁ]\. [А-ЯЁ]\. · \d{2}:\d{2}/g);
    check("PDF: суп — «Иванова А. А. · 12:31»", pdfText.includes("Иванова А. А. · 12:31"), results.facts.pdfSignatures);
    check("PDF: котлета (QR) — «Петров П. П. · 12:46»", pdfText.includes("Петров П. П. · 12:46"), results.facts.pdfSignatures);
    check("PDF: салат после правки бракеража — «Иванова А. А. · 13:21»", pdfText.includes("Иванова А. А. · 13:21"), results.facts.pdfSignatures);
    check("PDF: старые подписи — 08:01 и 13:03", pdfText.includes("Иванова А. А. · 08:01") && pdfText.includes("Петров П. П. · 13:03"), results.facts.pdfSignatures);
    check(
      "PDF: хлеб без бракеража — настоящее время",
      pdfText.includes(`Иванова А. А. · ${results.facts.r6.signedAtMoscow}`),
      results.facts.pdfSignatures
    );
    // Все подписи в PDF — ровно ожидаемые времена журнала (момент нажатия — только у хлеба без бракеража).
    const expectedPdf = [
      "Иванова А. А. · 12:31",
      "Петров П. П. · 12:46",
      "Иванова А. А. · 08:01",
      "Петров П. П. · 13:03",
      "Иванова А. А. · 13:21",
      `Иванова А. А. · ${results.facts.r6.signedAtMoscow}`,
    ].sort();
    check(
      "PDF: других времён подписи нет — момент нажатия супа и котлеты в журнал не попал",
      JSON.stringify([...(results.facts.pdfSignatures || [])].sort()) === JSON.stringify(expectedPdf),
      { expectedPdf, got: results.facts.pdfSignatures, r1: results.facts.r1, r2: results.facts.r2 }
    );
    results.facts.pdfPng = pdf.png;

    // ---------------------------------------------------------------- Word
    const docx = L.helper(["docx", path.join(L.OUT, "obrazec-finished_product.docx")]);
    check(
      "Word БЖГП — пустой образец: колонка «Подпись» есть, строк и времени подписи нет",
      docx.cells.includes("Подпись") && docx.times.length === 0,
      docx
    );

    // ---------------------------------------------------------------- старые записи не испорчены
    const cfgEnd = await docConfig(docId);
    const r3End = cfgEnd.rows.find((r) => r.id === "bz-r3").signatures;
    const r4End = cfgEnd.rows.find((r) => r.id === "bz-r4").signatures;
    check(
      "старые подписи в базе как были (signedAt, без journalAt)",
      JSON.stringify(canon(r3End)) === JSON.stringify(canon([legacyLate])) &&
        JSON.stringify(canon(r4End)) === JSON.stringify(canon([legacyInWindow])),
      { r3End, r4End }
    );

    check("без ошибок страниц", results.pageErrors.length === 0, results.pageErrors);
  } catch (err) {
    check("сценарий без исключений", false, String((err && err.stack) || err));
  } finally {
    await browser.close();
    results.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(L.OUT, "results.json"), JSON.stringify(results, null, 2));
    const failed = results.checks.filter((c) => !c.ok).length;
    console.log(`\n${results.checks.length - failed}/${results.checks.length} PASS`);
    process.exit(failed > 0 ? 1 : 0);
  }
})();
