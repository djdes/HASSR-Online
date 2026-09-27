import type { Composer, Context } from "grammy";
import type { InlineKeyboardButton } from "grammy/types";
import { db } from "@/lib/db";
import { botCallbackRateLimiter } from "@/lib/rate-limit";
import {
  getMiniAppBaseUrlFromEnv,
  buildMiniAppUrl,
} from "@/lib/journal-obligation-links";
import {
  aclActorFromSession,
  getAllowedJournalCodes,
  hasJournalAccess,
} from "@/lib/journal-acl";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { journalDisplayName } from "@/lib/custom-names";
import { getOrgCustomNames } from "@/lib/org-custom-names";
import { sortJournalsByName } from "@/lib/journal-sort";

/**
 * Bot-driven journal editor navigation.
 *
 * `/edit` (и enhanced `/journals`) открывает inline-меню со всеми доступными
 * пользователю шаблонами журналов. Клик по шаблону показывает активные
 * документы за последнее время + кнопку «Новая запись». Каждая листовая
 * кнопка — web_app-URL на соответствующий экран Mini App, где лежит полный
 * редактор: grid-таблица, инлайн-ячейки, photo upload и т.д. Писать
 * альтернативный редактор в чате никто не будет — 34+ шаблонов журналов
 * каждый со своим набором полей, это чревато багами. Mini App уже всё умеет
 * и именно туда ведут web_app-кнопки.
 *
 * Callback-protocol (`edit:<action>[:<arg>]`):
 *   edit:home          — ре-рендер корневого меню
 *   edit:t:<code>      — документы шаблона <code>
 *   edit:more:<cursor> — следующая страница списка шаблонов (резерв)
 */

const MAX_DOCS_PER_TEMPLATE = 6;
const TEMPLATE_PAGE_SIZE = 30;
const EMOJI_ACTIVE = "📝";
const EMOJI_DOC = "📄";
const EMOJI_NEW = "➕";
const EMOJI_HISTORY = "📋";
const BACK_BUTTON_LABEL = "‹ Назад к журналам";

type InlineKeyboard = { inline_keyboard: InlineKeyboardButton[][] };

type BotUser = {
  id: string;
  role: string;
  isRoot: boolean;
  organizationId: string;
};

async function resolveBotUser(fromId: number | undefined): Promise<BotUser | null> {
  if (!fromId) return null;
  const row = await db.user.findFirst({
    where: { telegramChatId: String(fromId), isActive: true },
    select: {
      id: true,
      role: true,
      isRoot: true,
      organizationId: true,
    },
  });
  if (!row) return null;
  return row as BotUser;
}

async function buildTemplateListView(
  user: BotUser,
  page = 0
): Promise<{ text: string; keyboard: InlineKeyboard } | null> {
  const fakeSession = {
    user: {
      id: user.id,
      role: user.role,
      isRoot: user.isRoot,
    },
  };
  const allowed = await getAllowedJournalCodes(aclActorFromSession(fakeSession));

  const rawTemplates = await db.journalTemplate.findMany({
    where: {
      isActive: true,
      ...(allowed ? { code: { in: allowed } } : {}),
    },
    orderBy: { sortOrder: "asc" },
    select: { code: true, name: true },
  });

  if (rawTemplates.length === 0) {
    return null;
  }
  // Своё название журнала организации — как на сайте и в приложении.
  const customNames = await getOrgCustomNames(user.organizationId);
  // По алфавиту — по тому названию, которое видит организация.
  const templates = sortJournalsByName(rawTemplates, (t) =>
    journalDisplayName(customNames, t.code, t.name)
  );

  const start = page * TEMPLATE_PAGE_SIZE;
  const slice = templates.slice(start, start + TEMPLATE_PAGE_SIZE);
  const hasMore = start + TEMPLATE_PAGE_SIZE < templates.length;
  const hasPrev = page > 0;

  const rows: InlineKeyboardButton[][] = slice.map((t) => [
    {
      text: `${EMOJI_ACTIVE} ${journalDisplayName(customNames, t.code, t.name)}`,
      callback_data: `edit:t:${t.code}`,
    },
  ]);

  if (hasPrev || hasMore) {
    const nav: InlineKeyboardButton[] = [];
    if (hasPrev) {
      nav.push({
        text: "‹ Предыдущие",
        callback_data: `edit:page:${page - 1}`,
      });
    }
    if (hasMore) {
      nav.push({
        text: "Следующие ›",
        callback_data: `edit:page:${page + 1}`,
      });
    }
    rows.push(nav);
  }

  const totalLabel = allowed
    ? ` (доступно ${templates.length})`
    : ` (всего ${templates.length})`;
  const text =
    `<b>Журналы</b>${totalLabel}\n` +
    `Выберите журнал, чтобы открыть документы или создать запись. ` +
    `Каждая кнопка откроет редактор прямо в Telegram.`;

  return { text, keyboard: { inline_keyboard: rows } };
}

