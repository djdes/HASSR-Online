import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getServerSession } from "@/lib/server-session";

import { MiniMeClient } from "./me-client";

export const dynamic = "force-dynamic";

/**
 * Тонкая server-обёртка над клиентским экраном профиля.
 *
 * Нужна ради `TELEGRAM_BOT_USERNAME` — серверной переменной (не
 * NEXT_PUBLIC), которую просит форма обратной связи, и ради должности с
 * телефоном: в сессии их нет, а человеку важно видеть, какие данные о нём
 * записаны — с них идёт связка с задачами (П-8).
 */
export default async function MiniMePage() {
  const session = await getServerSession(authOptions).catch(() => null);
  const profile = session?.user?.id
    ? await db.user
        .findUnique({
          where: { id: session.user.id },
          select: {
            phone: true,
            positionTitle: true,
            telegramChatId: true,
            // Должность почти всегда задана справочником, а не строкой:
            // раньше читали только `positionTitle`, и у всех, кого
            // завели правильно, в профиле стояло «не указана».
            jobPosition: { select: { name: true } },
          },
        })
        .catch(() => null)
    : null;

  return (
    <MiniMeClient
      telegramBotUsername={process.env.TELEGRAM_BOT_USERNAME ?? ""}
      positionTitle={
        profile?.jobPosition?.name?.trim() ||
        profile?.positionTitle?.trim() ||
        null
      }
      phone={profile?.phone ?? null}
      telegramLinked={Boolean(profile?.telegramChatId)}
    />
  );
}
