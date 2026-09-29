/**
 * Скидка навсегда — привязка к аккаунту и отмена. Ядро без `db`
 * (хранилище передаётся, как в custom-names-save), обёртка с базой —
 * lib/promo/lifetime.ts; зовёт её fulfillPaidOrder после продления.
 *
 * Правила привязки:
 *   - только оплаченный (paid/completed) заказ, где lifetime-код ВВЕДЁН
 *     (заказ с авто-скидкой навсегда ничего не привязывает);
 *   - вид и размер — снимком из кода на момент привязки;
 *   - идемпотентно: тот же заказ или уже действующий тот же код — ничего
 *     не меняем; гонка двух оплат — unique на accountId;
 *   - отменённая ROOT'ом скидка переписывается новой привязкой, действующая
 *     с другим кодом — заменяется (оформление выбрало этот код как более
 *     выгодный, см. pickBestDiscount).
 */

export const LIFETIME_BIND_ACTION = "promo.lifetime.bind";
export const LIFETIME_REVOKE_ACTION = "promo.lifetime.revoke";
export const LIFETIME_AUDIT_ENTITY = "AccountLifetimeDiscount";

const PAID_STATUSES = new Set(["paid", "completed"]);

export type LifetimeBindingRecord = {
  id: string;
  accountId: string;
  promoCodeId: string;
  code: string;
  kind: "percent" | "fixed";
  value: number;
  orderId: number;
  boundAt: Date;
  revokedAt: Date | null;
  revokedById: string | null;
};

export type LifetimeBindingData = Omit<LifetimeBindingRecord, "id">;

export type LifetimeStore = {
  findOrder(orderId: number): Promise<{
    id: number;
    status: string;
    promoCode: string | null;
    lifetimeDiscountId: string | null;
  } | null>;
  findCode(code: string): Promise<{
    id: string;
    code: string;
    kind: "percent" | "fixed";
    value: number;
    lifetime: boolean;
  } | null>;
  accountOfOrganization(organizationId: string): Promise<string | null>;
  findBinding(accountId: string): Promise<LifetimeBindingRecord | null>;
  findBindingById(id: string): Promise<LifetimeBindingRecord | null>;
  /** null — строка для аккаунта уже есть (гонка двух оплат, unique). */
  createBinding(data: LifetimeBindingData): Promise<LifetimeBindingRecord | null>;
  updateBinding(id: string, data: Partial<LifetimeBindingData>): Promise<LifetimeBindingRecord>;
  audit(entry: {
    organizationId: string;
    action: string;
    bindingId: string;
    actor?: { id: string; name: string | null } | null;
    details: Record<string, unknown>;
  }): Promise<void>;
};

export type LifetimeDecision = "create" | "noop" | "rebind";

/** Что делать с привязкой аккаунта при оплате заказа с lifetime-кодом. */
export function decideLifetimeBinding(
  existing: Pick<LifetimeBindingRecord, "orderId" | "promoCodeId" | "revokedAt"> | null,
  order: { id: number },
  code: { id: string }
): LifetimeDecision {
  if (!existing) return "create";
  // Тот же заказ — повторная обработка оплаты: ничего не меняем, даже если
  // ROOT уже успел отменить скидку.
  if (existing.orderId === order.id) return "noop";
  if (!existing.revokedAt && existing.promoCodeId === code.id) return "noop";
  return "rebind";
}

export type LifetimeBindOutcome =
  | { status: "bound"; binding: LifetimeBindingRecord }
  | {
      status: "rebound";
      binding: LifetimeBindingRecord;
      previous: { code: string; orderId: number; revoked: boolean };
    }
  | { status: "already-bound"; binding: LifetimeBindingRecord }
  | {
      status: "skipped";
      reason: "order-missing" | "not-paid" | "no-code" | "auto-applied" | "code-missing" | "not-lifetime" | "no-account";
    };

