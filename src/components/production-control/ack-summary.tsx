"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { BellRing, CheckCircle2, ChevronDown, Link2 } from "lucide-react";
import { toast } from "sonner";
import { ackDocPath } from "@/lib/ppk/acknowledge";
import { PPK_BUTTON_OUTLINE_CLASS } from "./ppk-ui";

export type AckSummaryStats = {
  acknowledged: { userId: string; name: string; date: string }[];
  pending: { userId: string; name: string }[];
};

/**
 * Сводка ознакомления для руководителя: «Ознакомлены 7 из 12», списки «кто» и
 * «ещё нет», напоминание в Telegram и ссылка для сотрудников. Данные приходят
 * с сервера страницы; после напоминания страница не меняется.
 */
export function AckSummary({ docKey, stats }: { docKey: string; stats: AckSummaryStats }) {
  const t = useTranslations("productionControl.ack");
  const router = useRouter();
  const [open, setOpen] = useState<"done" | "pending" | null>(null);
  const [busy, setBusy] = useState(false);
  const done = stats.acknowledged.length;
  const total = done + stats.pending.length;

  async function remind() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/production-control/acknowledgements/remind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docKey }),
      });
      const body = (await response.json().catch(() => null)) as { sent?: number; error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? "failed");
      toast.success(t("reminded", { count: String(body?.sent ?? 0) }));
      router.refresh();
    } catch {
      toast.error(t("remindFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    const url = `${window.location.origin}${ackDocPath(docKey)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("linkCopied"));
    } catch {
      toast.message(url);
    }
  }

  const toggle = (key: "done" | "pending") => setOpen((current) => (current === key ? null : key));

  return (
    <section className="space-y-3 rounded-3xl border border-[#ececf4] bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[16px] font-semibold text-[#0b1024]">{t("title")}</h2>
          <p className="mt-0.5 text-[14px] text-[#6f7282]">
            {total === 0 ? t("noAudience") : t("summary", { done: String(done), total: String(total) })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={remind}
            disabled={busy || stats.pending.length === 0}
            title={stats.pending.length === 0 ? t("allDone") : undefined}
            className={PPK_BUTTON_OUTLINE_CLASS}
          >
            <BellRing className="size-4" aria-hidden />
            {t("remind")}
          </button>
          <button type="button" onClick={copyLink} className={PPK_BUTTON_OUTLINE_CLASS}>
            <Link2 className="size-4" aria-hidden />
            {t("copyLink")}
          </button>
        </div>
      </div>

      {total > 0 ? (
        <div className="space-y-2">
          {(
            [
              { key: "done" as const, label: t("acknowledged"), count: done },
              { key: "pending" as const, label: t("pending"), count: stats.pending.length },
            ]
          ).map((group) => (
            <div key={group.key} className="rounded-2xl border border-[#ececf4]">
              <button
                type="button"
                onClick={() => toggle(group.key)}
                aria-expanded={open === group.key}
                className="flex w-full items-center justify-between gap-2 rounded-2xl px-4 py-2.5 text-left text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
              >
                <span className="inline-flex items-center gap-2">
                  {group.key === "done" ? <CheckCircle2 className="size-4 text-[#1f7a45]" aria-hidden /> : null}
                  {group.label}: {group.count}
                </span>
                <ChevronDown
                  className={`size-4 text-[#9b9fb3] transition-transform duration-150 ${open === group.key ? "rotate-180" : ""}`}
                  aria-hidden
                />
              </button>
              {open === group.key ? (
                <ul className="space-y-1 border-t border-[#ececf4] px-4 py-3 text-[14px] text-[#3c4053]">
                  {group.count === 0 ? <li className="text-[#9b9fb3]">{t("nobody")}</li> : null}
                  {group.key === "done"
                    ? stats.acknowledged.map((person) => (
                        <li key={person.userId} className="flex justify-between gap-3">
                          <span>{person.name}</span>
                          <span className="text-[#6f7282]">{person.date}</span>
                        </li>
                      ))
                    : stats.pending.map((person) => <li key={person.userId}>{person.name}</li>)}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
