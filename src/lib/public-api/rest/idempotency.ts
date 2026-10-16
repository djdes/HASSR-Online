import { claimIdempotency, type IdempotencyStore } from "@/lib/idempotency";

/**
 * Idempotency-Key для POST /api/v1/*: «сначала застолбить, потом делать»
 * (см. src/lib/idempotency.ts) — повтор клиента, пришедший, пока первая
 * попытка ещё выполняется, не создаёт второго сотрудника.
 */

export type RestReply = { status: number; body: unknown };

/** Ключ привязан к ключу API и инструменту: повтор на другой операции не отдаст чужой ответ. */
export function restIdempotencyKey(keyId: string, toolName: string, header: string | null): string | null {
  const value = header?.trim().slice(0, 120);
  return value ? `v1:${keyId}:${toolName}:${value}` : null;
}

export async function runIdempotent(args: {
  store: IdempotencyStore;
  key: string | null;
  organizationId: string;
  run: () => Promise<RestReply>;
}): Promise<RestReply & { replayed: boolean; inFlight?: boolean }> {
  if (!args.key) return { ...(await args.run()), replayed: false };

  const claim = await claimIdempotency(args.store, {
    key: args.key,
    organizationId: args.organizationId,
    journalCode: null,
  });
  if (claim.kind === "replay") {
    return { status: claim.stored.httpStatus, body: claim.stored.response, replayed: true };
  }
  if (claim.kind === "in_flight") {
    return {
      status: 409,
      body: { ok: false, error: "Запрос с этим Idempotency-Key ещё выполняется — повторите через несколько секунд" },
      replayed: false,
      inFlight: true,
    };
  }

  let reply: RestReply;
  try {
    reply = await args.run();
  } catch (error) {
    await args.store.release(args.key).catch(() => {});
    throw error;
  }
  // Запоминаем только успех: ошибку человек исправит и пришлёт тот же ключ.
  if (reply.status === 200) {
    await args.store.complete(args.key, { httpStatus: reply.status, response: reply.body }).catch(() => {});
  } else {
    await args.store.release(args.key).catch(() => {});
  }
  return { ...reply, replayed: false };
}
