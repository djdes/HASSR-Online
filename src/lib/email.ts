import nodemailer from "nodemailer";
import { closingDocumentFilename } from "@/lib/closing-documents/types";
import { escapeHtml } from "@/lib/html-escape";
import { TRIAL_DAYS } from "@/lib/tariff-plans";
import { translatorFor } from "@/i18n/translator";
import type { Locale } from "@/i18n/locales";
import type { LoginMethod } from "@/lib/login-device";

/**
 * Локальный relay на той же машине. Прод отправляет через exim на
 * 127.0.0.1, а он отдаёт самоподписанный сертификат — проверять его
 * бессмысленно (трафик не покидает хост), но и слать в обход TLS не
 * нужно. Поэтому для петлевых адресов проверку цепочки отключаем,
 * для внешних SMTP — оставляем строгой.
 */
const LOCAL_SMTP_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isLocalSmtpHost(): boolean {
  return LOCAL_SMTP_HOSTS.has((process.env.SMTP_HOST ?? "localhost").trim());
}

const FROM = process.env.SMTP_FROM || "WeSetup <noreply@wesetup.ru>";

/**
 * Домен из SMTP_FROM — «WeSetup <noreply@wesetup.ru>» → «wesetup.ru».
 * Нужен как дефолт для EHLO: exim на проде представляется именем
 * машины (`yesbeat.ru`), которое не совпадает с доменом отправителя, и
 * часть спам-фильтров это штрафует.
 */
function fromDomain(): string | null {
  const match = FROM.match(/@([^\s>]+)/);
  return match ? match[1].trim().toLowerCase() : null;
}

/**
 * Имя, которым мы представляемся серверу в EHLO. Явно настраивается через
 * `SMTP_HELO_NAME` — если у relay сменится хостнейм или понадобится
 * подогнать имя под PTR-запись, это правка одной переменной окружения.
 */
function heloName(): string | undefined {
  const explicit = process.env.SMTP_HELO_NAME?.trim();
  if (explicit) return explicit;
  return fromDomain() ?? undefined;
}

function createSmtpTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "localhost",
    port: Number(process.env.SMTP_PORT) || 25,
    secure: false,
    ...(heloName() ? { name: heloName() } : {}),
    tls: {
      rejectUnauthorized: !isLocalSmtpHost(),
    },
    connectionTimeout: 5000,
    socketTimeout: 5000,
  });
}

/**
 * Транспорт письма. Сейчас поддерживается только локальный SMTP (exim на
 * 127.0.0.1) — это дефолт и рабочий вариант: SPF/DKIM для wesetup.ru
 * настроены. Ветка по `EMAIL_TRANSPORT` заложена заранее, чтобы переезд
 * на внешнего провайдера (если письма начнут падать в спам) был правкой
 * одного этого модуля, а не всех вызывающих мест: добавляется ещё один
 * `case` с реализацией `deliver`, всё остальное не меняется.
 */
/**
 * Почтовое вложение. `path` — файл на локальном диске (nodemailer сам
 * читает поток). Суммарный размер контролирует вызывающий: многие SMTP
 * режут письма больше ~25 МБ, поэтому крупные файлы уходят ссылкой.
 */
export type EmailAttachment = {
  filename: string;
  /** Файл на диске или по URL. */
  path?: string;
  /** Содержимое — для PDF, собранных в памяти (закрывающие документы). */
  content?: Buffer | string;
  contentType?: string;
};

type EmailTransport = {
  name: string;
  deliver(message: {
    to: string;
    subject: string;
    html: string;
    attachments?: EmailAttachment[];
    /** Куда уйдёт ответ получателя (например, рекомендующему коллеге). */
    replyTo?: string;
  }): Promise<void>;
};

let cachedTransport: EmailTransport | null = null;

function getTransport(): EmailTransport {
  if (cachedTransport) return cachedTransport;

  const kind = (process.env.EMAIL_TRANSPORT ?? "smtp").trim().toLowerCase();
  if (kind !== "smtp" && kind !== "") {
    console.error(
      `[email] неизвестный EMAIL_TRANSPORT="${kind}", используем smtp`
    );
  }

  const smtp = createSmtpTransport();
  cachedTransport = {
    name: "smtp",
    async deliver({ to, subject, html, attachments, replyTo }) {
      await smtp.sendMail({
        from: FROM,
        to,
        subject,
        html,
        ...(replyTo ? { replyTo } : {}),
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
      });
    },
  };
  return cachedTransport;
}

const APP_URL = process.env.NEXTAUTH_URL || "https://wesetup.ru";

/**
 * Откуда почтовый клиент получателя тянет картинки письма. Всегда
 * боевой домен: в dev NEXTAUTH_URL смотрит на localhost, и логотип
 * в отправленном письме просто не загрузился бы.
 */
const EMAIL_ASSET_ORIGIN = "https://wesetup.ru";

/**
 * Партнёрский бренд в письме клиенту: отправитель остаётся
 * `WeSetup <noreply@wesetup.ru>`, в теле — логотип партнёра и строка
 * «при сопровождении <бренд>» (ТЗ по white-label, п. 4.2).
 */
export type EmailBrand = {
  brandName: string;
  /** Абсолютный URL светлого логотипа партнёра или null. */
  logoUrl: string | null;
};

/**
 * Бренд активного партнёра организации для письма. Лениво импортируем
 * модуль партнёрки, чтобы письма не тянули Prisma там, где он не нужен.
 * Любая ошибка → письмо уходит в стандартном оформлении.
 */
export async function emailBrandForOrganization(
  organizationId: string | null | undefined,
): Promise<EmailBrand | null> {
  if (!organizationId) return null;
  try {
    const { getVisibleOrgBranding, logoUrlFor } = await import("@/lib/partners/branding");
    const branding = await getVisibleOrgBranding(organizationId);
    if (!branding) return null;
    return {
      brandName: branding.brandName,
      logoUrl: branding.hasLogoLight ? `${EMAIL_ASSET_ORIGIN}${logoUrlFor(branding, "light")}` : null,
    };
  } catch {
    return null;
  }
}

export async function emailBrandForPartnerSlug(
  slug: string | null | undefined,
): Promise<EmailBrand | null> {
  if (!slug) return null;
  try {
    const { getPartnerBrandBySlug, logoUrlFor } = await import("@/lib/partners/branding");
    const brand = await getPartnerBrandBySlug(slug);
    if (!brand) return null;
    return {
      brandName: brand.brandName,
      logoUrl: brand.hasLogoLight ? `${EMAIL_ASSET_ORIGIN}${logoUrlFor(brand, "light")}` : null,
    };
  } catch {
    return null;
  }
}

