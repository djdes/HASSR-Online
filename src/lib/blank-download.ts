/**
 * Шаблоны журналов с публичных страниц — скачивание после email
 * (спека `.agent/tasks/blanks-email-gate-2026-09/spec.md`).
 *
 * Общие константы и чистые функции: их берут и окно «Куда прислать
 * шаблон?» в браузере, и сервер (POST /api/public/blank-download, роуты
 * файлов, страница /qb). Здесь нет ни node:crypto, ни БД — модуль
 * безопасно импортировать в клиентский компонент.
 */

import type { Locale } from "@/i18n/locales";
import { formatPhone, normalizePhone } from "@/lib/phone";

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

/** `source` основного согласия в LegalConsent — оно же учёт скачиваний. */
export const BLANK_CONSENT_SOURCE = "blank-download";

/**
 * `source` согласия с офертой и соглашением, когда кабинет создан галкой
 * «Быстрая регистрация» в окне скачивания (спека
 * blank-download-phone-autoreg-2026-11). Не путать с `BLANK_CONSENT_SOURCE`:
 * по тому считаются скачивания.
 */
export const BLANK_REGISTER_CONSENT_SOURCE = "blank-register";

/**
 * Необязательная галка «присылать материалы» в том же окне (спека
 * landing-pack-2026-09). По умолчанию снята, на скачивание не влияет.
 * Отмечена — отдельная запись LegalConsent с этим `source` и дословным
 * текстом: подпись галки и пометка под ней, как их видит человек.
 */
export const BLANK_MARKETING_CONSENT_LABEL = "Присылать полезные материалы и новости WeSetup";
export const BLANK_MARKETING_CONSENT_NOTE = "Согласие можно отозвать в любой момент";
export const BLANK_MARKETING_CONSENT_TEXT = `${BLANK_MARKETING_CONSENT_LABEL}. ${BLANK_MARKETING_CONSENT_NOTE}.`;
export const BLANK_MARKETING_CONSENT_SOURCE = "blank-download-marketing";

/** Строка LegalConsent без id и даты — то, что пишет POST /api/public/blank-download. */
export type BlankConsentRow = {
  email: string;
  version: string;
  statementText: string;
  source: string;
  ipAddress: string | null;
  userAgent: string | null;
  userId?: string;
  organizationId?: string;
};

/**
 * Какие согласия записать при скачивании: основное — всегда, согласие на
 * письма — только если галка отмечена. Обе строки с одной почтой, IP и
 * браузером; чистая функция, чтобы проверить без БД.
 */
export function blankConsentRows(params: {
  email: string;
  version: string;
  marketing: boolean;
  ipAddress: string | null;
  userAgent: string | null;
  userId?: string | null;
  organizationId?: string | null;
  /** Optional localized display snapshots; omission preserves the historic Russian contract. */
  statementText?: string;
  marketingStatementText?: string;
}): BlankConsentRow[] {
  const base = {
    email: params.email,
    version: params.version,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    ...(params.userId ? { userId: params.userId } : {}),
    ...(params.organizationId ? { organizationId: params.organizationId } : {}),
  };
  const rows: BlankConsentRow[] = [{
    ...base,
    statementText: params.statementText ?? BLANK_CONSENT_TEXT,
    source: BLANK_CONSENT_SOURCE,
  }];
  if (params.marketing) {
    rows.push({
      ...base,
      statementText: params.marketingStatementText ?? BLANK_MARKETING_CONSENT_TEXT,
      source: BLANK_MARKETING_CONSENT_SOURCE,
    });
  }
  return rows;
}

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

export const BLANK_COMPANY_MAX = 160;

/**
 * Телефон в окне скачивания: необязательный, для отправки шаблона в
 * Telegram, MAX или СМС. Канонический вид — как у регистрации (`+7…`).
 */
const PHONE_DIGITS_MIN = 10;
const PHONE_DIGITS_MAX = 15;

/** Почта в каноническом виде или `null`, если это не адрес. */
export function normalizeBlankEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (!email || email.length > EMAIL_MAX || !EMAIL_RE.test(email)) return null;
  return email;
}

/** Название организации для шапки бланка или `null`, если не указано. */
export function normalizeBlankCompany(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const company = raw.replace(/\s+/g, " ").trim().slice(0, BLANK_COMPANY_MAX);
  return company || null;
}

/**
 * Телефон в каноническом виде (`+79851234567`), `null` — если поле пустое.
 * `undefined` — введено что-то, что номером не является (окно покажет
 * ошибку, сервер отклонит запрос): пустое и неверное различаем, чтобы
 * необязательное поле не отвергало пустой ввод.
 */
