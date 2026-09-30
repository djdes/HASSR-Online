import { redirect } from "next/navigation";

import { AuthSessionProvider } from "@/components/layout/session-provider";
import { MasterShell } from "@/components/master/master-shell";
import { SiteThemeBootstrap, SiteThemeProvider } from "@/components/theme/site-theme";
import { Toaster } from "@/components/ui/sonner";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { listPoolOrganizations, MASTER_ORG_KIND } from "@/lib/master-directory";
import { listAccessibleOrganizations } from "@/lib/organization-access";
import { readInitialTheme } from "@/lib/site-theme.server";
import "@/app/app-theme.css";

export const dynamic = "force-dynamic";

// Рабочий кабинет бэк-офиса — индексировать нечего.
export const metadata = {
  title: "Мастер-кабинет справочников — WeSetup",
  robots: { index: false, follow: false },
};

/**
 * `/master` — мастер-кабинет справочников пула служебного кода. Proxy уже
 * пускает сюда только сессию с `orgKind="directory"`; здесь — второй рубеж
 * по базе: активная организация не кабинет → на главную.
 */
export default async function MasterLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAuth();
  const orgId = getActiveOrgId(session);
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true, kind: true, serviceCode: true, linkedServiceCode: true },
  });
  if (!org || org.kind !== MASTER_ORG_KIND) redirect("/dashboard");

  const [profile, poolOrganizations, accessible] = await Promise.all([
    db.user.findUnique({ where: { id: session.user.id }, select: { themePreference: true } }),
    listPoolOrganizations(org.id),
    listAccessibleOrganizations(session.user.id),
  ]);
  const initialTheme = await readInitialTheme(profile?.themePreference);
  // «Моя организация» — для владельца/руководителя, у которого кроме
  // кабинета есть обычные организации (не мастер-кабинеты и не демо).
  // Сотруднику бэк-офиса возвращаться некуда.
  const returnTargets = accessible
    .filter((item) => item.id !== org.id && !item.isDemo && item.kind !== MASTER_ORG_KIND)
    .map((item) => ({ id: item.id, name: item.name }));

  return (
    <AuthSessionProvider session={session}>
      <SiteThemeProvider initialTheme={initialTheme}>
        <div className="app-shell min-h-screen bg-[#f4f5fb]" data-app-theme={initialTheme} suppressHydrationWarning>
          {/* Первым ребёнком — красит оболочку до первого кадра. */}
          <SiteThemeBootstrap />
          <MasterShell
            organizationName={org.name}
            code={org.linkedServiceCode ?? org.serviceCode ?? null}
            objectsCount={poolOrganizations.length}
            userName={session.user.name || session.user.email || ""}
            userEmail={session.user.email || ""}
            returnTargets={returnTargets}
          >
            {children}
          </MasterShell>
        </div>
        <Toaster />
      </SiteThemeProvider>
    </AuthSessionProvider>
  );
}
