import type { Composer, Context } from "grammy";
import { db } from "@/lib/db";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { getManagerObligationSummary } from "@/lib/journal-obligations";
import { escapeTelegramHtml as esc, personalizeMessage } from "@/lib/telegram";
import { journalDisplayName } from "@/lib/custom-names";
import { getOrgCustomNames } from "@/lib/org-custom-names";

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

async function resolveManagementUser(
  chatId: number | string | undefined
): Promise<ManagementUser | null> {
  if (chatId === undefined || chatId === null) return null;
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
    },
  });
  if (!candidate) return null;
  if (!hasFullWorkspaceAccess(candidate)) return null;
  return candidate;
}

async function replyNotAuthorized(ctx: Context): Promise<void> {
  await ctx.reply(
    "🔒 Эта команда — для руководителей. Если вы менеджер/owner и видите это сообщение, значит ваш Telegram-чат пока не привязан к рабочему аккаунту. Откройте /settings/notifications в кабинете и привяжите его.",
    { parse_mode: "HTML", link_preview_options: { is_disabled: true } }
  );
}

function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function formatDateRu(date: Date): string {
  return date.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "long",
  });
}

export function registerOwnerStatsHandlers(composer: Composer<Context>): void {
  // /today — общий процент выполнения сегодня.
  composer.command("today", async (ctx) => {
    const user = await resolveManagementUser(ctx.from?.id);
    if (!user) return replyNotAuthorized(ctx);

    const now = new Date();
    const summary = await getManagerObligationSummary(user.organizationId, now);
    const pct = summary.total === 0
      ? 0
      : Math.round((summary.done / summary.total) * 100);

    const lines = [
      personalizeMessage("📋 <b>{greeting}, {name}!</b>", { name: user.name }),
      "",
      `Сегодня (${formatDateRu(now)}):`,
      `• Заполнено: <b>${summary.done}</b> / ${summary.total} (${pct}%)`,
      `• Осталось: <b>${summary.pending}</b>`,
      `• Сотрудников с открытыми задачами: ${summary.employeesWithPending}`,
    ];
    await ctx.reply(lines.join("\n"), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  });

  // /missing — что не заполнено.
  composer.command("missing", async (ctx) => {
    const user = await resolveManagementUser(ctx.from?.id);
    if (!user) return replyNotAuthorized(ctx);

    const now = new Date();
    const dateKey = utcDayStart(now);
    const pending = await db.journalObligation.findMany({
      where: {
        organizationId: user.organizationId,
        dateKey,
        status: "pending",
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
        "✅ <b>Все журналы заполнены</b>\nНа сегодня нет открытых задач — отличная работа смене.",
        { parse_mode: "HTML", link_preview_options: { is_disabled: true } }
      );
      return;
    }

    // Своё название журнала организации — как на сайте.
    const customNames = await getOrgCustomNames(user.organizationId);
    const grouped = new Map<string, string[]>();
    for (const row of pending) {
      const key = journalDisplayName(customNames, row.template.code, row.template.name);
      const arr = grouped.get(key) ?? [];
      arr.push(row.user.name?.trim() || "—");
      grouped.set(key, arr);
    }
    const lines = [
      `📋 <b>Не заполнено сегодня · ${pending.length}</b>`,
      "",
      ...Array.from(grouped.entries()).map(
        ([name, users]) =>
          `• <b>${esc(name)}</b> — ${users.map(esc).join(", ")}`
      ),
    ];
    await ctx.reply(lines.join("\n"), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  });

  // /capa — открытые тикеты.
  composer.command("capa", async (ctx) => {
    const user = await resolveManagementUser(ctx.from?.id);
    if (!user) return replyNotAuthorized(ctx);

    const tickets = await db.capaTicket.findMany({
      where: {
        organizationId: user.organizationId,
        status: { in: ["open", "in_progress"] },
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
        "✅ <b>Открытых CAPA нет</b>\nВсе предписания закрыты — можно выдохнуть.",
        { parse_mode: "HTML", link_preview_options: { is_disabled: true } }
      );
      return;
    }

    const lines = [
      `🛠 <b>Открытые CAPA · ${tickets.length}</b>`,
      "",
      ...tickets.map((t) => {
        const due = t.dueDate ? formatDateRu(t.dueDate) : "без срока";
        const assignee =
          (t.assignedToId && assigneeNameById.get(t.assignedToId)?.trim()) ||
          "не назначено";
        return `• [${esc(t.priority)}] <b>${esc(t.title)}</b>\n   ${esc(assignee)} · до ${esc(due)}`;
      }),
    ];
    await ctx.reply(lines.join("\n"), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  });

  // /stats — 7-дневный график.
  composer.command("stats", async (ctx) => {
    const user = await resolveManagementUser(ctx.from?.id);
    if (!user) return replyNotAuthorized(ctx);

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

    const dayLabels = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
    const totalDone = days.reduce((sum, d) => sum + d.done, 0);
    const totalAll = days.reduce((sum, d) => sum + d.total, 0);
    const weekPct = totalAll === 0 ? 0 : Math.round((totalDone / totalAll) * 100);

    const lines = [
      "📊 <b>7 дней · сводка</b>",
      "",
      `Заполнено: <b>${totalDone}</b> / ${totalAll} (${weekPct}%)`,
      "",
      ...days.map((d) => {
        const pct = d.total === 0 ? 0 : Math.round((d.done / d.total) * 100);
        const bar = bar10(pct);
        return `${dayLabels[d.date.getUTCDay()]} ${formatDateRu(d.date).padEnd(10)} ${bar} ${pct}%`;
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
    const user = await resolveManagementUser(ctx.from?.id);
    if (!user) return replyNotAuthorized(ctx);

    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 7);
    const losses = await db.lossRecord.findMany({
      where: { organizationId: user.organizationId, date: { gte: since } },
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
        "📦 <b>Списаний за 7 дней нет</b>\nЕсли есть — отметьте через кабинет, чтобы они попали в отчёт инспектору.",
        { parse_mode: "HTML", link_preview_options: { is_disabled: true } }
      );
      return;
    }

    const totalCost = losses.reduce((s, l) => s + (l.costRub ?? 0), 0);
    const lines = [
      `📦 <b>Последние списания · ${losses.length}</b>`,
      totalCost > 0 ? `Сумма за неделю: <b>${totalCost.toFixed(0)} ₽</b>` : "",
      "",
      ...losses.map((l) => {
        const cost = l.costRub ? ` · ${l.costRub.toFixed(0)} ₽` : "";
        return `• ${formatDateRu(l.date)} <b>${esc(l.productName)}</b>\n   ${l.quantity} ${esc(l.unit)} · ${esc(l.category)}${cost}`;
      }),
    ].filter(Boolean);
    await ctx.reply(lines.join("\n"), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  });

  // /batches — активные партии.
  composer.command("batches", async (ctx) => {
    const user = await resolveManagementUser(ctx.from?.id);
    if (!user) return replyNotAuthorized(ctx);

    const batches = await db.batch.findMany({
      where: {
        organizationId: user.organizationId,
        status: { in: ["received", "in_use"] },
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
        "📦 <b>Активных партий нет</b>\nДобавьте через журнал «Приёмка сырья» — карточки партий создаются автоматически.",
        { parse_mode: "HTML", link_preview_options: { is_disabled: true } }
      );
      return;
    }

    const now = new Date();
    const lines = [
      `📦 <b>Активные партии · ${batches.length}</b>`,
      "",
      ...batches.map((b) => {
        const expiry = b.expiryDate
          ? formatDateRu(b.expiryDate) +
            (b.expiryDate < now ? " ⚠️ просрочено" : "")
          : "без срока";
        const supplier = b.supplier?.trim() ? ` · ${esc(b.supplier)}` : "";
        return `• <code>${esc(b.code)}</code> <b>${esc(b.productName)}</b>${supplier}\n   ${b.quantity} ${esc(b.unit)} · до ${esc(expiry)}`;
      }),
    ];
    await ctx.reply(lines.join("\n"), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  });

  // /staff — кто сегодня на смене.
  composer.command("staff", async (ctx) => {
    const user = await resolveManagementUser(ctx.from?.id);
    if (!user) return replyNotAuthorized(ctx);

    const today = utcDayStart(new Date());
    const shifts = await db.workShift.findMany({
      where: { organizationId: user.organizationId, date: today },
      select: {
        status: true,
        user: { select: { name: true } },
        jobPosition: { select: { name: true } },
      },
      orderBy: [{ status: "asc" }, { user: { name: "asc" } }],
    });

    if (shifts.length === 0) {
      await ctx.reply(
        "👥 <b>На сегодня смены не назначены</b>\nРаспишите график в кабинете → «График смен» → выберите дату.",
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
      working: "🟢 На смене",
      scheduled: "🟡 По плану (ещё не вышли)",
      ended: "🔵 Закончили",
      absent: "🔴 Не вышли",
      off: "⚪ Выходной",
      vacation: "⚪ Отпуск",
      sick: "⚪ Больничный",
    };
    const order = ["working", "scheduled", "ended", "absent", "off", "vacation", "sick"];
    const lines = [`👥 <b>Сегодня · ${shifts.length} смен</b>`, ""];
    for (const status of order) {
      const arr = grouped[status];
      if (!arr || arr.length === 0) continue;
      lines.push(`<b>${STATUS_LABELS[status] ?? status}</b>`);
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
    const user = await resolveManagementUser(ctx.from?.id);
    if (!user) return replyNotAuthorized(ctx);

    const now = new Date();
    const today = utcDayStart(now);
    // Все активные смены сегодня в орге.
    const shifts = await db.workShift.findMany({
      where: {
        organizationId: user.organizationId,
        date: today,
        status: { in: ["working", "scheduled"] },
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
        "🕓 <b>Сегодня нет активных смен</b>\nПроверьте график: возможно вы забыли проставить смены в кабинете.",
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
        "✅ <b>Все на месте</b>\nКаждый сотрудник со сменой сегодня заполнял что-то в журналах за последние 2 часа.",
        { parse_mode: "HTML", link_preview_options: { is_disabled: true } }
      );
      return;
    }

    const STATUS_LABEL: Record<string, string> = {
      scheduled: "по графику (не вышел?)",
      working: "на смене > 2ч без записей",
    };
    const lines = [
      `⚠️ <b>Подозрительные смены · ${late.length}</b>`,
      `Сотрудники без активности в журналах за 2 часа:`,
      "",
      ...late.map((s) => {
        const name = s.user.name?.trim() || "—";
        const label = STATUS_LABEL[s.status] ?? s.status;
        return `• <b>${esc(name)}</b> — ${esc(label)}`;
      }),
      "",
      "Может стоит позвонить или зайти проверить.",
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
    const user = await resolveManagementUser(ctx.from?.id);
    if (!user) return replyNotAuthorized(ctx);

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
      "🩺 <b>Health check</b>",
      "",
      `<b>Build</b>: <code>${esc(buildId)}</code>`,
      `<b>Built at</b>: ${esc(buildTime)}`,
      "",
      `<b>Bot API</b>: ${getMeStatus === "ok" ? "✅" : "❌"} ${esc(getMeStatus)} (${getMeLatencyMs}ms)`,
      `<b>Bot username</b>: @${esc(botUsername)}`,
      "",
      `<b>DB ping</b>: ${dbStatus === "ok" ? "✅" : "❌"} ${esc(dbStatus)} (${dbLatencyMs}ms)`,
    ];
    await ctx.reply(lines.join("\n"), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  });
}
