"use client";

import { useState } from "react";
import { Megaphone } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

/**
 * «Показывать окно "Что нового"».
 *
 * Окно рассказывает о появившемся после обновления. Кому-то это нужно,
 * кому-то мешает — поэтому выбор, а не жёсткое решение за человека.
 *
 * Значение живёт в аккаунте: тот, кто окно отключил, не должен получать
 * его заново на телефоне и на втором компьютере.
 */
export function WhatsNewToggle({ initial }: { initial: boolean }) {
  const t = useTranslations("settingsManagement.appearance");
  const [enabled, setEnabled] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    const next = !enabled;
    setBusy(true);
    // Показываем сразу, откатываем при ошибке: переключатель, который
    // «думает» полсекунды, люди нажимают дважды.
    setEnabled(next);
    try {
      const res = await fetch("/api/me/whats-new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) throw new Error();
      toast.success(next ? t("whatsNewEnabled") : t("whatsNewDisabled"));
    } catch {
      setEnabled(!next);
      toast.error(t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={toggle}
      disabled={busy}
      className="flex w-full items-center gap-3 rounded-2xl border border-[#ececf4] bg-white p-4 text-left transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-60"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
        <Megaphone className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold text-[#0b1024]">
          {t("whatsNewTitle")}
        </span>
        <span className="mt-0.5 block text-[13px] leading-[1.5] text-[#6f7282]">
          {t("whatsNewHint")}
        </span>
      </span>
      <span
        aria-hidden
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          enabled ? "bg-[#5566f6]" : "bg-[#dcdfed]"
        }`}
      >
        <span
          className={`absolute top-0.5 size-5 rounded-full bg-white transition-all ${
            enabled ? "left-[22px]" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}
