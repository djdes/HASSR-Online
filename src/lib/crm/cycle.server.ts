import { db } from "@/lib/db";
import { syncAllMailboxes, type MailboxSyncResult } from "@/lib/crm/mailbox.server";
import { notifyNewMail, runCrmDigest, runCrmReminders } from "@/lib/crm/notify.server";
import { syncCrmSources, type SourceSyncResult } from "@/lib/crm/sources.server";
import { syncTelphinCalls, type TelphinSyncResult } from "@/lib/crm/telphin.server";
import { recordCronRun } from "@/lib/platform-alerts";

/**
 * Один прогон CRM (крон раз в 5 минут и кнопка «Обновить сейчас»):
 * обращения из таблиц сайта → звонки Телфина → почта IMAP → напоминания → утренняя сводка.
 * Шаги независимы: сбой почты не останавливает напоминания.
 */

export type CrmCycleResult = {
  ok: boolean;
  skipped?: "busy";
  sources: SourceSyncResult[];
  mailboxes: MailboxSyncResult[];
  calls: TelphinSyncResult | null;
  newMailAlerts: number;
  reminders: { planned: number; sent: number };
  digest: boolean;
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
  // Звонки — до напоминаний: пропущенный звонок тоже «ждёт ответа».
  const calls = await step("звонки", () => syncTelphinCalls(now), null);
  const rules = await step("правила", () => db.crmSenderRule.findMany({ select: { pattern: true, action: true } }), []);
  const mail = await step("почта", () => syncAllMailboxes(now, rules), { results: [], ingested: [] });
  const newMailAlerts = await step("письма РОП", () => notifyNewMail(mail.ingested, now), 0);
  const reminders = await step("напоминания", () => runCrmReminders(now), { planned: 0, sent: 0 });
  const digest = await step("сводка", () => runCrmDigest(now), false);

  for (const source of sources) if (source.error) errors.push(`${source.source}: ${source.error}`);
  for (const error of calls?.errors ?? []) errors.push(`звонки: ${error}`);
  for (const mailbox of mail.results) if (mailbox.error) errors.push(`${mailbox.label}: ${mailbox.error}`);
  await recordCronRun({ job: "crm", ok: errors.length === 0, error: errors.join("; ") || null }).catch(() => undefined);
  if (trigger !== "cron") console.log(`[crm] прогон (${trigger}): ${errors.length ? errors.join("; ") : "без ошибок"}`);
  return {
    ok: errors.length === 0,
    sources,
    mailboxes: mail.results,
    calls,
    newMailAlerts,
    reminders,
    digest,
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
