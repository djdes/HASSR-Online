import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  bindLifetimeDiscount,
  decideLifetimeBinding,
  LIFETIME_BIND_ACTION,
  LIFETIME_REVOKE_ACTION,
  revokeLifetimeDiscount,
  type LifetimeBindingRecord,
  type LifetimeStore,
} from "@/lib/promo/lifetime-core";

/**
 * Привязка скидки навсегда — то, что делает fulfillPaidOrder после
 * продления (fulfillPaidOrder → bindLifetimeDiscountForOrder →
 * bindLifetimeDiscount с хранилищем в базе). Здесь хранилище в памяти.
 */

type Order = { id: number; status: string; promoCode: string | null; lifetimeDiscountId: string | null };
type Code = { id: string; code: string; kind: "percent" | "fixed"; value: number; lifetime: boolean };

function memoryStore(input: { orders: Order[]; codes: Code[]; accounts: Record<string, string | null> }) {
  const bindings: LifetimeBindingRecord[] = [];
  const audits: Array<{ action: string; organizationId: string; details: Record<string, unknown> }> = [];
  let seq = 0;
  /** Перед созданием кто-то «успевает» создать строку (гонка двух оплат). */
  let raceWith: Omit<LifetimeBindingRecord, "id"> | null = null;
  const store: LifetimeStore = {
    async findOrder(id) {
      return input.orders.find((o) => o.id === id) ?? null;
    },
    async findCode(code) {
      return input.codes.find((c) => c.code === code) ?? null;
    },
    async accountOfOrganization(organizationId) {
      return input.accounts[organizationId] ?? null;
    },
    async findBinding(accountId) {
      return bindings.find((b) => b.accountId === accountId) ?? null;
    },
    async findBindingById(id) {
      return bindings.find((b) => b.id === id) ?? null;
    },
    async createBinding(data) {
      if (raceWith) {
        bindings.push({ ...raceWith, id: `ld${++seq}` });
        raceWith = null;
      }
      if (bindings.some((b) => b.accountId === data.accountId)) return null; // unique accountId
      const row = { ...data, id: `ld${++seq}` };
      bindings.push(row);
      return row;
    },
    async updateBinding(id, data) {
      const row = bindings.find((b) => b.id === id)!;
      Object.assign(row, data);
      return { ...row };
    },
    async audit(entry) {
      audits.push({ action: entry.action, organizationId: entry.organizationId, details: entry.details });
    },
  };
  return {
    store,
    bindings,
    audits,
    race(row: Omit<LifetimeBindingRecord, "id">) {
      raceWith = row;
    },
  };
}

const ROMASHKA10: Code = { id: "pc_rom", code: "ROMASHKA10", kind: "percent", value: 10, lifetime: true };
const PARTNER20: Code = { id: "pc_p20", code: "PARTNER20", kind: "percent", value: 20, lifetime: true };
const START30: Code = { id: "pc_s30", code: "START30", kind: "percent", value: 30, lifetime: false };
const now = new Date("2026-10-12T09:00:00.000Z");

