import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiTokenManager } from "./api-token-manager";
import { getTranslations } from "next-intl/server";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";

export const dynamic = "force-dynamic";

export default async function ExternalApiSettingsPage() {
  const t = await getTranslations("settingsManagement.apiPage");
  // Role-gate через единый helper — все management-роли имеют доступ.
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/journals");
  const org = await db.organization.findUnique({
    where: { id: getActiveOrgId(session) },
    select: { name: true, externalApiToken: true },
  });

  return (
    <DomainMessagesBoundary namespaces={["settingsManagement"]}>
    <div className="space-y-5">
      <div>
        <h1 className="text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("description")}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("keyTitle")}</CardTitle>
          <CardDescription>
            {t("keyDescriptionBefore")} <code className="rounded bg-muted px-1 py-0.5 text-[12px]">POST /api/external/entries</code>{" "}
            {t("keyDescriptionMiddle")} «{org?.name}». {t("keyDescriptionAfter")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ApiTokenManager initialToken={org?.externalApiToken ?? null} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("usageTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <pre className="overflow-x-auto rounded-xl bg-muted px-4 py-3 text-[12px]">
{`curl -X POST https://wesetup.ru/api/external/entries \\
  -H "authorization: Bearer <YOUR_TOKEN>" \\
  -H "content-type: application/json" \\
  -d '{
    "journalCode": "hygiene",
    "date": "2026-04-16",
    "data": { "status": "healthy", "temperatureAbove37": false }
  }'`}
          </pre>
          <p className="text-muted-foreground">
            {t.rich("usageDescription", {
              organizationId: (chunks) => <code className="rounded bg-muted px-1 py-0.5">{chunks}</code>,
              idempotencyKey: (chunks) => <code className="rounded bg-muted px-1 py-0.5">{chunks}</code>,
            })}{" "}
            {t("healthcheckLabel")}:{" "}
            <code className="rounded bg-muted px-1 py-0.5">GET /api/external/healthz</code>. {t("docsLinkLead")}{" "}
            <a href="/developers" target="_blank" rel="noreferrer" className="text-[#3848c7] underline underline-offset-2">wesetup.ru/developers</a>.
          </p>
        </CardContent>
      </Card>
    </div>
    </DomainMessagesBoundary>
  );
}
