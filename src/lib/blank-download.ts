/**
 * Шаблоны журналов с публичных страниц — скачивание после email
 * (спека `.agent/tasks/blanks-email-gate-2026-09/spec.md`).
 *
 * Общие константы и чистые функции: их берут и окно «Куда прислать
 * шаблон?» в браузере, и сервер (POST /api/public/blank-download, роуты
 * файлов, страница /qb). Здесь нет ни node:crypto, ни БД — модуль
 * безопасно импортировать в клиентский компонент.
 */

export type BlankFormat = "pdf" | "docx";

/** Что скачивают: образец журнала каталога или бумажный бланк. */
export type BlankTarget =
  | { kind: "code"; code: string }
  | { kind: "paper"; paperId: string };

export const BLANK_FORMAT_LABEL: Record<BlankFormat, string> = {
  pdf: "PDF",
  docx: "Word",
};

/**
 * Текст галки согласия — по частям, чтобы окно рисовало ссылки на
 * документы, а сервер сохранял ровно ту же строку (`BLANK_CONSENT_TEXT`),
 * что видел человек. Документы — те же действующие, что у регистрации;
 * оферта и соглашение здесь не нужны: скачивание не делает человека
 * клиентом сервиса.
 */
export const BLANK_CONSENT_PARTS = [
  { text: "Даю " },
  { text: "согласие на обработку персональных данных", href: "/consent" },
  { text: " и ознакомлен с " },
  { text: "политикой конфиденциальности", href: "/privacy" },
] as const;

export const BLANK_CONSENT_TEXT = BLANK_CONSENT_PARTS.map((part) => part.text).join("");

/** Подпись у QR в скачанном файле. */
export const BLANK_QR_CAPTION = "Заполнять с телефона — wesetup.ru";
/** Строка копирайта на каждой странице скачанного файла. */
export const BLANK_COPYRIGHT = "© WeSetup — электронные журналы ХАССП и СанПиН · wesetup.ru";

/**
 * Действие в AuditLog платформы: журнал и формат скачивания. В LegalConsent
 * для них нет полей (схему не меняем), запись ссылается на согласие.
 */
export const BLANK_DOWNLOAD_AUDIT_ACTION = "blank.download";

/** Где браузер помнит почту, на которую уже скачивали шаблон. */
export const BLANK_EMAIL_STORAGE_KEY = "wesetup.blank-download";

const EMAIL_MAX = 200;
// Та же проверка, что у мгновенной регистрации (instant-register).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Почта в каноническом виде или `null`, если это не адрес. */
export function normalizeBlankEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (!email || email.length > EMAIL_MAX || !EMAIL_RE.test(email)) return null;
  return email;
}

/** Стабильный ключ цели: `code:hygiene`, `paper:ot_intro`. */
export function blankTargetKey(target: BlankTarget): string {
  return target.kind === "code" ? `code:${target.code}` : `paper:${target.paperId}`;
}

export function parseBlankTargetKey(key: unknown): BlankTarget | null {
  if (typeof key !== "string") return null;
  const match = /^(code|paper):([a-z0-9_-]{1,64})$/.exec(key);
  if (!match) return null;
  return match[1] === "code" ? { kind: "code", code: match[2] } : { kind: "paper", paperId: match[2] };
}

/** Адрес файла без токена — таким он стоит в `href` кнопок и в старых ссылках. */
export function blankFilePath(target: BlankTarget, format: BlankFormat): string {
  if (target.kind === "paper") {
    return `/api/journal-samples/paper/${encodeURIComponent(target.paperId)}/pdf`;
  }
  return `/api/journal-samples/${encodeURIComponent(target.code)}/${format}`;
}

/**
 * Страница, куда уводим браузер, пришедший за файлом без действующего
 * токена (старая ссылка из блога, поиска, протухшее письмо): окно email
 * там открывается сразу.
 */
export function blankPagePath(target: BlankTarget, format: BlankFormat): string {
  if (target.kind === "paper") {
    return `/blanki?download=pdf&paper=${encodeURIComponent(target.paperId)}`;
  }
  return `/journals-info/${encodeURIComponent(target.code)}?download=${format}`;
}

/** Журнал в кабинете, который откроется после входа или регистрации. */
export function blankCabinetPath(target: BlankTarget): string {
  return target.kind === "paper"
    ? `/settings/journals/paper/${encodeURIComponent(target.paperId)}`
    : `/journals/${encodeURIComponent(target.code)}`;
}

/** Регистрация с подставленной почтой и отметкой источника «бланк». */
export function blankRegisterHref(params: { email?: string | null; target?: BlankTarget | null }): string {
  const query = new URLSearchParams();
  if (params.email) query.set("email", params.email);
  query.set("source", "blank");
  if (params.target) {
    query.set("journal", params.target.kind === "code" ? params.target.code : `paper:${params.target.paperId}`);
    query.set("next", blankCabinetPath(params.target));
  }
  return `/register?${query.toString()}`;
}

/** Вход с подставленной почтой и возвратом на журнал. */
export function blankLoginHref(params: { email?: string | null; target?: BlankTarget | null }): string {
  const query = new URLSearchParams();
  if (params.email) query.set("email", params.email);
  if (params.target) query.set("next", blankCabinetPath(params.target));
  const qs = query.toString();
  return qs ? `/login?${qs}` : "/login";
}

/**
 * Отметка источника для регистрации (`place` в readSignupSource): видна
 * в уведомлении о новой регистрации. Сервер режет место до 40 символов,
 * самый длинный код журнала — 30, так что «blank:<код>» помещается.
 */
export function blankSignupPlace(journal: string | null | undefined): string {
  const clean = (journal ?? "").trim();
  return /^(paper:)?[a-z0-9_-]{1,32}$/.test(clean) ? `blank:${clean}`.slice(0, 40) : "blank";
}

/** Что браузер помнит после первого скачивания. */
export type RememberedBlankEmail = { email: string; consentVersion: string };

export function readRememberedBlankEmail(raw: string | null | undefined): RememberedBlankEmail | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<RememberedBlankEmail>;
    const email = normalizeBlankEmail(value.email);
    if (!email || typeof value.consentVersion !== "string" || !value.consentVersion) return null;
    return { email, consentVersion: value.consentVersion.slice(0, 32) };
  } catch {
    return null;
  }
}
