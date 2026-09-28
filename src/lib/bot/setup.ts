import type { Bot } from "grammy";
import { TELEGRAM_COMMANDS } from "@/lib/bot/start-response";
import { buildMiniAppUrl } from "@/lib/journal-obligation-links";
import { JOURNALS_TOTAL } from "@/lib/journal-catalog";
import { pluralRu } from "@/lib/plural-ru";
import { FREE_TIER_SHORT } from "@/lib/plan-catalog";

export const WESETUP_BOT_PROFILE = {
  name: "WeSetup · журналы ХАССП/СанПиН",
  shortDescription:
    "Электронные журналы СанПиН и ХАССП прямо в Telegram — без бумажек.",
  description:
    "WeSetup — электронные журналы СанПиН и ХАССП для кафе, ресторанов и пищевых производств.\n\n" +
    `📋 ${JOURNALS_TOTAL} ${pluralRu(JOURNALS_TOTAL, "готовый журнал", "готовых журнала", "готовых журналов")}: гигиена, здоровье, температуры холодильников, бракераж, уборка, дезинфекция, приёмка сырья.\n` +
    "✅ Заполнение в один клик прямо здесь — откройте Кабинет и отметьте строки за смену.\n" +
    "📊 PDF для Роспотребнадзора одним кликом — сборка «По звонку инспектора» за 7 дней.\n" +
    "🤖 Умные напоминания, голосовой ввод температур, офлайн-режим на кухне.\n\n" +
    `${FREE_TIER_SHORT}. Сайт: wesetup.ru`,
  menuButtonText: "🏠 Кабинет",
} as const;

export function buildTelegramMenuButton(miniAppBaseUrl: string) {
  const url = buildMiniAppUrl(miniAppBaseUrl, "/mini");
  if (!url) {
    throw new Error("Mini App URL is not configured");
  }

  return {
    menu_button: {
      type: "web_app" as const,
      text: WESETUP_BOT_PROFILE.menuButtonText,
      web_app: { url },
    },
  };
}

/**
 * Идемпотентная настройка профиля бота.
 *
 * Раньше: безусловно вызывали setMyName / setMyShortDescription /
 * setMyDescription. Telegram держит длинный (часовой+) rate limit на
 * setMyName при повторе с тем же значением → 429 «retry after 74000s»
 * → poller crash → PM2 рестартует → 429 снова → бот не работает часами.
 *
 * Сейчас: читаем текущее значение через getMyName/getMy*Description
 * и пишем только при реальном отличии. setMyCommands и setChatMenuButton
 * не имеют такого rate limit'а — их можно вызывать всегда.
 */
export async function configureTelegramBotProfile(args: {
  api: Bot["api"];
  miniAppBaseUrl: string;
  profilePhoto?: Parameters<Bot["api"]["setMyProfilePhoto"]>[0];
}): Promise<void> {
  await safelyUpdateName(args.api, WESETUP_BOT_PROFILE.name);
  await safelyUpdateShortDescription(
    args.api,
    WESETUP_BOT_PROFILE.shortDescription
  );
  await safelyUpdateDescription(args.api, WESETUP_BOT_PROFILE.description);
  await args.api.setMyCommands([...TELEGRAM_COMMANDS]);
  await args.api.setChatMenuButton(buildTelegramMenuButton(args.miniAppBaseUrl));

  if (args.profilePhoto) {
    await args.api.setMyProfilePhoto(args.profilePhoto);
  }
}

async function safelyUpdateName(api: Bot["api"], target: string) {
  try {
    const current = await api.getMyName();
    if (current.name === target) return;
  } catch (err) {
    console.warn("[bot/setup] getMyName failed, fallback to setMyName", err);
  }
  await api.setMyName(target);
}

async function safelyUpdateShortDescription(api: Bot["api"], target: string) {
  try {
    const current = await api.getMyShortDescription();
    if (current.short_description === target) return;
  } catch (err) {
    console.warn("[bot/setup] getMyShortDescription failed", err);
  }
  await api.setMyShortDescription(target);
}

async function safelyUpdateDescription(api: Bot["api"], target: string) {
  try {
    const current = await api.getMyDescription();
    if (current.description === target) return;
  } catch (err) {
    console.warn("[bot/setup] getMyDescription failed", err);
  }
  await api.setMyDescription(target);
}

export async function configureTelegramBotRuntimeMenu(args: {
  api: Bot["api"];
  miniAppBaseUrl: string | null;
}): Promise<void> {
  await args.api.setMyCommands([...TELEGRAM_COMMANDS]);
  if (args.miniAppBaseUrl) {
    await args.api.setChatMenuButton(
      buildTelegramMenuButton(args.miniAppBaseUrl)
    );
  }
}
