import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  COMPLETION_RESEND_MAX,
  COMPLETION_RESEND_MIN_INTERVAL_MS,
  completionResendDecision,
  composeCompletionLinkEmail,
} from "@/lib/completion-resend";
import { PAYMENT_METHODS_NOTE, REFUND_HREF, REFUND_NOTE } from "@/lib/payment-copy";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const now = new Date("2026-11-02T12:00:00Z");
const secondsAgo = (s: number) => new Date(now.getTime() - s * 1000);

describe("оплата понятна заранее (AC1)", () => {
  it("способы оплаты и возврат — как в оферте: СБП, счёт, 14 дней с первой оплаты, дальше пропорционально", () => {
    assert.match(PAYMENT_METHODS_NOTE, /картой или через СБП/);
    assert.match(PAYMENT_METHODS_NOTE, /по счёту для юрлица/);
    assert.match(REFUND_NOTE, /^14 дней с первой оплаты — вернём всю сумму без вопросов/);
    assert.match(REFUND_NOTE, /за неиспользованный период/);
    assert.equal(REFUND_HREF, "/oferta#refund");
    const oferta = read("src/app/oferta/page.tsx");
    assert.match(oferta, /<h2 id="refund">6\. Порядок возврата денежных средств<\/h2>/);
    assert.match(oferta, /Безусловный возврат в течение 14 дней/);
    assert.match(oferta, /банковская карта, СБП/);
  });

  it("строка стоит на /pricing и под кнопкой оплаты на /order", () => {
    assert.match(read("src/app/pricing/page.tsx"), /\{PAYMENT_METHODS_NOTE\} \{REFUND_NOTE\}/);
    assert.match(read("src/app/order/order-client.tsx"), /\{PAYMENT_METHODS_NOTE\} \{REFUND_NOTE\}\{" "\}\s*<Link href=\{REFUND_HREF\}/);
  });
});

describe("неудачная оплата — не тупик (AC2)", () => {
  it("кроме «ещё раз» — счёт для юрлица и окно связи", () => {
    const client = read("src/app/order/order-client.tsx");
    const failed = client.slice(client.indexOf("Оплата не прошла"), client.indexOf("Проверяем оплату…"));
    assert.match(failed, /<PrimaryLink href="\/pricing">Попробовать ещё раз<\/PrimaryLink>/);
    assert.match(failed, /href=\{INVOICE_HREF\}[\s\S]*Оплатить по счёту/);
    assert.match(failed, /<ContactSupportButton\s+subject="Оплата не прошла"[\s\S]*Связаться с нами/);
    assert.match(client, /const INVOICE_HREF = "\/settings\/subscription";/);
  });
});

describe("ссылку на достройку можно выслать ещё раз (AC3)", () => {
  it("только оплаченному новому клиенту, не чаще раза в минуту и не больше пяти раз", () => {
    assert.equal(COMPLETION_RESEND_MIN_INTERVAL_MS, 60_000);
    assert.equal(COMPLETION_RESEND_MAX, 5);
    const base = { status: "paid", hasCompletionToken: true, previousSends: [] as Date[], now };
    assert.equal(completionResendDecision(base), "send");
    assert.equal(completionResendDecision({ ...base, status: "pending" }), "not_needed");
    assert.equal(completionResendDecision({ ...base, status: "completed" }), "not_needed");
    assert.equal(completionResendDecision({ ...base, hasCompletionToken: false }), "not_needed");
    assert.equal(completionResendDecision({ ...base, previousSends: [secondsAgo(30)] }), "too_soon");
    assert.equal(completionResendDecision({ ...base, previousSends: [secondsAgo(61), secondsAgo(500)] }), "send");
    assert.equal(completionResendDecision({ ...base, previousSends: [1, 2, 3, 4, 5].map((m) => secondsAgo(m * 600)) }), "limit");
  });

  it("письмо: ссылка, срок, предупреждение, что старые ссылки не работают", () => {
    const mail = composeCompletionLinkEmail({ link: "https://wesetup.ru/order?complete=tok", ttlDays: 7 });
    assert.equal(mail.subject, "Ссылка для входа в WeSetup");
    assert.match(mail.html, /href="https:\/\/wesetup\.ru\/order\?complete=tok"/);
    assert.match(mail.html, /действует 7 дней/);
    assert.match(mail.html, /Предыдущие ссылки больше не работают/);
    assert.doesNotMatch(mail.html, /style="[^"]*" style=/);
  });

  it("эндпоинт: то же доказательство, что у статуса, новый токен, ответ всегда одинаковый", () => {
    const route = read("src/app/api/payments/robokassa/resend-completion/route.ts");
    assert.match(route, /await findOrderByReturnProof\(new URL\(request\.url\)\)/);
    assert.match(route, /completeTokenHash: hashInviteToken\(token\), completeTokenExpiresAt: inviteExpiresAt\(\)/);
    assert.match(route, /return NextResponse\.json\(\{ ok: true \}\);\s*\}\s*$/);
    assert.equal((route.match(/NextResponse\.json/g) ?? []).length, 1);
    const status = read("src/app/api/payments/robokassa/status/route.ts");
    assert.match(status, /: await findOrderByReturnProof\(url\);/);
    assert.doesNotMatch(status, /async function findBySignature/);
    assert.match(read("src/app/order/order-client.tsx"), /<ResendCompletionLink query=\{query\} \/>/);
  });
});
