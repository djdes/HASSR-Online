import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { matchPlatformRule } from "@/lib/platform-access";
import {
  guestBuyerFrom,
  guestInvoicePdfPath,
  parseGuestInvoiceInput,
  readGuestBuyer,
  signGuestInvoice,
  verifyGuestInvoice,
} from "@/lib/invoices/guest";
import type { LegalProfile } from "@/lib/org-legal-profile";

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
// Реальная контрольная сумма: ИНН ООО «БФС» из оферты.
const INN = "5018215599";

describe("счёт по ИНН без регистрации", () => {
  it("форма: ИНН с контрольной суммой, почта; название — по желанию", () => {
    assert.deepEqual(parseGuestInvoiceInput({ inn: "5018 2155 99", email: " Buh@Company.RU ", companyName: "" }), {
      ok: true,
      value: { inn: INN, email: "buh@company.ru", companyName: "" },
    });
    assert.equal(parseGuestInvoiceInput({ inn: "123", email: "a@b.ru" }).ok, false);
    const bad = parseGuestInvoiceInput({ inn: "5018215598", email: "a@b.ru" });
    assert.equal(bad.ok, false);
    assert.match(bad.ok ? "" : bad.error, /Такого ИНН не бывает/);
    assert.equal(parseGuestInvoiceInput({ inn: INN, email: "не почта" }).ok, false);
  });

  it("покупатель: ЕГРЮЛ важнее введённого, без ЕГРЮЛ — нужно название", () => {
    const input = { inn: INN, email: "a@b.ru", companyName: "Ромашка" };
    const profile = { inn: INN, nameFull: "ООО «БФС»", nameShort: "БФС", kpp: "501801001", address: "Королёв" } as unknown as LegalProfile;
    const fromEgrul = guestBuyerFrom(input, profile);
    assert.deepEqual({ ...fromEgrul, legalProfile: Boolean(fromEgrul?.legalProfile) }, {
      inn: INN,
      name: "ООО «БФС»",
      kpp: "501801001",
      address: "Королёв",
      legalProfile: true,
    });
    assert.deepEqual(guestBuyerFrom(input, null), { inn: INN, name: "Ромашка", kpp: null, address: null, legalProfile: null });
    assert.equal(guestBuyerFrom({ ...input, companyName: "" }, null), null);
    assert.deepEqual(readGuestBuyer({ inn: INN, name: "Ромашка" }), { inn: INN, name: "Ромашка", kpp: null, address: null, legalProfile: null });
    assert.equal(readGuestBuyer(null), null);
    assert.equal(readGuestBuyer({ inn: 5 }), null);
  });

  it("ссылка на PDF подписана номером и почтой: чужая подпись не подходит", () => {
    const sig = signGuestInvoice(42, "Buh@Company.ru", "secret");
    assert.equal(sig.length, 32);
    assert.equal(verifyGuestInvoice(42, "buh@company.ru", sig, "secret"), true);
    assert.equal(verifyGuestInvoice(43, "buh@company.ru", sig, "secret"), false);
    assert.equal(verifyGuestInvoice(42, "other@company.ru", sig, "secret"), false);
    assert.equal(verifyGuestInvoice(42, "buh@company.ru", "x", "secret"), false);
    assert.match(guestInvoicePdfPath(42, "buh@company.ru"), /^\/api\/payments\/invoice\/42\/guest-pdf\?sig=[\w-]{32}$/);
  });

  it("маршруты: вошедшему — отказ, сумма как у карты, PDF по подписи, ROOT отмечает оплату", () => {
    const route = read("src/app/api/payments/invoice/guest/route.ts");
    assert.match(route, /if \(session\?\.user\) \{/);
    assert.match(route, /guestInvoiceRateLimiter\.consume/);
    assert.match(route, /fetchDadataParty\(parsed\.value\.inn\)/);
    const service = read("src/lib/invoices/service.ts");
    assert.match(service, /quoteCheckout\(\{ organizationId: null, target: args\.target, now, payer: \{ email: args\.email, guest: true \} \}\)/);
    assert.match(service, /buyerJson: args\.buyer as unknown as Prisma\.InputJsonValue/);
    assert.match(read("src/app/api/payments/invoice/[id]/guest-pdf/route.ts"), /verifyGuestInvoice\(orderId, order\.email, signature\)/);
    assert.match(read("src/lib/payment-fulfillment.ts"), /\.\.\.guestBuyerOrganizationData\(order\.buyerJson\)/);
    assert.equal(matchPlatformRule("/root/invoices")?.gate, "billing");
    assert.match(read("src/app/order/order-client.tsx"), /guestInvoiceReady && plan && amountAfterPromo > 0 \? \(\s*<GuestInvoicePanel/);
    assert.match(read("prisma/schema.prisma"), /buyerJson\s+Json\?/);
  });
});