describe("привязка скидки навсегда в fulfillPaidOrder", () => {
  it("первая оплаченная подписка с lifetime-кодом → скидка за аккаунтом (снимок вида и размера), лог и аудит", async () => {
    const env = memoryStore({
      orders: [{ id: 101, status: "paid", promoCode: "ROMASHKA10", lifetimeDiscountId: null }],
      codes: [ROMASHKA10],
      accounts: { org_rom: "acc_rom" },
    });
    const outcome = await bindLifetimeDiscount(env.store, { orderId: 101, organizationId: "org_rom", now });
    assert.equal(outcome.status, "bound");
    assert.equal(env.bindings.length, 1);
    assert.deepEqual(
      { ...env.bindings[0], id: "x" },
      {
        id: "x",
        accountId: "acc_rom",
        promoCodeId: "pc_rom",
        code: "ROMASHKA10",
        kind: "percent",
        value: 10,
        orderId: 101,
        boundAt: now,
        revokedAt: null,
        revokedById: null,
      }
    );
    assert.equal(env.audits.length, 1);
    assert.equal(env.audits[0].action, LIFETIME_BIND_ACTION);
    assert.equal(env.audits[0].organizationId, "org_rom");
  });

  it("идемпотентно: повторная обработка той же оплаты ничего не меняет (одна строка, один аудит)", async () => {
    const env = memoryStore({
      orders: [{ id: 101, status: "paid", promoCode: "ROMASHKA10", lifetimeDiscountId: null }],
      codes: [ROMASHKA10],
      accounts: { org_rom: "acc_rom" },
    });
    await bindLifetimeDiscount(env.store, { orderId: 101, organizationId: "org_rom", now });
    const again = await bindLifetimeDiscount(env.store, { orderId: 101, organizationId: "org_rom", now });
    const third = await bindLifetimeDiscount(env.store, { orderId: 101, organizationId: "org_rom", now: new Date() });
    assert.equal(again.status, "already-bound");
    assert.equal(third.status, "already-bound");
    assert.equal(env.bindings.length, 1);
    assert.equal(env.bindings[0].boundAt, now);
    assert.equal(env.audits.length, 1);
  });

  it("вторая оплата с тем же кодом (другим заказом) — тоже без изменений", async () => {
    const env = memoryStore({
      orders: [
        { id: 101, status: "paid", promoCode: "ROMASHKA10", lifetimeDiscountId: null },
        { id: 102, status: "completed", promoCode: "ROMASHKA10", lifetimeDiscountId: null },
      ],
      codes: [ROMASHKA10],
      accounts: { org_rom: "acc_rom" },
    });
    await bindLifetimeDiscount(env.store, { orderId: 101, organizationId: "org_rom", now });
    const second = await bindLifetimeDiscount(env.store, { orderId: 102, organizationId: "org_rom", now });
    assert.equal(second.status, "already-bound");
    assert.equal(env.bindings[0].orderId, 101);
  });

  it("гонка двух оплат: строку успели создать — решаем заново, дубля нет", async () => {
    const env = memoryStore({
      orders: [{ id: 102, status: "paid", promoCode: "ROMASHKA10", lifetimeDiscountId: null }],
      codes: [ROMASHKA10],
      accounts: { org_rom: "acc_rom" },
    });
    env.race({
      accountId: "acc_rom",
      promoCodeId: "pc_rom",
      code: "ROMASHKA10",
      kind: "percent",
      value: 10,
      orderId: 101,
      boundAt: now,
      revokedAt: null,
      revokedById: null,
    });
    const outcome = await bindLifetimeDiscount(env.store, { orderId: 102, organizationId: "org_rom", now });
    assert.equal(outcome.status, "already-bound");
    assert.equal(env.bindings.length, 1);
    assert.equal(env.audits.length, 0);
  });

  it("не привязываем: авто-скидка навсегда, обычный код, неоплаченный заказ, нет аккаунта", async () => {
    const env = memoryStore({
      orders: [
        { id: 201, status: "paid", promoCode: "ROMASHKA10", lifetimeDiscountId: "ld_old" },
        { id: 202, status: "paid", promoCode: "START30", lifetimeDiscountId: null },
        { id: 203, status: "pending", promoCode: "ROMASHKA10", lifetimeDiscountId: null },
        { id: 204, status: "paid", promoCode: null, lifetimeDiscountId: null },
        { id: 205, status: "paid", promoCode: "ROMASHKA10", lifetimeDiscountId: null },
      ],
      codes: [ROMASHKA10, START30],
      accounts: { org_rom: "acc_rom", org_legacy: null },
    });
    const reasons: string[] = [];
    for (const [orderId, org] of [[201, "org_rom"], [202, "org_rom"], [203, "org_rom"], [204, "org_rom"], [205, "org_legacy"]] as const) {
      const outcome = await bindLifetimeDiscount(env.store, { orderId, organizationId: org, now });
      reasons.push(outcome.status === "skipped" ? outcome.reason : outcome.status);
    }
    assert.deepEqual(reasons, ["auto-applied", "not-lifetime", "not-paid", "no-code", "no-account"]);
    assert.equal(env.bindings.length, 0);
  });

  it("правка кода потом не меняет привязанную скидку (снимок)", async () => {
    const code = { ...ROMASHKA10 };
    const env = memoryStore({
      orders: [{ id: 101, status: "paid", promoCode: "ROMASHKA10", lifetimeDiscountId: null }],
      codes: [code],
      accounts: { org_rom: "acc_rom" },
    });
    await bindLifetimeDiscount(env.store, { orderId: 101, organizationId: "org_rom", now });
    code.value = 50;
    code.lifetime = false;
    assert.equal(env.bindings[0].value, 10);
  });

  it("отменённую ROOT'ом скидку новый lifetime-код привязывает заново", async () => {
    const env = memoryStore({
      orders: [
        { id: 101, status: "paid", promoCode: "ROMASHKA10", lifetimeDiscountId: null },
        { id: 150, status: "paid", promoCode: "PARTNER20", lifetimeDiscountId: null },
      ],
      codes: [ROMASHKA10, PARTNER20],
      accounts: { org_rom: "acc_rom" },
    });
    await bindLifetimeDiscount(env.store, { orderId: 101, organizationId: "org_rom", now });
    await revokeLifetimeDiscount(env.store, {
      id: env.bindings[0].id,
      actor: { id: "root1", name: "ROOT" },
      auditOrganizationId: "platform",
      now,
    });
    const outcome = await bindLifetimeDiscount(env.store, { orderId: 150, organizationId: "org_rom", now });
    assert.equal(outcome.status, "rebound");
    assert.deepEqual(outcome.status === "rebound" && outcome.previous, { code: "ROMASHKA10", orderId: 101, revoked: true });
    assert.equal(env.bindings.length, 1);
    assert.equal(env.bindings[0].code, "PARTNER20");
    assert.equal(env.bindings[0].revokedAt, null);
  });

  it("более выгодный lifetime-код, выбранный на оплате, заменяет прежнюю скидку", async () => {
    const env = memoryStore({
      orders: [
        { id: 101, status: "paid", promoCode: "ROMASHKA10", lifetimeDiscountId: null },
        { id: 160, status: "paid", promoCode: "PARTNER20", lifetimeDiscountId: null },
      ],
      codes: [ROMASHKA10, PARTNER20],
      accounts: { org_rom: "acc_rom" },
    });
    await bindLifetimeDiscount(env.store, { orderId: 101, organizationId: "org_rom", now });
    const outcome = await bindLifetimeDiscount(env.store, { orderId: 160, organizationId: "org_rom", now });
    assert.equal(outcome.status, "rebound");
    assert.equal(env.bindings[0].value, 20);
    assert.equal(env.audits[env.audits.length - 1]?.details.previousCode, "ROMASHKA10");
  });

  it("решение: нет строки — создать; тот же заказ или тот же код — ничего; отменена/другой код — переписать", () => {
    const order = { id: 7 };
    const code = { id: "pc" };
    assert.equal(decideLifetimeBinding(null, order, code), "create");
    assert.equal(decideLifetimeBinding({ orderId: 7, promoCodeId: "other", revokedAt: new Date() }, order, code), "noop");
    assert.equal(decideLifetimeBinding({ orderId: 3, promoCodeId: "pc", revokedAt: null }, order, code), "noop");
    assert.equal(decideLifetimeBinding({ orderId: 3, promoCodeId: "pc", revokedAt: new Date() }, order, code), "rebind");
    assert.equal(decideLifetimeBinding({ orderId: 3, promoCodeId: "other", revokedAt: null }, order, code), "rebind");
  });
});

