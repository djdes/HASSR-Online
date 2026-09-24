import nodemailer from "nodemailer";
import { closingDocumentFilename } from "@/lib/closing-documents/types";
import { escapeHtml } from "@/lib/html-escape";
import { FREE_MAX_USERS } from "@/lib/plan-limits";

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
    async deliver({ to, subject, html, attachments }) {
      await smtp.sendMail({
        from: FROM,
        to,
        subject,
        html,
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

function brandBlock(brand: EmailBrand | null | undefined): string {
  if (!brand) return "";
  const logo = brand.logoUrl
    ? `<img src="${brand.logoUrl}" height="32" alt="${escapeHtml(brand.brandName)}" style="display:block;border:0;height:32px;max-width:160px;width:auto;margin:0 0 6px">`
    : "";
  return `
  <tr><td style="padding:14px 32px;background:#f5f6ff;border-bottom:1px solid #e4e4e7">
    ${logo}
    <p style="margin:0;font-size:12px;color:#3c4053">при сопровождении <strong style="color:#0b1024">${escapeHtml(brand.brandName)}</strong></p>
  </td></tr>`;
}

function layout(title: string, body: string, brand?: EmailBrand | null) {
  return `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px">
<tr><td align="center">
<table width="100%" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
  <tr><td style="background:#0b1024;padding:22px 32px">
    <img src="${EMAIL_ASSET_ORIGIN}/brand/logo-email.png" width="116" height="31" alt="WeSetup" style="display:block;border:0;height:31px;width:116px">
  </td></tr>${brandBlock(brand)}
  <tr><td style="padding:32px">
    <h2 style="margin:0 0 16px;font-size:18px;color:#18181b">${title}</h2>
    ${body}
  </td></tr>
  <tr><td style="padding:16px 32px;background:#fafafa;border-top:1px solid #e4e4e7">
    <p style="margin:0;font-size:12px;color:#a1a1aa;text-align:center">&copy; 2026 WeSetup. Электронные журналы СанПиН и ХАССП.${
      brand ? " Работает на платформе WeSetup." : ""
    }</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** Для писем партнёрки (src/lib/partners/emails.ts) — тот же шаблон и транспорт. */
export function renderEmailLayout(title: string, body: string, brand?: EmailBrand | null) {
  return layout(title, body, brand);
}
export async function sendRawEmail(to: string, subject: string, html: string): Promise<boolean> {
  return sendEmail(to, subject, html);
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
 * Возвращает true, если письмо принято транспортом. Раньше функция
 * возвращала void и глотала ошибку в console.error — вызывающий код не мог
 * отличить «ушло» от «упало», и в панели обращений было не видно, что
 * почтовый канал молчит. Fire-and-forget вызовы просто игнорируют результат.
 */
async function sendEmail(
  to: string,
  subject: string,
  html: string,
  attachments?: EmailAttachment[]
): Promise<boolean> {
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
    console.info(`[email/dev] Body:    ${stripped}`);
    return false;
  }
  try {
    await getTransport().deliver({ to, subject, html, attachments });
    return true;
  } catch (error) {
    console.error("Email send error:", error);
    return false;
  }
}

export async function sendVerificationEmail(to: string, code: string) {
  // Dev-mode explicit code line so it's grep'able in the server log
  // separately from the long HTML body stripped above.
  if (!isSmtpConfigured()) {
    console.info(`[email/dev] Код подтверждения для ${to}: ${code}`);
  }
  const subject = `Код подтверждения — WeSetup`;
  const body = `
    <p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">Здравствуйте!</p>
    <p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">Ваш код подтверждения регистрации:</p>
    <div style="background:#f4f4f5;border-radius:8px;padding:20px;margin:0 0 24px;text-align:center">
      <p style="margin:0;font-size:32px;font-weight:700;letter-spacing:8px;color:#18181b">${escapeHtml(code)}</p>
    </div>
    <p style="margin:0;color:#71717a;font-size:13px">Код действителен 10 минут. Если вы не запрашивали регистрацию, проигнорируйте это письмо.</p>`;
  return sendEmail(to, subject, layout(subject, body));
}

export async function sendInviteTokenEmail(params: {
  to: string;
  name: string;
  organizationName: string;
  inviteUrl: string;
  organizationId?: string | null;
  /** Своя тема письма (по умолчанию «Вас пригласили в … — WeSetup»). */
  subject?: string;
  /** Абзац о роли приглашённого — например, для сотрудника мастер-кабинета справочников. */
  intro?: string;
}) {
  const { to, name, organizationName, inviteUrl, organizationId, intro } = params;
  const brand = await emailBrandForOrganization(organizationId);
  const subject = params.subject ?? `Вас пригласили в ${organizationName} — WeSetup`;
  const introHtml = intro
    ? `<p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">${escapeHtml(intro)}</p>`
    : "";
  const body = `
    <p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">Здравствуйте, <strong>${escapeHtml(name)}</strong>!</p>
    <p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">Вас пригласили в организацию <strong>${escapeHtml(organizationName)}</strong>. Нажмите кнопку ниже, чтобы установить пароль и войти.</p>${introHtml}
    <p style="margin:0 0 16px;color:#71717a;font-size:13px;line-height:1.6">Логин для входа: <strong>${escapeHtml(to)}</strong></p>
    <a href="${inviteUrl}" style="display:inline-block;background:#5566f6;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">Установить пароль</a>
    <p style="margin:24px 0 0;font-size:13px;color:#a1a1aa">Ссылка действительна 7 дней. После установки пароля приглашение станет недействительным.</p>`;
  return sendEmail(to, subject, layout(subject, body, brand));
}

export async function sendInviteEmail(params: {
  to: string;
  name: string;
  password: string;
  organizationName: string;
  organizationId?: string | null;
}) {
  const { to, name, password, organizationName, organizationId } = params;
  const brand = await emailBrandForOrganization(organizationId);
  const subject = `Вас пригласили в ${organizationName} — WeSetup`;

  const body = `
    <p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">Здравствуйте, <strong>${escapeHtml(name)}</strong>!</p>
    <p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">Вас пригласили в организацию <strong>${escapeHtml(organizationName)}</strong> для ведения электронных журналов ХАССП.</p>
    <div style="background:#f4f4f5;border-radius:8px;padding:20px;margin:0 0 24px">
      <p style="margin:0 0 8px;font-size:13px;color:#71717a">Ваши данные для входа:</p>
      <p style="margin:0 0 4px;color:#18181b"><strong>Email:</strong> ${escapeHtml(to)}</p>
      <p style="margin:0;color:#18181b"><strong>Пароль:</strong> ${escapeHtml(password)}</p>
    </div>
    <a href="${APP_URL}/login" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">Войти в систему</a>
    <p style="margin:24px 0 0;font-size:13px;color:#a1a1aa">Рекомендуем сменить пароль после первого входа.</p>`;

  return sendEmail(to, subject, layout("Приглашение в систему", body, brand));
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
}) {
  const { to, password, organizationId } = params;
  const brand = await emailBrandForOrganization(organizationId);
  const subject = "Ваш аккаунт WeSetup создан — пароль внутри";

  const body = `
    <p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">Здравствуйте!</p>
    <p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">Аккаунт создан, вы уже вошли в кабинет. Сохраните данные для входа с других устройств:</p>
    <div style="background:#f4f4f5;border-radius:8px;padding:20px;margin:0 0 24px">
      <p style="margin:0 0 4px;color:#18181b"><strong>Логин:</strong> ${escapeHtml(to)}</p>
      <p style="margin:0;color:#18181b"><strong>Пароль:</strong> <span style="font-family:monospace;font-size:16px;letter-spacing:1px">${escapeHtml(password)}</span></p>
    </div>
    <a href="${APP_URL}/dashboard" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">Открыть кабинет</a>
    <p style="margin:24px 0 0;color:#71717a;font-size:13px">Пароль можно сменить в настройках профиля. В кабинете осталось заполнить данные организации — они попадают в шапку журналов и PDF для проверок.</p>`;

  return sendEmail(to, subject, layout("Аккаунт создан", body, brand));
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
}) {
  const { to, password, organizationId } = params;
  const brand = await emailBrandForOrganization(organizationId);
  const subject = "Новый пароль для входа в WeSetup";

  const body = `
    <p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">Здравствуйте!</p>
    <p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">В анкете организации задан новый пароль. Пароль из первого письма больше не подходит — сохраните данные для входа:</p>
    <div style="background:#f4f4f5;border-radius:8px;padding:20px;margin:0 0 24px">
      <p style="margin:0 0 4px;color:#18181b"><strong>Логин:</strong> ${escapeHtml(to)}</p>
      <p style="margin:0;color:#18181b"><strong>Пароль:</strong> <span style="font-family:monospace;font-size:16px;letter-spacing:1px">${escapeHtml(password)}</span></p>
    </div>
    <a href="${APP_URL}/dashboard" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">Открыть кабинет</a>
    <p style="margin:24px 0 0;color:#71717a;font-size:13px">Сменить пароль можно в любой момент в настройках профиля.</p>`;

  return sendEmail(to, subject, layout("Новый пароль", body, brand));
}

/**
 * Письмо восстановления доступа. Ссылка ведёт на ту же страницу, что и
 * приглашение сотрудника, поэтому копия нейтральная — «задайте новый
 * пароль», без слова «приглашение».
 */
export async function sendPasswordResetEmail(params: {
  to: string;
  resetUrl: string;
}) {
  const { to, resetUrl } = params;
  const subject = "Восстановление доступа к WeSetup";

  const body = `
    <p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">Здравствуйте!</p>
    <p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">Вы запросили восстановление доступа к аккаунту <strong>${escapeHtml(to)}</strong>. Нажмите кнопку ниже, чтобы задать новый пароль.</p>
    <a href="${resetUrl}" style="display:inline-block;background:#5566f6;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">Задать новый пароль</a>
    <p style="margin:24px 0 0;font-size:13px;color:#a1a1aa">Ссылка действительна 7 дней. Если вы не запрашивали восстановление — просто проигнорируйте письмо, пароль останется прежним.</p>`;

  return sendEmail(to, subject, layout(subject, body));
}

export async function sendWelcomeEmail(params: {
  to: string;
  name: string;
  organizationName: string;
  organizationId?: string | null;
}) {
  const { to, name, organizationName, organizationId } = params;
  const brand = await emailBrandForOrganization(organizationId);
  const subject = "Добро пожаловать в WeSetup!";

  const body = `
    <p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">Здравствуйте, <strong>${escapeHtml(name)}</strong>!</p>
    <p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">Организация <strong>${escapeHtml(organizationName)}</strong> успешно зарегистрирована. Бесплатно до <strong>${FREE_MAX_USERS} сотрудников</strong>, без ограничений по записям — все функции доступны сразу.</p>
    <div style="background:#f4f4f5;border-radius:8px;padding:20px;margin:0 0 24px">
      <p style="margin:0 0 12px;font-size:14px;font-weight:600;color:#18181b">С чего начать:</p>
      <p style="margin:0 0 8px;color:#3f3f46;font-size:14px">1. Добавьте производственные зоны в <strong>Настройки → Зоны</strong></p>
      <p style="margin:0 0 8px;color:#3f3f46;font-size:14px">2. Добавьте оборудование в <strong>Настройки → Оборудование</strong></p>
      <p style="margin:0 0 8px;color:#3f3f46;font-size:14px">3. Заполните первый журнал в разделе <strong>Журналы</strong></p>
      <p style="margin:0;color:#3f3f46;font-size:14px">4. Пригласите сотрудников в <strong>Настройки → Сотрудники</strong></p>
    </div>
    <a href="${APP_URL}/dashboard" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">Перейти в панель</a>`;

  return sendEmail(to, subject, layout("Добро пожаловать!", body, brand));
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
  method: string;
  organizationId?: string | null;
}) {
  const brand = await emailBrandForOrganization(params.organizationId);
  const subject = "Вход в WeSetup с нового устройства";
  const body = `
    <p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">${params.name ? `${escapeHtml(params.name)}, здравствуйте!` : "Здравствуйте!"}</p>
    <p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">В ваш аккаунт только что вошли с устройства, которого мы раньше не видели.</p>
    <div style="background:#f4f4f5;border-radius:8px;padding:20px;margin:0 0 24px">
      <p style="margin:0 0 8px;color:#3f3f46;font-size:14px">Устройство: <strong>${escapeHtml(params.device)}</strong></p>
      <p style="margin:0 0 8px;color:#3f3f46;font-size:14px">Когда: <strong>${escapeHtml(params.when)} МСК</strong></p>
      <p style="margin:0 0 8px;color:#3f3f46;font-size:14px">IP: <strong>${escapeHtml(params.ip)}</strong></p>
      <p style="margin:0;color:#3f3f46;font-size:14px">Способ: <strong>${escapeHtml(params.method)}</strong></p>
    </div>
    <p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">Если это были вы — ничего делать не нужно. Если нет — откройте «Настройки → Безопасность», нажмите «Завершить все сессии» и смените пароль.</p>
    <a href="${APP_URL}/settings/security" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">Открыть «Безопасность»</a>
    <p style="margin:24px 0 0;color:#71717a;font-size:13px">Вопросы — support@wesetup.ru.</p>`;
  return sendEmail(params.to, subject, layout(subject, body, brand));
}

