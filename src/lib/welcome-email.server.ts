import type { Locale } from "@/i18n/locales";
import { ensurePlatformOrganization } from "@/lib/blank-download-lead.server";
import { db } from "@/lib/db";
import { sendWelcomeEmail } from "@/lib/email";

/**
 * Приветственное письмо (спека trial-emails-rename-2026-11) — один раз на
 * адрес: после регистрации (любым путём) и после скачивания шаблона журнала.
 * Отправленное записывается в AuditLog платформы (`email.welcome`,
 * `entityId` — почта); повторное скачивание или регистрация того же адреса
 * второго письма не шлёт. Ручная отправка из карточки клиента (`force`) —
 * без этой проверки.
 *
 * Адреса из списка подавления (отписались, жалоба, «не существует») не
 * получают ничего. Ошибки не выбрасываются: письмо — не повод ронять
 * регистрацию или скачивание.
 */

export const WELCOME_EMAIL_AUDIT_ACTION = "email.welcome";
const PLATFORM_ORG_ID = () => process.env.PLATFORM_ORG_ID || "platform";

export type WelcomeEmailOutcome = "sent" | "already" | "suppressed" | "failed";

export async function sendWelcomeEmailOnce(params: {
  to: string;
  name?: string | null;
  hasAccount: boolean;
  organizationId?: string | null;
  locale?: Locale;
  /** Откуда: регистрация, скачивание, ручная отправка — для аудита. */
  via: "instant_register" | "register" | "blank_register" | "blank_download" | "manual";
  /** Ручная отправка: без проверки «уже отправляли». */
  force?: boolean;
  actor?: { userId: string; userName: string | null } | null;
}): Promise<WelcomeEmailOutcome> {
  const email = params.to.trim().toLowerCase();
  if (!email) return "failed";
  try {
    const suppressed = await db.emailSuppression.findUnique({ where: { email }, select: { email: true } }).catch(() => null);
    if (suppressed) return "suppressed";
    if (!params.force) {
      const already = await db.auditLog.findFirst({
        where: { organizationId: PLATFORM_ORG_ID(), action: WELCOME_EMAIL_AUDIT_ACTION, entity: "Email", entityId: email },
        select: { id: true },
      });
      if (already) return "already";
    }
    const sent = await sendWelcomeEmail({
      to: email,
      name: params.name,
      hasAccount: params.hasAccount,
      organizationId: params.organizationId,
      locale: params.locale,
    });
    if (!sent) return "failed";
    // Аудит платформы ссылается на её организацию — её могло не быть.
    await ensurePlatformOrganization(PLATFORM_ORG_ID()).catch(() => undefined);
    await db.auditLog
      .create({
        data: {
          organizationId: PLATFORM_ORG_ID(),
          userId: params.actor?.userId ?? null,
          userName: params.actor?.userName ?? "WeSetup",
          action: WELCOME_EMAIL_AUDIT_ACTION,
          entity: "Email",
          entityId: email,
          details: { via: params.via, organizationId: params.organizationId ?? null, hasAccount: params.hasAccount },
        },
      })
      .catch((error) => console.error("[welcome-email] audit failed", error));
    return "sent";
  } catch (error) {
    console.error("[welcome-email] send failed", { via: params.via, error });
    return "failed";
  }
}
