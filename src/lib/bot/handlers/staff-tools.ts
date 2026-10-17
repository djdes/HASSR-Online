import type { Composer, Context } from "grammy";
import type { InlineKeyboardButton } from "grammy/types";
import { db } from "@/lib/db";
import { escapeTelegramHtml as esc } from "@/lib/telegram";
import {
  getMiniAppBaseUrlFromEnv,
  buildMiniAppUrl,
} from "@/lib/journal-obligation-links";
import { buildTelegramWebAppKeyboard } from "@/lib/telegram-web-app";
import { botCallbackRateLimiter } from "@/lib/rate-limit";
import { listOpenJournalObligationsForUser } from "@/lib/journal-obligations";
import { buildStaffObligationDigest } from "@/lib/telegram-obligation-digests";
import { FORMAT_LOCALES, resolveLocale, type Locale } from "@/i18n/locales";
import { loadMessages, type Messages } from "@/i18n/messages";
import { createTranslator } from "use-intl/core";

/**
 * Команды для линейного сотрудника. В отличие от /today/missing
 * (зависят от management-роли), эти команды доступны любому
 * привязанному к чату пользователю — повар видит свою смену, повар
 * видит свой профиль.
 *
 *   /shift  → мой статус смены сегодня + inline-кнопки start/end.
 *   /me     → мой профиль (имя, должность, организация).
 *
 * Callback-кнопки start/end обновляют WorkShift.status (working/ended).
 */

export type LinkedUser = {
  id: string;
  name: string | null;
  organizationId: string;
  role: string;
  isRoot: boolean;
  locale?: string | null;
  organization?: { locale?: string | null } | null;
};

function roleLabelFor(messages: Messages, locale: Locale, role: string): string {
  const t = createTranslator({ locale, messages, namespace: "staffManagement.roleLabels" });
  switch (role) {
    case "manager": return t("manager");
    case "head_chef": return t("head_chef");
    case "cook": return t("cook");
    case "waiter": return t("waiter");
    case "owner": return t("owner");
    case "technologist": return t("technologist");
    case "operator": return t("operator");
    default: return role;
  }
}

export async function resolveLinkedUser(
  chatId: number | string | undefined
): Promise<LinkedUser | null> {
  if (chatId === undefined || chatId === null) return null;
  return db.user.findFirst({
    where: {
      telegramChatId: String(chatId),
      isActive: true,
      archivedAt: null,
    },
    select: {
      id: true,
      name: true,
      organizationId: true,
      role: true,
      isRoot: true,
      locale: true,
      organization: { select: { locale: true } },
    },
  });
}

async function workdayCopy(user: LinkedUser | null) {
  const locale = resolveLocale({
    authenticated: Boolean(user),
    userLocale: user?.locale,
    organizationLocale: user?.organization?.locale,
  });
  const messages = await loadMessages(locale);
  return { locale, messages };
}

function localizedGreeting(locale: Locale, messages: Messages, now = new Date()): string {
  const t = createTranslator({ locale, messages, namespace: "telegramWorkday.common" });
  const hour = now.getHours();
  if (hour < 6) return t("greetingNight");
  if (hour < 12) return t("greetingMorning");
  if (hour < 18) return t("greetingDay");
  return t("greetingEvening");
}

function localizedFirstName(locale: Locale, messages: Messages, name: string | null | undefined): string {
  const t = createTranslator({ locale, messages, namespace: "telegramWorkday.common" });
  const firstName = (name ?? "").trim().split(/\s+/)[0];
  return esc(firstName || t("fallbackName"));
}

function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Pure mapping shiftStatus → русскоязычный label с иконкой. Извлечено
 *  для testability (см. staff-tools-helpers.test.ts).
 *  Unknown статусы возвращаются как-есть — для forward-compat с
 *  будущими migration'ами. */
export const SHIFT_STATUS_LABEL: Record<string, string> = {
  none: "🆕 Смена ещё не открыта",
  scheduled: "🕒 По графику, но ещё не на смене",
  working: "🟢 На смене сейчас",
  ended: "✅ Смена сегодня закрыта",
  absent: "🔴 Помечена как пропуск",
  off: "🌴 Выходной",
  vacation: "✈️ Отпуск",
  sick: "🤒 Больничный",
};

export function formatShiftStatusLabel(status: string): string {
  return SHIFT_STATUS_LABEL[status] ?? status;
}

/** Pure decision — какие inline-buttons показать в /shift на конкретном
 *  shiftStatus. Возвращает массив action-id'ов; UI-каркас всегда
 *  одинаковый. Тестируем decision logic без grammy/Telegram. */
