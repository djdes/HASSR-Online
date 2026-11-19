import { Suspense, type ReactNode } from "react";
import { BillingStaffNotice } from "@/components/billing/billing-staff-notice";
import { OrgTrialLockGate } from "@/components/billing/org-trial-lock-gate";
import { MiniDeniedNotice } from "@/app/mini/_components/mini-denied-notice";
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
      {/* Организация закрыта после своих 14 дней (`lib/org-trial.ts`) — на главном
          экране мини-приложения то же окно, что на сайте; записи в журналы сервер
          в ней и так не принимает. Сменить организацию — в профиле. */}
      {billing?.orgTrial?.gate ? (
        <OrgTrialLockGate
          name={billing.orgTrial.name}
          lastDayIso={billing.orgTrial.lastDayIso}
          canDecide={billing.orgTrial.gate.canDecide}
          payHref={billing.orgTrial.gate.payHref}
          deleteHref={null}
          organizations={[]}
          switchHref="/mini/me"
        />
      ) : null}
      {/* Увели сюда из закрытого раздела (`?denied=`) — объясняем один раз. */}
      <Suspense fallback={null}>
        <MiniDeniedNotice />
      </Suspense>
      {children}
    </DomainMessagesBoundary>
  );
}
