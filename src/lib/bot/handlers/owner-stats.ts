import type { Composer, Context } from "grammy";
import type { ReactNode } from "react";
import { db } from "@/lib/db";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { scopedManagerObligationSummary } from "@/lib/bot/scoped-obligation-summary";
import { escapeTelegramHtml as esc } from "@/lib/telegram";
import { getOrgCustomNames } from "@/lib/org-custom-names";
import { createTranslator } from "use-intl/core";
import { resolveLocale, FORMAT_LOCALES, type Locale } from "@/i18n/locales";
import { loadMessages } from "@/i18n/messages";
import { journalTitle } from "@/i18n/journal-presentation";
import { customJournalName } from "@/lib/custom-names";
import ruMessages from "@/i18n/messages/ru.json";
import {
  documentWorkerScopeWhere,
  loadManagerPointScope,
  loadScopeAreaIds,
  lossWorkerScopeWhere,
  personWorkerScopeWhere,
  type WorkerPointScope,
} from "@/lib/worker-point-scope";

/**
 * Команды бота для руководителя (manager / head_chef / owner / technologist /
 * ROOT). Все четыре команды отдают краткую сводку в чат — без web-app
 * кнопок, чтобы пользователь не уходил из чата для базового контроля.
 *
 *   /today    → «X / Y журналов заполнено сегодня».
 *   /missing  → список незаполненных журналов.
 *   /capa     → количество и пара примеров открытых CAPA-тикетов.
 *   /stats    → 7-дневный график выполнения (text-only).
 *
 * Авторизация: бот узнаёт организацию по `User.telegramChatId`. Если
 * чат не привязан или пользователь — линейный сотрудник без management-
 * роли, отвечаем вежливым отказом.
 */

type ManagementUser = {
  id: string;
  name: string | null;
  organizationId: string;
  role: string;
  isRoot: boolean;
};

/**
 * `scope` — точки, которые руководитель видит (аудит 2026-11-01): руководитель
 * точки получает сводки только по своим точкам и своим людям, руководитель
 * офиса и без точек — по всей компании (null).
 */
type ManagerCommandContext = { user: ManagementUser | null; locale: Locale; scope: WorkerPointScope };

async function resolveManagerCommandContext(
  chatId: number | string | undefined
): Promise<ManagerCommandContext> {
  if (chatId === undefined || chatId === null) return { user: null, locale: "ru", scope: null };
  const candidate = await db.user.findFirst({
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
  const locale = resolveLocale({
    authenticated: Boolean(candidate),
    userLocale: candidate?.locale,
    organizationLocale: candidate?.organization.locale,
  });
  if (!candidate || !hasFullWorkspaceAccess(candidate)) return { user: null, locale, scope: null };
  return {
    scope: await loadManagerPointScope(candidate.organizationId, candidate.id),
    user: {
      id: candidate.id,
      name: candidate.name,
      organizationId: candidate.organizationId,
      role: candidate.role,
      isRoot: candidate.isRoot,
    },
    locale,
  };
}

async function managerTranslator(locale: Locale) {
  const messages = await loadMessages(locale);
  return createTranslator({
    locale,
    messages,
    namespace: "telegramManagerSummary",
    onError: (error) => { throw error; },
  });
}

async function managerOperationsTranslator(locale: Locale) {
  const messages = await loadMessages(locale);
  return createTranslator({
    locale,
    messages,
    namespace: "telegramManagerOperations",
    onError: (error) => { throw error; },
  });
}

function richTelegramText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((part) => typeof part === "string" || typeof part === "number")) {
    return value.join("");
  }
  throw new Error("Telegram rich message did not resolve to plain HTML text");
}

async function replyNotAuthorized(ctx: Context, locale?: Locale): Promise<void> {
  const text = locale
    ? (await managerTranslator(locale))("common.notAuthorized")
    : "🔒 Эта команда — для руководителей. Если вы менеджер/owner и видите это сообщение, значит ваш Telegram-чат пока не привязан к рабочему аккаунту. Откройте /settings/notifications в кабинете и привяжите его.";
  await ctx.reply(
    text,
    { parse_mode: "HTML", link_preview_options: { is_disabled: true } }
  );
}

