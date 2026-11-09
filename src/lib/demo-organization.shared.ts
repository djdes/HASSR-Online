import { sphereLabel } from "@/lib/org-profile";

/**
 * Чистые helper'ы демо-организации — без Prisma, чтобы их могли
 * импортировать клиентские компоненты (баннер, переключатель).
 * Серверная часть (установка, заселение, удаление) — в demo-organization.ts.
 *
 * Демо — одна общая на всю платформу (2026-11-09): фиксированный id,
 * переустановка раз в сутки со свежими данными. Своя демо на каждый
 * аккаунт больше не создаётся.
 */

/** Id общей демо-организации. Постоянный: сессии и ссылки переживают переустановку. */
export const SHARED_DEMO_ORG_ID = "demo";

/** Сфера общей демо: её ростер и набор журналов. */
export const SHARED_DEMO_SPHERE = "restaurant";

/** За сколько последних дней в демо заполнены журналы. */
export const DEMO_HISTORY_DAYS = 7;

/** Как часто демо переустанавливается. */
export const DEMO_RESET_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** «Демо — Кафе / Кофейня»: по label сферы из ORG_SPHERES. */
export function demoOrgName(sphere: unknown): string {
  return `Демо — ${sphereLabel(sphere)}`;
}

/** Когда демо, установленную в `now`, пора переустановить (`demoExpiresAt`). */
export function demoNextResetAt(now: Date): Date {
  return new Date(now.getTime() + DEMO_RESET_INTERVAL_MS);
}

/**
 * Демо пора переустановить: срок вышел или не записан. Страховка на случай,
 * если ночной cron не отработал, — проверяется, когда в демо входят.
 */
export function isDemoOverdue(expiresAt: Date | null | undefined, now: Date): boolean {
  return !expiresAt || expiresAt.getTime() <= now.getTime();
}
