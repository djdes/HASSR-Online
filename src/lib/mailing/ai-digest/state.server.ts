import { telegramBotConfigured } from "@/lib/mailing/channels.server";
import { DEFAULT_AI_DIGEST_CONFIG, type AiDigestConfig } from "@/lib/mailing/ai-digest/config";
import { listAiDigestRecipients, readAiDigestConfig, readAiDigestRuns } from "@/lib/mailing/ai-digest/run.server";
import { nextSlot, slotLabel } from "@/lib/mailing/ai-digest/schedule";

/** Состояние вкладки «ИИ-сводка»: настройки, получатели, история, готовность каналов. */
export async function aiDigestState(configOverride?: AiDigestConfig) {
  const [config, runs, recipients] = await Promise.all([
    configOverride ? Promise.resolve(configOverride) : readAiDigestConfig(),
    readAiDigestRuns(),
    listAiDigestRecipients(),
  ]);
  let maxConfigured = false;
  try {
    const { maxConfig } = await import("@/lib/max/config");
    maxConfigured = Boolean(maxConfig().token);
  } catch {
    maxConfigured = false;
  }
  return {
    config,
    defaults: DEFAULT_AI_DIGEST_CONFIG,
    runs,
    recipients,
    nextRun: config.enabled ? slotLabel(nextSlot(new Date(), config.schedule)) : null,
    telegramConfigured: telegramBotConfigured(),
    maxConfigured,
  };
}

export type AiDigestState = Awaited<ReturnType<typeof aiDigestState>>;
