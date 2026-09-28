// Доп. проверка по API: обычный заказ в период акции (без промокода) и счёт по безналу
// по цене с акцией (снимок акции в заказе). Реквизиты исполнителя — тестовые, в локальной базе.
// Запуск: node e2e/extra-api.cjs  (после e2e.cjs)
const fs = require("node:fs");
const path = require("node:path");
const { BASE, EVID, RAW, launch, sql, login, newContext, open, norm, readCreds } = require("./lib.cjs");

function mskInput(offsetMinutes = 0) {
  return new Date(Date.now() + 3 * 3600_000 + offsetMinutes * 60_000).toISOString().slice(0, 16);
}

const out = { checks: [] };
function check(name, ok, details = {}) {
  out.checks.push({ name, ok: Boolean(ok), details });
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(details)}`);
}

(async () => {
  const creds = readCreds();
  const browser = await launch();
  let promotionId = null;
  const root = await newContext(browser, { width: 1280, height: 900 });
  const owner = await newContext(browser, { width: 1280, height: 900 });
  try {
    await login(root, creds.root, creds.password);
    await login(owner, creds.owner, creds.password);
    const endDay = mskInput(2 * 24 * 60).slice(0, 10);
    const created = await (
      await root.request.post(`${BASE}/api/root/promotions`, {
        data: { title: "Счёт и заказ", percent: 25, startsAt: mskInput(-5), endsAt: `${endDay}T00:00` },
      })
    ).json();
    promotionId = created.promotion?.id ?? null;
    check("ROOT API: акция −25 % создана", Boolean(promotionId));

    // 1. Заказ картой без промокода: 1990 − 25 % (497,5 → 498) = 1492.
    const res = await owner.request.post(`${BASE}/api/payments/robokassa/create`, {
      data: { tariffKey: "monthly", usePoints: false, expectedGrossRub: 1492 },
    });
    const body = await res.json();
    const [order] = await sql(
      'select "amountRub", "baseRub", "promotionId", "promotionPercent", "promotionDiscountRub", "promoCode", description from "PaymentOrder" where id = $1',
      [body.invId],
    );
    check(
      "заказ в период акции без промокода: 1492, снимок акции",
      res.status() === 200 &&
        Number(order.amountRub) === 1492 &&
        order.baseRub === 1990 &&
        order.promotionId === promotionId &&
        order.promotionPercent === 25 &&
        order.promotionDiscountRub === 498 &&
        order.promoCode === null,
      { status: res.status(), ...order, amountRub: Number(order.amountRub) },
    );

    // 2. Счёт по безналу: реквизиты исполнителя (тестовые) и ИНН организации.
    await sql(
      `insert into "PlatformSetting" (key, value, "updatedAt") values ('legal.requisites', $1, now())
       on conflict (key) do update set value = excluded.value, "updatedAt" = now()`,
      [
        JSON.stringify({
          nameFull: "Общество с ограниченной ответственностью «Тест e2e»",
          nameShort: "ООО «Тест e2e»",
          inn: "7700000000",
          kpp: "770001001",
          ogrn: "1027700000000",
          address: "г. Москва, ул. Тестовая, д. 1, офис 1",
          bank: { name: "АО «Тестбанк»", bik: "044525225", account: "40702810000000000001", corrAccount: "30101810400000000225" },
          head: { post: "Генеральный директор", name: "Тестов Т. Т." },
          vatMode: "none",
          email: "",
          phone: "",
          facsimileFile: null,
          stampFile: null,
        }),
      ],
    );
    await sql('update "Organization" set inn = $1 where id = $2', ["7712345678", creds.organizationId]);
    await sql(`update "PaymentOrder" set status = 'cancelled' where "organizationId" = $1 and "paymentMethod" = 'invoice' and status = 'pending'`, [
      creds.organizationId,
    ]);
    const page = await owner.newPage();
    await open(page, "/settings/subscription", "h1", null, 2500);
    const card = page.locator("section:has-text('Оплата по безналу для юрлиц')").last();
    const cardText = norm(await card.textContent());
    check("карточка «Оплата по безналу»: зачёркнутая 1 990 и 1 492", /1 990 ₽.*1 492 ₽/.test(cardText) && (await card.locator("[data-promo-active=true]").count()) === 1, {
      cardText: cardText.slice(0, 200),
    });
    await card.screenshot({ path: path.join(EVID, "settings-invoice-1280.png") });
    const inv = await owner.request.post(`${BASE}/api/payments/invoice`, { data: { tariffKey: "monthly" } });
    const invBody = await inv.json();
    const [invoice] = await sql(
      'select "amountRub", "baseRub", "promotionPercent", "promotionDiscountRub", "paymentMethod", description from "PaymentOrder" where id = $1',
      [invBody.orderId],
    );
    check(
      "счёт по безналу по цене с акцией: 1492, снимок акции",
      inv.status() === 200 &&
        invBody.amountRub === 1492 &&
        invoice.paymentMethod === "invoice" &&
        invoice.baseRub === 1990 &&
        invoice.promotionPercent === 25 &&
        invoice.promotionDiscountRub === 498 &&
        /счёт; акция «Счёт и заказ» −25 %/.test(norm(invoice.description)),
      { status: inv.status(), ...invoice, amountRub: Number(invoice.amountRub) },
    );
    await page.close();
  } finally {
    if (promotionId) await root.request.delete(`${BASE}/api/root/promotions/${promotionId}`);
    await root.close();
    await owner.close();
    await browser.close();
  }
  fs.writeFileSync(path.join(RAW, "extra-api.json"), JSON.stringify(out, null, 2));
  if (out.checks.some((c) => !c.ok)) process.exitCode = 1;
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
