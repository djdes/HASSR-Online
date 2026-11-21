/**
 * Роли в аккаунте (серия E, Р5): владелец аккаунта и управляющий сетью.
 *
 * Управляющего назначает владелец (`AccountNetworkManager`) из руководителей
 * организаций аккаунта с полным доступом. Он получает права владельца на
 * «Сеть», обмен справочниками, разовый перенос, пропуски, историю, код
 * мастер-кабинета, баланс по аккаунту и переводы. Только владельцу —
 * решения по запросам другой компании, назначение управляющих, тариф и
 * оплата. Чистые правила; данные читает `account-roles.server.ts`.
 */

export type AccountRole = "owner" | "network_manager";

/** Больше управляющих на аккаунт не назначаем: это доверенные люди, не весь штат. */
export const NETWORK_MANAGERS_MAX = 20;

/** Что известно о человеке по отношению к организациям одного аккаунта. */
export type AccountAccessFacts = {
  isActive: boolean;
  archivedAt: Date | null;
  isRoot: boolean;
  /** Домашняя организация — рабочая организация этого аккаунта. */
  homeInAccount: boolean;
  /** Роль руководства в домашней организации (`isManagementRole`). */
  homeManagement: boolean;
  /** Руководитель точки в домашней организации — не вся компания. */
  homePointScoped: boolean;
  /** Членств в рабочих организациях аккаунта (в чужой организации членство — руководство). */
  accountMemberships: number;
};

/**
 * Полный доступ хотя бы в одной рабочей организации аккаунта: человек
 * активен, не в архиве, не администратор платформы, и он руководитель всей
 * компании дома или участник (`OrganizationMember`) одной из организаций.
 */
export function hasAccountFullAccess(facts: AccountAccessFacts): boolean {
  if (!facts.isActive || facts.archivedAt || facts.isRoot) return false;
  if (facts.homeInAccount && facts.homeManagement && !facts.homePointScoped) return true;
  return facts.accountMemberships > 0;
}

/**
 * Роль человека в аккаунте: владелец — всегда владелец; назначенный
 * управляющий — только пока у него полный доступ в организациях аккаунта
 * (уволили, перевели в архив, лишили руководства — права пропали сразу).
 */
export function resolveAccountRole(input: {
  userId: string;
  ownerUserId: string | null | undefined;
  appointed: boolean;
  fullAccess: boolean;
}): AccountRole | null {
  if (input.ownerUserId && input.ownerUserId === input.userId) return "owner";
  if (input.appointed && input.fullAccess) return "network_manager";
  return null;
}

/** Права владельца на сеть: «Сеть», обмен, перенос, пропуски, история, код, баланс и переводы. */
export function canManageNetworkRole(role: AccountRole | null | undefined): boolean {
  return role === "owner" || role === "network_manager";
}

/** Назначать и снимать управляющих, решать запросы другой компании, тариф и оплата. */
export function isAccountOwnerRole(role: AccountRole | null | undefined): boolean {
  return role === "owner";
}

/**
 * Можно ли назначить человека: не владелец, ещё не назначен, с полным
 * доступом в организациях аккаунта и в пределах `NETWORK_MANAGERS_MAX`.
 */
export type AppointDecision =
  | { ok: true }
  | { ok: false; reason: "owner" | "already" | "not_eligible" | "limit" };

export function decideAppointment(input: {
  userId: string;
  ownerUserId: string;
  appointedIds: ReadonlySet<string>;
  eligibleIds: ReadonlySet<string>;
}): AppointDecision {
  if (input.userId === input.ownerUserId) return { ok: false, reason: "owner" };
  if (input.appointedIds.has(input.userId)) return { ok: false, reason: "already" };
  if (!input.eligibleIds.has(input.userId)) return { ok: false, reason: "not_eligible" };
  if (input.appointedIds.size >= NETWORK_MANAGERS_MAX) return { ok: false, reason: "limit" };
  return { ok: true };
}