async function buildTemplateDocumentsView(
  user: BotUser,
  code: string,
  miniAppBaseUrl: string | null
): Promise<{ text: string; keyboard: InlineKeyboard } | null> {
  const template = await db.journalTemplate.findUnique({
    where: { code },
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
    },
  });
  if (!template) return null;

  // ACL check — employees без canRead не должны даже видеть чужие шаблоны.
  const allowed = await hasJournalAccess(
    aclActorFromSession({
      user: { id: user.id, role: user.role, isRoot: user.isRoot },
    }),
    template.code
  );
  if (!allowed) return null;

  const documents = await db.journalDocument.findMany({
    where: {
      organizationId: user.organizationId,
      templateId: template.id,
      status: "active",
    },
    orderBy: [{ dateFrom: "desc" }, { createdAt: "desc" }],
    take: MAX_DOCS_PER_TEMPLATE,
    select: {
      id: true,
      title: true,
      dateFrom: true,
      dateTo: true,
    },
  });

  const rows: InlineKeyboardButton[][] = [];

  // Основные документы — каждый открывает grid-редактор в Mini App.
  for (const doc of documents) {
    const url = buildMiniAppUrl(
      miniAppBaseUrl,
      `/mini/documents/${doc.id}`
    );
    if (!url) continue;
    const period = formatDocPeriod(doc.dateFrom, doc.dateTo);
    const titleSuffix = period ? ` · ${period}` : "";
    rows.push([
      {
        text: `${EMOJI_DOC} ${truncate(doc.title, 40)}${titleSuffix}`,
        web_app: { url },
      },
    ]);
  }

  // Быстрый path: новая запись + вся история журнала.
  const newUrl = buildMiniAppUrl(
    miniAppBaseUrl,
    `/mini/journals/${template.code}/new`
  );
  const listUrl = buildMiniAppUrl(
    miniAppBaseUrl,
    `/mini/journals/${template.code}`
  );

  if (newUrl) {
    rows.push([
      {
        text: `${EMOJI_NEW} Новая запись`,
        web_app: { url: newUrl },
      },
    ]);
  }
  if (listUrl) {
    rows.push([
      {
        text: `${EMOJI_HISTORY} Все записи журнала`,
        web_app: { url: listUrl },
      },
    ]);
  }

  rows.push([
    {
      text: BACK_BUTTON_LABEL,
      callback_data: "edit:home",
    },
  ]);

  const managerHint = hasFullWorkspaceAccess({
    role: user.role,
    isRoot: user.isRoot,
  })
    ? ""
    : "\n<i>Видны только ваши документы — ACL.</i>";

  const docLine = documents.length
    ? `Активных документов: ${documents.length}${
        documents.length >= MAX_DOCS_PER_TEMPLATE ? "+" : ""
      }.`
    : "Пока нет активных документов — нажмите «Новая запись».";

  const journalName = journalDisplayName(
    await getOrgCustomNames(user.organizationId),
    template.code,
    template.name
  );
  const text =
    `<b>${escapeHtml(journalName)}</b>\n` +
    `${escapeHtml(template.description ?? "")}\n\n${docLine}${managerHint}`;

  return { text, keyboard: { inline_keyboard: rows } };
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}

