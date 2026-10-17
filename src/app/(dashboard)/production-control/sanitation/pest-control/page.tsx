import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { getDisabledJournalCodes } from "@/lib/disabled-journals";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { parsePpkRecords } from "@/lib/ppk/records";
import { PpkBlockHeader } from "@/components/production-control/ppk-block-header";
import { PpkCreateButton } from "@/components/production-control/ppk-ui";
import { PpkFolder } from "@/components/production-control/ppk-folder";
import { PestClient } from "./pest-client";

export const dynamic = "force-dynamic";

/** Журнал мониторинга и журнал учёта средств: карточки раздела в этом порядке. */
const JOURNAL_CODES = ["pest_control", "disinfectant_usage"] as const;

const CARD =
  "flex flex-col gap-3 rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] transition-shadow duration-200 hover:shadow-[0_16px_40px_-24px_rgba(85,102,246,0.35)]";
const LINK_BUTTON =
  "inline-flex h-10 w-fit items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

/** Дезинсекция и дератизация, санитария: план мероприятий, журналы, договор и акты. */
export default async function PestControlPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/journals");
  const organizationId = getActiveOrgId(session);

  const [rows, journalRows, disabled, t] = await Promise.all([
    db.ppkRecord.findMany({
      where: { organizationId, block: "pest-plan" },
      select: { id: true, data: true, sortOrder: true, updatedAt: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    db.journalTemplate.findMany({
      where: { code: { in: [...JOURNAL_CODES] } },
      select: { code: true, name: true },
    }),
    getDisabledJournalCodes(organizationId),
    getTranslations("productionControl.pest"),
  ]);

  const initial = parsePpkRecords("pest-plan", rows).map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }));

  // Карточки журналов идут в порядке JOURNAL_CODES; журнала нет в базе — карточки нет.
  const journals = JOURNAL_CODES.flatMap((code) => {
    const template = journalRows.find((row) => row.code === code);
    return template ? [{ code, name: template.name, enabled: !disabled.has(code) }] : [];
  });

  const header = (
    <PpkBlockHeader
      blockKey="pest-control"
      lead={t("lead")}
      reminderHint
      actions={<PpkCreateButton label={t("add")} />}
    />
  );

  return (
    <div className="space-y-10">
      <PestClient initial={initial} header={header} />

      <section className="space-y-4">
        <h2 className="text-[16px] font-semibold text-[#0b1024]">{t("journals")}</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {journals.map((journal) => (
            <div key={journal.code} className={CARD}>
              <div className="min-w-0 font-semibold text-[#0b1024]">{journal.name}</div>
              {journal.enabled ? (
                <Link href={`/journals/${journal.code}`} className={LINK_BUTTON}>
                  {t("openJournal")}
                </Link>
              ) : (
                <div className="mt-auto flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-[#f1f2f7] px-2.5 py-1 text-[12px] font-medium text-[#6f7282]">
                    {t("disabled")}
                  </span>
                  <Link
                    href="/settings/journals"
                    className="rounded-xl px-2 py-1 text-[13.5px] font-medium text-[#3848c7] transition-colors duration-150 hover:text-[#5566f6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                  >
                    {t("enable")}
                  </Link>
                </div>
              )}
            </div>
          ))}
          <div className={CARD}>
            <span className="font-semibold text-[#0b1024]">{t("order")}</span>
            <Link href="/orders/disinfection" className={`mt-auto ${LINK_BUTTON}`}>
              {t("openOrder")}
            </Link>
          </div>
        </div>
      </section>

      <div className="grid gap-8 md:grid-cols-2">
        <section className="space-y-4">
          <h2 className="text-[16px] font-semibold text-[#0b1024]">{t("contract")}</h2>
          <PpkFolder folder="pest-contract" canManage />
        </section>
        <section className="space-y-4">
          <h2 className="text-[16px] font-semibold text-[#0b1024]">{t("acts")}</h2>
          <PpkFolder folder="pest-acts" canManage />
        </section>
      </div>
    </div>
  );
}
