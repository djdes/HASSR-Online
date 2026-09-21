/**
 * Отображаемое имя сотрудника — без служебной почты.
 *
 * Мгновенная регистрация кладёт почту в поле «имя», и в списках выбора
 * сотрудника журналов и в шапках бланков печаталось «Управляющий -
 * owner-a@e2e.local». Почта — не фамилия: на бумаге для инспектора она
 * бессмысленна, а в списке выглядит как сбой. Если имени нет или это
 * почта, возвращаем запасной текст (должность или «Без имени»).
 *
 * Модуль чистый и без зависимостей — его зовут и сервер (PDF), и браузер.
 */

const EMAIL_LIKE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const NO_NAME_LABEL = "Без имени";

/** Похоже на адрес почты? */
export function looksLikeEmail(value: string | null | undefined): boolean {
  return EMAIL_LIKE.test(String(value ?? "").trim());
}

/** Имя человека или `null`, если имени по сути нет (пусто / почта). */
export function getRealUserName(user: {
  name?: string | null;
  email?: string | null;
}): string | null {
  const name = String(user.name ?? "").trim();
  if (!name) return null;
  if (looksLikeEmail(name)) return null;
  const email = String(user.email ?? "").trim().toLowerCase();
  if (email && name.toLowerCase() === email) return null;
  return name;
}

/**
 * Имя для показа. Нет имени — `fallback` (должность), а если и её нет —
 * «Без имени». Почту не показываем никогда.
 */
export function getUserDisplayName(
  user: { name?: string | null; email?: string | null },
  fallback?: string | null
): string {
  return getRealUserName(user) ?? (String(fallback ?? "").trim() || NO_NAME_LABEL);
}
