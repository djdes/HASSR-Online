/**
 * «Права доступа → Мастер-кабинеты» — чистая часть без БД.
 *
 * Доступ к мастер-кабинету (владелец, 2026-09-30) выдаётся двумя путями:
 *   - приглашение по почте — отдельный аккаунт, у которого есть только этот
 *     кабинет (домашняя организация — сам кабинет);
 *   - уже заведённому сотруднику объекта — участие в кабинете
 *     (`OrganizationMember`), его обычный вход и права не меняются.
 */

export type AccessCandidate = {
  id: string;
  name: string;
  organizationName: string;
  /** Должность из карточки (или роль). */
  title: string;
  /** Руководство и технологи — меню и сырьё обычно ведут они. */
  recommended: boolean;
};

export type AccessPerson = {
  userId: string;
  name: string;
  email: string;
  /** invited — аккаунт только в кабинете (по почте); member — сотрудник объекта. */
  kind: "invited" | "member";
  /** Приглашённый ещё не задал пароль. */
  pending: boolean;
  /** Объект сотрудника (для member). */
  organizationName: string | null;
  title: string | null;
};

export type CabinetAccess = { id: string; name: string; people: AccessPerson[] };

const MANAGEMENT_ROLES = new Set(["owner", "manager", "head_chef", "technologist"]);

export function isRecommendedForCabinet(
  role: string | null | undefined,
  positionCategory: string | null | undefined
): boolean {
  return positionCategory === "management" || MANAGEMENT_ROLES.has((role ?? "").trim());
}

/**
 * Кого можно добавить в кабинет: без тех, у кого доступ уже есть; поиск по
 * имени, объекту и должности; «Рекомендуем» (руководство, технологи) —
 * сверху, внутри групп — по алфавиту.
 */
export function groupAccessCandidates(
  candidates: readonly AccessCandidate[],
  excludeIds: readonly string[],
  query: string
): { recommended: AccessCandidate[]; other: AccessCandidate[] } {
  const exclude = new Set(excludeIds);
  const q = query.replace(/\s+/g, " ").trim().toLocaleLowerCase("ru");
  const matches = candidates.filter(
    (candidate) =>
      !exclude.has(candidate.id) &&
      (!q || `${candidate.name} ${candidate.organizationName} ${candidate.title}`.toLocaleLowerCase("ru").includes(q))
  );
  const byName = (a: AccessCandidate, b: AccessCandidate) => a.name.localeCompare(b.name, "ru");
  return {
    recommended: matches.filter((candidate) => candidate.recommended).sort(byName),
    other: matches.filter((candidate) => !candidate.recommended).sort(byName),
  };
}

export const ACCESS_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** ФИО и email приглашения: пробелы схлопнуты, email в нижнем регистре; неверно — текст ошибки. */
export function normalizeCabinetInvite(
  rawName: unknown,
  rawEmail: unknown
): { ok: true; name: string; email: string } | { ok: false; error: string } {
  const name = typeof rawName === "string" ? rawName.replace(/\s+/g, " ").trim() : "";
  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
  if (name.length < 2 || name.length > 120) return { ok: false, error: "Укажите ФИО — от 2 до 120 символов" };
  if (!ACCESS_EMAIL_RE.test(email)) return { ok: false, error: "Введите корректный email" };
  return { ok: true, name, email };
}
