import type { PrismaClient } from "@prisma/client";

/**
 * Неблокирующая advisory-блокировка Postgres «на время работы».
 *
 * Зачем: документ нового периода может родиться из нескольких мест сразу
 * — ночной крон и первые QR-сканы после полуночи, пять сотрудников
 * у одного плаката. Проверка «активного документа нет → создаём» без
 * блокировки даёт два бланка на один период.
 *
 * Как: `pg_try_advisory_xact_lock(hashtext(key))` внутри транзакции.
 * Блокировка ТРАНЗАКЦИОННАЯ, а не сессионная: у нас пул соединений, и
 * сессионный `pg_advisory_unlock` мог уйти в другое соединение — замок
 * висел бы до его закрытия. Транзакция держит соединение, пока работает
 * `fn`, и Postgres сам снимает замок на commit/rollback.
 *
 * Не ждём на стороне БД (`pg_advisory_xact_lock` занял бы соединение из
 * пула на всё ожидание): проигравший сразу закрывает транзакцию, спит
 * `delayMs` и пробует снова. Внутри `fn` вызывающий обязан ПЕРЕПРОВЕРИТЬ
 * состояние (документ мог создать победитель) — блокировка лишь
 * выстраивает создателей в очередь.
 */
export type AdvisoryLockClient = Pick<PrismaClient, "$transaction">;

export type AdvisoryLockResult<T> = { acquired: true; value: T } | { acquired: false };

/** Ключ блокировки из частей; пустые части — «-». */
export function advisoryLockKey(...parts: Array<string | null | undefined>): string {
  return parts.map((part) => (part === null || part === undefined || part === "" ? "-" : part)).join(":");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function withAdvisoryTryLock<T>(
  key: string,
  fn: () => Promise<T>,
  options: {
    /** Сколько раз пробовать взять замок (по умолчанию 40 × 150 мс ≈ 6 с). */
    attempts?: number;
    delayMs?: number;
    /** Клиент БД; по умолчанию общий `db`. Тесты и кроны передают свой. */
    client?: AdvisoryLockClient;
    /** Сколько может работать `fn` под замком. */
    timeoutMs?: number;
  } = {}
): Promise<AdvisoryLockResult<T>> {
  const attempts = Math.max(1, options.attempts ?? 40);
  const delayMs = Math.max(0, options.delayMs ?? 150);
  // Ленивый импорт: чистые тесты передают свой клиент и не поднимают Prisma.
  const client = options.client ?? ((await import("@/lib/db")).db as AdvisoryLockClient);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const outcome = await client.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtext(${key}::text)) AS locked`;
        if (rows[0]?.locked !== true) return { acquired: false } as const;
        return { acquired: true, value: await fn() } as const;
      },
      { maxWait: 10_000, timeout: options.timeoutMs ?? 60_000 }
    );
    if (outcome.acquired) return outcome;
    if (attempt < attempts - 1) await sleep(delayMs);
  }
  return { acquired: false };
}
