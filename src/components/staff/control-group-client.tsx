"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useMessages, useTranslations } from "next-intl";
import { journalTitle } from "@/i18n/journal-presentation";
import { ArrowRight, BadgeCheck, Ban, Eye, Send, UserMinus, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageGuide } from "@/components/ui/page-guide";
import { SectionPageHeader } from "@/components/layout/section-page-header";
import { StaffPicker } from "@/components/shared/staff-picker";
import {
  PersonAvatar,
  STAFF_BUTTON_PRIMARY,
  STAFF_LINK,
  STAFF_PILL,
  StaffCard,
  StaffEmptyState,
} from "@/components/staff/staff-page-ui";
import type { ControlGroupCandidate, ControlGroupMember } from "@/lib/control-group.server";
import type { ScopeSummary } from "@/lib/control-group";
import type { MessageContract } from "@/i18n/message-contract";
import type { PermissionPreset } from "@/lib/permission-presets";
import { cn } from "@/lib/utils";

type PresetKey = keyof MessageContract["staffManagement"]["access"]["presets"];

/** Сколько имён показываем в строке «Видит …» до «и ещё N». */
const PREVIEW = 3;

export function ControlGroupClient(props: {
  members: ControlGroupMember[];
  candidates: ControlGroupCandidate[];
  canManage: boolean;
  canNarrow: boolean;
}) {
  const t = useTranslations("staffPages.controlGroup");
  const tAccess = useTranslations("staffManagement.access");
  const locale = useLocale();
  const journalNames = useMessages().journals.names;
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [confirmAdd, setConfirmAdd] = useState<ControlGroupCandidate | null>(null);
  const [pendingRemove, setPendingRemove] = useState<ControlGroupMember | null>(null);
  const [busy, setBusy] = useState(false);

  const presetLabel = (preset: PermissionPreset) => tAccess(`presets.${preset as PresetKey}.label`);
  const picked = props.candidates.find((candidate) => candidate.id === pickedId) ?? null;

  const list = (names: string[]) => {
    const head = names.slice(0, PREVIEW).join(", ");
    return names.length > PREVIEW ? `${head} ${t("scope.more", { count: String(names.length - PREVIEW) })}` : head;
  };
  const journalName = (journal: { code: string; name: string }) =>
    journalTitle(locale, journalNames, journal.code, journal.name);

  const sees = (scope: ScopeSummary) => {
    if (!scope.configured) return t("scope.seesDefault");
    if (scope.viewMode === "all") return t("scope.seesAll");
    if (scope.viewMode === "none") return t("scope.seesNone");
    if (scope.viewMode === "job_positions") {
      return scope.viewJobPositions.length === 0
        ? t("scope.seesNoPositions")
        : t("scope.seesPositions", { list: list(scope.viewJobPositions.map((item) => item.name)) });
    }
    return scope.viewUsers.length === 0
      ? t("scope.seesNoUsers")
      : t("scope.seesUsers", { count: scope.viewUsers.length, list: list(scope.viewUsers.map((item) => item.name)) });
  };
  const assigns = (scope: ScopeSummary) =>
    scope.assignableJournals.length === 0
      ? t("scope.assignsAll")
      : t("scope.assigns", { list: list(scope.assignableJournals.map(journalName)) });

  async function setPreset(userId: string, preset: "control_group" | null, done: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/staff/${userId}/preset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preset }),
      });
      const payload = (await response.json().catch(() => null)) as { code?: string } | null;
      if (!response.ok) {
        toast.error(
          payload?.code === "SELF_LOCKOUT"
            ? tAccess("presetSelfLocked")
            : response.status === 403
              ? t("errors.forbidden")
              : response.status === 404
                ? t("errors.notFound")
                : t("errors.saveFailed")
        );
        return;
      }
      toast.success(done);
      setPickedId(null);
      startTransition(() => router.refresh());
    } catch {
      toast.error(t("errors.network"));
    } finally {
      setBusy(false);
    }
  }

  function add(candidate: ControlGroupCandidate) {
    // Администратор потеряет полный доступ — сначала объясняем, что будет.
    if (candidate.effectivePreset === "admin") {
      setConfirmAdd(candidate);
      return;
    }
    void setPreset(candidate.id, "control_group", t("toast.added", { name: candidate.name }));
  }

  return (
    <div className="space-y-4" data-control-group-page>
      <SectionPageHeader description={t("description")} />

      <PageGuide
        storageKey="settings-control-group"
        title={t("guide.title")}
        bullets={[
          { title: t("guide.whoTitle"), body: t("guide.whoBody") },
          { title: t("guide.scopeTitle"), body: t("guide.scopeBody") },
          { title: t("guide.removeTitle"), body: t("guide.removeBody") },
        ]}
      />

      <StaffCard id="rights" number={1} title={t("rights.title")} description={t("rights.hint")}>
        <ul className="grid gap-2 sm:grid-cols-2" data-control-group-rights>
          {[
            { icon: <Eye className="size-4" />, title: t("rights.seesTitle"), body: t("rights.seesBody"), tone: "ok" },
            { icon: <BadgeCheck className="size-4" />, title: t("rights.verifyTitle"), body: t("rights.verifyBody"), tone: "ok" },
            { icon: <Send className="size-4" />, title: t("rights.assignTitle"), body: t("rights.assignBody"), tone: "ok" },
            { icon: <Ban className="size-4" />, title: t("rights.fillTitle"), body: t("rights.fillBody"), tone: "no" },
          ].map((item) => (
            <li key={item.title} className="flex gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-3.5">
              <span
                aria-hidden
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-xl",
                  item.tone === "ok" ? "bg-[#eef1ff] text-[#3848c7]" : "bg-[#fff4f2] text-[#a13a32]"
                )}
              >
                {item.icon}
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] font-medium text-[#0b1024]">{item.title}</span>
                <span className="block text-[12.5px] leading-[1.5] text-[#6f7282]">{item.body}</span>
              </span>
            </li>
          ))}
        </ul>
      </StaffCard>

      <StaffCard
        id="members"
        number={2}
        title={t("members.title")}
        description={props.canNarrow ? t("members.hint") : t("members.hintNoHierarchy")}
        aside={
          props.members.length > 0 ? (
            <span className={cn(STAFF_PILL, "bg-[#f5f6ff] px-3 py-1 text-[13px] text-[#3848c7]")}>
              {t("members.count", { count: props.members.length })}
            </span>
          ) : null
        }
      >
        {props.members.length === 0 ? (
          <StaffEmptyState title={t("members.emptyTitle")} hint={props.canManage ? t("members.emptyHint") : t("members.emptyHintReadOnly")} />
        ) : (
          <ul className="divide-y divide-[#ececf4] overflow-hidden rounded-2xl border border-[#ececf4]" data-control-group-members>
            {props.members.map((member) => (
              <li key={member.id} data-member={member.name} className="flex flex-wrap items-start gap-x-3 gap-y-2 bg-white px-3 py-3 sm:px-4">
                <PersonAvatar name={member.name} />
                <div className="min-w-0 flex-1 basis-[220px]">
                  <div className="text-[14px] font-medium text-[#0b1024]">{member.name}</div>
                  <div className="text-[12.5px] text-[#6f7282]">{member.position || t("members.noPosition")}</div>
                  <ul className="mt-1.5 space-y-0.5 text-[13px] text-[#3c4053]">
                    <li className="flex gap-1.5">
                      <Eye className="mt-0.5 size-3.5 shrink-0 text-[#5566f6]" aria-hidden />
                      <span className="min-w-0 [overflow-wrap:anywhere]">{sees(member.scope)}</span>
                    </li>
                    <li className="flex gap-1.5">
                      <Send className="mt-0.5 size-3.5 shrink-0 text-[#5566f6]" aria-hidden />
                      <span className="min-w-0 [overflow-wrap:anywhere]">{assigns(member.scope)}</span>
                    </li>
                  </ul>
                  {props.canNarrow ? (
                    <Link href="/settings/staff-hierarchy" className={cn(STAFF_LINK, "mt-1.5 text-[12.5px]")}>
                      {t("members.narrow")}
                      <ArrowRight className="size-3" />
                    </Link>
                  ) : null}
                </div>
                {props.canManage ? (
                  <button
                    type="button"
                    onClick={() => setPendingRemove(member)}
                    disabled={busy}
                    className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-[#ffd2cd] bg-[#fff4f2] px-3 text-[13px] font-medium text-[#a13a32] transition-colors duration-150 hover:bg-[#ffe9e5] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#a13a32]/15 disabled:opacity-60"
                    data-testid="control-group-remove"
                  >
                    <UserMinus className="size-4" />
                    {t("members.remove")}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </StaffCard>

      <StaffCard id="add" number={3} title={t("add.title")} description={props.canManage ? t("add.hint") : t("add.readOnly")}>
        {props.canManage ? (
          props.candidates.length === 0 ? (
            <p className="text-[13px] text-[#6f7282]">{t("add.noCandidates")}</p>
          ) : (
            <div className="space-y-3" data-control-group-add>
              <div className="max-w-[460px]">
                <StaffPicker
                  value={pickedId}
                  onChange={setPickedId}
                  staff={props.candidates.map((candidate) => ({
                    id: candidate.id,
                    name: candidate.name,
                    title: candidate.position,
                    isManager: candidate.isManager,
                  }))}
                  placeholder={t("add.placeholder")}
                />
              </div>
              {picked ? (
                <p className="text-[13px] text-[#3c4053]" data-control-group-preview>
                  {t("add.preview", { from: presetLabel(picked.effectivePreset), to: presetLabel("control_group") })}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => picked && add(picked)}
                disabled={!picked || busy}
                className={STAFF_BUTTON_PRIMARY}
                data-testid="control-group-add"
              >
                <UserPlus className="size-4" />
                {t("add.button")}
              </button>
            </div>
          )
        ) : null}
      </StaffCard>

      {confirmAdd ? (
        <ConfirmDialog
          open
          onClose={() => setConfirmAdd(null)}
          onConfirm={async () => {
            const candidate = confirmAdd;
            setConfirmAdd(null);
            await setPreset(candidate.id, "control_group", t("toast.added", { name: candidate.name }));
          }}
          variant="warn"
          title={t("confirmAdd.title", { name: confirmAdd.name })}
          description={t("confirmAdd.description")}
          bullets={[
            { label: t("confirmAdd.losesAdmin"), tone: "warn" },
            { label: t("confirmAdd.keeps") },
            { label: t("confirmAdd.undo") },
          ]}
          confirmLabel={t("confirmAdd.confirm")}
          cancelLabel={t("cancel")}
        />
      ) : null}

      {pendingRemove ? (
        <ConfirmDialog
          open
          onClose={() => setPendingRemove(null)}
          onConfirm={async () => {
            const member = pendingRemove;
            setPendingRemove(null);
            await setPreset(member.id, null, t("toast.removed", { name: member.name }));
          }}
          variant="warn"
          title={t("confirmRemove.title", { name: pendingRemove.name })}
          description={t("confirmRemove.description")}
          bullets={[
            { label: t("confirmRemove.preset", { preset: presetLabel(pendingRemove.defaultPreset) }) },
            { label: t("confirmRemove.rights"), tone: "warn" },
          ]}
          confirmLabel={t("confirmRemove.confirm")}
          cancelLabel={t("cancel")}
        />
      ) : null}
    </div>
  );
}
