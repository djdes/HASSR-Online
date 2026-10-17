import type { Composer, Context } from "grammy";
import { createTranslator } from "use-intl/core";
import { db } from "@/lib/db";
import { recordAuditLog } from "@/lib/audit-log";
import { botCallbackRateLimiter } from "@/lib/rate-limit";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { resolveLocale } from "@/i18n/locales";
import { loadMessages } from "@/i18n/messages";
import { markPlanDone, moscowToday, nextDueAfterDone } from "@/lib/ppk/plan-done";
import { PPK_RECORD_SCHEMAS, type LabPlanItem, type PestPlanItem } from "@/lib/ppk/records";
import { resolveLinkedUser } from "./staff-tools";

/** YYYY-MM-DD → ДД.ММ.ГГГГ. */
function dmy(value: string): string {
  const [y, m, d] = value.split("-");
  return `${d}.${m}.${y}`;
}

/**
 * Кнопка «✅» под напоминанием о сроках плана «Производственного контроля»:
 * отмечает пункт выполненным сегодня (лаборатория — `lastDate`, дезинсекция —
 * ещё и следующий срок) и убирает нажатую кнопку из сообщения.
 */
export function registerPpkHandlers(composer: Composer<Context>) {
  composer.callbackQuery(/^ppk:done:([a-z0-9]{10,40})$/, async (ctx) => {
    const fromId = ctx.from?.id;
    if (!fromId) return;
    const recordId = ctx.match[1];

    const user = await resolveLinkedUser(fromId);
    const locale = resolveLocale({
      authenticated: Boolean(user),
      userLocale: user?.locale,
      organizationLocale: user?.organization?.locale,
    });
    const messages = await loadMessages(locale);
    const common = createTranslator({ locale, messages, namespace: "telegramWorkday.common" });
    const t = createTranslator({ locale, messages, namespace: "telegramWorkday.ppk" });

    if (!botCallbackRateLimiter.consume(`${fromId}:ppk:done`)) {
      await ctx.answerCallbackQuery({ text: common("tooManyClicks"), show_alert: false });
      return;
    }
    if (!user) {
      await ctx.answerCallbackQuery({ text: common("chatNotLinked"), show_alert: true });
      return;
    }

    const record = hasFullWorkspaceAccess(user)
      ? await db.ppkRecord.findFirst({
          where: { id: recordId, organizationId: user.organizationId, block: { in: ["lab-plan", "pest-plan"] } },
          select: { id: true, block: true, data: true },
        })
      : null;
    if (!record) {
      await ctx.answerCallbackQuery({ text: t("noAccess"), show_alert: true });
      return;
    }

    const block = record.block as "lab-plan" | "pest-plan";
    const schema = PPK_RECORD_SCHEMAS[block];
    const current = schema.safeParse(record.data);
    if (!current.success) {
      await ctx.answerCallbackQuery({ text: t("noAccess"), show_alert: true });
      return;
    }
    const next = schema.safeParse(markPlanDone(block, current.data as LabPlanItem | PestPlanItem, moscowToday()));
    if (!next.success) {
      await ctx.answerCallbackQuery({ text: t("noAccess"), show_alert: true });
      return;
    }
    await db.ppkRecord.update({ where: { id: record.id }, data: { data: next.data as object } });
    await recordAuditLog({
      organizationId: user.organizationId,
      session: { user: { id: user.id, name: user.name } },
      action: "ppk.plan.done",
      entity: "PpkRecord",
      entityId: record.id,
      details: { block, via: "telegram" },
    });

    const due = nextDueAfterDone(block, next.data as LabPlanItem | PestPlanItem);
    await ctx.answerCallbackQuery({ text: due ? t("doneNext", { date: dmy(due) }) : t("done") });

    // Убираем нажатую кнопку, остальные оставляем. Старое сообщение — не критично.
    try {
      const rows = ctx.callbackQuery.message && "reply_markup" in ctx.callbackQuery.message
        ? ctx.callbackQuery.message.reply_markup?.inline_keyboard ?? []
        : [];
      const left = rows.filter((row) => !row.some((b) => "callback_data" in b && b.callback_data === ctx.callbackQuery.data));
      await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: left } });
    } catch {
      /* ignore */
    }
  });
}
