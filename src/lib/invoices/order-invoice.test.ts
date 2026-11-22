import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * /order: чек, компактный промокод, способ оплаты списком, счёт с
 * дозаполнением ИНН, «скачать» и «на другую почту» (спека
 * checkout-conversion-2026-11-22). Сторожа по исходникам — как у соседних фич
 * страницы оплаты.
 */
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const client = () => read("src/app/order/order-client.tsx");

describe("чек «К оплате» и промокод (AC1, AC2)", () => {
  it("чек — поверхность без рамки: тариф, срок, строки, итог, «≈ в месяц» для полного года", () => {
    const source = client();
    assert.match(source, /<section data-testid="order-summary"[^>]*className="mt-6 rounded-2xl bg-\[#f4f5fb\] p-5"/);
    assert.match(source, /data-testid="order-period"/);
    assert.match(source, /data-testid="order-total"[\s\S]*\{formatRub\(netRub\)\}/);
    assert.match(
      source,
      /const perMonthRub =\s*plan\?\.cycle === "year" && \(plan\.kind === "new" \|\| plan\.kind === "renew"\) && netRub > 0 \? Math\.round\(netRub \/ 12\) : null;/,
    );
    // Сумма заказа сверяется с той же, что в чеке: формула не менялась.
    assert.match(source, /expectedGrossRub: amountAfterPromo,/);
  });

  it("промокод: ссылка «Есть промокод?», поле в одну строку, плашка с крестиком; крестик — пересчёт без кода", () => {
    const source = client();
    assert.match(source, /data-testid="promo-open"/);
    assert.match(source, /data-testid="promo-applied"/);
    assert.match(source, /aria-label=\{t\("promo\.remove"\)\}/);
    assert.match(source, /body: JSON\.stringify\(\{ code: "", tariffKey: tariff\.key/);
    assert.match(source, /setDiscount\(\(data\.ok \? data\.applied : data\.fallback\) \?\? null\);/);
    assert.doesNotMatch(source, /применяется сама,\s*вводить ничего не нужно/, "длинных пояснений под промокодом больше нет");
  });
});

describe("способ оплаты списком и счёт на странице (AC3–AC5)", () => {
  it("список «Способ оплаты» — только когда счёт доступен; баллы — только при оплате картой", () => {
    const source = client();
    assert.match(source, /\{invoiceAvailable \? \(\s*<div className="mt-6">[\s\S]*<Select value=\{activeMethod\}/);
    assert.match(source, /const activeMethod = invoiceAvailable \? method : "card";/);
    assert.match(source, /activeMethod === "card" && usePoints && !autopay/);
    assert.match(source, /window\.location\.hash === "#invoice"/);
    assert.match(source, /org=\{guest \? null : orgInvoice\}/);
  });

  it("страница: руководителю — счёт на организацию, не в «войти как», когда реквизиты WeSetup заполнены", () => {
    const page = read("src/app/order/page.tsx");
    assert.match(page, /canSpendPoints && offer && plan && invoiceRequisitesReady\(await readPlatformRequisites\(\)\)/);
    assert.match(page, /orgInvoice=\{orgInvoice\}/);
    assert.match(page, /<SiteLocaleProvider locale=\{locale\} messages=\{messages\} timeZone="Europe\/Moscow">/);
  });

  it("ИНН организации дозаполняется при выставлении: журнал действий, сверка пробного, чужой ИНН не меняем", () => {
    const route = read("src/app/api/payments/invoice/route.ts");
    const fill = route.indexOf("await fillOrganizationInn(");
    assert.ok(fill > 0 && fill < route.indexOf("await createInvoiceOrder("), "ИНН записывается до счёта");
    const buyer = read("src/lib/invoices/org-buyer.server.ts");
    assert.match(buyer, /action: "organization\.settings\.update"/);
    assert.match(buyer, /await checkTrialReuse\(/);
    assert.match(buyer, /code: "inn-set"/);
    assert.match(buyer, /code: "name-required"/);
    // Без ЕГРЮЛ покупатель счёта — юридическое название.
    assert.match(read("src/lib/invoices/service.ts"), /name: org\.legalFullName\?\.trim\(\) \|\| org\.name,/);
  });

  it("«Отправить на другую почту»: гостю — по подписи ссылки, организации — её руководителю; только действующий счёт", () => {
    const route = read("src/app/api/payments/invoice/[id]/send/route.ts");
    assert.match(route, /verifyGuestInvoice\(orderId, order\.email, signature\)/);
    assert.match(route, /!isImpersonating\(session!\) &&\s*hasFullWorkspaceAccess\(session!\.user\) &&\s*getActiveOrgId\(session!\) === order\.organizationId/);
    assert.match(route, /if \(order\.status !== "pending"\) return NextResponse\.json\(\{ error: "Счёт уже не действует" \}, \{ status: 410 \}\);/);
    assert.match(route, /invoiceSendRateLimiter\.consume/);
    const panel = read("src/app/order/invoice-panel.tsx");
    assert.match(panel, /fetch\(`\/api\/payments\/invoice\/\$\{done\.orderId\}\/send`/);
    assert.match(panel, /<a\s+href=\{done\.pdfUrl\}/);
    assert.match(panel, /buyer: \{ inn, companyName: companyName \|\| undefined \}/);
  });
});

describe("тексты — через словари на трёх языках (AC10)", () => {
  it("раздел orderCheckout есть в ru, en, uz с одинаковыми ключами", () => {
    const keys = (value: unknown, prefix = ""): string[] =>
      value && typeof value === "object"
        ? Object.entries(value as Record<string, unknown>).flatMap(([key, inner]) => keys(inner, `${prefix}${key}.`))
        : [prefix.slice(0, -1)];
    const sets = (["ru", "en", "uz"] as const).map((locale) => {
      const messages = JSON.parse(read(`src/i18n/messages/${locale}.json`)) as { orderCheckout?: unknown };
      assert.ok(messages.orderCheckout, locale);
      return keys(messages.orderCheckout).sort();
    });
    assert.deepEqual(sets[1], sets[0]);
    assert.deepEqual(sets[2], sets[0]);
    const ru = JSON.parse(read("src/i18n/messages/ru.json")) as { orderCheckout: { promo: { open: string }; method: { invoice: string } } };
    assert.equal(ru.orderCheckout.promo.open, "Есть промокод?");
    assert.equal(ru.orderCheckout.method.invoice, "Счёт для юрлица или ИП");
  });
});