function brandBlock(brand: EmailBrand | null | undefined, tagline?: string): string {
  if (!brand) return "";
  const logo = brand.logoUrl
    ? `<img src="${brand.logoUrl}" height="32" alt="${escapeHtml(brand.brandName)}" style="display:block;border:0;height:32px;max-width:160px;width:auto;margin:0 0 6px">`
    : "";
  return `
  <tr><td style="padding:14px 32px;background:#f5f6ff;border-bottom:1px solid #e4e4e7">
    ${logo}
    <p style="margin:0;font-size:12px;color:#3c4053">${escapeHtml(tagline ?? "при сопровождении")} <strong style="color:#0b1024">${escapeHtml(brand.brandName)}</strong></p>
  </td></tr>`;
}

/**
 * Дополнения шаблона для рекламных писем (`src/lib/mailing`): прехедер —
 * строка, которую почта показывает рядом с темой, и подвал с отпиской.
 */
export type EmailLayoutExtras = {
  preheader?: string | null;
  /** HTML под копирайтом (уже экранированный вызывающим). */
  footerHtml?: string | null;
  brandTagline?: string;
  locale?: Locale;
};

function layout(title: string, body: string, brand?: EmailBrand | null, extras?: EmailLayoutExtras) {
  const preheader = extras?.preheader?.trim()
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px">${escapeHtml(extras.preheader.trim())}</div>`
    : "";
  const footer = extras?.footerHtml ? `\n    ${extras.footerHtml}` : "";
  return `<!DOCTYPE html>
<html lang="${extras?.locale === "uz" ? "uz-Latn" : extras?.locale ?? "ru"}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">${preheader}
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px">
<tr><td align="center">
<table width="100%" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
  <tr><td style="background:#0b1024;padding:22px 32px">
    <img src="${EMAIL_ASSET_ORIGIN}/brand/logo-email.png" width="116" height="31" alt="WeSetup" style="display:block;border:0;height:31px;width:116px">
  </td></tr>${brandBlock(brand, extras?.brandTagline)}
  <tr><td style="padding:32px">
    <h2 style="margin:0 0 16px;font-size:18px;color:#18181b">${title}</h2>
    ${body}
  </td></tr>
  <tr><td style="padding:16px 32px;background:#fafafa;border-top:1px solid #e4e4e7">
    ${extras?.locale ? "" : `<p style="margin:0;font-size:12px;color:#a1a1aa;text-align:center">&copy; 2026 WeSetup. Электронные журналы СанПиН и ХАССП.${brand ? " Работает на платформе WeSetup." : ""}</p>`}${footer}
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** Для писем партнёрки (src/lib/partners/emails.ts) — тот же шаблон и транспорт. */
function localizedLayout(
  t: Awaited<ReturnType<typeof translatorFor>>,
  locale: Locale,
  title: string,
  body: string,
  brand?: EmailBrand | null,
) {
  const footer = `${t("email.common.footer")}${brand ? ` ${t("email.common.footerBrand")}` : ""}`;
  return layout(escapeHtml(title), body, brand, {
    locale,
    footerHtml: `<p style="margin:0;font-size:12px;color:#a1a1aa;text-align:center">&copy; 2026 WeSetup. ${footer}</p>`,
    brandTagline: brand ? t("email.common.partnerBrandTagline") : undefined,
  });
}

export function renderEmailLayout(
  title: string,
  body: string,
  brand?: EmailBrand | null,
  extras?: EmailLayoutExtras
) {
  return layout(title, body, brand, extras);
}
export async function sendRawEmail(
  to: string,
  subject: string,
  html: string,
  options?: { replyTo?: string | null; attachments?: EmailAttachment[] }
): Promise<boolean> {
  return sendEmail(to, subject, html, options?.attachments, options);
}

/**
 * Пустой SMTP_HOST (или дефолтный "localhost" без реального relay) =
 * dev-режим. В этом случае не ломаем регистрацию таймаутом на 127.0.0.1:25,
 * а просто логируем тело в консоль. Так разработчик видит код/ссылку
 * приглашения сразу в выводе dev-сервера.
 */
function isSmtpConfigured(): boolean {
  const host = (process.env.SMTP_HOST ?? "").trim();
  return host.length > 0 && host !== "localhost";
}

/**
 * Настроена ли реальная отправка. `false` от `send*Email` при
 * ненастроенной почте означает «письмо записано в лог» (dev), а не сбой —
 * вызывающему, который показывает человеку «письмо не ушло», нужно это
 * различать.
 */
export function isEmailDeliveryConfigured(): boolean {
  return isSmtpConfigured();
}

/**
 * Возвращает true, если письмо принято транспортом. Раньше функция
 * возвращала void и глотала ошибку в console.error — вызывающий код не мог
 * отличить «ушло» от «упало», и в панели обращений было не видно, что
 * почтовый канал молчит. Fire-and-forget вызовы просто игнорируют результат.
 */
async function sendEmail(
  to: string,
  subject: string,
  html: string,
  attachments?: EmailAttachment[],
  options?: { replyTo?: string | null }
): Promise<boolean> {
  const replyTo = options?.replyTo?.trim() || undefined;
  if (!isSmtpConfigured()) {
    const stripped = html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    console.info(
      `[email/dev] SMTP не настроен — письмо не отправлено на ${to}.`
    );
    console.info(`[email/dev] Subject: ${subject}`);
    if (replyTo) console.info(`[email/dev] Reply-To: ${replyTo}`);
    console.info(`[email/dev] Body:    ${stripped}`);
    return false;
  }
  try {
    await getTransport().deliver({ to, subject, html, attachments, replyTo });
    return true;
  } catch (error) {
    console.error("Email send error:", error);
    return false;
  }
}

export async function sendVerificationEmail(to: string, code: string, locale: Locale = "ru") {
  const t = await translatorFor(locale);
  if (!isSmtpConfigured()) console.info("[email/dev] Verification code for " + to + ": " + code);
  const subject = t("email.verification.subject");
  const body = [
    `<p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">${t("email.verification.greeting")}</p>`,
    `<p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">${t("email.verification.codeIntro")}</p>`,
    `<div style="background:#f4f4f5;border-radius:8px;padding:20px;margin:0 0 24px;text-align:center"><p style="margin:0;font-size:32px;font-weight:700;letter-spacing:8px;color:#18181b">${t("email.verification.codeValue", { code: escapeHtml(code) })}</p></div>`,
    `<p style="margin:0;color:#71717a;font-size:13px">${t("email.verification.expiryNotice")}</p>`,
  ].join("");
  return sendEmail(to, subject, localizedLayout(t, locale, subject, body));
}