export function shiftStatusActions(status: string): Array<"start" | "end"> {
  if (status === "working") return ["end"];
  if (
    status === "ended" ||
    status === "absent" ||
    status === "off" ||
    status === "vacation" ||
    status === "sick"
  ) {
    return [];
  }
  // none, scheduled, или любой другой → предлагаем «вышел».
  return ["start"];
}

function buildShiftKeyboard(args: {
  shiftStatus: string;
  miniAppBaseUrl: string | null;
  messages: Messages;
  locale: Locale;
}): { inline_keyboard: InlineKeyboardButton[][] } | undefined {
  const t = createTranslator({ locale: args.locale, messages: args.messages, namespace: "telegramWorkday.shift.button" });
  const rows: InlineKeyboardButton[][] = [];
  if (args.shiftStatus === "working") {
    rows.push([
      { text: t("end"), callback_data: "shift-tg:end" },
    ]);
  } else if (args.shiftStatus === "ended" || args.shiftStatus === "absent") {
    // Завершено или пропущено — никаких inline-actions, только web_app.
  } else if (
    args.shiftStatus === "off" ||
    args.shiftStatus === "vacation" ||
    args.shiftStatus === "sick"
  ) {
    // Сегодня не на смене по плану — менять статус через бота не даём,
    // чтобы повар случайно не сломал HR-учёт.
  } else {
    // ВАЖНО: префикс `shift-tg:` (а не `shift:`) — иначе срабатывает
    // ДВА handler'а одновременно: shift-gate.ts матчит "shift:start"
    // (status='scheduled') и сразу staff-tools regex /^shift:(start|end)$/
    // перезаписывает на 'working'. Pass-3 review нашёл это как CRITICAL.
    rows.push([
      { text: t("start"), callback_data: "shift-tg:start" },
    ]);
  }
  if (args.miniAppBaseUrl) {
    const url = buildMiniAppUrl(args.miniAppBaseUrl, "/mini");
    if (url) {
      rows.push([{ text: t("cabinet"), web_app: { url } }]);
    }
  }
  if (rows.length === 0) return undefined;
  return { inline_keyboard: rows };
}

async function buildShiftReply(user: LinkedUser): Promise<{
  text: string;
  reply_markup?: { inline_keyboard: InlineKeyboardButton[][] };
}> {
  const { locale, messages } = await workdayCopy(user);
  const t = createTranslator({ locale, messages, namespace: "telegramWorkday" });
  const today = utcDayStart(new Date());
  const shift = await db.workShift.findUnique({
    where: { userId_date: { userId: user.id, date: today } },
    select: { status: true, jobPosition: { select: { name: true } } },
  });
  const status = shift?.status ?? "none";
  const statusT = createTranslator({ locale, messages, namespace: "telegramWorkday.shift.status" });
  const statusLabel = (() => {
    switch (status) {
      case "none": return statusT("none");
      case "scheduled": return statusT("scheduled");
      case "working": return statusT("working");
      case "ended": return statusT("ended");
      case "absent": return statusT("absent");
      case "off": return statusT("off");
      case "vacation": return statusT("vacation");
      case "sick": return statusT("sick");
      default: return t("common.unknownShiftStatus");
    }
  })();
  const lines = [
    t.markup("shift.greeting", { greeting: localizedGreeting(locale, messages), name: localizedFirstName(locale, messages, user.name), b: (chunks: string) => `<b>${chunks}</b>` }),
    "",
    t.markup("shift.statusLine", { status: statusLabel, b: (chunks: string) => `<b>${chunks}</b>` }),
  ];
  if (shift?.jobPosition?.name) {
    lines.push(t.markup("shift.positionLine", { position: esc(shift.jobPosition.name), b: (chunks: string) => `<b>${chunks}</b>` }));
  }
  const text = lines.join("\n");
  const miniAppBaseUrl = getMiniAppBaseUrlFromEnv();
  return {
    text,
    reply_markup: buildShiftKeyboard({
      shiftStatus: status,
      miniAppBaseUrl,
      messages,
      locale,
    }),
  };
}

async function applyShiftAction(
  user: LinkedUser,
  action: "start" | "end"
): Promise<{ ok: boolean; status: string; message: "started" | "ended" | "mustStartFirst" }> {
  const today = utcDayStart(new Date());
  if (action === "start") {
    const result = await db.workShift.upsert({
      where: { userId_date: { userId: user.id, date: today } },
      update: { status: "working" },
      create: {
        organizationId: user.organizationId,
        userId: user.id,
        date: today,
        status: "working",
      },
      select: { status: true },
    });
    return { ok: true, status: result.status, message: "started" };
  }
  const existing = await db.workShift.findUnique({
    where: { userId_date: { userId: user.id, date: today } },
    select: { id: true, status: true },
  });
  if (!existing || existing.status !== "working") {
    return {
      ok: false,
      status: existing?.status ?? "none",
      message: "mustStartFirst",
    };
  }
  const updated = await db.workShift.update({
    where: { id: existing.id },
    data: { status: "ended" },
    select: { status: true },
  });
  return { ok: true, status: updated.status, message: "ended" };
}

