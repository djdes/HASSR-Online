import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { checkPlanFeature, limitResponse } from "@/lib/billing.server";
import { COMPANY_ONLY_API_ERROR, isPointScoped } from "@/lib/point-scope";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { getServerSession } from "@/lib/server-session";

/**
 * Доступ к настройкам Меркурия (площадки, сопоставление с точками): руководство
 * всей компании и тариф с «Меркурием». Руководитель точки сюда не ходит —
 * подключение общее на компанию (proxy закрывает то же по префиксу).
 */
export async function mercurySettingsGuard(): Promise<{ error: NextResponse } | { error?: undefined; organizationId: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Не авторизован" }, { status: 401 }) };
  }
  if (!hasFullWorkspaceAccess(session.user)) {
    return { error: NextResponse.json({ error: "Настройка интеграций доступна руководству" }, { status: 403 }) };
  }
  if (isPointScoped(session.user)) {
    return { error: NextResponse.json({ error: COMPANY_ONLY_API_ERROR }, { status: 403 }) };
  }
  const organizationId = getActiveOrgId(session);
  const feature = await checkPlanFeature(organizationId, "mercury", "mercury.settings");
  if (!feature.ok) return { error: limitResponse(feature) };
  return { organizationId };
}