export async function bindLifetimeDiscount(
  store: LifetimeStore,
  input: { orderId: number; organizationId: string; now?: Date }
): Promise<LifetimeBindOutcome> {
  const order = await store.findOrder(input.orderId);
  if (!order) return { status: "skipped", reason: "order-missing" };
  if (!PAID_STATUSES.has(order.status)) return { status: "skipped", reason: "not-paid" };
  if (!order.promoCode) return { status: "skipped", reason: "no-code" };
  if (order.lifetimeDiscountId) return { status: "skipped", reason: "auto-applied" };
  const code = await store.findCode(order.promoCode);
  if (!code) return { status: "skipped", reason: "code-missing" };
  if (!code.lifetime) return { status: "skipped", reason: "not-lifetime" };
  const accountId = await store.accountOfOrganization(input.organizationId);
  if (!accountId) {
    console.warn(
      `[promo] lifetime not bound: organization ${input.organizationId} has no account (order #${order.id}, code ${code.code})`
    );
    return { status: "skipped", reason: "no-account" };
  }

  const data: LifetimeBindingData = {
    accountId,
    promoCodeId: code.id,
    code: code.code,
    kind: code.kind,
    value: code.value,
    orderId: order.id,
    boundAt: input.now ?? new Date(),
    revokedAt: null,
    revokedById: null,
  };

  let existing = await store.findBinding(accountId);
  let decision = decideLifetimeBinding(existing, order, code);
  let binding: LifetimeBindingRecord | null = null;
  if (decision === "create") {
    binding = await store.createBinding(data);
    if (!binding) {
      // Параллельная оплата успела привязать первой — решаем заново.
      existing = await store.findBinding(accountId);
      decision = decideLifetimeBinding(existing, order, code);
    }
  }
  if (decision === "noop" && existing) {
    console.info(
      `[promo] lifetime already bound account=${accountId} code=${existing.code} order=${existing.orderId} (order #${order.id} changes nothing)`
    );
    return { status: "already-bound", binding: existing };
  }
  let previous: { code: string; orderId: number; revoked: boolean } | null = null;
  if (!binding && existing) {
    previous = { code: existing.code, orderId: existing.orderId, revoked: Boolean(existing.revokedAt) };
    binding = await store.updateBinding(existing.id, data);
  }
  if (!binding) return { status: "skipped", reason: "no-account" };

  const amount = code.kind === "percent" ? `${code.value}%` : `${code.value}rub`;
  console.info(
    `[promo] lifetime bound account=${accountId} code=${code.code} value=${amount} order=${order.id}` +
      (previous ? ` (replaced ${previous.code}${previous.revoked ? ", revoked" : ""})` : "")
  );
  await store.audit({
    organizationId: input.organizationId,
    action: LIFETIME_BIND_ACTION,
    bindingId: binding.id,
    details: {
      code: code.code,
      kind: code.kind,
      value: code.value,
      orderId: order.id,
      accountId,
      ...(previous ? { previousCode: previous.code, previousRevoked: previous.revoked } : {}),
    },
  });
  return previous ? { status: "rebound", binding, previous } : { status: "bound", binding };
}

export type LifetimeRevokeOutcome =
  | { ok: true; binding: LifetimeBindingRecord }
  | { ok: false; status: 404 | 409; error: string };

/** Отмена ROOT'ом: скидка перестаёт применяться к следующим оплатам. */
export async function revokeLifetimeDiscount(
  store: LifetimeStore,
  input: { id: string; actor: { id: string; name: string | null }; auditOrganizationId: string; now?: Date }
): Promise<LifetimeRevokeOutcome> {
  const existing = await store.findBindingById(input.id);
  if (!existing) return { ok: false, status: 404, error: "Скидка не найдена" };
  if (existing.revokedAt) return { ok: false, status: 409, error: "Скидка уже отменена" };
  const binding = await store.updateBinding(existing.id, {
    revokedAt: input.now ?? new Date(),
    revokedById: input.actor.id,
  });
  console.info(
    `[promo] lifetime revoked account=${existing.accountId} code=${existing.code} order=${existing.orderId} by ${input.actor.name ?? input.actor.id}`
  );
  await store.audit({
    organizationId: input.auditOrganizationId,
    action: LIFETIME_REVOKE_ACTION,
    bindingId: existing.id,
    actor: input.actor,
    details: {
      code: existing.code,
      kind: existing.kind,
      value: existing.value,
      orderId: existing.orderId,
      accountId: existing.accountId,
    },
  });
  return { ok: true, binding };
}