function formatDocPeriod(from: Date, to: Date): string {
  const fmt = (d: Date) => {
    const day = String(d.getDate()).padStart(2, "0");
    const mon = String(d.getMonth() + 1).padStart(2, "0");
    return `${day}.${mon}`;
  };
  // Один день — показываем одну дату.
  if (
    from.getFullYear() === to.getFullYear() &&
    from.getMonth() === to.getMonth() &&
    from.getDate() === to.getDate()
  ) {
    return fmt(from);
  }
  return `${fmt(from)}–${fmt(to)}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function safeEditMessage(
  ctx: Context,
  text: string,
  keyboard: InlineKeyboard
): Promise<void> {
  try {
    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: keyboard,
    });
  } catch (err) {
    // Telegram возвращает 400 «message is not modified» при double-click
    // на ту же кнопку. Не критично, игнорируем.
    const message = err instanceof Error ? err.message : String(err);
    if (!/not modified/i.test(message)) {
      console.error("[edit] editMessageText failed:", message);
    }
  }
}

async function replyUnlinked(ctx: Context): Promise<void> {
  await ctx.reply(
    "⛔️ Этот Telegram не привязан к сотруднику WeSetup. Попросите менеджера выслать приглашение.",
    { parse_mode: "HTML" }
  );
}

export function registerEditHandlers(composer: Composer<Context>): void {
  composer.command("edit", async (ctx) => {
    const user = await resolveBotUser(ctx.from?.id);
    if (!user) return replyUnlinked(ctx);

    const view = await buildTemplateListView(user);
    if (!view) {
      await ctx.reply(
        "Ни одного журнала не доступно. Обратитесь к менеджеру."
      );
      return;
    }

    await ctx.reply(view.text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: view.keyboard,
    });
  });

  composer.callbackQuery(/^edit:home$/, async (ctx) => {
    const fromId = ctx.from?.id;
    if (!fromId) return;
    if (!botCallbackRateLimiter.consume(`${fromId}:edit-home`)) {
      await ctx.answerCallbackQuery({ text: "Слишком много кликов" });
      return;
    }
    const user = await resolveBotUser(fromId);
    if (!user) {
      await ctx.answerCallbackQuery({
        text: "Telegram не привязан",
        show_alert: true,
      });
      return;
    }
    const view = await buildTemplateListView(user);
    if (!view) {
      await ctx.answerCallbackQuery({
        text: "Нет доступных журналов",
        show_alert: true,
      });
      return;
    }
    await safeEditMessage(ctx, view.text, view.keyboard);
    await ctx.answerCallbackQuery();
  });

  composer.callbackQuery(/^edit:page:(\d+)$/, async (ctx) => {
    const fromId = ctx.from?.id;
    if (!fromId) return;
    if (!botCallbackRateLimiter.consume(`${fromId}:edit-page`)) {
      await ctx.answerCallbackQuery({ text: "Слишком много кликов" });
      return;
    }
    const user = await resolveBotUser(fromId);
    if (!user) {
      await ctx.answerCallbackQuery({ text: "Telegram не привязан" });
      return;
    }
    // Bound page между 0 и 100 — защита от amplification-DDoS:
    // edit:page:9999999999 → page=9999999999 → бесплатный full
    // findMany + ACL resolve. Pass-3 HIGH #9.
    const rawPage = parseInt(ctx.match?.[1] ?? "0", 10);
    const page = Number.isFinite(rawPage)
      ? Math.max(0, Math.min(100, rawPage))
      : 0;
    const view = await buildTemplateListView(user, page);
    if (!view) {
      await ctx.answerCallbackQuery({ text: "Нет данных" });
      return;
    }
    await safeEditMessage(ctx, view.text, view.keyboard);
    await ctx.answerCallbackQuery();
  });

  // Tight regex: journal codes — snake_case ≤ 40 chars (см. ACTIVE_JOURNAL_CATALOG).
  // `(.+)` принимал бы любые байты, что не SQL-injection (Prisma параметризует),
  // но даёт DDoS-amplification — каждый callback запускает findUnique по
  // arbitrary code. Pass-3 HIGH #10.
  composer.callbackQuery(/^edit:t:([a-z_]{1,40})$/, async (ctx) => {
    const fromId = ctx.from?.id;
    if (!fromId) return;
    if (!botCallbackRateLimiter.consume(`${fromId}:edit-t`)) {
      await ctx.answerCallbackQuery({ text: "Слишком много кликов" });
      return;
    }
    const user = await resolveBotUser(fromId);
    if (!user) {
      await ctx.answerCallbackQuery({
        text: "Telegram не привязан",
        show_alert: true,
      });
      return;
    }
    const code = ctx.match?.[1];
    if (!code) {
      await ctx.answerCallbackQuery({ text: "Нет кода журнала" });
      return;
    }

    const miniAppBaseUrl = getMiniAppBaseUrlFromEnv();
    const view = await buildTemplateDocumentsView(
      user,
      code,
      miniAppBaseUrl
    );
    if (!view) {
      await ctx.answerCallbackQuery({
        text: "Журнал недоступен",
        show_alert: true,
      });
      return;
    }

    await safeEditMessage(ctx, view.text, view.keyboard);
    await ctx.answerCallbackQuery();
  });
}