export async function sendInviteTokenEmail(params: {
  to: string;
  name: string;
  organizationName: string;
  inviteUrl: string;
  organizationId?: string | null;
  locale?: Locale;
  /** Своя тема письма (по умолчанию «Вас пригласили в … — WeSetup»). */
  subject?: string;
  /** Абзац о роли приглашённого — например, для сотрудника мастер-кабинета справочников. */
  intro?: string;
}) {
  const { to, name, organizationName, inviteUrl, organizationId, intro } = params;
  const t = await translatorFor(params.locale ?? "ru");
  const brand = await emailBrandForOrganization(organizationId);
  const subject = params.subject ?? t("email.invitation.subject", { organization: organizationName });
  const introHtml = intro
    ? `<p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">${escapeHtml(intro)}</p>`
    : "";
  const body = [
    `<p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">${t("email.invitation.greeting", { name: escapeHtml(name) })}</p>`,
    `<p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">${t("email.invitation.body", { organization: escapeHtml(organizationName) })}</p>`,
    introHtml,
    `<p style="margin:0 0 16px;color:#71717a;font-size:13px;line-height:1.6">${t("email.invitation.loginLabel", { email: escapeHtml(to) })}</p>`,
    `<a href="${escapeHtml(inviteUrl)}" style="display:inline-block;background:#5566f6;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">${t("email.invitation.setPasswordAction")}</a>`,
    `<p style="margin:24px 0 0;font-size:13px;color:#a1a1aa">${t("email.invitation.expiryNotice")}</p>`,
  ].join("");
  return sendEmail(to, subject, localizedLayout(t, params.locale ?? "ru", subject, body, brand));
}

export async function sendInviteEmail(params: {
  to: string;
  name: string;
  password: string;
  organizationName: string;
  organizationId?: string | null;
  locale?: Locale;
}) {
  const { to, name, password, organizationName, organizationId } = params;
  const t = await translatorFor(params.locale ?? "ru");
  const brand = await emailBrandForOrganization(organizationId);
  const subject = t("email.inviteWithPassword.subject", { organization: organizationName });

  const body = [
    `<p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">${t("email.inviteWithPassword.greeting", { name: escapeHtml(name) })}</p>`,
    `<p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">${t("email.inviteWithPassword.body", { organization: escapeHtml(organizationName) })}</p>`,
    `<div style="background:#f4f4f5;border-radius:8px;padding:20px;margin:0 0 24px"><p style="margin:0 0 8px;font-size:13px;color:#71717a">${t("email.inviteWithPassword.credentialsIntro")}</p><p style="margin:0 0 4px;color:#18181b"><strong>${t("email.inviteWithPassword.emailLabel")}</strong> ${escapeHtml(to)}</p><p style="margin:0;color:#18181b"><strong>${t("email.inviteWithPassword.passwordLabel")}</strong> ${escapeHtml(password)}</p></div>`,
    `<a href="${escapeHtml(APP_URL + "/login")}" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">${t("email.inviteWithPassword.signInAction")}</a>`,
    `<p style="margin:24px 0 0;font-size:13px;color:#a1a1aa">${t("email.inviteWithPassword.passwordHint")}</p>`,
  ].join("");
  return sendEmail(to, subject, localizedLayout(t, params.locale ?? "ru", t("email.inviteWithPassword.title"), body, brand));
}
/**
 * Письмо после мгновенной регистрации с лендинга.
 *
 * Пароль генерируется за пользователя и существует только здесь — в
 * интерфейсе он нигде не показывается, поэтому письмо критично: без
 * него человек не сможет войти со второго устройства. Отправляется
 * fire-and-forget, вход при этом уже произошёл.
 */
export async function sendAccountPasswordEmail(params: {
  to: string;
  password: string;
  organizationId?: string | null;
  locale?: Locale;
}) {
  const { to, password, organizationId } = params;
  const t = await translatorFor(params.locale ?? "ru");
  const brand = await emailBrandForOrganization(organizationId);
  const subject = t("email.accountPassword.subject");
  const body = [
    `<p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">${t("email.accountPassword.greeting")}</p>`,
    `<p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">${t("email.accountPassword.createdNotice")}</p>`,
    `<div style="background:#f4f4f5;border-radius:8px;padding:20px;margin:0 0 24px"><p style="margin:0 0 4px;color:#18181b"><strong>${t("email.accountPassword.loginLabel")}</strong> ${escapeHtml(to)}</p><p style="margin:0;color:#18181b"><strong>${t("email.accountPassword.passwordLabel")}</strong> <span style="font-family:monospace;font-size:16px;letter-spacing:1px">${escapeHtml(password)}</span></p></div>`,
    `<a href="${escapeHtml(APP_URL + "/dashboard")}" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">${t("email.accountPassword.openCabinetAction")}</a>`,
    `<p style="margin:24px 0 0;color:#71717a;font-size:13px">${t("email.accountPassword.nextSteps")}</p>`,
  ].join("");
  return sendEmail(to, subject, localizedLayout(t, params.locale ?? "ru", t("email.accountPassword.title"), body, brand));
}

/**
 * Пароль, заданный в анкете после регистрации. Пароль из первого письма
 * после этого не подходит — поэтому новый тоже уходит на почту: человек,
 * не заметивший поле в анкете, не должен остаться без входа.
 */
export async function sendPasswordChangedEmail(params: {
  to: string;
  password: string;
  organizationId?: string | null;
  locale?: Locale;
}) {
  const { to, password, organizationId } = params;
  const locale = params.locale ?? "ru";
  const t = await translatorFor(locale);
  const brand = await emailBrandForOrganization(organizationId);
  const subject = t("email.passwordChanged.subject");
  const body = [
    `<p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">${t("email.passwordChanged.greeting")}</p>`,
    `<p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">${t("email.passwordChanged.body")}</p>`,
    `<div style="background:#f4f4f5;border-radius:8px;padding:20px;margin:0 0 24px"><p style="margin:0 0 4px;color:#18181b"><strong>${t("email.passwordChanged.loginLabel")}</strong> ${escapeHtml(to)}</p><p style="margin:0;color:#18181b"><strong>${t("email.accountPassword.passwordLabel")}</strong> <span style="font-family:monospace;font-size:16px;letter-spacing:1px">${escapeHtml(password)}</span></p></div>`,
    `<a href="${escapeHtml(APP_URL + "/dashboard")}" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">${t("email.passwordChanged.dashboardAction")}</a>`,
    `<p style="margin:24px 0 0;color:#71717a;font-size:13px">${t("email.passwordChanged.changeNotice")}</p>`,
  ].join("");
  return sendEmail(to, subject, localizedLayout(t, locale, t("email.passwordChanged.title"), body, brand));
}