export function registerStaffToolsHandlers(composer: Composer<Context>): void {
  composer.command("shift", async (ctx) => {
    const user = await resolveLinkedUser(ctx.from?.id);
    if (!user) {
      const { locale, messages } = await workdayCopy(null);
      const t = createTranslator({ locale, messages, namespace: "telegramWorkday.common" });
      await ctx.reply(
        t("notLinked"),
        { parse_mode: "HTML", link_preview_options: { is_disabled: true } }
      );
      return;
    }
    const reply = await buildShiftReply(user);
    await ctx.reply(reply.text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...(reply.reply_markup ? { reply_markup: reply.reply_markup } : {}),
    });
  });

  // /my_digest — on-demand копия утреннего mini-digest'а. Сотрудник
  // может в любой момент спросить «что мне делать сегодня?» и получить
  // тот же список open-obligations, что и в утреннем push'е, не
  // открывая Mini App. Полезно когда повар на смене получил сообщение
  // о смене ответственных и хочет сразу узнать актуальный список.
  composer.command("my_digest", async (ctx) => {
    const fromId = ctx.from?.id;
    if (!fromId) return;
    const user = await resolveLinkedUser(fromId);
    const { locale, messages } = await workdayCopy(user);
    const commonT = createTranslator({ locale, messages, namespace: "telegramWorkday.common" });
    const t = createTranslator({ locale, messages, namespace: "telegramWorkday.digest" });
    if (!botCallbackRateLimiter.consume(`${fromId}:my_digest`)) {
      await ctx.reply(commonT("rateLimited"), {
        parse_mode: "HTML",
      });
      return;
    }
    if (!user) {
      await ctx.reply(
        commonT("notLinked"),
        { parse_mode: "HTML", link_preview_options: { is_disabled: true } }
      );
      return;
    }
    const obligations = await listOpenJournalObligationsForUser(user.id);
    const miniAppBaseUrl = getMiniAppBaseUrlFromEnv();
    const presentation = {
      openCount: (count: number) => t("openCount", { count }),
      nextAction: (title: string) => t("nextAction", { title }),
      noNextAction: t("noNextAction"),
      todayHeading: t("todayHeading"),
      obligationLine: (values: { title: string; location: string; description: string }) => t("obligationLine", values),
      locationSuffix: (building: string) => t("locationSuffix", { building }),
      descriptionSuffix: (description: string) => t("descriptionSuffix", { description }),
      moreCount: (count: number) => t("moreCount", { count }),
      openTask: t("openTask"),
      openJournals: t("openJournals"),
    };
    const digest = buildStaffObligationDigest({
      userId: user.id,
      openObligations: obligations,
      miniAppBaseUrl,
      presentation,
    });
    if (!digest) {
      const greeting = localizedGreeting(locale, messages, new Date());
      await ctx.reply(
        t.markup("allDone", { greeting, name: localizedFirstName(locale, messages, user.name), b: (chunks: string) => `<b>${chunks}</b>` }),
        { parse_mode: "HTML", link_preview_options: { is_disabled: true } }
      );
      return;
    }
    const greeting = localizedGreeting(locale, messages);
    const name = localizedFirstName(locale, messages, user.name);
    const body = digest.body.replace("{greeting}", greeting).replace("{name}", name);
    const replyMarkup = digest.primaryCta
      ? buildTelegramWebAppKeyboard({
          label: digest.primaryCta.label,
          url: digest.primaryCta.url,
        })
      : undefined;
    await ctx.reply(body, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
  });

  composer.command("me", async (ctx) => {
    const user = await resolveLinkedUser(ctx.from?.id);
    const locale = resolveLocale({ authenticated: Boolean(user), userLocale: user?.locale, organizationLocale: user?.organization?.locale });
    const messages = await loadMessages(locale);
    const t = createTranslator({ locale, messages, namespace: "telegram.bot.me" });
    if (!user) {
      await ctx.reply(t("unlinked"), { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
      return;
    }
    const fullUser = await db.user.findUnique({
      where: { id: user.id },
      select: {
        name: true,
        email: true,
        positionTitle: true,
        jobPosition: { select: { name: true } },
        organization: { select: { name: true } },
      },
    });
    const customPosition =
      fullUser?.jobPosition?.name?.trim() ||
      fullUser?.positionTitle?.trim();
    const roleLabel = roleLabelFor(messages, locale, user.role);
    const position = customPosition || roleLabel;
    const lines = [
      t.markup("nameLine", { name: esc(fullUser?.name ?? "—"), b: (chunks: string) => `<b>${chunks}</b>` }),
      t("positionLine", { position: esc(position) }),
      fullUser?.organization?.name ? t("organizationLine", { organization: esc(fullUser.organization.name) }) : "",
      fullUser?.email ? t.markup("emailLine", { email: esc(fullUser.email), code: (chunks: string) => `<code>${chunks}</code>` }) : "",
    ].filter(Boolean);

    const miniAppBaseUrl = getMiniAppBaseUrlFromEnv();
    const url = miniAppBaseUrl ? buildMiniAppUrl(miniAppBaseUrl, "/mini/me") : null;
    await ctx.reply(lines.join("\n"), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...(url
        ? {
            reply_markup: buildTelegramWebAppKeyboard({
              label: t("button"),
              url,
            }),
          }
        : {}),
    });
  });

  // Callback `digest:refresh` — пользователь нажал «🔄 Обновить» на
  // утреннем mini-digest push'е. Пересчитываем list и edit'им
  // исходное сообщение. Полезно после заполнения журнала: повар
  // видит обновлённый список (одной задачей меньше) не открывая
  // Mini App.
  composer.callbackQuery("digest:refresh", async (ctx) => {
    const fromId = ctx.from?.id;
    if (!fromId) return;
    const user = await resolveLinkedUser(fromId);
    const { locale, messages } = await workdayCopy(user);
    const commonT = createTranslator({ locale, messages, namespace: "telegramWorkday.common" });
    const t = createTranslator({ locale, messages, namespace: "telegramWorkday.digest" });
    if (!botCallbackRateLimiter.consume(`${fromId}:digest-refresh`)) {
      await ctx.answerCallbackQuery({
        text: commonT("tooManyClicks"),
      });
      return;
    }
    if (!user) {
      await ctx.answerCallbackQuery({
        text: commonT("chatNotLinked"),
        show_alert: true,
      });
      return;
    }
    const obligations = await listOpenJournalObligationsForUser(user.id);
    const miniAppBaseUrl = getMiniAppBaseUrlFromEnv();
    const presentation = {
      openCount: (count: number) => t("openCount", { count }),
      nextAction: (title: string) => t("nextAction", { title }),
      noNextAction: t("noNextAction"),
      todayHeading: t("todayHeading"),
      obligationLine: (values: { title: string; location: string; description: string }) => t("obligationLine", values),
      locationSuffix: (building: string) => t("locationSuffix", { building }),
      descriptionSuffix: (description: string) => t("descriptionSuffix", { description }),
      moreCount: (count: number) => t("moreCount", { count }),
      openTask: t("openTask"),
      openJournals: t("openJournals"),
    };
    const digest = buildStaffObligationDigest({
      userId: user.id,
      openObligations: obligations,
      miniAppBaseUrl,
      presentation,
    });
    if (!digest) {
      // Все задачи закрыты — заменяем body на success + убираем
      // refresh/snooze кнопки (нечего обновлять).
      const successText = t.markup("allDone", {
        greeting: localizedGreeting(locale, messages),
        name: localizedFirstName(locale, messages, user.name),
        b: (chunks: string) => `<b>${chunks}</b>`,
      });
      try {
        await ctx.editMessageText(successText, {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
          reply_markup: undefined,
        });
      } catch {
        /* старое сообщение */
      }
      await ctx.answerCallbackQuery({ text: t("allDoneCallback") });
      return;
    }
    const body = digest.body
      .replace("{greeting}", localizedGreeting(locale, messages))
      .replace("{name}", localizedFirstName(locale, messages, user.name));
    const rows: Array<Array<Record<string, unknown>>> = [];
    if (digest.primaryCta) {
      rows.push([
        {
          text: digest.primaryCta.label,
          web_app: { url: digest.primaryCta.url },
        },
      ]);
    }
    rows.push([
      { text: t("refresh"), callback_data: "digest:refresh" },
      { text: t("snooze"), callback_data: "notif:snooze:60" },
    ]);
    try {
      await ctx.editMessageText(body, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        reply_markup: { inline_keyboard: rows } as Parameters<
          typeof ctx.editMessageText
        >[1] extends { reply_markup?: infer T }
          ? T
          : never,
      });
    } catch {
      /* old message */
    }
    await ctx.answerCallbackQuery({
      text: t("openCallbackCount", { count: obligations.length }),
    });
  });

  // Callback `notif:snooze:<minutes>` — пользователь нажал «Отложить»
  // на push'е. Записываем `notificationPrefs.snoozedUntil = now + minutes`,
  // notifyEmployee увидит этот флаг и пропустит будущие отправки.
  composer.callbackQuery(/^notif:snooze:(\d+)$/, async (ctx) => {
    const fromId = ctx.from?.id;
    if (!fromId) return;
    const user = await resolveLinkedUser(fromId);
    const { locale, messages } = await workdayCopy(user);
    const commonT = createTranslator({ locale, messages, namespace: "telegramWorkday.common" });
    const digestT = createTranslator({ locale, messages, namespace: "telegramWorkday.digest" });
    if (!botCallbackRateLimiter.consume(`${fromId}:notif:snooze`)) {
      await ctx.answerCallbackQuery({
        text: commonT("tooManyClicks"),
        show_alert: false,
      });
      return;
    }
    const rawMinutes = Number(ctx.match[1]);
    if (!Number.isFinite(rawMinutes)) return;
    const minutes = Math.min(24 * 60, Math.max(1, rawMinutes));
    if (!user) {
      await ctx.answerCallbackQuery({
        text: commonT("chatNotLinked"),
        show_alert: true,
      });
      return;
    }
    const snoozedUntil = new Date(Date.now() + minutes * 60 * 1000);
    const existing = await db.user.findUnique({
      where: { id: user.id },
      select: { notificationPrefs: true },
    });
    const prefs =
      (existing?.notificationPrefs as Record<string, unknown> | null) ?? {};
    await db.user.update({
      where: { id: user.id },
      data: {
        notificationPrefs: {
          ...prefs,
          snoozedUntil: snoozedUntil.toISOString(),
        },
      },
    });
    const until = snoozedUntil.toLocaleTimeString(FORMAT_LOCALES[locale], {
      hour: "2-digit",
      minute: "2-digit",
    });
    await ctx.answerCallbackQuery({
      text: digestT("snoozedUntil", { time: until }),
      show_alert: false,
    });
    // Убираем кнопку «Отложить» из исходного сообщения (само сообщение
    // оставляем — пользователь захочет позже к нему вернуться).
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    } catch {
      /* старое или удалённое сообщение — не критично */
    }
  });

  // Callback-handler для inline-кнопок start/end из /shift.
  // Регекспируем именно `shift-tg:` — НЕ `shift:`, потому что
  // shift-gate.ts держит «shift:start» под собой (onboarding —
  // отметка «начал смену», status='scheduled'). Подробнее см. JSDoc
  // выше у buildShiftKeyboard.
  composer.callbackQuery(/^shift-tg:(start|end)$/, async (ctx) => {
    const fromId = ctx.from?.id;
    if (!fromId) return;
    const user = await resolveLinkedUser(fromId);
    const { locale, messages } = await workdayCopy(user);
    const commonT = createTranslator({ locale, messages, namespace: "telegramWorkday.common" });
    const actionT = createTranslator({ locale, messages, namespace: "telegramWorkday.shift.action" });
    if (!botCallbackRateLimiter.consume(`${fromId}:shift-tg`)) {
      await ctx.answerCallbackQuery({
        text: commonT("tooManyClicks"),
        show_alert: false,
      });
      return;
    }
    const action = ctx.match[1] as "start" | "end";
    if (!user) {
      await ctx.answerCallbackQuery({
        text: commonT("chatNotLinked"),
        show_alert: true,
      });
      return;
    }
    const result = await applyShiftAction(user, action);
    const actionMessage = result.message === "started"
      ? actionT("started")
      : result.message === "ended"
        ? actionT("ended")
        : actionT("mustStartFirst");
    await ctx.answerCallbackQuery({
      text: actionMessage,
      show_alert: !result.ok,
    });
    if (!result.ok) return;
    // Обновляем сообщение, чтобы кнопки и статус были актуальные.
    const reply = await buildShiftReply(user);
    try {
      await ctx.editMessageText(reply.text, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        ...(reply.reply_markup ? { reply_markup: reply.reply_markup } : {}),
      });
    } catch {
      // Если editMessageText упал (например сообщение слишком старое или
      // в нём нечего менять — Telegram бросает 400) — просто отправим
      // новый message с актуальным состоянием.
      await ctx.reply(reply.text, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        ...(reply.reply_markup ? { reply_markup: reply.reply_markup } : {}),
      });
    }
  });
}