export async function sendInvoiceEmail(params: {
  to: string;
  number: string;
  amountRub: number;
  dueAt: Date;
  organizationId?: string | null;
  pdf: Buffer;
}) {
  const brand = await emailBrandForOrganization(params.organizationId);
  const subject = `Счёт № ${params.number} на оплату WeSetup`;
  const rub = new Intl.NumberFormat("ru-RU").format(params.amountRub) + " ₽";
  const due = params.dueAt.toLocaleDateString("ru-RU");
  const body = `
    <p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">Здравствуйте!</p>
    <p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">Счёт на оплату подписки WeSetup — во вложении.</p>
    <div style="background:#f4f4f5;border-radius:8px;padding:20px;margin:0 0 24px">
      <p style="margin:0 0 8px;color:#3f3f46;font-size:14px">Счёт: <strong>№ ${escapeHtml(params.number)}</strong></p>
      <p style="margin:0 0 8px;color:#3f3f46;font-size:14px">Сумма: <strong>${escapeHtml(rub)}</strong></p>
      <p style="margin:0;color:#3f3f46;font-size:14px">Действителен до: <strong>${escapeHtml(due)}</strong></p>
    </div>
    <p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">В назначении платежа укажите «Оплата по счёту № ${escapeHtml(params.number)}». Как только деньги поступят, подписка продлится автоматически, а закрывающие документы (УПД) появятся в кабинете: «Настройки → Подписка → История оплат» — и придут письмом.</p>
    <p style="margin:24px 0 0;color:#71717a;font-size:13px">Вопросы по счёту — support@wesetup.ru.</p>`;
  return sendEmail(params.to, subject, layout(subject, body, brand), [
    { filename: `Invoice-${params.number.replace(/[^0-9A-Za-z_-]/g, "")}.pdf`, content: params.pdf, contentType: "application/pdf" },
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
}) {
  const { to, amountRub, description, actionUrl, isNewClient, subscriptionEnd, organizationId } =
    params;
  const closing = params.closingDocument ?? null;
  // Закрывающие — в том же письме, а не отдельным: бухгалтеру нужен один
  // источник «оплата + документ». Про оригинал и ЭДО говорим сразу:
  // факсимиле для признания расходов принимают не все.
  const closingBlock = closing
    ? `<p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">Закрывающие документы: универсальный передаточный документ № ${escapeHtml(closing.number)} — во вложении (PDF, с факсимиле). Он же всегда доступен в кабинете: «Настройки → Подписка → История оплат». Нужен оригинал с собственноручной подписью или обмен через ЭДО — просто ответьте на это письмо.</p>`
    : "";
  const points = Math.max(0, Number(params.pointsSpent ?? 0));
  const brand = await emailBrandForOrganization(organizationId);
  const subject = isNewClient
    ? "Оплата получена — завершите настройку"
    : "Оплата получена — подписка продлена";
  const rub = (value: number) =>
    new Intl.NumberFormat("ru-RU").format(value) + " ₽";
  // Чек показывает и деньги, и баллы: строка «Сумма: 1 490 ₽» при цене
  // 1 990 ₽ без пояснения выглядит как ошибка списания.
  const amount =
    amountRub <= 0 && points > 0
      ? `оплачено баллами (${rub(points)})`
      : points > 0
        ? `${rub(amountRub)} (+ ${rub(points)} баллами)`
        : rub(amountRub);
  const until = subscriptionEnd.toLocaleDateString("ru-RU");

  const body = `
    <p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">Здравствуйте!</p>
    <p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">Мы получили вашу оплату. Спасибо!</p>
    <div style="background:#f4f4f5;border-radius:8px;padding:20px;margin:0 0 24px">
      <p style="margin:0 0 8px;color:#3f3f46;font-size:14px">Тариф: <strong>${escapeHtml(description)}</strong></p>
      <p style="margin:0 0 8px;color:#3f3f46;font-size:14px">Сумма: <strong>${escapeHtml(amount)}</strong></p>
      <p style="margin:0;color:#3f3f46;font-size:14px">Подписка действует до: <strong>${escapeHtml(until)}</strong></p>
    </div>
    ${closingBlock}
    <p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">${
      isNewClient
        ? "Осталось задать пароль и указать название организации — это займёт минуту."
        : "Подписка вашей организации продлена, дополнительных действий не требуется."
    }</p>
    <a href="${actionUrl}" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">${
      isNewClient ? "Завершить настройку" : "Войти в кабинет"
    }</a>
    <p style="margin:24px 0 0;color:#71717a;font-size:13px">Вопросы по оплате и возврату — support@wesetup.ru.</p>`;
  const attachments = closing
    ? [
        {
          filename: closingDocumentFilename(closing.number).ascii,
          content: closing.pdf,
          contentType: "application/pdf",
        },
      ]
    : undefined;
  return sendEmail(to, subject, layout(subject, body, brand), attachments);
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
  const theme = FEEDBACK_TYPE_THEME[type] ?? FEEDBACK_TYPE_THEME.suggestion;
  const typeLabel = theme.label;
  const typeColor = theme.color;
  const typeBg = theme.bg;
  const typeBorder = theme.border;
  const whenLabel = (submittedAt ?? new Date()).toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
  });
  const subject = `[Feedback · ${typeLabel}] ${userName ?? userEmail ?? "Анонимно"}`;

  const row = (label: string, value: string | null | undefined) =>
    value
      ? `<tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#71717a;font-size:13px;width:140px">${escapeHtml(label)}</td><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#18181b">${escapeHtml(value)}</td></tr>`
      : "";

  const attachmentsBlock =
    params.attachmentLinks && params.attachmentLinks.length > 0
      ? `<div style="margin:0 0 24px">
      <p style="margin:0 0 8px;font-size:12px;font-weight:600;letter-spacing:1.4px;text-transform:uppercase;color:#71717a">Вложения</p>
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
      ${row("Отправитель", userName)}
      ${row("Email", userEmail)}
      ${row("Организация", organizationName)}
      ${row("Телефон для ответа", phone)}
      <tr><td style="padding:8px 0;color:#71717a;font-size:13px">Время</td><td style="padding:8px 0;color:#18181b">${whenLabel}</td></tr>
    </table>
    <a href="${APP_URL}/root/feedback" style="display:inline-block;background:#5566f6;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">Открыть панель обращений</a>`;

  return sendEmail(
    to,
    subject,
    layout(`Обратная связь — ${typeLabel}`, body),
    params.attachments
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
  to: string;
  replyMessage: string;
  originalMessage: string;
  respondedByName?: string | null;
}): Promise<boolean> {
  const { to, replyMessage, originalMessage, respondedByName } = params;
  const subject = "Ответ на ваше обращение — WeSetup";

  const body = `
    <p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">Здравствуйте!</p>
    <p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">Мы ответили на ваше обращение${
      respondedByName ? ` — ${escapeHtml(respondedByName)}` : ""
    }:</p>
    <div style="background:#eef1ff;border:1px solid #c7ccea;border-radius:8px;padding:20px;margin:0 0 20px">
      <p style="margin:0;white-space:pre-wrap;color:#18181b;font-size:14px;line-height:1.55">${escapeHtml(replyMessage)}</p>
    </div>
    <div style="border-left:3px solid #e4e4e7;padding:0 0 0 14px;margin:0 0 24px">
      <p style="margin:0 0 6px;font-size:12px;color:#a1a1aa">Ваше обращение</p>
      <p style="margin:0;white-space:pre-wrap;color:#71717a;font-size:13px;line-height:1.5">${escapeHtml(originalMessage)}</p>
    </div>
    <a href="${APP_URL}/dashboard" style="display:inline-block;background:#5566f6;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">Открыть WeSetup</a>
    <p style="margin:24px 0 0;color:#71717a;font-size:13px">Ответить можно прямо на это письмо или написать боту @wesetupbot в Telegram.</p>`;

  return sendEmail(to, subject, layout("Ответ поддержки", body));
}

