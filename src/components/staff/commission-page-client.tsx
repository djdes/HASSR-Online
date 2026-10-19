"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowRight, Info, KeyRound, Power, RefreshCw, Users } from "lucide-react";
import { CommissionDialog } from "@/components/journals/commission-dialog";
import { PageGuide } from "@/components/ui/page-guide";
import { SectionPageHeader } from "@/components/layout/section-page-header";
import {
  PersonAvatar,
  STAFF_BUTTON_OUTLINE,
  STAFF_BUTTON_PRIMARY,
  STAFF_PILL,
  StaffCard,
  StaffEmptyState,
} from "@/components/staff/staff-page-ui";
import { commissionRoleLabel, type BrakerageCommissionMember } from "@/lib/brakerage-commission";
import { cn } from "@/lib/utils";

type CommissionCode = "finished_product" | "perishable_rejection";

type Candidate = { id: string; name: string; position: string; hasPin: boolean };

type CommissionState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; members: BrakerageCommissionMember[]; candidates: Candidate[]; canManage: boolean };

export function CommissionPageClient({ journals }: { journals: Array<{ code: CommissionCode; enabled: boolean }> }) {
  const t = useTranslations("staffPages.commission");
  return (
    <div className="space-y-4" data-commission-page>
      <SectionPageHeader description={t("description")} />
      <PageGuide
        storageKey="settings-brakerage-commission"
        title={t("guide.title")}
        bullets={[
          { title: t("guide.whoTitle"), body: t("guide.whoBody") },
          { title: t("guide.signTitle"), body: t("guide.signBody") },
          { title: t("guide.copyTitle"), body: t("guide.copyBody") },
        ]}
      />
      {journals.map((journal, index) => (
        <CommissionCard key={journal.code} number={index + 1} code={journal.code} enabled={journal.enabled} />
      ))}
    </div>
  );
}

function CommissionCard({ number, code, enabled }: { number: number; code: CommissionCode; enabled: boolean }) {
  const t = useTranslations("staffPages.commission");
  const tJournals = useTranslations("journals.names");
  const tRoles = useTranslations("journalControls.commissionDialog");
  const [state, setState] = useState<CommissionState>({ status: "loading" });
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/settings/brakerage-commission/${code}`, { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as {
        members?: BrakerageCommissionMember[];
        candidates?: Candidate[];
        canManage?: boolean;
      };
      setState({
        status: "ready",
        members: body.members ?? [],
        candidates: body.candidates ?? [],
        canManage: body.canManage === true,
      });
    } catch {
      setState({ status: "error" });
    }
  }, [code]);

  // Состав — из API при открытии страницы (и после сохранения в окне).
  useEffect(() => {
    void load();
  }, [load]);

  const roleLabels = { chair: tRoles("chair"), member: tRoles("member") };
  const candidates = state.status === "ready" ? new Map(state.candidates.map((candidate) => [candidate.id, candidate])) : null;

  return (
    <StaffCard
      id={code}
      number={number}
      title={t(`journals.${code}.title`)}
      description={t(`journals.${code}.hint`)}
      aside={
        state.status === "ready" && state.members.length > 0 ? (
          <span className={cn(STAFF_PILL, "bg-[#f5f6ff] px-3 py-1 text-[13px] text-[#3848c7]")}>
            {t("count", { count: state.members.length })}
          </span>
        ) : null
      }
    >
      <div data-commission={code}>
        {state.status === "loading" ? (
          <div className="space-y-2" aria-busy="true" aria-label={t("loading")}>
            {[0, 1].map((key) => (
              <div key={key} className="h-[60px] animate-pulse rounded-2xl bg-[#f5f6ff]" />
            ))}
          </div>
        ) : state.status === "error" ? (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-[#fff4f2] px-4 py-3 text-[13.5px] text-[#a13a32]">
            {t("loadFailed")}
            <button type="button" onClick={() => void load()} className={STAFF_BUTTON_OUTLINE}>
              <RefreshCw className="size-4 text-[#5566f6]" />
              {t("retry")}
            </button>
          </div>
        ) : state.members.length === 0 ? (
          <StaffEmptyState title={t("emptyTitle")} hint={state.canManage ? t("emptyHint") : t("emptyHintReadOnly")}>
            {state.canManage ? (
              <button type="button" onClick={() => setDialogOpen(true)} className={STAFF_BUTTON_PRIMARY} data-testid="commission-edit">
                <Users className="size-4" />
                {t("assign")}
              </button>
            ) : null}
          </StaffEmptyState>
        ) : (
          <ul className="divide-y divide-[#ececf4] overflow-hidden rounded-2xl border border-[#ececf4]">
            {state.members.map((member) => {
              const candidate = candidates?.get(member.employeeId);
              const isChair = member.roleKind === "chair";
              return (
                <li key={member.id} data-member={member.employeeName} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 bg-white px-3 py-2.5 sm:px-4">
                  <PersonAvatar name={member.employeeName} />
                  <span className="min-w-0 flex-1 basis-[180px]">
                    <span className="block text-[14px] font-medium text-[#0b1024] [overflow-wrap:anywhere]">{member.employeeName}</span>
                    <span className="block text-[12.5px] text-[#6f7282]">{candidate?.position || t("noPosition")}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className={cn(STAFF_PILL, isChair ? "bg-[#5566f6] text-white" : "bg-[#f5f6ff] text-[#3848c7]")}>
                      {commissionRoleLabel(member, roleLabels)}
                    </span>
                    {candidate && !candidate.hasPin ? (
                      <span className={cn(STAFF_PILL, "bg-[#fff8eb] text-[#b25f00]")} title={t("noPinHint")}>
                        <KeyRound className="size-3" aria-hidden />
                        {t("noPin")}
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-3 flex items-start gap-2 text-[12.5px] leading-[1.5] text-[#6f7282]">
          <Info className="mt-0.5 size-3.5 shrink-0 text-[#5566f6]" aria-hidden />
          {t("copyHint")}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {state.status === "ready" && state.canManage && state.members.length > 0 ? (
            <button type="button" onClick={() => setDialogOpen(true)} className={STAFF_BUTTON_PRIMARY} data-testid="commission-edit">
              <Users className="size-4" />
              {t("edit")}
            </button>
          ) : null}
          <Link
            href={`/journals/${code}`}
            title={tJournals(code)}
            className={STAFF_BUTTON_OUTLINE}
            data-testid="commission-open-journal"
          >
            {t("openJournal")}
            <ArrowRight className="size-4 text-[#5566f6]" />
          </Link>
          {!enabled ? (
            <>
              <span className={cn(STAFF_PILL, "bg-[#fff8eb] px-3 py-1 text-[13px] text-[#b25f00]")} data-testid="commission-journal-off">
                {t("journalOff")}
              </span>
              <Link href="/settings/journals" className={STAFF_BUTTON_OUTLINE}>
                <Power className="size-4 text-[#5566f6]" />
                {t("enableJournal")}
              </Link>
            </>
          ) : null}
        </div>
        {state.status === "ready" && !state.canManage ? (
          <p className="mt-2 text-[12.5px] text-[#9b9fb3]">{t("readOnly")}</p>
        ) : null}
      </div>

      <CommissionDialog
        code={code}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        // Окно само закрывается после «Сохранить состав»; после «Новый человек»
        // оно остаётся открытым (показывает PIN) — список обновляем в обоих случаях.
        onSaved={() => void load()}
      />
    </StaffCard>
  );
}
