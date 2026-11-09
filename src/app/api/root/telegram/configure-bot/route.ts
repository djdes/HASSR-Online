import { platformViewerForSession } from "@/lib/platform-access.server";
import { NextResponse } from "next/server";
import { InputFile } from "grammy";
import fs from "node:fs";
import path from "node:path";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getInboundBot, ensureBotInit } from "@/lib/bot/bot-app";
import {
  configureTelegramBotProfile,
  WESETUP_BOT_PROFILE,
} from "@/lib/bot/setup";
import { getMiniAppBaseUrlFromEnv } from "@/lib/journal-obligation-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/root/telegram/configure-bot
 *
 * Однократная (идемпотентная) настройка бот-профиля в Telegram:
 * имя, краткое описание, описание, команды, menu button
 * (WebApp → /mini), и аватарка (если на диске `public/bot-avatar.png`).
 *
 * Доступна только ROOT-пользователю — админская операция уровня
 * платформы, не организации.
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  // Владелец и администратор платформы.
  if (!session?.user || !(await platformViewerForSession(session)).superadmin) {
    return NextResponse.json({ error: "Нужны права администратора платформы" }, { status: 403 });
  }
  const bot = getInboundBot();
  if (!bot) {
    return NextResponse.json(
      { error: "TELEGRAM_BOT_TOKEN не настроен" },
      { status: 500 }
    );
  }
  const miniAppBaseUrl = getMiniAppBaseUrlFromEnv();
  if (!miniAppBaseUrl) {
    return NextResponse.json(
      { error: "MINI_APP_BASE_URL / NEXTAUTH_URL не настроен" },
      { status: 500 }
    );
  }

  try {
    await ensureBotInit(bot);
    const avatarPath = path.join(process.cwd(), "public", "bot-avatar.png");
    const profilePhoto = fs.existsSync(avatarPath)
      ? ({ type: "static", photo: new InputFile(avatarPath) } as const)
      : undefined;

    await configureTelegramBotProfile({
      api: bot.api,
      miniAppBaseUrl,
      profilePhoto,
    });

    return NextResponse.json({
      ok: true,
      profile: {
        name: WESETUP_BOT_PROFILE.name,
        shortDescription: WESETUP_BOT_PROFILE.shortDescription,
        descriptionLength: WESETUP_BOT_PROFILE.description.length,
        menuButton: WESETUP_BOT_PROFILE.menuButtonText,
        miniAppBaseUrl,
        avatarSet: !!profilePhoto,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Не удалось настроить бота",
      },
      { status: 500 }
    );
  }
}