/**
 * Тест-письмо для кнопки «Проверить связь» в /root/feedback. Владелец
 * должен видеть своими глазами, куда реально приходят служебные письма,
 * а не выяснять это по логам.
 */
export async function sendPlatformAdminTestEmail(params: {
  to: string;
  triggeredBy: string;
}): Promise<boolean> {
  const { to, triggeredBy } = params;
  const subject = "Проверка связи — WeSetup";
  const when = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });

  const body = `
    <p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">Это тестовое письмо из панели обращений WeSetup. Если вы его читаете — почтовый канал служебных уведомлений работает и письма не уходят в спам.</p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 24px">
      <tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#71717a;font-size:13px;width:140px">Адрес</td><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#18181b">${escapeHtml(to)}</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#71717a;font-size:13px">Запустил</td><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#18181b">${escapeHtml(triggeredBy)}</td></tr>
      <tr><td style="padding:8px 0;color:#71717a;font-size:13px">Время</td><td style="padding:8px 0;color:#18181b">${escapeHtml(when)}</td></tr>
    </table>
    <p style="margin:0;color:#71717a;font-size:13px">Проверьте «Показать оригинал» в почтовом клиенте: должны быть spf=pass и dkim=pass для wesetup.ru.</p>`;

  return sendEmail(to, subject, layout("Проверка связи", body));
}

