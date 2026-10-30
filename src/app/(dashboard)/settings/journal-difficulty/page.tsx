import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getSiteLocale } from "@/i18n/site-locale-server";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { forbidden } from "next/navigation";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { db } from "@/lib/db";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { sortJournalsByName } from "@/lib/journal-sort";
import { JournalDifficultyClient } from "@/components/settings/journal-difficulty-client";
import { PageGuide } from "@/components/ui/page-guide";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function JournalDifficultyPage() {
  const session = await requireAuth();
  if (!hasCapability(session.user, "admin.full")) forbidden();
  const organizationId = getActiveOrgId(session);
  const locale = await getSiteLocale();
  const t = await getTranslations({ locale, namespace: "settingsJournalDifficulty" });

  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { journalDifficultyJson: true },
  });
  const stored = (org?.journalDifficultyJson ?? {}) as Record<string, unknown>;
  const initial: Record<string, number> = {};
  for (const [code, v] of Object.entries(stored)) {
    if (typeof v === "number" && v >= 1 && v <= 5) {
      initial[code] = Math.round(v);
    }
  }

  const journals = sortJournalsByName(ACTIVE_JOURNAL_CATALOG, (j) => j.name).map((j) => ({
    code: j.code,
    name: j.name,
  }));

  return (
    <DomainMessagesBoundary namespaces={["settingsJournalDifficulty"]}>
    <div className="space-y-5">
      {/* Тёмный hero снят: под заголовком уже стоит PageGuide, который
          подробно разбирает шкалу 1–5 — бейдж «дефолты из практики
          общепита» был его дублем и удалён. Ссылка на «Распределение
          задач» стала кнопкой-действием справа. */}
      <PageHeader
        title={t("title")}
        description={t.rich("description", { strong: (chunks) => <strong>{chunks}</strong> })}
        actions={
          <Link
            href="/settings/workload-balance"
            className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
          >
            {t("balanceLink")}
          </Link>
        }
      />

      <PageGuide
        storageKey="journal-difficulty"
        title={t("guide.title")}
        bullets={[
          {
            title: t("guide.one.title"),
            body: t("guide.one.body"),
          },
          {
            title: t("guide.twoThree.title"),
            body: t("guide.twoThree.body"),
          },
          {
            title: t("guide.four.title"),
            body: t("guide.four.body"),
          },
          {
            title: t("guide.five.title"),
            body: t("guide.five.body"),
          },
        ]}
        qa={[
          {
            q: t("guide.why.question"),
            a: t("guide.why.answer"),
          },
          {
            q: t("guide.equal.question"),
            a: t("guide.equal.answer"),
          },
        ]}
      />

      <JournalDifficultyClient
        journals={journals}
        initialDifficulty={initial}
      />
    </div>
    </DomainMessagesBoundary>
  );
}