export async function sendPasswordResetEmail(params: {
  to: string;
  resetUrl: string;
  locale?: Locale;
}) {
  const { to, resetUrl } = params;
  const locale = params.locale ?? "ru";
  const t = await translatorFor(locale);
  const subject = t("email.passwordReset.subject");
  const body = [
    `<p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">${t("email.passwordReset.greeting")}</p>`,
    `<p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">${t("email.passwordReset.body", { email: escapeHtml(to) })}</p>`,
    `<a href="${escapeHtml(resetUrl)}" style="display:inline-block;background:#5566f6;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">${t("email.passwordReset.action")}</a>`,
    `<p style="margin:24px 0 0;font-size:13px;color:#a1a1aa">${t("email.passwordReset.expiryNotice")}</p>`,
  ].join("");
  return sendEmail(to, subject, localizedLayout(t, locale, t("email.passwordReset.title"), body));
}

export async function sendWelcomeEmail(params: {
  to: string;
  name: string;
  organizationName: string;
  organizationId?: string | null;
  locale?: Locale;
}) {
  const { to, name, organizationName, organizationId } = params;
  const t = await translatorFor(params.locale ?? "ru");
  const brand = await emailBrandForOrganization(organizationId);
  const subject = t("email.welcome.subject");

  const body = [
    `<p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">${t("email.welcome.greeting", { name: escapeHtml(name) })}</p>`,
    `<p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">${t("email.welcome.organizationReady", { organization: escapeHtml(organizationName), trialDays: TRIAL_DAYS })}</p>`,
    `<div style="background:#f4f4f5;border-radius:8px;padding:20px;margin:0 0 24px"><p style="margin:0 0 12px;font-size:14px;font-weight:600;color:#18181b">${t("email.welcome.gettingStarted")}</p>`,
    `<p style="margin:0 0 8px;color:#3f3f46;font-size:14px">1. ${t("email.welcome.stepAreas")}</p>`,
    `<p style="margin:0 0 8px;color:#3f3f46;font-size:14px">2. ${t("email.welcome.stepEquipment")}</p>`,
    `<p style="margin:0 0 8px;color:#3f3f46;font-size:14px">3. ${t("email.welcome.stepJournals")}</p>`,
    `<p style="margin:0;color:#3f3f46;font-size:14px">4. ${t("email.welcome.stepStaff")}</p></div>`,
    `<a href="${escapeHtml(APP_URL + "/dashboard")}" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">${t("email.welcome.openWorkspace")}</a>`,
  ].join("");

  return sendEmail(to, subject, localizedLayout(t, params.locale ?? "ru", t("email.welcome.title"), body, brand));
}

/**
 * Письмо после успешной оплаты через Робокассу.
 *
 * Новому клиенту уходит ссылка с одноразовым токеном на достройку
 * профиля (название организации, имя, пароль), существующему —
 * подтверждение продления со ссылкой на вход.
 */
/**
 * Счёт по безналу — клиенту, с PDF во вложении. Здесь же говорим, что
 * будет после оплаты: подписка продлится сама, документы — в кабинете.
 */
/**
 * Вход с нового устройства. Коротко и без паники: что, когда, откуда, и
 * что делать, если это не вы.
 */
export async function sendNewDeviceLoginEmail(params: {
  to: string;
  name: string | null;
  when: string;
  device: string;
  ip: string;
  method: LoginMethod;
  organizationId?: string | null;
  locale?: Locale;
}) {
  const locale = params.locale ?? "ru";
  const t = await translatorFor(locale);
  const brand = await emailBrandForOrganization(params.organizationId);
  const subject = t("email.newDevice.subject");
  const greeting = params.name
    ? t("email.newDevice.greetingNamed", { name: escapeHtml(params.name) })
    : t("email.newDevice.greeting");
  const methodLabels: Record<LoginMethod, string> = {
    password: t("email.newDevice.methodPassword"),
    phone: t("email.newDevice.methodPhone"),
    telegram: t("email.newDevice.methodTelegram"),
    pair: t("email.newDevice.methodPair"),
    register: t("email.newDevice.methodRegister"),
    magic: t("email.newDevice.methodMagic"),
    passkey: t("email.newDevice.methodPasskey"),
  };
  const body = [
    `<p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">${greeting}</p>`,
    `<p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">${t("email.newDevice.body")}</p>`,
    `<div style="background:#f4f4f5;border-radius:8px;padding:20px;margin:0 0 24px"><p style="margin:0 0 8px;color:#3f3f46;font-size:14px">${t("email.newDevice.deviceLabel")} <strong>${escapeHtml(params.device)}</strong></p><p style="margin:0 0 8px;color:#3f3f46;font-size:14px">${t("email.newDevice.timeLabel")} <strong>${escapeHtml(params.when)}</strong></p><p style="margin:0 0 8px;color:#3f3f46;font-size:14px">IP: <strong>${escapeHtml(params.ip)}</strong></p><p style="margin:0;color:#3f3f46;font-size:14px">${t("email.newDevice.methodLabel")} <strong>${escapeHtml(methodLabels[params.method])}</strong></p></div>`,
    `<p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">${t("email.newDevice.securityNotice")}</p>`,
    `<a href="${escapeHtml(APP_URL + "/settings/security")}" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">${t("email.newDevice.securityAction")}</a>`,
    `<p style="margin:24px 0 0;color:#71717a;font-size:13px">${t("email.newDevice.support")}</p>`,
  ].join("");
  return sendEmail(params.to, subject, localizedLayout(t, locale, t("email.newDevice.title"), body, brand));
}

