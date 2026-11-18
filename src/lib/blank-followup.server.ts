import { JOURNAL_INFO } from "@/content/journal-info";
import { BLANK_DOWNLOAD_AUDIT_ACTION, blankRegisterHref } from "@/lib/blank-download";
import { db } from "@/lib/db";
import { sendBlankFollowupEmail } from "@/lib/email";

/**
 * Письмо через сутки после скачивания шаблона (спека conversion-pack-2026-11):
 * тем, кто скачал журнал и так и не зарегистрировался, — одно письмо про
 * этот журнал: подсказки, ссылка на образец и FAQ, «вести с телефона».
 *
 * Берём скачивания 24–48 часов назад (крон CRM ходит раз в 5 минут, окно
 * в сутки переживает простой крона). Одному адресу — одно письмо за 30 дней,
 * отметка — запись `blank.followup` в журнале аудита платформы.
 */

const PLATFORM_ORG_ID = process.env.PLATFORM_ORG_ID || "platform";
export const BLANK_FOLLOWUP_AUDIT_ACTION = "blank.followup";
const HOUR = 60 * 60 * 1000;
const APP_URL = (process.env.NEXTAUTH_URL || process.env.APP_URL || "https://wesetup.ru").replace(/\/+$/, "");

type DownloadDetails = { email?: unknown; code?: unknown; title?: unknown; account?: unknown };

/** Кому писать: последнее скачивание журнала по каждому адресу, без кабинета. */
export function pickFollowupCandidates(
  rows: ReadonlyArray<{ id: string; details: unknown }>,
): Array<{ sourceId: string; email: string; code: string; title: string }> {
  const byEmail = new Map<string, { sourceId: string; email: string; code: string; title: string }>();
  for (const row of rows) {
    const details = (row.details ?? {}) as DownloadDetails;
    const email = typeof details.email === "string" ? details.email.trim().toLowerCase() : "";
    const code = typeof details.code === "string" ? details.code : "";
    // Кабинет уже есть (создан галкой или был раньше) — ему не это письмо.
    if (!email || !code || !Object.hasOwn(JOURNAL_INFO, code)) continue;
    if (details.account === "created" || details.account === "exists") {
      byEmail.delete(email);
      continue;
    }
    const title = typeof details.title === "string" && details.title.trim() ? details.title.trim() : code;
    byEmail.set(email, { sourceId: row.id, email, code, title });
  }
  return [...byEmail.values()];
}

export async function sendBlankFollowups(now = new Date(), limit = 40): Promise<{ sent: number; skipped: number }> {
  const rows = await db.auditLog.findMany({
    where: {
      organizationId: PLATFORM_ORG_ID,
      action: BLANK_DOWNLOAD_AUDIT_ACTION,
      createdAt: { gte: new Date(now.getTime() - 48 * HOUR), lt: new Date(now.getTime() - 24 * HOUR) },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, details: true },
    take: 1000,
  });
  let sent = 0;
  let skipped = 0;
  for (const candidate of pickFollowupCandidates(rows)) {
    if (sent >= limit) break;
    const [user, already, suppressed] = await Promise.all([
      db.user.findFirst({ where: { email: { equals: candidate.email, mode: "insensitive" } }, select: { id: true } }),
      db.auditLog.findFirst({
        where: {
          organizationId: PLATFORM_ORG_ID,
          action: BLANK_FOLLOWUP_AUDIT_ACTION,
          entityId: candidate.email,
          createdAt: { gte: new Date(now.getTime() - 30 * 24 * HOUR) },
        },
        select: { id: true },
      }),
      // Отписавшимся от писем WeSetup — не пишем.
      db.emailSuppression.findUnique({ where: { email: candidate.email }, select: { id: true } }),
    ]);
    if (user || already || suppressed) {
      skipped += 1;
      continue;
    }
    const target = { kind: "code" as const, code: candidate.code };
    const ok = await sendBlankFollowupEmail({
      to: candidate.email,
      journalTitle: candidate.title,
      tips: JOURNAL_INFO[candidate.code]?.tips ?? [],
      pageUrl: `${APP_URL}/journals-info/${candidate.code}`,
      registerUrl: `${APP_URL}${blankRegisterHref({ email: candidate.email, target })}&utm_source=email&utm_medium=followup&utm_campaign=blank_followup`,
    }).catch((error) => {
      console.error("[blank-followup] send failed", error);
      return false;
    });
    // Отметка и при сбое: повторять письмо каждые 5 минут хуже, чем не отправить.
    await db.auditLog.create({
      data: {
        organizationId: PLATFORM_ORG_ID,
        action: BLANK_FOLLOWUP_AUDIT_ACTION,
        entity: "Email",
        entityId: candidate.email,
        details: { code: candidate.code, sourceId: candidate.sourceId, sent: ok },
      },
    });
    if (ok) sent += 1;
    else skipped += 1;
  }
  return { sent, skipped };
}
