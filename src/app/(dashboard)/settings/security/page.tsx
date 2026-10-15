import { requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { LOGIN_METHOD_LABEL, maskIp, type LoginMethod } from "@/lib/login-device";
import { PageHeader } from "@/components/ui/page-header";

import { SecurityClient } from "./security-client";
import { getTranslations } from "next-intl/server";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";

export const dynamic = "force-dynamic";

/**
 * «Безопасность»: история входов и «завершить все сессии». Доступна
 * каждому пользователю для его аккаунта — руководителю и сотруднику.
 */
export default async function SecurityPage() {
  const t = await getTranslations("settingsManagement.security");
  const session = await requireAuth();
  const me = await db.user.findUnique({
    where: { id: session.user.id },
    select: { twoFactorTelegram: true, telegramChatId: true },
  });
  const rows = await db.loginEvent.findMany({
    where: { userId: session.user.id },
    orderBy: { at: "desc" },
    take: 30,
    select: { id: true, at: true, ip: true, device: true, method: true, isNewDevice: true },
  });
  const logins = rows.map((row) => ({
    id: row.id,
    at: row.at.toISOString(),
    ip: maskIp(row.ip),
    device: row.device,
    method: (row.method as LoginMethod) in LOGIN_METHOD_LABEL ? (row.method as LoginMethod) : "password",
    isNewDevice: row.isNewDevice,
  }));

  return (
    <DomainMessagesBoundary namespaces={["settingsManagement"]}>
    <div className="space-y-5">
      <PageHeader
        title={t("title")}
        description={t("description")}
      />
      <SecurityClient
        logins={logins}
        twoFactor={{ enabled: me?.twoFactorTelegram === true, telegramLinked: Boolean(me?.telegramChatId) }}
      />
    </div>
    </DomainMessagesBoundary>
  );
}