export async function sendInvoiceEmail(params: {
  to: string;
  number: string;
  amountRub: number;
  dueAt: Date;
  organizationId?: string | null;
  pdf: Buffer;
  /** Счёт на пополнение баланса — другой текст «что будет после оплаты». */
  purpose?: "subscription" | "topup";
  locale?: Locale;
}) {
  const locale = params.locale ?? "ru";
  const t = await translatorFor(locale);
  const brand = await emailBrandForOrganization(params.organizationId);
  const topup = params.purpose === "topup";
  const subject = t(topup ? "email.invoice.subject.topup" : "email.invoice.subject.subscription", { invoiceNumber: params.number });
  const rub = new Intl.NumberFormat("ru-RU").format(params.amountRub) + " ₽";
  const due = params.dueAt.toLocaleDateString("ru-RU");
  const body = `
    <p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">${t("email.invoice.greeting")}</p>
    <p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">${t(topup ? "email.invoice.attachment.topup" : "email.invoice.attachment.subscription")}</p>
    <div style="background:#f4f4f5;border-radius:8px;padding:20px;margin:0 0 24px">
      <p style="margin:0 0 8px;color:#3f3f46;font-size:14px">${t("email.invoice.numberLabel")} <strong>№ ${escapeHtml(params.number)}</strong></p>
      <p style="margin:0 0 8px;color:#3f3f46;font-size:14px">${t("email.invoice.amountLabel")} <strong>${escapeHtml(rub)}</strong></p>
      <p style="margin:0;color:#3f3f46;font-size:14px">${t("email.invoice.dueDateLabel")} <strong>${escapeHtml(due)}</strong></p>
    </div>
    <p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">${t(topup ? "email.invoice.paymentInstructions.topup" : "email.invoice.paymentInstructions.subscription", { invoiceNumber: escapeHtml(params.number) })}</p>
    <p style="margin:24px 0 0;color:#71717a;font-size:13px">${t("email.invoice.support")}</p>`;
  return sendEmail(params.to, subject, localizedLayout(t, locale, subject, body, brand), [    { filename: `Invoice-${params.number.replace(/[^0-9A-Za-z_-]/g, "")}.pdf`, content: params.pdf, contentType: "application/pdf" },
  ]);
}

export async function sendPaymentReceiptEmail(params: {
  to: string;
  amountRub: number;
  description: string;
  actionUrl: string;
  isNewClient: boolean;
  subscriptionEnd: Date;
  organizationId?: string | null;
  /** Сколько рублей закрыли баллами — показываем рядом с суммой. */
  pointsSpent?: number | null;
  /** УПД по этому платежу — вложением; null, если документ не выпущен. */
  closingDocument?: { number: string; pdf: Buffer } | null;
  locale?: Locale;
  /** Заказ тарифа ждёт ручного разбора: подписка изменилась после оформления. */
  held?: boolean;
}) {
  const { to, amountRub, description, actionUrl, isNewClient, subscriptionEnd, organizationId } =
    params;
  const held = params.held === true && !isNewClient;
  const closing = params.closingDocument ?? null;
  const locale = params.locale ?? "ru";
  const t = await translatorFor(locale);
  // Закрывающие — в том же письме, а не отдельным: бухгалтеру нужен один
  // источник «оплата + документ». Про оригинал и ЭДО говорим сразу:
  // факсимиле для признания расходов принимают не все.
  const points = Math.max(0, Number(params.pointsSpent ?? 0));
  const brand = await emailBrandForOrganization(organizationId);
  const subject = t(
    isNewClient
      ? "email.paymentReceipt.subject.newClient"
      : held
        ? "email.paymentReceipt.subject.held"
        : "email.paymentReceipt.subject.renewal"
  );
  const rub = (value: number) =>
    new Intl.NumberFormat("ru-RU").format(value) + " ₽";
  // Чек показывает и деньги, и баллы: строка «Сумма: 1 490 ₽» при цене
  // 1 990 ₽ без пояснения выглядит как ошибка списания.
  const amount = amountRub <= 0 && points > 0
    ? t("email.paymentReceipt.pointsOnlyAmount", { points: escapeHtml(rub(points)) })
    : points > 0
      ? t("email.paymentReceipt.amountWithPoints", { amount: escapeHtml(rub(amountRub)), points: escapeHtml(rub(points)) })
      : rub(amountRub);
  const until = subscriptionEnd.toLocaleDateString("ru-RU");

  const closingBlock = closing
    ? `<p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">${t("email.paymentReceipt.closingDocumentDisclosure", { documentNumber: escapeHtml(closing.number) })}</p>`
    : "";
  const body = `
    <p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">${t("email.paymentReceipt.greeting")}</p>
    <p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">${t("email.paymentReceipt.thankYou")}</p>
    <div style="background:#f4f4f5;border-radius:8px;padding:20px;margin:0 0 24px">
      <p style="margin:0 0 8px;color:#3f3f46;font-size:14px">${t("email.paymentReceipt.planLabel")} <strong>${escapeHtml(description)}</strong></p>
      <p style="margin:0 0 8px;color:#3f3f46;font-size:14px">${t("email.paymentReceipt.amountLabel")} <strong>${escapeHtml(amount)}</strong></p>
      <p style="margin:0;color:#3f3f46;font-size:14px">${t("email.paymentReceipt.subscriptionUntilLabel")} <strong>${escapeHtml(until)}</strong></p>
    </div>
    ${closingBlock}
    <p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">${t(isNewClient ? "email.paymentReceipt.newClientNextStep" : held ? "email.paymentReceipt.heldNextStep" : "email.paymentReceipt.renewalNextStep")}</p>
    <a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">${t(isNewClient ? "email.paymentReceipt.newClientAction" : "email.paymentReceipt.renewalAction")}</a>
    <p style="margin:24px 0 0;color:#71717a;font-size:13px">${t("email.paymentReceipt.support")}</p>`;
  const attachments = closing
    ? [
        {
          filename: closingDocumentFilename(closing.number).ascii,
          content: closing.pdf,
          contentType: "application/pdf",
        },
      ]
    : undefined;
  return sendEmail(to, subject, localizedLayout(t, locale, subject, body, brand), attachments);
}

export type FeedbackType =
  | "bug"
  | "suggestion"
  | "partnership"
  | "support";

const FEEDBACK_TYPE_THEME: Record<
  FeedbackType,
  { label: string; color: string; bg: string; border: string }
> = {
  bug: { label: "Ошибка", color: "#dc2626", bg: "#fef2f2", border: "#fecaca" },
  suggestion: {
    label: "Улучшение",
    color: "#5566f6",
    bg: "#eef1ff",
    border: "#c7ccea",
  },
  // Предложение о партнёрстве — не баг и не пожелание по продукту, и
  // разбирает его не поддержка. Отдельная метка нужна, чтобы такие письма
  // не терялись среди «не работает кнопка».
  partnership: {
    label: "Сотрудничество",
    color: "#7a5cff",
    bg: "#f5f3ff",
    border: "#ddd6fe",
  },
  // Обращение из Telegram-бота: человек просто написал в поддержку.
  support: {
    label: "Поддержка",
    color: "#0f7a5a",
    bg: "#ecfdf5",
    border: "#b6e3d2",
  },
};

