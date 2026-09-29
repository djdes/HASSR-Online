import { withAdvisoryTryLock } from "@/lib/advisory-lock";

import "./kinds";
import { createChannelSenders } from "./channels.server";
import { runQueuePass, type QueueDeps, type QueueReport } from "./queue";
import { readMailingSettings } from "./settings.server";
import { createPrismaQueueStore } from "./store.server";

/**
 * Проход очереди рассылки: cron `/api/cron/mailing` раз в минуту и толчок
 * сразу после запуска. Два прохода одновременно не идут — advisory-замок
 * Postgres; проигравший сразу выходит (его работу сделает текущий проход
 * или следующий cron).
 */

export function mailingAppUrl(): string {
  return (process.env.NEXTAUTH_URL || "https://wesetup.ru").replace(/\/+$/, "");
}

export async function mailingQueueDeps(): Promise<QueueDeps> {
  return {
    store: createPrismaQueueStore(),
    senders: createChannelSenders(),
    settings: await readMailingSettings(),
    appUrl: mailingAppUrl(),
  };
}

export type ProcessResult = ({ busy: false } & QueueReport) | { busy: true };

export async function processMailingQueue(source: "cron" | "launch" | "retry" | "manual"): Promise<ProcessResult> {
  const startedAt = Date.now();
  const outcome = await withAdvisoryTryLock(
    "mailing:queue",
    async () => runQueuePass(await mailingQueueDeps()),
    { attempts: 1, timeoutMs: 10 * 60_000 }
  );
  if (!outcome.acquired) {
    console.info(`[mailing] queue busy — skip (${source})`);
    return { busy: true };
  }
  console.info(`[mailing] queue pass (${source}) in ${Date.now() - startedAt}ms`);
  return { busy: false, ...outcome.value };
}

/** Толчок без ожидания: сбой не должен ронять ответ ROOT. */
export async function nudgeMailingQueue(source: "launch" | "retry"): Promise<void> {
  try {
    await processMailingQueue(source);
  } catch (error) {
    console.error(`[mailing] queue nudge (${source}) failed`, error);
  }
}
