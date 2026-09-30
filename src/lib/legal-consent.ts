import { clientIp } from "@/lib/client-ip";
import { db } from "@/lib/db";

/**
 * Согласие с юридическими документами (2026-09-22): обязательная галка при
 * регистрации и разовое окно у руководителей при новой редакции. Текст
 * хранится дословно — в споре нужно показать ровно то, что человек видел.
 */
export const LEGAL_VERSION = "2026-09-30";

export const LEGAL_CONSENT_TEXT =
  "Принимаю условия оферты и пользовательского соглашения, ознакомлен с политикой конфиденциальности и даю согласие на обработку персональных данных";

export type LegalConsentSource = "register" | "landing" | "update-modal";

export async function recordLegalConsent(params: {
  request: Request;
  userId: string;
  email: string;
  organizationId: string | null;
  source: LegalConsentSource;
}): Promise<void> {
  await db.$transaction([
    db.legalConsent.create({
      data: {
        userId: params.userId,
        email: params.email,
        organizationId: params.organizationId,
        version: LEGAL_VERSION,
        statementText: LEGAL_CONSENT_TEXT,
        source: params.source,
        ipAddress: clientIp(params.request),
        userAgent: params.request.headers.get("user-agent")?.slice(0, 400) ?? null,
      },
    }),
    db.user.update({ where: { id: params.userId }, data: { legalVersion: LEGAL_VERSION } }),
  ]);
}
