import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Sparkles } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasCapability } from "@/lib/permission-presets";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import {
  PRODUCTION_DOC_KINDS,
  productionDocServiceKey,
} from "@/lib/production-control-docs";
import { PPK_MENU_GROUPS, ppkBlockHref, ppkMenuBlocks } from "@/lib/ppk/registry";
import { loadPpkStatuses } from "@/lib/ppk/facts.server";
import { ppkNextStep, ppkProgress } from "@/lib/ppk/status";
import { STARTER_BLOCKS } from "@/lib/ppk/starter-packs";
import { DocumentSlot } from "@/components/production-control/document-slot";
import { PpkStarterWizard } from "@/components/production-control/ppk-starter-wizard";
import { PpkNextStep } from "@/components/production-control/ppk-next-step";
import { PpkProgressBar } from "@/components/production-control/ppk-progress-bar";
import { PpkStatusDot } from "@/components/production-control/ppk-status-dot";
import { OrganizationMark } from "@/components/layout/app-sidebar";

export const dynamic = "force-dynamic";

/**
 * «Производственный контроль → Обзор»: карточка программы с прогрессом, два
 * главных документа (свой файл или заказ у специалиста), следующий шаг и
 * карта разделов с точками статуса.
 */
export default async function ProductionControlPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/journals");
  const organizationId = getActiveOrgId(session);
  const canManage = hasCapability(session.user, "admin.full");

  const [rows, organization, statuses, t, nav, blockCounts] = await Promise.all([
    db.knowledgeDocument.findMany({
      where: { organizationId, kind: { in: [...PRODUCTION_DOC_KINDS] } },
      select: { kind: true, fileName: true, mimeType: true, sizeBytes: true, updatedAt: true },
    }),
    db.organization.findUnique({ where: { id: organizationId }, select: { name: true, logoUrl: true } }),
    loadPpkStatuses(organizationId),
    getTranslations("productionControl"),
    getTranslations("navigation"),
    db.ppkRecord.groupBy({
      by: ["block"],
      where: { organizationId, block: { in: [...STARTER_BLOCKS] } },
      _count: { _all: true },
    }),
  ]);
  // Блоки, где уже есть данные: мастер «типовыми за 10 минут» их не тронет.
  const filledBlocks = STARTER_BLOCKS.filter((block) => blockCounts.some((row) => row.block === block));

  const { done, total } = ppkProgress(statuses);
  const next = ppkNextStep(statuses);
  const progress = t("overview.progress", { done: String(done), total: String(total) });

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-4 rounded-3xl border border-[#ececf4] bg-white p-5 md:grid-cols-[auto_1fr_auto] md:p-6">
        <OrganizationMark logoUrl={organization?.logoUrl ?? null} name={organization?.name ?? ""} compact />
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-[#0b1024] md:text-[26px]">
            {t("overview.title")}
          </h1>
          <p className="mt-1 text-[13.5px] text-[#6f7282] [overflow-wrap:anywhere]">
            {organization?.name ? `${organization.name} · ` : ""}
            {progress}
          </p>
          <PpkProgressBar done={done} total={total} label={progress} className="mt-3 max-w-[420px]" />
        </div>
        <Link
          href="/settings/services?order=ppk-development"
          className="col-span-2 inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 md:col-span-1"
        >
          <Sparkles className="size-4 text-[#5566f6]" />
          {t("overview.fillForYou")}
        </Link>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        {PRODUCTION_DOC_KINDS.map((kind) => {
          const row = rows.find((doc) => doc.kind === kind);
          return (
            <DocumentSlot
              key={kind}
              kind={kind}
              document={
                row
                  ? { fileName: row.fileName, sizeBytes: row.sizeBytes, updatedAt: row.updatedAt.toISOString() }
                  : null
              }
              canManage={canManage}
              orderHref={`/settings/services?order=${productionDocServiceKey(kind)}`}
              assembleHref={kind === "ppk" ? "/production-control/program" : "/production-control/haccp-plan"}
            />
          );
        })}
      </div>

      {total > 0 && done / total < 0.4 ? <PpkStarterWizard filled={filledBlocks} /> : null}

      {next ? <PpkNextStep blockKey={next.key} /> : null}

      <section className="space-y-3">
        <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-[#0b1024]">{t("overview.mapTitle")}</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {PPK_MENU_GROUPS.map((group) => {
            // «Программа» — это сам обзор, отдельной строкой она не нужна.
            const blocks = ppkMenuBlocks(group.key).filter((block) => block.key !== "program");
            if (blocks.length === 0) return null;
            const counted = blocks.filter((block) => block.counted);
            const groupDone = counted.filter((block) => statuses[block.key] === "done").length;
            return (
              <div
                key={group.key}
                className="rounded-3xl border border-[#ececf4] bg-white p-5 transition-shadow duration-150 hover:shadow-[0_16px_40px_-24px_rgba(85,102,246,0.35)]"
              >
                <h3 className="flex items-baseline justify-between gap-2 text-[16px] font-semibold text-[#0b1024]">
                  <span>{group.key === "main" ? t("overview.mapMain") : nav(`shell.menuGroups.${group.key}`)}</span>
                  {counted.length > 0 ? (
                    <span className="text-[13px] font-normal tabular-nums text-[#9b9fb3]">
                      {groupDone}/{counted.length}
                    </span>
                  ) : null}
                </h3>
                <ul className="mt-2">
                  {blocks.map((block) => (
                    <li key={block.key}>
                      <Link
                        href={ppkBlockHref(block)}
                        className="-mx-2 flex min-h-[36px] items-center gap-2 rounded-xl px-2 text-[14px] text-[#3c4053] transition-colors duration-150 hover:bg-[#fafbff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                      >
                        <span className="min-w-0 flex-1">{nav(`shell.items.${block.key}`)}</span>
                        <PpkStatusDot status={statuses[block.key]} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