export async function sendFeedbackAdminEmail(params: {
  to: string;
  type: FeedbackType;
  message: string;
  userName?: string | null;
  userEmail?: string | null;
  organizationName?: string | null;
  phone?: string | null;
  submittedAt?: Date;
  /** Ссылки на вложения (абсолютные URL) — рендерятся списком в письме. */
  attachmentLinks?: Array<{ url: string; filename: string }>;
  /** Файлы, вкладываемые в само письмо (мелкие; крупные — только ссылкой). */
  attachments?: EmailAttachment[];
  /** Абсолютная ссылка на страницу, с которой отправлен репорт. */
  pageUrl?: string | null;
  /** Короткий номер тикета — тот же, что в письме автору. */
  ticket?: string | null;
  locale?: Locale;
}) {
  const {
    to,
    type,
    message,
    userName,
    userEmail,
    organizationName,
    phone,
    submittedAt,
  } = params;
  const locale = params.locale ?? "ru";
  const t = await translatorFor(locale);
  const theme = FEEDBACK_TYPE_THEME[type] ?? FEEDBACK_TYPE_THEME.suggestion;
  const typeLabel = t(`email.feedbackAdmin.type.${type}`);
  const typeColor = theme.color;
  const typeBg = theme.bg;
  const typeBorder = theme.border;
  const whenLabel = (submittedAt ?? new Date()).toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
  });
  const subject = t("email.feedbackAdmin.subject", { feedbackType: typeLabel, sender: userName ?? userEmail ?? t("email.feedbackAdmin.anonymousSender") });

  const row = (label: string, value: string | null | undefined) =>
    value
      ? `<tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#71717a;font-size:13px;width:140px">${escapeHtml(label)}</td><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#18181b">${escapeHtml(value)}</td></tr>`
      : "";

  const attachmentsBlock =
    params.attachmentLinks && params.attachmentLinks.length > 0
      ? `<div style="margin:0 0 24px">
      <p style="margin:0 0 8px;font-size:12px;font-weight:600;letter-spacing:1.4px;text-transform:uppercase;color:#71717a">${t("email.feedbackAdmin.attachmentsLabel")}</p>
      ${params.attachmentLinks
        .map(
          (a) =>
            `<p style="margin:0 0 6px"><a href="${escapeHtml(a.url)}" style="color:#5566f6;text-decoration:underline;font-size:14px">${escapeHtml(a.filename)}</a></p>`
        )
        .join("")}
    </div>`
      : "";

  const body = `
    <div style="background:${typeBg};border:1px solid ${typeBorder};border-radius:8px;padding:20px;margin:0 0 24px">
      <p style="margin:0 0 8px;font-size:12px;font-weight:600;letter-spacing:1.4px;text-transform:uppercase;color:${typeColor}">${typeLabel}</p>
      <p style="margin:0;white-space:pre-wrap;color:#18181b;font-size:14px;line-height:1.55">${escapeHtml(message)}</p>
    </div>
    ${attachmentsBlock}
    <table style="width:100%;border-collapse:collapse;margin:0 0 24px">
      ${row(t("email.feedbackAdmin.ticketLabel"), params.ticket)}
      ${row(t("email.feedbackAdmin.senderLabel"), userName)}
      ${row(t("email.feedbackAdmin.emailLabel"), userEmail)}
      ${row(t("email.feedbackAdmin.organizationLabel"), organizationName)}
      ${row(t("email.feedbackAdmin.phoneLabel"), phone)}
      ${params.pageUrl ? `<tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#71717a;font-size:13px;width:140px">${t("email.feedbackAdmin.pageLabel")}</td><td style="padding:8px 0;border-bottom:1px solid #e4e4e7"><a href="${escapeHtml(params.pageUrl)}" style="color:#5566f6;word-break:break-all">${escapeHtml(params.pageUrl)}</a></td></tr>` : ""}
      <tr><td style="padding:8px 0;color:#71717a;font-size:13px">${t("email.feedbackAdmin.timeLabel")}</td><td style="padding:8px 0;color:#18181b">${escapeHtml(whenLabel)}</td></tr>
    </table>
    <a href="${APP_URL}/root/feedback" style="display:inline-block;background:#5566f6;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">${t("email.feedbackAdmin.openPanel")}</a>`;

  return sendEmail(
    to,
    subject,
    localizedLayout(t, locale, t("email.feedbackAdmin.layoutTitle", { feedbackType: typeLabel }), body),
    params.attachments
  );
}

/**
 * Подтверждение автору: обращение зарегистрировано, вот его номер.
 *
 * Без него человек отправлял форму в пустоту и через день писал ещё раз
 * «вы получили?». Номер тот же, что видит админ в Telegram и письме, —
 * по нему обращение находится в панели.
 */
export async function sendFeedbackReceivedEmail(params: {
  to: string;
  ticket: string;
  message: string;
  pageUrl?: string | null;
  attachmentsCount?: number;
  locale?: Locale;
}): Promise<boolean> {
  const locale = params.locale ?? "ru";
  const t = await translatorFor(locale);
  const subject = t("email.feedbackReceived.subject", { ticket: params.ticket });
  const page = params.pageUrl
    ? `<p style="margin:0 0 6px;font-size:13px;color:#71717a">${t("email.feedbackReceived.pageLabel")}: <a href="${escapeHtml(params.pageUrl)}" style="color:#5566f6;word-break:break-all">${escapeHtml(params.pageUrl)}</a></p>`
    : "";
  const files = params.attachmentsCount
    ? `<p style="margin:0;font-size:13px;color:#71717a">${escapeHtml(t("email.feedbackReceived.attachmentsLabel", { count: params.attachmentsCount }))}</p>`
    : "";
  const body = `
    <p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">${t("email.feedbackReceived.greeting")}</p>
    <p style="margin:0 0 20px;color:#3f3f46;line-height:1.6">${t("email.feedbackReceived.intro")}</p>
    <div style="background:#eef1ff;border:1px solid #c7ccea;border-radius:8px;padding:16px 20px;margin:0 0 20px">
      <p style="margin:0 0 4px;font-size:12px;font-weight:600;letter-spacing:1.4px;text-transform:uppercase;color:#3848c7">${t("email.feedbackReceived.ticketLabel")}</p>
      <p style="margin:0;font-size:22px;font-weight:700;letter-spacing:2px;color:#0b1024">${escapeHtml(params.ticket)}</p>
    </div>
    <div style="border-left:3px solid #e4e4e7;padding:0 0 0 14px;margin:0 0 24px">
      <p style="margin:0 0 6px;font-size:12px;color:#a1a1aa">${t("email.feedbackReceived.messageLabel")}</p>
      <p style="margin:0 0 10px;white-space:pre-wrap;color:#3f3f46;font-size:14px;line-height:1.5">${escapeHtml(params.message)}</p>
      ${page}${files}
    </div>
    <a href="${APP_URL}/dashboard" style="display:inline-block;background:#5566f6;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">${t("email.feedbackReceived.openWorkspace")}</a>
    <p style="margin:24px 0 0;color:#71717a;font-size:13px">${t("email.feedbackReceived.footer")}</p>`;
  return sendEmail(
    params.to,
    subject,
    localizedLayout(t, locale, t("email.feedbackReceived.layoutTitle"), body)
  );
}

/**
 * Ответ поддержки автору обращения.
 *
 * Раньше ответ жил только во внутреннем колокольчике — человек, который
 * написал с телефона и больше на сайт не заходил, его не видел. Письмо
 * цитирует исходное обращение, чтобы получатель понял, о чём речь.
 */
export async function sendFeedbackReplyEmail(params: {
  to: string; replyMessage: string; originalMessage: string; respondedByName?: string | null; locale?: Locale;
}): Promise<boolean> {
  const { to, replyMessage, originalMessage, respondedByName } = params;
  const locale = params.locale ?? "ru";
  const t = await translatorFor(locale);
  const subject = t("email.feedbackReply.subject");
  const intro = respondedByName
    ? t("email.feedbackReply.introWithName", { respondentName: escapeHtml(respondedByName) })
    : t("email.feedbackReply.intro");
  const body = `
    <p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">${t("email.feedbackReply.greeting")}</p>
    <p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">${intro}</p>
    <div style="background:#eef1ff;border:1px solid #c7ccea;border-radius:8px;padding:20px;margin:0 0 20px"><p style="margin:0;white-space:pre-wrap;color:#18181b;font-size:14px;line-height:1.55">${escapeHtml(replyMessage)}</p></div>
    <div style="border-left:3px solid #e4e4e7;padding:0 0 0 14px;margin:0 0 24px"><p style="margin:0 0 6px;font-size:12px;color:#a1a1aa">${t("email.feedbackReply.originalMessageLabel")}</p><p style="margin:0;white-space:pre-wrap;color:#71717a;font-size:13px;line-height:1.5">${escapeHtml(originalMessage)}</p></div>
    <a href="${APP_URL}/dashboard" style="display:inline-block;background:#5566f6;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">${t("email.feedbackReply.openWorkspace")}</a>
    <p style="margin:24px 0 0;color:#71717a;font-size:13px">${t("email.feedbackReply.footer")}</p>`;
  return sendEmail(to, subject, localizedLayout(t, locale, t("email.feedbackReply.layoutTitle"), body));
}
export async function sendPlatformAdminTestEmail(params: { to: string; triggeredBy: string; locale?: Locale }): Promise<boolean> {
  const { to, triggeredBy } = params;
  const locale = params.locale ?? "ru";
  const t = await translatorFor(locale);
  const subject = t("email.adminTest.subject");
  const when = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
  const body = `
    <p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">${t("email.adminTest.body")}</p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 24px">
      <tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#71717a;font-size:13px;width:140px">${t("email.adminTest.addressLabel")}</td><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#18181b">${escapeHtml(to)}</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#71717a;font-size:13px">${t("email.adminTest.triggeredByLabel")}</td><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#18181b">${escapeHtml(triggeredBy)}</td></tr>
      <tr><td style="padding:8px 0;color:#71717a;font-size:13px">${t("email.adminTest.timeLabel")}</td><td style="padding:8px 0;color:#18181b">${escapeHtml(when)}</td></tr>
    </table>
    <p style="margin:0;color:#71717a;font-size:13px">${t("email.adminTest.diagnostics")}</p>`;
  return sendEmail(to, subject, localizedLayout(t, locale, t("email.adminTest.layoutTitle"), body));
}
export async function sendDeviationAlertEmail(params: {
  to: string; journalName: string; journalCode: string; deviationType: string; details: string; filledBy: string; organizationId?: string | null; locale?: Locale;
}) {
  const { to, journalName, journalCode, deviationType, details, filledBy, organizationId } = params;
  const locale = params.locale ?? "ru";
  const t = await translatorFor(locale);
  const brand = await emailBrandForOrganization(organizationId);
  const subject = t("email.alerts.deviation.subject", { deviationType, journalName });
  const when = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
  const body = `
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:20px;margin:0 0 24px">
      <p style="margin:0 0 8px;font-size:16px;font-weight:700;color:#dc2626">${escapeHtml(deviationType)}</p>
      <p style="margin:0;color:#7f1d1d;font-size:14px;line-height:1.6">${escapeHtml(details)}</p>
    </div>
    <table style="width:100%;border-collapse:collapse;margin:0 0 24px">
      <tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#71717a;font-size:13px;width:140px">${t("email.alerts.deviation.journalLabel")}</td><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#18181b;font-weight:600">${escapeHtml(journalName)}</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#71717a;font-size:13px">${t("email.alerts.deviation.recordedByLabel")}</td><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#18181b">${escapeHtml(filledBy)}</td></tr>
      <tr><td style="padding:8px 0;color:#71717a;font-size:13px">${t("email.alerts.deviation.timeLabel")}</td><td style="padding:8px 0;color:#18181b">${escapeHtml(when)}</td></tr>
    </table>
    <a href="${APP_URL}/journals/${encodeURIComponent(journalCode)}" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">${t("email.alerts.deviation.openJournal")}</a>`;
  return sendEmail(to, subject, localizedLayout(t, locale, t("email.alerts.deviation.title"), body, brand));
}

