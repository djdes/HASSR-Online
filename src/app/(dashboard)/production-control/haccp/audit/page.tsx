import Link from "next/link";
import { forbidden } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { getDisabledJournalCodes } from "@/lib/disabled-journals";
import { hasJournalAccess } from "@/lib/journal-acl";
import { CHECKLIST_CODE } from "@/lib/custom-checklists";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { PpkBlockHeader } from "@/components/production-control/ppk-block-header";
import {
  PPK_BUTTON_OUTLINE_CLASS,
  PPK_BUTTON_TEXT_CLASS,
} from "@/components/production-control/ppk-ui";

export const dynamic = "force-dynamic";

const AUDIT_CODES = ["audit_plan", "audit_protocol", "audit_report"] as const;

/** Название проверки: из снимка шаблона на момент запуска, иначе заголовок самой проверки. */
function inspectionTitle(snapshot: unknown, fallback: string): string {
  const title = (snapshot as { title?: unknown } | null)?.title;
  return typeof title === "string" && title.trim() ? title : fallback;
}

/** ХАССП, шаг 7 — внутренний аудит: журналы аудита и последние проверки по чек-листам. */
export default async function AuditPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const organizationId = getActiveOrgId(session);

  const yearAgo = new Date();
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);

  const [t, locale, templates, disabled, hasChecklists] = await Promise.all([
    getTranslations("productionControl.audit"),
    getLocale(),
    db.journalTemplate.findMany({
      where: { code: { in: [...AUDIT_CODES] } },
      select: { id: true, code: true, name: true },
    }),
    getDisabledJournalCodes(organizationId),
    hasJournalAccess(session.user, CHECKLIST_CODE).catch(() => false),
  ]);

  const lastDocs = await Promise.all(
    templates.map((template) =>
      db.journalDocument.findFirst({
        where: { organizationId, templateId: template.id },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
    ),
  );
  const journals = AUDIT_CODES.flatMap((code) => {
    const index = templates.findIndex((template) => template.code === code);
    return index < 0 ? [] : [{ template: templates[index], last: lastDocs[index] }];
  });

  const [runsCount, runs] = hasChecklists
    ? await Promise.all([
        db.checklistInspection.count({ where: { organizationId, createdAt: { gte: yearAgo } } }),
        db.checklistInspection.findMany({
          where: { organizationId, createdAt: { gte: yearAgo } },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: { id: true, title: true, snapshot: true, status: true, createdAt: true },
        }),
      ])
    : [0, []];

  const formatDate = (date: Date) =>
    date.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="space-y-8">
      <PpkBlockHeader blockKey="audit" lead={t("lead")} />

      <section className="space-y-3">
        <h2 className="text-[16px] font-semibold text-[#0b1024]">{t("journalsTitle")}</h2>
        <ul className="grid gap-3 md:grid-cols-3">
          {journals.map(({ template, last }) => {
            const off = disabled.has(template.code);
            return (
              <li
                key={template.code}
                className="flex flex-col gap-3 rounded-2xl border border-[#ececf4] bg-white p-4 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[14.5px] font-semibold text-[#0b1024]">{template.name}</div>
                  {off ? (
                    <span className="shrink-0 rounded-full bg-[#f5f6ff] px-2.5 py-1 text-[12px] font-medium text-[#3848c7]">
                      {t("disabled")}
                    </span>
                  ) : null}
                </div>
                <div className="text-[13px] text-[#6f7282]">
                  {last ? t("lastDoc", { date: formatDate(last.createdAt) }) : t("noDocs")}
                </div>
                <div className="mt-auto">
                  {off ? (
                    <Link href="/settings/journals" className={PPK_BUTTON_OUTLINE_CLASS}>
                      {t("enable")}
                    </Link>
                  ) : (
                    <Link href={`/journals/${template.code}`} className={PPK_BUTTON_OUTLINE_CLASS}>
                      {t("open")}
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {hasChecklists ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[16px] font-semibold text-[#0b1024]">{t("checklistsTitle")}</h2>
            <Link href="/checklists" className={PPK_BUTTON_OUTLINE_CLASS}>
              {t("openChecklists")}
            </Link>
          </div>
          <div className="rounded-2xl border border-[#ececf4] bg-white p-4 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
            <div className="text-[13.5px] font-medium text-[#0b1024]">{t("runsYear", { count: String(runsCount) })}</div>
            {runs.length === 0 ? (
              <p className="mt-2 text-[13px] text-[#6f7282]">{t("noRuns")}</p>
            ) : (
              <ul className="mt-2 divide-y divide-[#ececf4]">
                {runs.map((run) => (
                  <li key={run.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <Link
                      href={`/checklists/inspections/${run.id}`}
                      className={`${PPK_BUTTON_TEXT_CLASS} h-auto min-w-0 px-0 py-1 hover:bg-transparent hover:underline`}
                    >
                      <span className="truncate">{inspectionTitle(run.snapshot, run.title)}</span>
                    </Link>
                    <span className="flex items-center gap-3 text-[12.5px] text-[#6f7282]">
                      <span>{formatDate(run.createdAt)}</span>
                      <span
                        className={
                          run.status === "completed"
                            ? "rounded-full bg-[#f5f6ff] px-2.5 py-1 font-medium text-[#3848c7]"
                            : "rounded-full bg-[#fff7e6] px-2.5 py-1 font-medium text-[#8a5a00]"
                        }
                      >
                        {run.status === "completed" ? t("status.completed") : t("status.draft")}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
