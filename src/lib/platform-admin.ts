/**
 * Единая точка «уведомить админа платформы».
 *
 * До этого модуля служебные события расползались по двум разным env:
 * регистрации и оплаты уходили в `PLATFORM_ADMIN_TELEGRAM_CHAT_ID`, а
 * обратная связь — в `FEEDBACK_ADMIN_TG_CHAT_ID`, то есть двум разным
 * людям, и владелец не понимал, кто что видит. Здесь один источник
 * правды, legacy-переменные остаются fallback'ом, чтобы ничего не
 * отвалилось до чистки прод-окружения.
 */

import { db } from "@/lib/db";
import { renderEmailLayout, sendRawEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/html-escape";
import { isPlatformAdministrator, PLATFORM_SECTION_KEYS } from "@/lib/platform-access";
import { adminNotificationEmail, mergeAdminEmails, mergeChatIds, parseEmailList } from "@/lib/platform-admin-mail";
import { sendTelegramMessage } from "@/lib/telegram";

/** Разбор списка chat id: «111, 222» → ["111", "222"] (дубликаты убираем). */
export function parseChatIdList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const ids = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return Array.from(new Set(ids));
}

/**
 * Chat id(ы) админа платформы.
 *
 * `PLATFORM_ADMIN_TELEGRAM_CHAT_ID` — источник правды, можно перечислить
 * несколько через запятую (владелец + помощник). `FEEDBACK_ADMIN_TG_CHAT_ID`
 * добавляется следом как legacy: пока прод-env не почищен, обращения должны
 * продолжать приходить туда, куда приходили.
 */
export function getPlatformAdminChatIds(): string[] {
  const primary = parseChatIdList(process.env.PLATFORM_ADMIN_TELEGRAM_CHAT_ID);
  const legacy = parseChatIdList(process.env.FEEDBACK_ADMIN_TG_CHAT_ID);
  return Array.from(new Set([...primary, ...legacy]));
}

/**
 * Почта админа платформы из env (для показа в панели). `PLATFORM_ADMIN_EMAIL`
 * новее, `FEEDBACK_ADMIN_EMAIL` — legacy. Кому реально уходят письма —
 * {@link getPlatformAdminEmails}: env плюс администраторы платформы.
 */
export function getPlatformAdminEmail(): string | null {
  const primary = process.env.PLATFORM_ADMIN_EMAIL?.trim();
  if (primary) return primary;
  const legacy = process.env.FEEDBACK_ADMIN_EMAIL?.trim();
  return legacy || null;
}

type PlatformAdministrator = { email: string; telegramChatId: string | null };

/**
 * Кому уходит уведомление. `admins` — администраторы платформы (`isRoot` или
 * пресет «Администратор»). `support` — они же плюс все, кому в панели открыт
 * раздел «Обратная связь» (менеджер поддержки): обращения с сайта, онлайн-чат,
 * бот — их работа, а не только администраторов.
 */
export type PlatformAudience = "admins" | "support";

type StaffRow = PlatformAdministrator & { isRoot: boolean; platformSections: string[] };

let staffCache: { at: number; rows: StaffRow[] } | null = null;
const ADMINISTRATORS_CACHE_MS = 60_000;

/** Получатель уведомления по аудитории — чистая функция, проверяется тестом. */
export function inPlatformAudience(
  user: { isRoot: boolean; platformSections: readonly string[] },
  audience: PlatformAudience
): boolean {
  if (isPlatformAdministrator(user)) return true;
  return audience === "support" && user.platformSections.includes("support");
}

async function loadPlatformStaff(): Promise<StaffRow[]> {
  if (staffCache && Date.now() - staffCache.at < ADMINISTRATORS_CACHE_MS) return staffCache.rows;
  try {
    const rows = await db.user.findMany({
      where: {
        isActive: true,
        archivedAt: null,
        OR: [
          { isRoot: true },
          { platformSections: { hasEvery: [...PLATFORM_SECTION_KEYS] } },
          { platformSections: { has: "support" } },
        ],
      },
      select: { email: true, telegramChatId: true, isRoot: true, platformSections: true },
      orderBy: { createdAt: "asc" },
    });
    staffCache = { at: Date.now(), rows };
    return rows;
  } catch (error) {
    console.error("[platform-admin] не удалось получить команду платформы:", error);
    return staffCache?.rows ?? [];
  }
}

/**
 * Активные получатели уведомлений платформы (по умолчанию — администраторы:
 * `isRoot` или пресет «Администратор»). Кеш на минуту: уведомлений бывает
 * много подряд (онлайн-чат), а команда меняется редко. Сбой БД — последний
 * известный список (или пустой): уведомление в env-чат всё равно уйдёт.
 */
export async function getPlatformAdministrators(audience: PlatformAudience = "admins"): Promise<PlatformAdministrator[]> {
  const rows = await loadPlatformStaff();
  return rows
    .filter((row) => inPlatformAudience(row, audience))
    .map((row) => ({ email: row.email, telegramChatId: row.telegramChatId }));
}

/** Все адреса для писем: env + почта получателей аудитории. */
export async function getPlatformAdminEmails(audience: PlatformAudience = "admins"): Promise<string[]> {
  const users = await getPlatformAdministrators(audience);
  const env = parseEmailList(process.env.PLATFORM_ADMIN_EMAIL?.trim() || process.env.FEEDBACK_ADMIN_EMAIL);
  return mergeAdminEmails([env, users.map((user) => user.email)]);
}

