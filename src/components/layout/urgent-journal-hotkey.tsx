"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

/**
 * P2.A.1 — Hotkey Ctrl+Shift+N (Win/Linux) / Cmd+Shift+N (Mac):
 *   1. Запрос /api/dashboard/most-urgent-journal
 *   2. Если есть pending obligation — навигация в /journals/[code]/new
 *   3. Если нет — навигация на список /journals (там уже UI выберет)
 *
 * Один глобальный keydown-listener в DashboardLayout, ноль cost когда
 * не используется.
 *
 * Не конфликтует с Cmd+Shift+N браузера потому что мы preventDefault'им.
 * Браузеры не имеют единой команды на этот shortcut (одни — приватное
 * окно, другие ничего), поэтому override OK для логированных
 * пользователей — но мы preventDefault только если внутри dashboard.
 */
export function UrgentJournalHotkey() {
  const router = useRouter();
  const t = useTranslations("layoutUi.urgentJournalHotkey");

  useEffect(() => {
    let inflight = false;
    async function handler(e: KeyboardEvent) {
      const isHotkey =
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "n";
      if (!isHotkey) return;
      e.preventDefault();
      if (inflight) return;
      inflight = true;
      try {
        const response = await fetch("/api/dashboard/most-urgent-journal", {
          cache: "no-store",
        });
        const data = (await response.json().catch(() => null)) as
          | { code: string | null }
          | null;
        if (!response.ok) {
          toast.error(t("failed"));
          return;
        }
        if (data?.code) {
          toast.message(t("urgent", { code: data.code }), { duration: 1500 });
          router.push(`/journals/${data.code}/new`);
        } else {
          toast.message(t("none"), {
            duration: 1500,
          });
          router.push("/journals");
        }
      } finally {
        inflight = false;
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [router, t]);

  return null;
}
