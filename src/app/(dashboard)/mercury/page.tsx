import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { PageGuide } from "@/components/ui/page-guide";
import { PageHeader, PageHeaderStat } from "@/components/ui/page-header";
import { getActiveBuildingId } from "@/lib/active-building";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { buildingWhere } from "@/lib/building-scope";
import { db } from "@/lib/db";
import { hasPlanFeature } from "@/lib/billing.server";
import { describeDeadline } from "@/lib/mercury/deadline";
import { resolveTransportMode } from "@/lib/mercury/transport";

import { IncomingVsdClient } from "./incoming-vsd-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * «Входящие ВСД» — рабочий экран менеджера.
 *
 * Смысл страницы в одном действии: увидеть, что приехало, ввести
 * физический контроль и одной кнопкой получить строку журнала приёмки
 * плюс погашенный в Меркурии документ.
 */
export default async function MercuryPage() {
  const t = await getTranslations("mercuryUi.page");
  const session = await requireAuth();
  const organizationId = getActiveOrgId(session);
  const buildingId = await getActiveBuildingId(session);

  const [available, integration, rows] = await Promise.all([
    // «Меркурий» — возможность «Премиума» (и пробного, прежней «Подписки», демо).
    hasPlanFeature(organizationId, "mercury"),
    db.mercuryIntegration.findUnique({
      where: { organizationId },
      select: { enabled: true, autoProcessMode: true },
    }),
    db.mercuryVetDocument.findMany({
      where: {
        organizationId,
        ...buildingWhere(buildingId),
        NOT: { localStatus: "irrelevant" },
      },
      orderBy: [{ processingDueAt: "asc" }, { firstSeenAt: "desc" }],
      take: 200,
      select: {
        id: true,
        uuid: true,
        number: true,
        remoteStatus: true,
        localStatus: true,
        deliveryDate: true,
        processingDueAt: true,
        productName: true,
        volume: true,
        unit: true,
        batchNumber: true,
        expiryDate: true,
        consignorName: true,
        manufacturerName: true,
        accompanyingDocs: true,
        transportInfo: true,
        processError: true,
        journalDocumentId: true,
      },
    }),
  ]);

  const now = new Date();
  const documents = rows.map((row) => ({
    ...row,
    deliveryDate: row.deliveryDate?.toISOString() ?? null,
    processingDueAt: row.processingDueAt?.toISOString() ?? null,
    expiryDate: row.expiryDate?.toISOString() ?? null,
    deadline: describeDeadline(row.processingDueAt, now),
  }));

  const pending = documents.filter((d) =>
    ["new", "acknowledged"].includes(d.localStatus),
  );
  const overdue = pending.filter((d) => d.deadline.tone === "overdue");

  if (!available) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("title")} eyebrow={t("eyebrow")} />
        <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-14 text-center">
          <div className="text-[15px] font-medium text-[#0b1024]">
            {t("proTitle")}
          </div>
          <p className="mx-auto mt-1.5 max-w-[420px] text-[13px] leading-[1.6] text-[#6f7282]">
            {t("proDescription")}
          </p>
          <Link
            href="/settings/subscription#tariffs"
            className="mt-4 inline-flex h-10 items-center justify-center rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white transition-colors hover:bg-[#4a5bf0]"
          >
            {t("proCta")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("description")}
        actions={
          <>
            {overdue.length > 0 ? (
              <PageHeaderStat tone="warn">
                {t("overdue", { count: overdue.length })}
              </PageHeaderStat>
            ) : null}
            <PageHeaderStat>{t("pending", { count: pending.length })}</PageHeaderStat>
            <Link
              href="/settings/integrations/mercury"
              className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              {t("settings")}
            </Link>
          </>
        }
      />

      <PageGuide
        title={t("guideTitle")}
        storageKey="mercury-incoming-v1"
        bullets={[
          {
            title: t("bullet1Title"),
            body: t("bullet1Body"),
          },
          {
            title: t("bullet2Title"),
            body: t("bullet2Body"),
          },
          {
            title: t("bullet3Title"),
            body: t("bullet3Body"),
          },
        ]}
        qa={[
          {
            q: t("q1"),
            a: t("a1"),
          },
          {
            q: t("q2"),
            a: t("a2"),
          },
        ]}
      />

      <IncomingVsdClient
        documents={documents}
        enabled={integration?.enabled ?? false}
        demoMode={resolveTransportMode({}) === "mock"}
      />
    </div>
  );
}