/** Все Telegram-чаты: env + получатели аудитории с привязанным Telegram. */
export async function getPlatformAdminRecipientChatIds(audience: PlatformAudience = "admins"): Promise<string[]> {
  const users = await getPlatformAdministrators(audience);
  return mergeChatIds([getPlatformAdminChatIds(), users.map((user) => user.telegramChatId)]);
}

/** Чат команды поддержки: ответ из него на обращение уходит клиенту (свайп в боте). */
export async function isPlatformAdminChat(chatId: string): Promise<boolean> {
  return (await getPlatformAdminRecipientChatIds("support")).includes(chatId);
}

/**
 * Своё подробное письмо (обращение с вложениями, заявка) — каждому
 * адресату {@link getPlatformAdminEmails}. Сбой одного не мешает другим;
 * true, если ушло хотя бы одно.
 */
export async function sendToPlatformAdminEmails(
  send: (to: string) => Promise<boolean>,
  audience: PlatformAudience = "admins"
): Promise<boolean> {
  const emails = await getPlatformAdminEmails(audience);
  const results = await Promise.all(
    emails.map((to) =>
      send(to).catch((error: unknown) => {
        console.error("[platform-admin] письмо админу не ушло:", error);
        return false;
      })
    )
  );
  return results.some(Boolean);
}

/** Общее письмо из текста уведомления — тем, у кого нет своего письма. */
async function emailPlatformAdmins(text: string, audience: PlatformAudience): Promise<boolean> {
  const mail = adminNotificationEmail(text);
  const html = renderEmailLayout(escapeHtml(mail.title), mail.bodyHtml ? `<div style="color:#3f3f46;font-size:14px;line-height:1.6">${mail.bodyHtml}</div>` : "", null, {
    preheader: mail.title,
    footerHtml: `<p style="margin:6px 0 0;font-size:12px;color:#a1a1aa;text-align:center">Письмо администратору платформы WeSetup. Такое же уведомление приходит в Telegram, если он привязан.</p>`,
  });
  return sendToPlatformAdminEmails((to) => sendRawEmail(to, mail.subject, html), audience);
}

/**
 * Маскированное значение для показа в админке: «…638». Владелец не должен
 * гадать, чей chat id настроен, но и целиком светить его в UI незачем.
 */
export function maskChatId(chatId: string): string {
  return chatId.length <= 4 ? chatId : `…${chatId.slice(-4)}`;
}

/** Маска почты для той же цели: «yor…@gmail.com». */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at);
  const head = local.slice(0, Math.min(3, local.length));
  return `${head}…${domain}`;
}

/**
 * Уведомление администраторам платформы: в Telegram — env-чаты и
 * администраторы с привязанным Telegram (`sendTelegramMessage`: TelegramLog
 * и retry на 429), на почту — env-адрес и почта каждого администратора.
 * `audience: "support"` — обращения и чаты: ещё и менеджерам с разделом
 * «Обратная связь». `email: false` — у события своё подробное письмо (обращения, заявки),
 * его вызывающий шлёт сам через {@link sendToPlatformAdminEmails}.
 *
 * `kind` попадает в `TelegramLog.kind` как `admin:<kind>` — по логу видно,
 * какие именно служебные уведомления реально ушли. `dedupeKey` пишется
 * туда же: по паре kind+dedupeKey алерты о сбоях считают свой кулдаун
 * (см. `raisePlatformAlert`), не заводя отдельной таблицы.
 *
 * Возвращает true, если хотя бы одна отправка успешна (с `email: false` —
 * только Telegram): вызывающий код (форма обратной связи, бот) записывает по
 * этому флагу `adminTgNotifiedAt`.
 */
export async function notifyPlatformAdmin(
  text: string,
  opts?: { kind?: string; dedupeKey?: string; email?: boolean; audience?: PlatformAudience }
): Promise<boolean> {
  const [telegram, email] = await Promise.all([
    telegramPlatformAdmins(text, opts),
    opts?.email === false
      ? Promise.resolve(false)
      : emailPlatformAdmins(text, opts?.audience ?? "admins").catch((error: unknown) => {
          console.error("[platform-admin] email failed:", error);
          return false;
        }),
  ]);
  return telegram || email;
}

async function telegramPlatformAdmins(
  text: string,
  opts?: { kind?: string; dedupeKey?: string; audience?: PlatformAudience }
): Promise<boolean> {
  const chatIds = await getPlatformAdminRecipientChatIds(opts?.audience ?? "admins");
  if (chatIds.length === 0) {
    console.error(
      "[platform-admin] нет Telegram-чата админа: PLATFORM_ADMIN_TELEGRAM_CHAT_ID пуст и никто из администраторов не привязал Telegram"
    );
    return false;
  }

  const kind = opts?.kind ? `admin:${opts.kind}` : "admin";
  const results = await Promise.all(
    chatIds.map(async (chatId) => {
      try {
        return await sendTelegramMessage(chatId, text, {
          delivery: { kind, dedupeKey: opts?.dedupeKey },
        });
      } catch (error) {
        console.error("[platform-admin] telegram send failed:", error);
        return false;
      }
    })
  );

  return results.some(Boolean);
}

/** Подробное письмо по обращению — команде поддержки (аудитория `support`). */
export function sendToSupportEmails(send: (to: string) => Promise<boolean>): Promise<boolean> {
  return sendToPlatformAdminEmails(send, "support");
}