export function normalizeBlankPhone(raw: unknown): string | null | undefined {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") return undefined;
  // Кроме цифр — только то, чем номер оформляют: плюс, пробелы, скобки, дефисы.
  if (/[^\d\s()+\-.]/.test(raw)) return undefined;
  const digits = raw.replace(/\D+/g, "");
  // Только подставленный префикс «+7 » — поле по сути пустое.
  if (digits === "" || digits === "7") return null;
  if (digits.length < PHONE_DIGITS_MIN || digits.length > PHONE_DIGITS_MAX) return undefined;
  const phone = normalizePhone(raw);
  if (!phone) return undefined;
  // Российский номер — ровно 10 цифр после +7.
  if (phone.startsWith("+7") && phone.length !== 12) return undefined;
  return phone;
}

/** Номер для людей: `+7 985 123-45-67`. */
export function displayBlankPhone(phone: string): string {
  return formatPhone(phone);
}

/**
 * Простая проверка от ботов, которую человек не видит (спека
 * blank-download-phone-autoreg-2026-11):
 *   • `website` — скрытое поле-ловушка, как у регистрации; человек его не
 *     видит и не заполняет;
 *   • `elapsedMs` — сколько окно было открыто до отправки. Почту, галку
 *     согласия и кнопку человек не успевает пройти быстрее 1,5 с.
 * Скачивание по запомненной почте окна не показывает — время не меряем.
 */
export const BLANK_BOT_MIN_ELAPSED_MS = 1500;

export type BlankBotVerdict = "ok" | "honeypot" | "too_fast";

export function blankBotVerdict(params: {
  website?: unknown;
  elapsedMs?: unknown;
  remembered?: boolean;
}): BlankBotVerdict {
  if (typeof params.website === "string" && params.website.trim() !== "") return "honeypot";
  if (params.website !== undefined && typeof params.website !== "string") return "honeypot";
  if (params.remembered) return "ok";
  const elapsed = params.elapsedMs;
  if (typeof elapsed !== "number" || !Number.isFinite(elapsed) || elapsed < BLANK_BOT_MIN_ELAPSED_MS) {
    return "too_fast";
  }
  return "ok";
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
export function blankFilePath(target: BlankTarget, format: BlankFormat, locale?: Locale): string {
  if (target.kind === "paper") {
    return `/api/journal-samples/paper/${encodeURIComponent(target.paperId)}/pdf`;
  }
  return `/api/journal-samples/${encodeURIComponent(target.code)}/${format}${locale === "en" || locale === "uz" ? `?locale=${locale}` : ""}`;
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

/**
 * Журнал в кабинете, который откроется после входа или регистрации.
 * `from=qb`: если у организации журнал выключен, экран «Этот журнал
 * отключён» скажет, откуда человек пришёл, и даст включить одним нажатием.
 */
export function blankCabinetPath(target: BlankTarget): string {
  return target.kind === "paper"
    ? `/settings/journals/paper/${encodeURIComponent(target.paperId)}`
    : `/journals/${encodeURIComponent(target.code)}?from=qb`;
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
export type RememberedBlankEmail = { email: string; consentVersion: string; company?: string; phone?: string };

export function readRememberedBlankEmail(raw: string | null | undefined): RememberedBlankEmail | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<RememberedBlankEmail>;
    const email = normalizeBlankEmail(value.email);
    if (!email || typeof value.consentVersion !== "string" || !value.consentVersion) return null;
    const company = normalizeBlankCompany(value.company);
    const phone = normalizeBlankPhone(value.phone);
    return {
      email,
      consentVersion: value.consentVersion.slice(0, 32),
      ...(company ? { company } : {}),
      ...(phone ? { phone } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Отправлять ли уведомление в Telegram о скачивании шаблона: только на первое
 * скачивание пользователя (по почте или userId), чтобы пакетное скачивание
 * нескольких журналов одним человеком не спамило чат продаж. Кабинет,
 * созданный галкой «Быстрая регистрация», — повод написать всегда: продажи
 * должны узнать о новом клиенте, даже если шаблоны он качал и раньше.
 */
export function shouldNotifyBlankDownloadAdmin(previousDownloadsCount: number, accountCreated = false): boolean {
  return accountCreated || previousDownloadsCount === 0;
}

/** Текст уведомления в Telegram-бот при скачивании шаблона журнала. */
export function buildBlankDownloadAdminText(params: {
  title: string;
  format: BlankFormat;
  email: string;
  /** Телефон из окна (канонический `+7…`) — сразу после почты. */
  phone?: string | null;
  company?: string | null;
  /** Кабинет создан галкой «Быстрая регистрация». */
  accountCreated?: boolean;
  escape: (value: string) => string;
}): string {
  const esc = params.escape;
  return [
    "📥 Скачивание шаблона журнала",
    `Журнал: ${esc(params.title)} (${esc(BLANK_FORMAT_LABEL[params.format])})`,
    `Почта: ${esc(params.email)}`,
    ...(params.phone ? [`Телефон: ${esc(displayBlankPhone(params.phone))}`] : []),
    ...(params.company ? [`Организация: ${esc(params.company)}`] : []),
    ...(params.accountCreated ? ["✅ Быстрая регистрация: кабинет создан, доступ отправлен на почту"] : []),
  ].join("\n");
}
