"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Copy, Inbox, RefreshCw, Send, Unlink } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

/**
 * Рабочий Telegram сотрудника панели: сюда приходят обращения с сайта,
 * онлайн-чат и заявки, и отсюда же можно ответить клиенту свайпом.
 * Раньше привязать его можно было только из кабинета организации
 * («Настройки → Уведомления»), и менеджер поддержки об этом не знал.
 */
export function TelegramLinkCard({ linked, botLink, startCommand }: { linked: boolean; botLink: string | null; startCommand: string }) {
  const t = useTranslations("rootPanel.me.telegram");
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function unlink() {
    setBusy(true);
    try {
      const res = await fetch("/api/notifications/telegram/unlink", { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
      toast.success(t("unlinkDone"));
      router.refresh();
    } catch {
      toast.error(t("error"));
    } finally {
      setBusy(false);
    }
  }

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(startCommand);
      toast.success(t("copied"));
    } catch {
      toast.error(t("error"));
    }
  }

  return (
    <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-7" data-testid="root-telegram-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
            <Send className="size-5" />
          </span>
          <div>
            <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">{t("title")}</h2>
            <p className="mt-1 max-w-[560px] text-[14px] leading-[1.6] text-[#6f7282]">{linked ? t("linkedHint") : t("unlinkedHint")}</p>
          </div>
        </div>
        <span
          className={
            linked
              ? "inline-flex items-center gap-1.5 rounded-full bg-[#ecfdf5] px-3 py-1 text-[13px] font-medium text-[#116b2a]"
              : "inline-flex items-center gap-1.5 rounded-full bg-[#fff4f2] px-3 py-1 text-[13px] font-medium text-[#a13a32]"
          }
        >
          {linked ? <Check className="size-3.5" /> : null}
          {linked ? t("linked") : t("unlinked")}
        </span>
      </div>

      {linked ? (
        <div className="mt-5 flex flex-wrap gap-2">
          <Link
            href="/root/feedback"
            className="inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0]"
          >
            <Inbox className="size-4" />
            {t("inbox")}
          </Link>
          <button
            type="button"
            onClick={unlink}
            disabled={busy}
            className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-60"
          >
            <Unlink className="size-4 text-[#5566f6]" />
            {t("unlink")}
          </button>
        </div>
      ) : botLink ? (
        <div className="mt-5 space-y-4">
          <ol className="space-y-1.5 text-[14px] text-[#3c4053]">
            {(["step1", "step2", "step3"] as const).map((key, index) => (
              <li key={key} className="flex gap-2.5">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-[#5566f6] text-[11px] font-semibold text-[#5566f6]">
                  {index + 1}
                </span>
                {t(key)}
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-2">
            <a
              href={botLink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[15px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors hover:bg-[#4a5bf0]"
            >
              <Send className="size-4" />
              {t("connect")}
            </a>
            <button
              type="button"
              onClick={() => router.refresh()}
              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              <RefreshCw className="size-4 text-[#5566f6]" />
              {t("check")}
            </button>
          </div>
          <div className="text-[13px] text-[#6f7282]">
            {t("copyCommand")}{" "}
            <button
              type="button"
              onClick={copyCommand}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#f5f6ff] px-2 py-1 font-mono text-[12px] text-[#3848c7] transition-colors hover:bg-[#eef1ff]"
            >
              /start …
              <Copy className="size-3.5" />
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-[13px] text-[#a13a32]">{t("noBot")}</p>
      )}
    </section>
  );
}
