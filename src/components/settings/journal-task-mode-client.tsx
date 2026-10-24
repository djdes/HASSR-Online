"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  HelpCircle,
  Loader2,
  RefreshCw,
} from "lucide-react";
import {
  TASK_DISTRIBUTION_MODES,
  TASK_VERIFICATION_MODES,
  DISTRIBUTION_LABELS,
  DISTRIBUTION_HINTS,
  VERIFICATION_LABELS,
  VERIFICATION_HINTS,
  type TaskDistributionMode,
  type TaskVerificationMode,
  type TaskMode,
} from "@/lib/journal-task-modes";

type JournalRow = {
  code: string;
  name: string;
  defaultMode: TaskMode;
  override: Partial<TaskMode>;
};

type Props = {
  journals: JournalRow[];
};

export function JournalTaskModeClient({ journals: initial }: Props) {
  const t = useTranslations("settingsUi.journalTaskModeClient");
  const router = useRouter();
  const [journals, setJournals] = useState(initial);
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const filtered = search.trim()
    ? journals.filter((j) =>
        j.name.toLowerCase().includes(search.toLowerCase()),
      )
    : journals;

  async function patchJournal(
    code: string,
    patch: Partial<TaskMode> | null,
  ) {
    setSavingCode(code);
    try {
      const res = await fetch("/api/settings/journal-task-mode", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, mode: patch }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? t("saveFailed"));
      }
      const data = await res.json();
      const updatedOverride = (data?.modes?.[code] ?? {}) as Partial<TaskMode>;
      setJournals((prev) =>
        prev.map((j) =>
          j.code === code ? { ...j, override: updatedOverride } : j,
        ),
      );
      toast.success(patch === null ? t("resetToast") : t("savedToast"));
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setSavingCode(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="h-10 flex-1 min-w-[200px] rounded-2xl border border-[#dcdfed] bg-white px-3 text-[14px] focus:border-[#5566f6] focus:outline-none focus:ring-2 focus:ring-[#5566f6]/15"
        />
        <span className="text-[12px] text-[#6f7282]">
          {t("journalsCount", { shown: filtered.length, total: journals.length })}
        </span>
      </div>

      <div className="rounded-3xl border border-[#ececf4] bg-white p-3 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-5">
        <ul className="divide-y divide-[#ececf4]">
          {filtered.map((j) => (
            <JournalRow
              key={j.code}
              row={j}
              saving={savingCode === j.code}
              onPatch={(patch) => patchJournal(j.code, patch)}
            />
          ))}
        </ul>
      </div>

      <details className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4 text-[13px] text-[#3c4053]">
        <summary className="cursor-pointer list-none font-medium text-[#0b1024]">
          <span className="inline-flex items-center gap-1.5">
            <HelpCircle className="size-4 text-[#5566f6]" />
            {t("helpSummary")}
          </span>
        </summary>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div>
            <div className="font-semibold text-[#0b1024]">
              {t("distributionModes")}
            </div>
            <ul className="mt-1.5 space-y-1.5">
              {TASK_DISTRIBUTION_MODES.map((m) => (
                <li key={m}>
                  <b>{DISTRIBUTION_LABELS[m]}</b> — {DISTRIBUTION_HINTS[m]}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="font-semibold text-[#0b1024]">
              {t("verificationModes")}
            </div>
            <ul className="mt-1.5 space-y-1.5">
              {TASK_VERIFICATION_MODES.map((m) => (
                <li key={m}>
                  <b>{VERIFICATION_LABELS[m]}</b> — {VERIFICATION_HINTS[m]}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </details>
    </div>
  );
}

function JournalRow({
  row,
  saving,
  onPatch,
}: {
  row: JournalRow;
  saving: boolean;
  onPatch: (patch: Partial<TaskMode> | null) => void;
}) {
  const t = useTranslations("settingsUi.journalTaskModeClient");
  const [open, setOpen] = useState(false);
  const eff: TaskMode = {
    distribution: row.override.distribution ?? row.defaultMode.distribution,
    verification: row.override.verification ?? row.defaultMode.verification,
    siblingVisibility:
      row.override.siblingVisibility ?? row.defaultMode.siblingVisibility,
  };
  const hasOverride = Object.keys(row.override).length > 0;

  return (
    <li className="py-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center gap-2 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-[#fafbff]"
        >
          {open ? (
            <ChevronDown className="size-4 text-[#6f7282]" />
          ) : (
            <ChevronRight className="size-4 text-[#6f7282]" />
          )}
          <div className="flex-1">
            <div className="text-[14px] font-medium text-[#0b1024]">
              {row.name}
            </div>
            <div className="text-[12px] text-[#6f7282]">
              <span className="rounded-full bg-[#eef1ff] px-2 py-0.5 text-[#3848c7]">
                {DISTRIBUTION_LABELS[eff.distribution]}
              </span>
              <span className="mx-1.5 text-[#9b9fb3]">·</span>
              <span className="rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[#5566f6]">
                {VERIFICATION_LABELS[eff.verification]}
              </span>
              {hasOverride ? (
                <span className="ml-1.5 rounded-full bg-[#fff8eb] px-2 py-0.5 text-[#a13a32]">
                  {t("customised")}
                </span>
              ) : (
                <span className="ml-1.5 text-[#9b9fb3]">{t("defaultLabel")}</span>
              )}
            </div>
          </div>
        </button>
        {hasOverride ? (
          <button
            type="button"
            onClick={() => onPatch(null)}
            disabled={saving}
            title={t("resetTitle")}
            className="inline-flex h-8 items-center gap-1 rounded-xl border border-[#dcdfed] bg-white px-2.5 text-[12px] text-[#6f7282] hover:border-[#a13a32]/40 hover:bg-[#fff4f2] hover:text-[#a13a32] disabled:opacity-60"
          >
            <RefreshCw className="size-3" />
            {t("reset")}
          </button>
        ) : null}
        {saving ? (
          <Loader2 className="size-4 animate-spin text-[#5566f6]" />
        ) : null}
      </div>

      {open ? (
        <div className="mt-2 grid gap-3 rounded-2xl bg-[#fafbff] p-3 md:grid-cols-2">
          <label className="block">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6f7282]">
              {t("taskDistribution")}
            </div>
            <select
              value={eff.distribution}
              onChange={(e) =>
                onPatch({
                  distribution: e.target.value as TaskDistributionMode,
                })
              }
              disabled={saving}
              className="mt-1 w-full rounded-xl border border-[#dcdfed] bg-white px-3 py-2 text-[13px] focus:border-[#5566f6] focus:outline-none focus:ring-2 focus:ring-[#5566f6]/15 disabled:opacity-60"
            >
              {TASK_DISTRIBUTION_MODES.map((m) => (
                <option key={m} value={m}>
                  {DISTRIBUTION_LABELS[m]}
                </option>
              ))}
            </select>
            <div className="mt-1 text-[11px] leading-snug text-[#6f7282]">
              {DISTRIBUTION_HINTS[eff.distribution]}
            </div>
          </label>

          <label className="block">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6f7282]">
              {t("verification")}
            </div>
            <select
              value={eff.verification}
              onChange={(e) =>
                onPatch({
                  verification: e.target.value as TaskVerificationMode,
                })
              }
              disabled={saving}
              className="mt-1 w-full rounded-xl border border-[#dcdfed] bg-white px-3 py-2 text-[13px] focus:border-[#5566f6] focus:outline-none focus:ring-2 focus:ring-[#5566f6]/15 disabled:opacity-60"
            >
              {TASK_VERIFICATION_MODES.map((m) => (
                <option key={m} value={m}>
                  {VERIFICATION_LABELS[m]}
                </option>
              ))}
            </select>
            <div className="mt-1 text-[11px] leading-snug text-[#6f7282]">
              {VERIFICATION_HINTS[eff.verification]}
            </div>
          </label>

          <label className="flex items-start gap-2 md:col-span-2">
            <input
              type="checkbox"
              checked={eff.siblingVisibility ?? false}
              onChange={(e) =>
                onPatch({ siblingVisibility: e.target.checked })
              }
              disabled={saving}
              className="mt-0.5 size-4 rounded border-[#dcdfed] text-[#5566f6]"
            />
            <span className="text-[12px] text-[#3c4053]">
              {t.rich("siblingVisibility", {
                b: (chunks) => <b>{chunks}</b>,
              })}
            </span>
          </label>
        </div>
      ) : null}
    </li>
  );
}
