/**
 * Разбор реквизитов организации — одни правила на всех, кто их правит.
 *
 * Полей два потребителя: `/api/settings/organization` (клиент правит
 * свою организацию) и `/api/partner/clients/[orgId]` (консультант правит
 * организацию клиента со своей карточки). Дублировать проверки было бы
 * вопросом времени до расхождения: там 10 цифр в ИНН, тут 12.
 *
 * Каждый потребитель передаёт свой список разрешённых полей. Ключ,
 * которого нет в теле запроса, не попадает в результат — значит поле не
 * трогаем; пустая строка у необязательного поля означает «очистить».
 */

import { sanitizeOrgJournalName } from "@/lib/org-journal-name";
import { ORG_LOGO_PATH_PATTERN } from "@/lib/org-logo-file";
import { normalizeOwnership, normalizeSphere } from "@/lib/org-profile";

export const ORG_PROFILE_FIELDS = [
  "name",
  "journalShortName",
  "type",
  "ownershipKind",
  "inn",
  "address",
  "phone",
  "accountantEmail",
  "locale",
  "timezone",
  "brandColor",
  "logoUrl",
  "shiftEndHour",
  "lockPastDayEdits",
  "requireAdminForJournalEdit",
  // Правки реквизитов поверх снимка ЕГРЮЛ (`document-org-block.ts`).
  "legalFullName",
  "kpp",
  "ogrn",
  "legalAddress",
  "directorName",
  "directorPost",
] as const;

export type OrgProfileField = (typeof ORG_PROFILE_FIELDS)[number];

const VALID_LOCALES = new Set(["ru", "en", "uz"]);
const TIMEZONE_PATTERN = /^[A-Za-z_]+\/[A-Za-z_/-]+$/;
// Принимаем 3- (#abc), 6- (#aabbcc) и 8-знач (#aabbccff) hex — иначе
// legacy-данные с alpha или коротким shorthand блокируют сохранение
// всей формы.
const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const URL_PATTERN = /^https?:\/\/.+/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INN_PATTERN = /^\d{10}$|^\d{12}$/;
const PHONE_PATTERN = /^[+\d][\d\s().-]{5,}$/;
// КПП: 4 цифры кода налогового органа, 2 знака причины (цифры или
// заглавные латинские с 2019 г.), 3 цифры номера.
const KPP_PATTERN = /^\d{4}[\dA-Z]{2}\d{3}$/;
// ОГРН юрлица — 13 цифр, ОГРНИП — 15.
const OGRN_PATTERN = /^\d{13}$|^\d{15}$/;

/**
 * Текстовая правка реквизита: пробелы схлопнуты, длина ограничена; пусто →
 * null — «брать из ЕГРЮЛ».
 */
function legalText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim().slice(0, max);
  return text || null;
}

export type OrgProfilePatchResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string };