export async function sendDeviationAlertEmail(params: {
  to: string;
  journalName: string;
  journalCode: string;
  deviationType: string;
  details: string;
  filledBy: string;
  organizationId?: string | null;
}) {
  const { to, journalName, journalCode, deviationType, details, filledBy, organizationId } = params;
  const brand = await emailBrandForOrganization(organizationId);
  const subject = `⚠ ${deviationType} — ${journalName}`;

  const body = `
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:20px;margin:0 0 24px">
      <p style="margin:0 0 8px;font-size:16px;font-weight:700;color:#dc2626">${escapeHtml(deviationType)}</p>
      <p style="margin:0;color:#7f1d1d;font-size:14px;line-height:1.6">${escapeHtml(details)}</p>
    </div>
    <table style="width:100%;border-collapse:collapse;margin:0 0 24px">
      <tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#71717a;font-size:13px;width:140px">Журнал</td><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#18181b;font-weight:600">${escapeHtml(journalName)}</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#71717a;font-size:13px">Записал</td><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#18181b">${escapeHtml(filledBy)}</td></tr>
      <tr><td style="padding:8px 0;color:#71717a;font-size:13px">Время</td><td style="padding:8px 0;color:#18181b">${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}</td></tr>
    </table>
    <a href="${APP_URL}/journals/${encodeURIComponent(journalCode)}" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">Открыть журнал</a>`;

  return sendEmail(to, subject, layout("Отклонение зафиксировано", body, brand));
}

