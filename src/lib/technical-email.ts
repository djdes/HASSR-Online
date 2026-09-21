/**
 * Служебные почтовые адреса сотрудников.
 *
 * У сотрудника, заведённого руководителем или зарегистрированного по
 * QR-коду, настоящей почты нет: адрес собирается автоматически, только
 * чтобы соблюсти `User.email @unique`. Человек его не знает, войти по
 * нему не может, и в интерфейсе он выглядит мусором
 * («79991234567@cmf….staff.local»). Такие адреса не показываем.
 *
 * Шаблоны (см. `src/lib/staff-create.ts` и `src/app/api/join/[token]`):
 *   staff-<соль>@<id организации>.local.haccp
 *   <цифры телефона>@<id организации>.staff.local
 */
const TECHNICAL_EMAIL_SUFFIXES = [".local.haccp", ".staff.local", ".local"];

export function isTechnicalEmail(email: string | null | undefined): boolean {
  const value = (email ?? "").trim().toLowerCase();
  if (value === "" || !value.includes("@")) return false;
  const domain = value.slice(value.lastIndexOf("@") + 1);
  return TECHNICAL_EMAIL_SUFFIXES.some((suffix) => domain.endsWith(suffix));
}