function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function formatManagerDate(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(FORMAT_LOCALES[locale], {
    day: "2-digit",
    month: "long",
  }).format(date);
}

function greetingKey(now: Date): "greetingNight" | "greetingMorning" | "greetingDay" | "greetingEvening" {
  const hour = now.getHours();
  if (hour < 6) return "greetingNight";
  if (hour < 12) return "greetingMorning";
  if (hour < 18) return "greetingDay";
  return "greetingEvening";
}

export function registerOwnerStatsHandlers(composer: Composer<Context>): void {
  // /today — общий процент выполнения сегодня.
  composer.command("today", async (ctx) => {
    const { user, locale, scope } = await resolveManagerCommandContext(ctx.from?.id);
    const t = await managerTranslator(locale);
    if (!user) return replyNotAuthorized(ctx, locale);

    const now = new Date();
    const summary = await scopedManagerObligationSummary(user.organizationId, now, scope);
    const pct = summary.total === 0
      ? 0
      : Math.round((summary.done / summary.total) * 100);

    const firstName = user.name?.trim().split(/\s+/)[0] || t("common.fallbackName");
    const greeting = {
      greetingNight: t("common.greetingNight"),
      greetingMorning: t("common.greetingMorning"),
      greetingDay: t("common.greetingDay"),
      greetingEvening: t("common.greetingEvening"),
    }[greetingKey(now)];
    const lines = [
      richTelegramText(t.rich("today.greeting", {
        greeting,
        name: esc(firstName),
        b: (children) => `<b>${String(children)}</b>`,
      })),
      "",
      t("today.dateHeading", { date: formatManagerDate(now, locale) }),
      richTelegramText(t.rich("today.completed", {
        done: summary.done,
        total: summary.total,
        percentage: pct,
        b: (children) => `<b>${String(children)}</b>`,
      })),
      richTelegramText(t.rich("today.pending", {
        count: summary.pending,
        b: (children) => `<b>${String(children)}</b>`,
      })),
      t("today.employeesWithPending", { count: summary.employeesWithPending }),
    ];
    await ctx.reply(lines.join("\n"), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  });

  // /missing — что не заполнено.
  composer.command("missing", async (ctx) => {
    const { user, locale, scope } = await resolveManagerCommandContext(ctx.from?.id);
    const t = await managerTranslator(locale);
    if (!user) return replyNotAuthorized(ctx, locale);

    const now = new Date();
    const dateKey = utcDayStart(now);
    const pending = await db.journalObligation.findMany({
      where: {
        organizationId: user.organizationId,
        dateKey,
        status: "pending",
        ...documentWorkerScopeWhere(scope),
        ...(scope ? { user: personWorkerScopeWhere(scope) } : {}),
      },
      select: {
        userId: true,
        template: { select: { name: true, code: true } },
        user: { select: { name: true } },
      },
      orderBy: [{ template: { name: "asc" } }, { user: { name: "asc" } }],
      take: 20,
    });

    if (pending.length === 0) {
      await ctx.reply(
        richTelegramText(t.rich("missing.allComplete", { b: (children) => `<b>${String(children)}</b>` })),
        { parse_mode: "HTML", link_preview_options: { is_disabled: true } }
      );
      return;
    }

    // Своё название журнала организации — как на сайте.
    const customNames = await getOrgCustomNames(user.organizationId);
    const journalNames = (await loadMessages(locale)).journals.names;
    const grouped = new Map<string, string[]>();
    for (const row of pending) {
      const customName = customJournalName(customNames, row.template.code);
      const canonicalName = ruMessages.journals.names[row.template.code as keyof typeof ruMessages.journals.names];
      const key = customName ?? (locale !== "ru" && canonicalName === row.template.name
        ? journalTitle(locale, journalNames, row.template.code, row.template.name)
        : row.template.name);
      const arr = grouped.get(key) ?? [];
      arr.push(row.user.name?.trim() || "—");
      grouped.set(key, arr);
    }
    const lines = [
      richTelegramText(t.rich("missing.heading", {
        count: pending.length,
        b: (children) => `<b>${String(children)}</b>`,
      })),
      "",
      ...Array.from(grouped.entries()).map(([name, users]) => richTelegramText(t.rich("missing.groupLine", {
        journal: esc(name),
        names: new Intl.ListFormat(FORMAT_LOCALES[locale], { style: "long", type: "conjunction" }).format(users.map(esc)),
        b: (children) => `<b>${String(children)}</b>`,
      }))),
    ];
    await ctx.reply(lines.join("\n"), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  });

  // /capa — открытые тикеты.
  composer.command("capa", async (ctx) => {
    const { user, locale, scope } = await resolveManagerCommandContext(ctx.from?.id);
    const t = await managerOperationsTranslator(locale);
    if (!user) return replyNotAuthorized(ctx, locale);

    const tickets = await db.capaTicket.findMany({
      where: {
        organizationId: user.organizationId,
        status: { in: ["open", "in_progress"] },
        // CAPA своих точек и общие (2026-11-01).
        ...documentWorkerScopeWhere(scope),
      },
      select: {
        id: true,
        title: true,
        priority: true,
        dueDate: true,
        assignedToId: true,
      },
      orderBy: [{ priority: "desc" }, { dueDate: "asc" }],
      take: 10,
    });
    const assigneeIds = Array.from(
      new Set(tickets.map((t) => t.assignedToId).filter((v): v is string => Boolean(v)))
    );
    const assignees = assigneeIds.length
      ? await db.user.findMany({
          where: { id: { in: assigneeIds } },
          select: { id: true, name: true },
        })
      : [];
    const assigneeNameById = new Map(assignees.map((u) => [u.id, u.name ?? ""]));

    if (tickets.length === 0) {
      await ctx.reply(
        richTelegramText(t.rich("capa.empty", { b: (children) => `<b>${String(children)}</b>` })),
        { parse_mode: "HTML", link_preview_options: { is_disabled: true } }
      );
      return;
    }

    const lines = [
      richTelegramText(t.rich("capa.heading", { count: tickets.length, b: (children) => `<b>${String(children)}</b>` })),
      "",
      ...tickets.map((ticket) => {
        const due = ticket.dueDate
          ? formatManagerDate(ticket.dueDate, locale)
          : t("capa.noDeadline");
        const assignee =
          (ticket.assignedToId && assigneeNameById.get(ticket.assignedToId)?.trim()) ||
          t("capa.unassigned");
        return richTelegramText(t.rich("capa.row", {
          priority: esc(ticket.priority),
          title: esc(ticket.title),
          assignee: esc(assignee),
          due: esc(due),
          b: (children) => `<b>${String(children)}</b>`,
        }));
      }),
    ];
    await ctx.reply(lines.join("\n"), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  });

  // /stats — 7-дневный график.
  composer.command("stats", async (ctx) => {
    const { user, locale, scope } = await resolveManagerCommandContext(ctx.from?.id);
    const t = await managerOperationsTranslator(locale);
    if (!user) return replyNotAuthorized(ctx, locale);

    const now = new Date();
    // ОДИН groupBy на всё окно 7 дней вместо 7 sequential round-trip'ов.
    // Раньше каждое /stats делало 7 query — на 50 одновременных
    // менеджеров это 350 sequential query/sec (Pass-3 MEDIUM #20).
    const weekStart = utcDayStart(new Date(now));
    weekStart.setUTCDate(weekStart.getUTCDate() - 6);
    const grouped = await db.journalObligation.groupBy({
      by: ["dateKey", "status"],
      where: {
        organizationId: user.organizationId,
        dateKey: { gte: weekStart },
        ...documentWorkerScopeWhere(scope),
        ...(scope ? { user: personWorkerScopeWhere(scope) } : {}),
      },
      _count: { _all: true },
    });
    // Build map: ISO-day → {done, pending}
    const byDay = new Map<string, { done: number; pending: number }>();
    for (const row of grouped) {
      const key = row.dateKey.toISOString().slice(0, 10);
      const cur = byDay.get(key) ?? { done: 0, pending: 0 };
      if (row.status === "done") cur.done += row._count._all;
      else if (row.status === "pending") cur.pending += row._count._all;
      byDay.set(key, cur);
    }
    const days: Array<{ date: Date; done: number; total: number }> = [];
    for (let offset = 6; offset >= 0; offset--) {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - offset);
      const dayStart = utcDayStart(d);
      const key = dayStart.toISOString().slice(0, 10);
      const stats = byDay.get(key) ?? { done: 0, pending: 0 };
      days.push({
        date: dayStart,
        done: stats.done,
        total: stats.done + stats.pending,
      });
    }

    const dayLabels = {
      0: t("stats.weekdays.sun"),
      1: t("stats.weekdays.mon"),
      2: t("stats.weekdays.tue"),
      3: t("stats.weekdays.wed"),
      4: t("stats.weekdays.thu"),
      5: t("stats.weekdays.fri"),
      6: t("stats.weekdays.sat"),
    } as const;
    const totalDone = days.reduce((sum, d) => sum + d.done, 0);
    const totalAll = days.reduce((sum, d) => sum + d.total, 0);
    const weekPct = totalAll === 0 ? 0 : Math.round((totalDone / totalAll) * 100);

    const lines = [
      richTelegramText(t.rich("stats.heading", { b: (children) => `<b>${String(children)}</b>` })),
      "",
      richTelegramText(t.rich("stats.total", {
        done: totalDone, total: totalAll, percentage: weekPct,
        b: (children) => `<b>${String(children)}</b>`,
      })),
      "",
      ...days.map((d) => {
        const pct = d.total === 0 ? 0 : Math.round((d.done / d.total) * 100);
        const bar = bar10(pct);
        return t("stats.dayLine", {
          weekday: dayLabels[d.date.getUTCDay() as keyof typeof dayLabels],
          date: formatManagerDate(d.date, locale).padEnd(10),
          bar,
          percentage: pct,
        });
      }),
    ];
    await ctx.reply(`<pre>${lines.join("\n")}</pre>`, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  });
}

function bar10(pct: number): string {
  const filled = Math.round((Math.max(0, Math.min(100, pct)) / 100) * 10);
  return "█".repeat(filled) + "·".repeat(10 - filled);
}

/**
 * Расширение команд для рук-ва: /losses /batches /staff. Регистрируется
 * тем же composer'ом что и /today/missing/capa/stats.
 */
export function registerOwnerExtendedHandlers(composer: Composer<Context>): void {
  // /losses — последние списания.
  composer.command("losses", async (ctx) => {
    const { user, locale, scope } = await resolveManagerCommandContext(ctx.from?.id);
    const t = await managerOperationsTranslator(locale);
    if (!user) return replyNotAuthorized(ctx, locale);

    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 7);
    const areaIds = await loadScopeAreaIds(user.organizationId, scope);
    const losses = await db.lossRecord.findMany({
      where: { organizationId: user.organizationId, date: { gte: since }, ...lossWorkerScopeWhere(scope, areaIds) },
      orderBy: { date: "desc" },
      take: 10,
      select: {
        id: true,
        date: true,
        category: true,
        productName: true,
        quantity: true,
        unit: true,
        costRub: true,
      },
    });

    if (losses.length === 0) {
      await ctx.reply(
        richTelegramText(t.rich("losses.empty", { b: (children) => `<b>${String(children)}</b>` })),
        { parse_mode: "HTML", link_preview_options: { is_disabled: true } }
      );
      return;
    }

    const totalCost = losses.reduce((s, l) => s + (l.costRub ?? 0), 0);
    const lines = [
      richTelegramText(t.rich("losses.heading", { count: losses.length, b: (children) => `<b>${String(children)}</b>` })),
      totalCost > 0 ? richTelegramText(t.rich("losses.weeklyTotal", {
        amount: Number(totalCost.toFixed(0)), b: (children) => `<b>${String(children)}</b>`,
      })) : "",
      "",
      ...losses.map((l) => {
        const params = {
          date: formatManagerDate(l.date, locale),
          product: esc(l.productName),
          quantity: String(l.quantity),
          unit: esc(l.unit),
          category: esc(l.category),
          amount: Number((l.costRub ?? 0).toFixed(0)),
          b: (children: ReactNode) => `<b>${String(children)}</b>`,
        };
        return l.costRub
          ? richTelegramText(t.rich("losses.rowWithCost", params))
          : richTelegramText(t.rich("losses.row", params));
      }),
    ].filter(Boolean);
    await ctx.reply(lines.join("\n"), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  });

  // /batches — активные партии.
  composer.command("batches", async (ctx) => {
    const { user, locale, scope } = await resolveManagerCommandContext(ctx.from?.id);
    const t = await managerOperationsTranslator(locale);
    if (!user) return replyNotAuthorized(ctx, locale);

    const batches = await db.batch.findMany({
      where: {
        organizationId: user.organizationId,
        status: { in: ["received", "in_use"] },
        // Партии своих точек и общие (2026-11-01).
        ...documentWorkerScopeWhere(scope),
      },
      orderBy: [{ expiryDate: "asc" }, { receivedAt: "desc" }],
      take: 15,
      select: {
        id: true,
        code: true,
        productName: true,
        supplier: true,
        quantity: true,
        unit: true,
        expiryDate: true,
        status: true,
      },
    });

    if (batches.length === 0) {
      await ctx.reply(
        richTelegramText(t.rich("batches.empty", { b: (children) => `<b>${String(children)}</b>` })),
        { parse_mode: "HTML", link_preview_options: { is_disabled: true } }
      );
      return;
    }

    const now = new Date();
    const lines = [
      richTelegramText(t.rich("batches.heading", { count: batches.length, b: (children) => `<b>${String(children)}</b>` })),
      "",
      ...batches.map((b) => {
        const date = b.expiryDate ? formatManagerDate(b.expiryDate, locale) : "";
        const expiry = b.expiryDate
          ? (b.expiryDate < now ? t("batches.overdue", { date }) : date)
          : t("batches.noExpiry");
        const params = {
          batchCode: esc(b.code), product: esc(b.productName),
          quantity: String(b.quantity), unit: esc(b.unit), expiry: esc(expiry),
          b: (children: ReactNode) => `<b>${String(children)}</b>`,
          code: (children: ReactNode) => `<code>${String(children)}</code>`,
        };
        return b.supplier?.trim()
          ? richTelegramText(t.rich("batches.rowWithSupplier", { ...params, supplier: esc(b.supplier) }))
          : richTelegramText(t.rich("batches.row", params));
      }),
    ];
    await ctx.reply(lines.join("\n"), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  });

  // /staff — кто сегодня на смене.
  composer.command("staff", async (ctx) => {
    const { user, locale, scope } = await resolveManagerCommandContext(ctx.from?.id);
    const t = await managerTranslator(locale);
    if (!user) return replyNotAuthorized(ctx, locale);

    const today = utcDayStart(new Date());
    const shifts = await db.workShift.findMany({
      where: { organizationId: user.organizationId, date: today, ...(scope ? { user: personWorkerScopeWhere(scope) } : {}) },
      select: {
        status: true,
        user: { select: { name: true } },
        jobPosition: { select: { name: true } },
      },
      orderBy: [{ status: "asc" }, { user: { name: "asc" } }],
    });

    if (shifts.length === 0) {
      await ctx.reply(
        richTelegramText(t.rich("staff.noShifts", { b: (children) => `<b>${String(children)}</b>` })),
        { parse_mode: "HTML", link_preview_options: { is_disabled: true } }
      );
      return;
    }

    const grouped: Record<string, string[]> = {};
    for (const s of shifts) {
      const status = s.status;
      const line = `${esc(s.user.name?.trim() || "—")}${
        s.jobPosition?.name ? ` · ${esc(s.jobPosition.name)}` : ""
      }`;
      grouped[status] = grouped[status] ?? [];
      grouped[status].push(line);
    }
    const STATUS_LABELS: Record<string, string> = {
      working: t("staff.status.working"),
      scheduled: t("staff.status.scheduled"),
      ended: t("staff.status.ended"),
      absent: t("staff.status.absent"),
      off: t("staff.status.off"),
      vacation: t("staff.status.vacation"),
      sick: t("staff.status.sick"),
    };
    const order = ["working", "scheduled", "ended", "absent", "off", "vacation", "sick"];
    const lines = [richTelegramText(t.rich("staff.heading", {
      count: shifts.length,
      b: (children) => `<b>${String(children)}</b>`,
    })), ""];
    for (const status of order) {
      const arr = grouped[status];
      if (!arr || arr.length === 0) continue;
      lines.push(`<b>${STATUS_LABELS[status] ?? esc(status)}</b>`);
      lines.push(...arr.map((l) => `• ${l}`));
      lines.push("");
    }
    // Также неизвестные статусы (если кто-то прошёл миграцию).
    for (const [status, arr] of Object.entries(grouped)) {
      if (order.includes(status)) continue;
      lines.push(`<b>${esc(status)}</b>`);
      lines.push(...arr.map((l) => `• ${l}`));
      lines.push("");
    }
    await ctx.reply(lines.join("\n").trim(), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  });

  // /who_late — кто на смене (status='working') но без journal-активности
  // последние 2 часа. Это «рука помощи» для управляющего: ОДНОЙ командой
  // увидеть кому нужно позвонить или зайти проверить, без открытия Mini App.
  // Перекликается с shift-watcher cron'ом, но on-demand: менеджер хочет
  // сразу узнать состояние, не ждать следующего cron-tick'а.
  composer.command("who_late", async (ctx) => {
    const { user, locale, scope } = await resolveManagerCommandContext(ctx.from?.id);
    const t = await managerTranslator(locale);
    if (!user) return replyNotAuthorized(ctx, locale);

    const now = new Date();
    const today = utcDayStart(now);
    // Все активные смены сегодня в орге (руководителю точки — его людей).
    const shifts = await db.workShift.findMany({
      where: {
        organizationId: user.organizationId,
        date: today,
        status: { in: ["working", "scheduled"] },
        ...(scope ? { user: personWorkerScopeWhere(scope) } : {}),
      },
      select: {
        id: true,
        userId: true,
        status: true,
        user: { select: { name: true } },
      },
    });
    if (shifts.length === 0) {
      await ctx.reply(
        richTelegramText(t.rich("whoLate.noActiveShifts", { b: (children) => `<b>${String(children)}</b>` })),
        { parse_mode: "HTML", link_preview_options: { is_disabled: true } }
      );
      return;
    }

    // Activity threshold = 2h. За последние 2 часа была ли запись?
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const userIds = shifts.map((s) => s.userId);
    const recentActivity = await db.journalEntry.findMany({
      where: {
        organizationId: user.organizationId,
        filledById: { in: userIds },
        createdAt: { gte: twoHoursAgo },
      },
      select: { filledById: true },
      distinct: ["filledById"],
    });
    const activeUserIds = new Set(
      recentActivity
        .map((r) => r.filledById)
        .filter((id): id is string => Boolean(id))
    );

    const late = shifts.filter((s) => !activeUserIds.has(s.userId));
    if (late.length === 0) {
      await ctx.reply(
        richTelegramText(t.rich("whoLate.allPresent", { b: (children) => `<b>${String(children)}</b>` })),
        { parse_mode: "HTML", link_preview_options: { is_disabled: true } }
      );
      return;
    }

    const STATUS_LABEL: Record<string, string> = {
      scheduled: t("whoLate.status.scheduled"),
      working: t("whoLate.status.working"),
    };
    const lines = [
      richTelegramText(t.rich("whoLate.heading", {
        count: late.length,
        b: (children) => `<b>${String(children)}</b>`,
      })),
      t("whoLate.description"),
      "",
      ...late.map((s) => {
        const name = s.user.name?.trim() || "—";
        const label = STATUS_LABEL[s.status] ?? s.status;
        return `• <b>${esc(name)}</b> — ${esc(label)}`;
      }),
      "",
      t("whoLate.closing"),
    ];
    await ctx.reply(lines.join("\n"), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  });

  // /health — diagnostic для admin'а / ROOT'а. Показывает последний
  // build sha + время + Telegram API latency. Polly-pinch для on-call:
  // когда пользователи жалуются «бот не отвечает», admin спрашивает
  // /health в DM и видит все signals в одном сообщении.
  composer.command("health", async (ctx) => {
    const { user, locale } = await resolveManagerCommandContext(ctx.from?.id);
    const t = await managerOperationsTranslator(locale);
    if (!user) return replyNotAuthorized(ctx, locale);

    const startMe = Date.now();
    let getMeStatus = "ok";
    let getMeLatencyMs = 0;
    let botUsername = "?";
    try {
      const me = await ctx.api.getMe();
      botUsername = me.username ?? "?";
      getMeLatencyMs = Date.now() - startMe;
    } catch (err) {
      getMeStatus = err instanceof Error ? err.message.slice(0, 80) : "error";
      getMeLatencyMs = Date.now() - startMe;
    }

    // Build sha и time запекаются в env при build'е (next.config.ts
    // → NEXT_PUBLIC_BUILD_ID). На server-side доступны через process.env.
    const buildId = process.env.NEXT_PUBLIC_BUILD_ID || "unknown";
    const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME || "unknown";

    // Один simple DB-ping чтобы убедиться что Prisma жива.
    let dbStatus = "ok";
    let dbLatencyMs = 0;
    const startDb = Date.now();
    try {
      await db.$queryRaw`SELECT 1`;
      dbLatencyMs = Date.now() - startDb;
    } catch (err) {
      dbStatus = err instanceof Error ? err.message.slice(0, 80) : "error";
      dbLatencyMs = Date.now() - startDb;
    }

    const lines = [
      richTelegramText(t.rich("health.heading", { b: (children) => `<b>${String(children)}</b>` })),
      "",
      richTelegramText(t.rich("health.build", {
        buildId: esc(buildId), b: (children) => `<b>${String(children)}</b>`,
        code: (children) => `<code>${String(children)}</code>`,
      })),
      richTelegramText(t.rich("health.builtAt", {
        buildTime: esc(buildTime), b: (children) => `<b>${String(children)}</b>`,
      })),
      "",
      richTelegramText(t.rich("health.botApi", {
        icon: getMeStatus === "ok" ? "✅" : "❌", status: esc(getMeStatus), latency: getMeLatencyMs,
        b: (children) => `<b>${String(children)}</b>`,
      })),
      richTelegramText(t.rich("health.botUsername", {
        username: esc(botUsername), b: (children) => `<b>${String(children)}</b>`,
      })),
      "",
      richTelegramText(t.rich("health.database", {
        icon: dbStatus === "ok" ? "✅" : "❌", status: esc(dbStatus), latency: dbLatencyMs,
        b: (children) => `<b>${String(children)}</b>`,
      })),
    ];
    await ctx.reply(lines.join("\n"), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  });
}
