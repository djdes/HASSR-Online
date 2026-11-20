import assert from "node:assert/strict";
import test from "node:test";

import {
  ACCOUNT_TRANSFER_COMMENT_MAX,
  ACCOUNT_TRANSFER_MAX_RUB,
  accountBalanceTotal,
  isSameTransfer,
  keepTransferKeyAfter,
  normalizeTransferComment,
  parseAccountTransfer,
  parseTransferAmount,
  transferDedupeKeys,
  transferDescriptions,
} from "./account-transfer";
import { isTransferKind, transactionKindLabel } from "./constants";

const KEY = "3f1c2a9e-1b7d-4c55-9a0e-8f6d2b1c0a77";

test("amount: whole rubles from 1 to the maximum, from a number or a form string", () => {
  assert.deepEqual(parseTransferAmount(1), { ok: true, amountRub: 1 });
  assert.deepEqual(parseTransferAmount("5 000"), { ok: true, amountRub: 5000 });
  assert.deepEqual(parseTransferAmount("5 000 ₽"), { ok: true, amountRub: 5000 });
  assert.deepEqual(parseTransferAmount(ACCOUNT_TRANSFER_MAX_RUB), { ok: true, amountRub: ACCOUNT_TRANSFER_MAX_RUB });
  const refused = (value: unknown) => {
    const result = parseTransferAmount(value);
    return result.ok ? null : result.code;
  };
  assert.equal(refused(""), "amount_required");
  assert.equal(refused(undefined), "amount_required");
  assert.equal(refused("abc"), "amount_numeric");
  assert.equal(refused(Number.NaN), "amount_numeric");
  assert.equal(refused(10.5), "amount_whole");
  assert.equal(refused("10,5"), "amount_whole");
  assert.equal(refused(0), "amount_minimum");
  assert.equal(refused(-100), "amount_minimum");
  assert.equal(refused(ACCOUNT_TRANSFER_MAX_RUB + 1), "amount_maximum");
});

test("transfer body: both organizations, different, a valid amount and an idempotency key", () => {
  const ok = parseAccountTransfer({ fromId: " org-a ", toId: "org-b", amountRub: "1 500", comment: "  на\nтариф  ", idempotencyKey: KEY });
  assert.deepEqual(ok, { ok: true, value: { fromId: "org-a", toId: "org-b", amountRub: 1500, comment: "на тариф", idempotencyKey: KEY } });

  const code = (body: unknown) => {
    const result = parseAccountTransfer(body);
    return result.ok ? null : result.code;
  };
  assert.equal(code(null), "organizations");
  assert.equal(code({ fromId: "org-a", amountRub: 1, idempotencyKey: KEY }), "organizations");
  assert.equal(code({ fromId: "org-a", toId: "x".repeat(65), amountRub: 1, idempotencyKey: KEY }), "organizations");
  assert.equal(code({ fromId: "org-a", toId: "org-a", amountRub: 1, idempotencyKey: KEY }), "same_org");
  assert.equal(code({ fromId: "org-a", toId: "org-b", amountRub: 0, idempotencyKey: KEY }), "amount_minimum");
  assert.equal(code({ fromId: "org-a", toId: "org-b", amountRub: 1 }), "key");
  assert.equal(code({ fromId: "org-a", toId: "org-b", amountRub: 1, idempotencyKey: "short" }), "key");
  assert.equal(code({ fromId: "org-a", toId: "org-b", amountRub: 1, idempotencyKey: "bad key with spaces" }), "key");
});

test("comment is one line and capped", () => {
  assert.equal(normalizeTransferComment(undefined), "");
  assert.equal(normalizeTransferComment("a\tb\r\nc"), "a b c");
  assert.equal(normalizeTransferComment("x".repeat(500)).length, ACCOUNT_TRANSFER_COMMENT_MAX);
});

test("dedupe keys are scoped to the account and differ for the two ledger rows", () => {
  const keys = transferDedupeKeys("acc-1", KEY);
  assert.equal(keys.out, `transfer_out:acc-1:${KEY}`);
  assert.equal(keys.in, `transfer_in:acc-1:${KEY}`);
  assert.notEqual(transferDedupeKeys("acc-2", KEY).out, keys.out);
});

test("descriptions name the other organization and carry the comment", () => {
  assert.deepEqual(transferDescriptions({ fromName: "Кафе", toName: "Бар", comment: "" }), {
    out: "Перевод в «Бар»",
    in: "Перевод из «Кафе»",
  });
  assert.deepEqual(transferDescriptions({ fromName: "Кафе", toName: "Бар", comment: "на тариф" }), {
    out: "Перевод в «Бар» — на тариф",
    in: "Перевод из «Кафе» — на тариф",
  });
});

test("account total sums balances; transfer kinds have labels", () => {
  assert.equal(accountBalanceTotal([{ balanceRub: 100 }, { balanceRub: 250 }, { balanceRub: 0 }]), 350);
  assert.equal(accountBalanceTotal([]), 0);
  assert.equal(isTransferKind("transfer_out"), true);
  assert.equal(isTransferKind("transfer_in"), true);
  assert.equal(isTransferKind("topup"), false);
  assert.equal(transactionKindLabel("transfer_out"), "Перевод в другую организацию");
  assert.equal(transactionKindLabel("transfer_in"), "Перевод из другой организации");
});

test("same idempotency key: the same transfer only when from, to and amount match", () => {
  const earlier = { fromId: "org-a", toId: "org-b", amountRub: 1500 };
  assert.equal(isSameTransfer(earlier, { fromId: "org-a", toId: "org-b", amountRub: 1500 }), true);
  assert.equal(isSameTransfer(earlier, { fromId: "org-a", toId: "org-c", amountRub: 1500 }), false);
  assert.equal(isSameTransfer(earlier, { fromId: "org-b", toId: "org-a", amountRub: 1500 }), false);
  assert.equal(isSameTransfer(earlier, { fromId: "org-a", toId: "org-b", amountRub: 900 }), false);
});

test("idempotency key: cleared only on 2xx or a 4xx refusal with our body, kept otherwise", () => {
  // Исход известен — следующий перевод с новым ключом.
  assert.equal(keepTransferKeyAfter({ status: 200, body: { ok: true } }), false);
  assert.equal(keepTransferKeyAfter({ status: 409, body: { error: "Недостаточно средств", code: "insufficient" } }), false);
  assert.equal(keepTransferKeyAfter({ status: 400, body: { error: "Укажите сумму", code: "amount_required" } }), false);
  assert.equal(keepTransferKeyAfter({ status: 429, body: { error: "Слишком много запросов" } }), false);
  // Обрыв сети, 5xx, таймаут шлюза, нечитаемое тело — перевод мог пройти, ключ остаётся.
  assert.equal(keepTransferKeyAfter(null), true);
  assert.equal(keepTransferKeyAfter({ status: 500, body: { error: "Internal" } }), true);
  assert.equal(keepTransferKeyAfter({ status: 502, body: null }), true);
  assert.equal(keepTransferKeyAfter({ status: 504, body: null }), true);
  assert.equal(keepTransferKeyAfter({ status: 200, body: null }), true);
  assert.equal(keepTransferKeyAfter({ status: 200, body: [] }), true);
  // 4xx не от нас (страница шлюза, тело без `error`) — исход неизвестен.
  assert.equal(keepTransferKeyAfter({ status: 408, body: null }), true);
  assert.equal(keepTransferKeyAfter({ status: 413, body: {} }), true);
});
