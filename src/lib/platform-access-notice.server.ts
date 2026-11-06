import { db } from "@/lib/db";
import { renderEmailLayout, sendRawEmail } from "@/lib/email";
import { addedPlatformSections, buildPlatformAccessNotice } from "@/lib/platform-access-notice";
import { normalizePlatformSections } from "@/lib/platform-access";
import { sendTelegramMessage } from "@/lib/telegram";
import { isTechnicalEmail } from "@/lib/technical-email";

export type PlatformAccessNoticeResult = { email: boolean; telegram: boolean; skipped?: "no-new-sections" | "user-not-found" };

/**
 * Письмо и Telegram человеку, которому открыли разделы панели. Каналы
 * независимы и никогда не бросают: сбой оповещения не отменяет выдачу.
 */
export async function notifyPlatformAccessGranted(args: {
  userId: string;
  before: unknown;
  after: unknown;
  grantedBy: string | null;
}): Promise<PlatformAccessNoticeResult> {
  const added = addedPlatformSections(args.before, args.after);
  if (!added.length) return { email: false, telegram: false, skipped: "no-new-sections" };
  const user = await db.user.findUnique({
    where: { id: args.userId },
    select: { id: true, name: true, email: true, contactEmail: true, telegramChatId: true, isActive: true, archivedAt: true, organizationId: true },
  });
  if (!user || !user.isActive || user.archivedAt) return { email: false, telegram: false, skipped: "user-not-found" };

  const loginEmail = isTechnicalEmail(user.email) ? null : user.email;
  const to = user.contactEmail?.trim() || loginEmail;
  const notice = buildPlatformAccessNotice({
    name: user.name,
    sections: normalizePlatformSections(args.after),
    firstGrant: normalizePlatformSections(args.before).length === 0,
    grantedBy: args.grantedBy,
    loginEmail,
    appUrl: process.env.NEXTAUTH_URL || "https://wesetup.ru",
  });

  let email = false;
  if (to) {
    try {
      email = await sendRawEmail(to, notice.subject, renderEmailLayout(notice.title, notice.html));
    } catch (error) {
      console.error("[platform-access] email failed", error);
    }
  }
  let telegram = false;
  if (user.telegramChatId) {
    try {
      telegram = await sendTelegramMessage(user.telegramChatId, notice.telegram, {
        userId: user.id,
        delivery: { organizationId: user.organizationId, kind: "platform.access.granted", dedupeKey: `platform.access.granted:${user.id}:${added.join(",")}` },
      });
    } catch (error) {
      console.error("[platform-access] telegram failed", error);
    }
  }
  return { email, telegram };
}