describe("отмена скидки навсегда (ROOT)", () => {
  it("отмена ставит revokedAt/revokedById, пишет аудит; повторная — 409, неизвестная — 404", async () => {
    const env = memoryStore({
      orders: [{ id: 101, status: "paid", promoCode: "ROMASHKA10", lifetimeDiscountId: null }],
      codes: [ROMASHKA10],
      accounts: { org_rom: "acc_rom" },
    });
    await bindLifetimeDiscount(env.store, { orderId: 101, organizationId: "org_rom", now });
    const id = env.bindings[0].id;
    const revoked = await revokeLifetimeDiscount(env.store, {
      id,
      actor: { id: "root1", name: "ROOT" },
      auditOrganizationId: "platform",
      now,
    });
    assert.equal(revoked.ok, true);
    assert.equal(env.bindings[0].revokedAt, now);
    assert.equal(env.bindings[0].revokedById, "root1");
    assert.equal(env.audits[env.audits.length - 1]?.action, LIFETIME_REVOKE_ACTION);
    assert.equal(env.audits[env.audits.length - 1]?.organizationId, "platform");

    const again = await revokeLifetimeDiscount(env.store, { id, actor: { id: "root1", name: null }, auditOrganizationId: "platform" });
    assert.deepEqual(again, { ok: false, status: 409, error: "Скидка уже отменена" });
    const missing = await revokeLifetimeDiscount(env.store, { id: "nope", actor: { id: "root1", name: null }, auditOrganizationId: "platform" });
    assert.equal(!missing.ok && missing.status, 404);
  });
});
