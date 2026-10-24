"use client";

import { CalendarDays, Copy, KeyRound, Link2Off, RefreshCw, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { CalendarEventKind } from "@/lib/calendar/ics";

export type CalendarPreviewGroup = {
  kind: CalendarEventKind;
  label: string;
  total: number;
  overdue: number;
  upcoming: Array<{ date: string; title: string }>;
};

const CARD = "rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]";
const PRIMARY =
  "inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] disabled:opacity-60";
const SECONDARY =
  "inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-60";

function formatDay(iso: string, locale: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString(locale, { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });
}

export function CalendarClient({
  initialToken,
  initialUrl,
  groups,
  previewDays,
}: {
  initialToken: string | null;
  initialUrl: string | null;
  groups: CalendarPreviewGroup[];
  previewDays: number;
}) {
  const t = useTranslations("settingsUi.calendarClient");
  const locale = useLocale();
  const howTo: Array<{ title: string; steps: string[] }> = [
    {
      title: t("howGoogleTitle"),
      steps: [t("howGoogle1"), t("howGoogle2"), t("howGoogle3")],
    },
    {
      title: t("howAppleTitle"),
      steps: [t("howApple1"), t("howApple2"), t("howApple3")],
    },
    {
      title: t("howOutlookTitle"),
      steps: [t("howOutlook1"), t("howOutlook2"), t("howOutlook3")],
    },
  ];
  const [url, setUrl] = useState<string | null>(initialUrl);
  const [hasToken, setHasToken] = useState(Boolean(initialToken));
  const [busy, setBusy] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);

  async function rotate() {
    setBusy(true);
    try {
      const response = await fetch("/api/settings/calendar-token", { method: "POST" });
      const data = (await response.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!response.ok || !data?.url) throw new Error(data?.error ?? t("createFailed"));
      setUrl(data.url);
      setHasToken(true);
      toast.success(hasToken ? t("rotated") : t("created"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("error"));
    } finally {
      setBusy(false);
      setRotateOpen(false);
    }
  }

  async function revoke() {
    setBusy(true);
    try {
      const response = await fetch("/api/settings/calendar-token", { method: "DELETE" });
      if (!response.ok) throw new Error(t("revokeFailed"));
      setUrl(null);
      setHasToken(false);
      toast.success(t("revoked"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("error"));
    } finally {
      setBusy(false);
      setRevokeOpen(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("copied"));
    } catch {
      toast.error(t("copyFailed"));
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
      <div className="space-y-6">
        <section className={CARD}>
          <div className="flex items-center gap-2 text-[15px] font-semibold text-[#0b1024]">
            <KeyRound className="size-4 text-[#5566f6]" />
            {t("linkTitle")}
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-[#6f7282]">
            {t("linkDescription")}
          </p>
          {url ? (
            <div className="mt-4 space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  readOnly
                  value={url}
                  data-testid="calendar-url"
                  onFocus={(e) => e.currentTarget.select()}
                  className="h-11 min-w-0 flex-1 rounded-2xl border border-[#dcdfed] bg-[#fafbff] px-4 font-mono text-[12.5px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
                />
                <button type="button" onClick={copy} className={PRIMARY}>
                  <Copy className="size-4" />
                  {t("copy")}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setRotateOpen(true)} disabled={busy} className={SECONDARY}>
                  <RefreshCw className="size-4 text-[#5566f6]" />
                  {t("rotate")}
                </button>
                <button type="button" onClick={() => setRevokeOpen(true)} disabled={busy} className={SECONDARY}>
                  <Link2Off className="size-4 text-[#a13a32]" />
                  {t("revoke")}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-4">
              <button type="button" onClick={() => void rotate()} disabled={busy} className={PRIMARY}>
                <CalendarDays className="size-4" />
                {busy ? t("creating") : t("createLink")}
              </button>
            </div>
          )}
          <div className="mt-4 flex items-start gap-2 rounded-2xl bg-[#fff8eb] px-3.5 py-3 text-[12.5px] leading-relaxed text-[#b25f00]">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              {t("warning")}
            </span>
          </div>
        </section>

        <section className={CARD}>
          <div className="text-[15px] font-semibold text-[#0b1024]">{t("howToTitle")}</div>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {howTo.map((item) => (
              <div key={item.title} className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4">
                <div className="text-[13.5px] font-semibold text-[#0b1024]">{item.title}</div>
                <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-[12.5px] leading-relaxed text-[#3c4053]">
                  {item.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </section>
      </div>

      <aside className="space-y-6">
        <section className={CARD}>
          <div className="flex items-center gap-2 text-[15px] font-semibold text-[#0b1024]">
            <CalendarDays className="size-4 text-[#5566f6]" />
            {t("previewTitle")}
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-[#6f7282]">
            {t("previewDescription", { days: previewDays })}
          </p>
          {groups.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-4 py-8 text-center">
              <div className="text-[14px] font-medium text-[#0b1024]">{t("emptyTitle")}</div>
              <p className="mx-auto mt-1.5 max-w-[320px] text-[12.5px] text-[#6f7282]">
                {t("emptyHint")}
              </p>
            </div>
          ) : (
            <ul className="mt-4 space-y-4">
              {groups.map((group) => (
                <li key={group.kind}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13.5px] font-semibold text-[#0b1024]">{group.label}</span>
                    <span className="rounded-full bg-[#f5f6ff] px-2.5 py-1 text-[12px] tabular-nums text-[#3848c7]">
                      {t("groupTotal", { count: group.total })}
                      {group.overdue > 0 ? ` · ${t("groupOverdue", { count: group.overdue })}` : ""}
                    </span>
                  </div>
                  {group.upcoming.length > 0 ? (
                    <ul className="mt-2 space-y-1.5">
                      {group.upcoming.map((event, index) => (
                        // Дата + название не уникальны (две поверки одного
                        // прибора в день, одноимённые сотрудники) — React
                        // ругался «two children with the same key».
                        <li key={`${event.date}-${event.title}-${index}`} className="flex items-start gap-3 text-[13px] leading-snug">
                          <span className="shrink-0 tabular-nums text-[#6f7282]">{formatDay(event.date, locale)}</span>
                          <span className="min-w-0 text-[#0b1024]">{event.title}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1.5 text-[12.5px] text-[#9b9fb3]">{t("nothingSoon", { days: previewDays })}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>

      <ConfirmDialog
        open={rotateOpen}
        onClose={() => setRotateOpen(false)}
        variant="warn"
        title={t("rotateTitle")}
        description={t("rotateDescription")}
        bullets={[{ label: t("rotateBullet1") }, { label: t("rotateBullet2") }]}
        confirmLabel={t("rotate")}
        onConfirm={rotate}
        confirmDisabled={busy}
      />
      <ConfirmDialog
        open={revokeOpen}
        onClose={() => setRevokeOpen(false)}
        variant="danger"
        title={t("revokeTitle")}
        description={t("revokeDescription")}
        bullets={[{ label: t("revokeBullet1") }, { label: t("revokeBullet2") }]}
        confirmLabel={t("revoke")}
        onConfirm={revoke}
        confirmDisabled={busy}
      />
    </div>
  );
}