export async function sendComplianceReminderEmail(params: {
  to: string;
  missingJournals: string[];
  organizationName: string;
  organizationId?: string | null;
}) {
  const { to, missingJournals, organizationName, organizationId } = params;
  const brand = await emailBrandForOrganization(organizationId);
  const subject = `📋 Незаполненные журналы — ${organizationName}`;

  const listHtml = missingJournals
    .map((j) => `<li style="margin:0 0 4px;color:#18181b;font-size:14px">${escapeHtml(j)}</li>`)
    .join("");

  const body = `
    <p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">Следующие обязательные журналы не были заполнены сегодня:</p>
    <div style="background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:20px;margin:0 0 24px">
      <ul style="margin:0;padding:0 0 0 20px">${listHtml}</ul>
    </div>
    <a href="${APP_URL}/journals" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">Заполнить журналы</a>`;

  return sendEmail(to, subject, layout("Напоминание о журналах", body, brand));
}

export async function sendTemperatureAlertEmail(params: {
  to: string;
  equipmentName: string;
  temperature: number;
  tempMin: number | null;
  tempMax: number | null;
  areaName?: string;
  filledBy: string;
  organizationId?: string | null;
}) {
  const { to, equipmentName, temperature, tempMin, tempMax, areaName, filledBy, organizationId } = params;
  const brand = await emailBrandForOrganization(organizationId);
  const subject = `⚠ Нарушение температуры: ${equipmentName}`;

  const limitsText = tempMin != null && tempMax != null
    ? `${tempMin}°C — ${tempMax}°C`
    : tempMin != null ? `от ${tempMin}°C` : `до ${tempMax}°C`;

  const body = `
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:20px;margin:0 0 24px">
      <p style="margin:0 0 8px;font-size:16px;font-weight:700;color:#dc2626">Температура вне нормы!</p>
      <p style="margin:0;color:#7f1d1d;font-size:14px;line-height:1.6">Зафиксировано отклонение температуры. Требуется корректирующее действие.</p>
    </div>
    <table style="width:100%;border-collapse:collapse;margin:0 0 24px">
      <tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#71717a;font-size:13px;width:140px">Оборудование</td><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#18181b;font-weight:600">${escapeHtml(equipmentName)}</td></tr>
      ${areaName ? `<tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#71717a;font-size:13px">Зона</td><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#18181b">${escapeHtml(areaName)}</td></tr>` : ""}
      <tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#71717a;font-size:13px">Факт. температура</td><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#dc2626;font-weight:700;font-size:18px">${escapeHtml(temperature)}°C</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#71717a;font-size:13px">Допустимый диапазон</td><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#18181b">${escapeHtml(limitsText)}</td></tr>
      <tr><td style="padding:8px 0;color:#71717a;font-size:13px">Записал</td><td style="padding:8px 0;color:#18181b">${escapeHtml(filledBy)}</td></tr>
    </table>
    <a href="${APP_URL}/journals/temp_control" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">Открыть журнал</a>`;

  return sendEmail(to, subject, layout("Температурный алерт", body, brand));
}
