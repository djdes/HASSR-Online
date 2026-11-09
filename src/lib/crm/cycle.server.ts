import { db } from "@/lib/db";
import { syncAllMailboxes, type MailboxSyncResult } from "@/lib/crm/mailbox.server";
import { notifyNewMail, runCrmDigest, runCrmReminders } from "@/lib/crm/notify.server";
import { syncCrmSources, type SourceSyncResult } from "@/lib/crm/sources.server";
import { runLifecycle, type LifecycleRunResult } from "@/lib/crm/lifecycle/run.server";
import { runTaskReminders } from "@/lib/crm/lifecycle/tasks.server";
import { recordCronRun } from "@/lib/platform-alerts";

/**
 * Один прогон CRM (крон раз в 5 минут и кнопка «Обновить сейчас»):
 * обращения из таблиц сайта → почта IMAP → напоминания → утренняя сводка.
 * Шаги независимы: сбой почты не останавливает напоминания.
 */

export type CrmCycleResult = {
  ok: boolean;
  skipped?: "busy";
  sources: SourceSyncResult[];
  mailboxes: MailboxSyncResult[];
  newMailAlerts: number;
  reminders: { planned: number; sent: number };
  digest: boolean;
  /** Автоворонка: сделки, письма клиентам, задачи (не чаще раза в 15 минут). */
  lifecycle: Pick<LifecycleRunResult, "skipped" | "scanned" | "deals" | "messages" | "tasks"> | null;
  taskReminders: { daily: number; escalated: number };
  errors: string[];
  durationMs: number;
};

let running: Promise<CrmCycleResult> | null = null;

async function cycle(trigger: string): Promise<CrmCycleResult> {
  const started = Date.now();
  const now = new Date();
  const errors: string[] = [];
  const step = async <T>(name: string, run: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      console.error(`[crm] шаг «${name}» упал`, error);
      errors.push(`${name}: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}`);
      return fallback;
    }
  };

  const sources = await step("источники", () => syncCrmSources(now), []);
  const rules = await step("правила", () => db.crmSenderRule.findMany({ select: { pattern: true, action: true } }), []);
  const mail = await step("почта", () => syncAllMailboxes(now, rules), { results: [], ingested: [] });
  const newMailAlerts = await step("письма РОП", () => notifyNewMail(mail.ingested, now), 0);
  const reminders = await step("напоминания", () => runCrmReminders(now), { planned: 0, sent: 0 });
  const digest = await step("сводка", () => runCrmDigest(now), false);
  const lifecycle = await step("автоворонка", () => runLifecycle({ now, force: trigger === "manual" }), null);
  const taskReminders = await step("задачи", () => runTaskReminders(now), { daily: 0, escalated: 0 });
  if (lifecycle) for (const error of lifecycle.errors) errors.push(`автоворонка: ${error}`);

  for (const source of sources) if (source.error) errors.push(`${source.source}: ${source.error}`);
  for (const mailbox of mail.results) if (mailbox.error) errors.push(`${mailbox.label}: ${mailbox.error}`);
  await recordCronRun({ job: "crm", ok: errors.length === 0, error: errors.join("; ") || null }).catch(() => undefined);
  if (trigger !== "cron") console.log(`[crm] прогон (${trigger}): ${errors.length ? errors.join("; ") : "без ошибок"}`);
  return {
    ok: errors.length === 0,
    sources,
    mailboxes: mail.results,
    newMailAlerts,
    reminders,
    digest,
    lifecycle: lifecycle ? { skipped: lifecycle.skipped, scanned: lifecycle.scanned, deals: lifecycle.deals, messages: lifecycle.messages, tasks: lifecycle.tasks } : null,
    taskReminders,
    errors,
    durationMs: Date.now() - started,
  };
}

/** Второй вызов, пока идёт первый, ждёт его результата, а не запускает свой. */
export async function runCrmCycle(trigger: "cron" | "manual" = "cron"): Promise<CrmCycleResult> {
  if (running) return running;
  running = cycle(trigger).finally(() => {
    running = null;
  });
  return running;
}
