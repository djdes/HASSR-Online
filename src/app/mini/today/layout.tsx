import type { ReactNode } from "react";
import { BillingStaffNotice } from "@/components/billing/billing-staff-notice";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId, isImpersonating } from "@/lib/auth-helpers";
import { loadBillingView } from "@/lib/billing-view.server";
import { isMobileAppRequest } from "@/lib/mobile-app-payments";
import { getServerSession } from "@/lib/server-session";

export default async function MiniTodayLayout({ children }: { children: ReactNode }) {
  // Сотруднику без прав на тариф — та же плашка, что в профиле: «Сегодня» —
  // главный экран мини-приложения, сюда ведут и /dashboard, и /journals.
  const session = await getServerSession(authOptions).catch(() => null);
  const billing = session?.user
    ? await loadBillingView({
        organizationId: getActiveOrgId(session),
        user: session.user,
        impersonating: isImpersonating(session),
        partnerAccess: Boolean(session.user.partnerAccess),
        inMobileApp: await isMobileAppRequest(),
      }).catch(() => null)
    : null;
  return (
    <DomainMessagesBoundary namespaces={["miniToday", "miniTaskPool"]}>
      {billing?.staffNotice ? <BillingStaffNotice variant="mini" /> : null}
      {children}
    </DomainMessagesBoundary>
  );
}
