import { db } from "@/lib/db";

/**
 * Версия сессий пользователя — способ «выйти на всех устройствах» при
 * JWT-сессиях без серверного хранилища. В токен при входе кладётся
 * `sv`; каждая проверка сессии сравнивает его с `User.sessionVersion`.
 * «Завершить все сессии» увеличивает версию — все выданные ранее
 * токены (включая текущий) перестают проходить.
 *
 * Сравнение делается на каждом запросе, поэтому версия кешируется на
 * минуту: один запрос в базу на человека в минуту, а не на каждый клик.
 * После bump кеш обновляется сразу — в этом процессе новая версия видна
 * немедленно; воркер один (PM2 fork), так что этого достаточно.
 */
const TTL_MS = 60_000;
// Кеш — один на процесс (globalThis): Next грузит модуль отдельными копиями
// для страниц и API-маршрутов, и bump из API иначе доходил до страниц
// только через минуту (2026-09-22).
const cacheHost = globalThis as typeof globalThis & { __wesetupSessionVersionCache?: Map<string, { version: number; at: number }> };
const cache = (cacheHost.__wesetupSessionVersionCache ??= new Map<string, { version: number; at: number }>());

export async function getSessionVersion(userId: string): Promise<number> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.version;
  const row = await db.user.findUnique({ where: { id: userId }, select: { sessionVersion: true } });
  const version = row?.sessionVersion ?? 0;
  cache.set(userId, { version, at: Date.now() });
  return version;
}

/** Токен без claim'а (выдан до этой фичи) считается версией 0. */
export async function isSessionVersionCurrent(userId: string, claimed: unknown): Promise<boolean> {
  if (!userId) return false;
  const claimedVersion = typeof claimed === "number" && Number.isFinite(claimed) ? claimed : 0;
  try {
    return (await getSessionVersion(userId)) === claimedVersion;
  } catch (error) {
    // База недоступна — не выкидывать всех из кабинета из-за этого.
    console.error("[session-version] check failed", error);
    return true;
  }
}

export async function bumpSessionVersion(userId: string): Promise<number> {
  const row = await db.user.update({
    where: { id: userId },
    data: { sessionVersion: { increment: 1 } },
    select: { sessionVersion: true },
  });
  cache.set(userId, { version: row.sessionVersion, at: Date.now() });
  return row.sessionVersion;
}