export async function sendComplianceReminderEmail(params: {
  to: string; missingJournals: string[]; organizationName: string; organizationId?: string | null; locale?: Locale;
}) {
  const { to, missingJournals, organizationName, organizationId } = params;
  const locale = params.locale ?? "ru";
  const t = await translatorFor(locale);
  const brand = await emailBrandForOrganization(organizationId);
  const subject = t("email.alerts.compliance.subject", { organizationName });
  const listHtml = missingJournals.map((j) => `<li style="margin:0 0 4px;color:#18181b;font-size:14px">${escapeHtml(j)}</li>`).join("");
  const body = `
    <p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">${t("email.alerts.compliance.intro")}</p>
    <div style="background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:20px;margin:0 0 24px"><ul style="margin:0;padding:0 0 0 20px">${listHtml}</ul></div>
    <a href="${APP_URL}/journals" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">${t("email.alerts.compliance.fillJournals")}</a>`;
  return sendEmail(to, subject, localizedLayout(t, locale, t("email.alerts.compliance.title"), body, brand));
}

export async function sendTemperatureAlertEmail(params: {
  to: string; equipmentName: string; temperature: number; tempMin: number | null; tempMax: number | null; areaName?: string; filledBy: string; organizationId?: string | null; locale?: Locale;
}) {
  const { to, equipmentName, temperature, tempMin, tempMax, areaName, filledBy, organizationId } = params;
  const locale = params.locale ?? "ru";
  const t = await translatorFor(locale);
  const brand = await emailBrandForOrganization(organizationId);
  const subject = t("email.alerts.temperature.subject", { equipmentName });
  const limits = tempMin != null && tempMax != null
    ? t("email.alerts.temperature.range.both", { minimum: tempMin, maximum: tempMax })
    : tempMin != null
      ? t("email.alerts.temperature.range.minimumOnly", { minimum: tempMin })
      : t("email.alerts.temperature.range.maximumOnly", { maximum: tempMax ?? 0 });
  const body = `
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:20px;margin:0 0 24px">
      <p style="margin:0 0 8px;font-size:16px;font-weight:700;color:#dc2626">${t("email.alerts.temperature.title")}</p>
      <p style="margin:0;color:#7f1d1d;font-size:14px;line-height:1.6">${t("email.alerts.temperature.description")}</p>
    </div>
    <table style="width:100%;border-collapse:collapse;margin:0 0 24px">
      <tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#71717a;font-size:13px;width:140px">${t("email.alerts.temperature.equipmentLabel")}</td><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#18181b;font-weight:600">${escapeHtml(equipmentName)}</td></tr>
      ${areaName ? `<tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#71717a;font-size:13px">${t("email.alerts.temperature.areaLabel")}</td><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#18181b">${escapeHtml(areaName)}</td></tr>` : ""}
      <tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#71717a;font-size:13px">${t("email.alerts.temperature.actualLabel")}</td><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#dc2626;font-weight:700;font-size:18px">${t("email.alerts.temperature.actualValue", { temperature })}</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#71717a;font-size:13px">${t("email.alerts.temperature.allowedRangeLabel")}</td><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#18181b">${escapeHtml(limits)}</td></tr>
      <tr><td style="padding:8px 0;color:#71717a;font-size:13px">${t("email.alerts.temperature.recordedByLabel")}</td><td style="padding:8px 0;color:#18181b">${escapeHtml(filledBy)}</td></tr>
    </table>
    <a href="${APP_URL}/journals/temp_control" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">${t("email.alerts.temperature.openJournal")}</a>`;
  return sendEmail(to, subject, localizedLayout(t, locale, t("email.alerts.temperature.title"), body, brand));
}
/**
 * Письмо со ссылками на скачанный с сайта шаблон журнала. Файл уже
 * скачался в браузере — письмо дублирует его, чтобы шаблон можно было
 * открыть с другого устройства или переслать. Ссылки подписаны и живут
 * `expiresDays` дней; адрес печатается и текстом — кнопки режут
 * некоторые почтовые клиенты.
 *
 * Сборка отделена от отправки ради тестов: письмо проверяется целиком,
 * без SMTP.
 */