export function parseOrganizationProfilePatch(
  body: Record<string, unknown>,
  allowed: readonly OrgProfileField[],
): OrgProfilePatchResult {
  const can = new Set<string>(allowed);
  const data: Record<string, unknown> = {};
  const errors: string[] = [];
  const has = (key: OrgProfileField) => can.has(key) && key in body;

  if (has("name")) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) errors.push("Название обязательно");
    else if (name.length > 200) errors.push("Название слишком длинное");
    else data.name = name;
  }
  // Сокращённое название для шапки журналов: пусто — «как в ЕГРЮЛ или
  // полное», поэтому очищаем в null, а не в пустую строку.
  if (has("journalShortName")) {
    data.journalShortName = sanitizeOrgJournalName(body.journalShortName) || null;
  }
  // `type` — сфера заведения. Не валидируем перечислением, а
  // нормализуем: старые значения из базы (meat, dairy…) должны
  // сохраняться без ошибки, а не ронять всю форму.
  if (has("type")) {
    data.type = normalizeSphere(body.type);
  }
  if (has("ownershipKind")) {
    data.ownershipKind = normalizeOwnership(body.ownershipKind);
  }
  if (has("inn")) {
    const inn = typeof body.inn === "string" ? body.inn.replace(/\s/g, "") : "";
    if (inn === "") data.inn = null;
    else if (!INN_PATTERN.test(inn)) errors.push("ИНН должен содержать 10 или 12 цифр");
    else data.inn = inn;
  }
  if (has("address")) {
    const v = typeof body.address === "string" ? body.address.trim() : "";
    data.address = v === "" ? null : v.slice(0, 500);
  }
  if (has("phone")) {
    const v = typeof body.phone === "string" ? body.phone.trim() : "";
    if (v === "") data.phone = null;
    else if (!PHONE_PATTERN.test(v)) errors.push("Телефон в неправильном формате");
    else data.phone = v.slice(0, 50);
  }
  if (has("accountantEmail")) {
    const v = typeof body.accountantEmail === "string" ? body.accountantEmail.trim() : "";
    if (v === "") data.accountantEmail = null;
    else if (!EMAIL_PATTERN.test(v)) errors.push("Email бухгалтера в неправильном формате");
    else data.accountantEmail = v.slice(0, 200);
  }
  if (has("locale")) {
    const v = typeof body.locale === "string" ? body.locale : "";
    if (!VALID_LOCALES.has(v)) errors.push("Язык должен быть ru, en или uz");
    else data.locale = v;
  }
  if (has("timezone")) {
    const v = typeof body.timezone === "string" ? body.timezone.trim() : "";
    if (v === "") data.timezone = "Europe/Moscow";
    else if (!TIMEZONE_PATTERN.test(v)) errors.push("Часовой пояс в формате IANA: Europe/Moscow");
    else data.timezone = v;
  }
  if (has("brandColor")) {
    const v = typeof body.brandColor === "string" ? body.brandColor.trim() : "";
    if (v === "") data.brandColor = null;
    else if (!HEX_COLOR.test(v)) errors.push("Брендовый цвет в формате #RRGGBB");
    else data.brandColor = v;
  }
  if (has("logoUrl")) {
    const v = typeof body.logoUrl === "string" ? body.logoUrl.trim() : "";
    if (v === "") data.logoUrl = null;
    // Загруженный в кабинете файл живёт по внутреннему адресу (lib/org-logo.ts).
    else if (!URL_PATTERN.test(v) && !ORG_LOGO_PATH_PATTERN.test(v)) errors.push("URL логотипа должен начинаться с http:// или https://");
    else data.logoUrl = v.slice(0, 500);
  }
  if (has("shiftEndHour")) {
    const h = Number(body.shiftEndHour);
    if (!Number.isFinite(h) || h < 0 || h > 23) errors.push("Час окончания смены должен быть от 0 до 23");
    else data.shiftEndHour = Math.floor(h);
  }
  if (has("lockPastDayEdits") && typeof body.lockPastDayEdits === "boolean") {
    data.lockPastDayEdits = body.lockPastDayEdits;
  }
  if (has("requireAdminForJournalEdit") && typeof body.requireAdminForJournalEdit === "boolean") {
    data.requireAdminForJournalEdit = body.requireAdminForJournalEdit;
  }

  // Правки реквизитов: пустое значение очищает правку, и в документы снова
  // идёт снимок ЕГРЮЛ.
  if (has("legalFullName")) data.legalFullName = legalText(body.legalFullName, 300);
  if (has("legalAddress")) data.legalAddress = legalText(body.legalAddress, 500);
  if (has("directorName")) data.directorName = legalText(body.directorName, 200);
  if (has("directorPost")) data.directorPost = legalText(body.directorPost, 200);
  if (has("kpp")) {
    const v = legalText(body.kpp, 20)?.replace(/\s/g, "").toUpperCase() ?? null;
    if (v !== null && !KPP_PATTERN.test(v)) errors.push("КПП — 9 знаков, например 770101001");
    else data.kpp = v;
  }
  if (has("ogrn")) {
    const v = legalText(body.ogrn, 20)?.replace(/\s/g, "") ?? null;
    if (v !== null && !OGRN_PATTERN.test(v)) errors.push("ОГРН — 13 цифр, ОГРНИП — 15 цифр");
    else data.ogrn = v;
  }

  if (errors.length > 0) return { ok: false, error: errors.join("; ") };
  if (Object.keys(data).length === 0) return { ok: false, error: "Нет полей для обновления" };
  return { ok: true, data };
}
