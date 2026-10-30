import Link from "next/link";
import { forbidden } from "next/navigation";
import { ArrowRight, ChevronDown, Fingerprint, MessageSquareText, ScrollText, ShieldCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { PageGuide } from "@/components/ui/page-guide";
import { PageHeader, PageHeaderStat } from "@/components/ui/page-header";
import { publicBaseUrl } from "@/lib/public-api/auth";
import { listOrgApiKeys } from "@/lib/public-api/key-admin";
import { keyAdminGuard } from "@/lib/public-api/key-admin-guard";
import { PUBLIC_API_TOOLS } from "@/lib/public-api/tools";
import { AiConnectClient } from "./ai-connect-client";
import { ApiTokenManager } from "./api-token-manager";

export const dynamic = "force-dynamic";

/**
 * «ИИ-ассистенты и API»: персональные ключи для MCP (ChatGPT, Claude,
 * Cursor) и REST API v1. Ниже, свёрнуто, — старый общий ключ организации
 * для датчиков и /api/external/*.
 */
export default async function ExternalApiSettingsPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const orgId = getActiveOrgId(session);
  const [t, tLegacy, org, keys] = await Promise.all([
    getTranslations("settingsManagement.aiConnect"),
    getTranslations("settingsManagement.apiPage"),
    db.organization.findUnique({ where: { id: orgId }, select: { name: true, externalApiToken: true } }),
    listOrgApiKeys(orgId, session.user.id),
  ]);
  const prompts = [t("showcase.prompt1"), t("showcase.prompt2"), t("showcase.prompt3")];
  // Тот же guard, что у /api/settings/api-keys: ROOT «войти как» и партнёр
  // видят список, но не форму — иначе нажатие кончалось бы ошибкой 403.
  const guard = keyAdminGuard(session);
  const manageBlockedReason = guard.ok ? null : t(`create.blocked.${guard.code}`);

  return (
    <DomainMessagesBoundary namespaces={["settingsManagement"]}>
      <div className="space-y-5">
        <PageHeader
          title={t("title")}
          description={t("description")}
          actions={
            <>
              <PageHeaderStat>{t("badgeMcp")}</PageHeaderStat>
              <PageHeaderStat>{t("badgeRest")}</PageHeaderStat>
            </>
          }
        />

        <PageGuide
          storageKey="settings-api-ai"
          title={t("guide.title")}
          bullets={[t("guide.b1"), t("guide.b2"), t("guide.b3")]}
          qa={[
            { q: t("guide.q1"), a: t("guide.a1") },
            { q: t("guide.q2"), a: t("guide.a2") },
            { q: t("guide.q3"), a: t("guide.a3") },
          ]}
        />

        <section className="relative overflow-hidden rounded-3xl border border-[#dfe3ff] bg-[linear-gradient(135deg,#f5f6ff_0%,#ffffff_55%,#f0edff_100%)] p-5 sm:p-6">
          <div className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-[#7a5cff] opacity-[0.08] blur-3xl" />
          <div className="relative">
            <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#5566f6]">
              <MessageSquareText className="size-4" />
              MCP · REST
            </div>
            <h2 className="mt-2 text-[22px] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024]">{t("showcase.title")}</h2>
            <p className="mt-1 text-[14px] text-[#3c4053]">{t("showcase.text")}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {prompts.map((prompt) => (
                <span
                  key={prompt}
                  className="rounded-2xl rounded-bl-md border border-[#dfe3ff] bg-white px-3.5 py-2 text-[13.5px] text-[#0b1024] shadow-[0_8px_24px_-18px_rgba(85,102,246,0.6)]"
                >
                  {prompt}
                </span>
              ))}
            </div>
          </div>
        </section>

        <AiConnectClient
          baseUrl={publicBaseUrl()}
          initialKeys={keys}
          tools={PUBLIC_API_TOOLS.map((tool) => ({ name: tool.name, access: tool.access }))}
          manageBlockedReason={manageBlockedReason}
        />

        <section className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-6">
          <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[#0b1024]">{t("security.title")}</h2>
          <ul className="mt-3 space-y-2.5 text-[14px] text-[#3c4053]">
            <li className="flex gap-3">
              <ShieldCheck className="mt-0.5 size-[18px] shrink-0 text-[#5566f6]" />
              {t("security.owner")}
            </li>
            <li className="flex gap-3">
              <ScrollText className="mt-0.5 size-[18px] shrink-0 text-[#5566f6]" />
              <span>
                {t("security.audit")}{" "}
                <Link href="/settings/audit" className="inline-flex items-center gap-1 font-medium text-[#3848c7] underline-offset-2 hover:underline">
                  {t("security.auditLink")}
                  <ArrowRight className="size-3.5" />
                </Link>
              </span>
            </li>
            <li className="flex gap-3">
              <Fingerprint className="mt-0.5 size-[18px] shrink-0 text-[#5566f6]" />
              {t("security.hash")}
            </li>
          </ul>
        </section>

        <details className="group rounded-3xl border border-[#ececf4] bg-[#fafbff] p-5 sm:p-6">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[15px] font-semibold text-[#0b1024]">
            {t("legacy.title")}
            <ChevronDown className="size-5 text-[#6f7282] transition-transform duration-200 group-open:rotate-180" />
          </summary>
          <p className="mt-2 text-[13px] text-[#6f7282]">{t("legacy.hint")}</p>
          <div className="mt-4 space-y-4">
            <div className="rounded-2xl border border-[#ececf4] bg-white p-4 sm:p-5">
              <div className="text-[14px] font-semibold text-[#0b1024]">{tLegacy("keyTitle")}</div>
              <p className="mt-1 text-[13px] text-[#6f7282]">
                {tLegacy("keyDescriptionBefore")} <code className="rounded bg-[#f5f6ff] px-1 py-0.5 text-[12px]">POST /api/external/entries</code>{" "}
                {tLegacy("keyDescriptionMiddle")} «{org?.name}». {tLegacy("keyDescriptionAfter")}
              </p>
              <div className="mt-4">
                <ApiTokenManager initialToken={org?.externalApiToken ?? null} />
              </div>
            </div>
            <div className="rounded-2xl border border-[#ececf4] bg-white p-4 text-[13px] sm:p-5">
              <div className="text-[14px] font-semibold text-[#0b1024]">{tLegacy("usageTitle")}</div>
              <pre className="mt-3 overflow-x-auto rounded-xl bg-[#0b1024] px-4 py-3 text-[12px] text-[#e6e8f5]">
{`curl -X POST https://wesetup.ru/api/external/entries \\
  -H "authorization: Bearer <YOUR_TOKEN>" \\
  -H "content-type: application/json" \\
  -d '{
    "journalCode": "hygiene",
    "date": "2026-04-16",
    "data": { "status": "healthy", "temperatureAbove37": false }
  }'`}
              </pre>
              <p className="mt-3 text-[#6f7282]">
                {tLegacy.rich("usageDescription", {
                  organizationId: (chunks) => <code className="rounded bg-[#f5f6ff] px-1 py-0.5">{chunks}</code>,
                  idempotencyKey: (chunks) => <code className="rounded bg-[#f5f6ff] px-1 py-0.5">{chunks}</code>,
                })}{" "}
                {tLegacy("healthcheckLabel")}: <code className="rounded bg-[#f5f6ff] px-1 py-0.5">GET /api/external/healthz</code>.
              </p>
            </div>
          </div>
        </details>
      </div>
    </DomainMessagesBoundary>
  );
}