export async function buildBlankDownloadEmail(params: {
  journalTitle: string;
  files: Array<{ label: string; url: string }>;
  pageUrl: string | null;
  registerUrl: string;
  expiresDays: number;
  locale?: Locale;
}): Promise<{ subject: string; html: string }> {
  const { journalTitle, files, pageUrl, registerUrl, expiresDays } = params;
  const locale = params.locale ?? "ru";
  const t = await translatorFor(locale);
  const subject = t("email.blankDownload.subject", { journalTitle });
  const [main, ...more] = files;
  const moreHtml = more.map((file) => `<p style="margin:12px 0 0;font-size:14px"><a href="${escapeHtml(file.url)}" style="color:#3848c7">${escapeHtml(file.label)}</a></p>`).join("");
  const pageHtml = pageUrl
    ? `<p style="margin:16px 0 0;color:#3f3f46;font-size:14px;line-height:1.6">${t("email.blankDownload.journalPageIntro")} <a href="${escapeHtml(pageUrl)}" style="color:#3848c7">${escapeHtml(pageUrl)}</a></p>`
    : "";
  const body = `
    <p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">${t("email.blankDownload.greeting")}</p>
    <p style="margin:0 0 20px;color:#3f3f46;line-height:1.6">${t("email.blankDownload.downloadNotice", { journalTitle: escapeHtml(journalTitle), expiresDays })}</p>
    ${main ? `<a href="${escapeHtml(main.url)}" style="display:inline-block;background:#5566f6;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">${escapeHtml(main.label)}</a><p style="margin:12px 0 0;color:#a1a1aa;font-size:12px;line-height:1.5;word-break:break-all">${t("email.blankDownload.fallbackLinkNotice")} ${escapeHtml(main.url)}</p>` : ""}${moreHtml}${pageHtml}
    <div style="background:#f5f6ff;border-radius:8px;padding:20px;margin:24px 0 0">
      <p style="margin:0 0 8px;font-size:14px;font-weight:600;color:#18181b">${t("email.blankDownload.paperlessTitle")}</p>
      <p style="margin:0 0 16px;color:#3f3f46;font-size:14px;line-height:1.6">${t("email.blankDownload.paperlessBody", { freeTier: t("email.blankDownload.freeTier", { count: TRIAL_DAYS }) })}</p>
      <a href="${escapeHtml(registerUrl)}" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600;font-size:14px">${t("email.blankDownload.startUsingAction")}</a>
    </div>
    <p style="margin:24px 0 0;font-size:12px;color:#a1a1aa;line-height:1.5">${t("email.blankDownload.disclaimer")}</p>`;
  return { subject, html: localizedLayout(t, locale, subject, body) };
}
export async function sendBlankDownloadEmail(
  params: Parameters<typeof buildBlankDownloadEmail>[0] & { to: string }
): Promise<boolean> {
  const { subject, html } = await buildBlankDownloadEmail(params);
  return sendEmail(params.to, subject, html);
}
