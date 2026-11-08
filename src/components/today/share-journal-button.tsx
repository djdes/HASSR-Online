"use client";

import { useTranslations } from "next-intl";
import { Share2 } from "lucide-react";
import { toast } from "sonner";

/**
 * «Поделиться» на странице журнала (08.11.2026): руководитель отправляет
 * повару ссылку «заполни вот этот». Телефон — системное меню «Поделиться»,
 * компьютер — ссылка в буфер обмена. Ссылка — адрес страницы без параметров
 * и якоря (они бывают служебными).
 */
export function journalShareUrl(location: { origin: string; pathname: string }): string {
  return `${location.origin}${location.pathname}`;
}

export function ShareJournalButton({ title }: { title?: string }) {
  const t = useTranslations("common.quickActions");

  async function share() {
    const url = journalShareUrl(window.location);
    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void>; canShare?: (data: ShareData) => boolean };
    const data: ShareData = { url, title: title ?? document.title.replace(/^\(\d+\)\s/, "") };
    // Системное меню — там, где оно есть и умеет ссылки (телефоны).
    if (typeof nav.share === "function" && window.matchMedia?.("(pointer: coarse)").matches && (!nav.canShare || nav.canShare(data))) {
      try {
        await nav.share(data);
        return;
      } catch (error) {
        if ((error as { name?: string })?.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("shareCopied"));
    } catch {
      toast.error(t("shareFailed"));
    }
  }

  return (
    <button
      type="button"
      onClick={share}
      data-testid="share-journal"
      aria-label={t("share")}
      title={t("share")}
      className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-[#6f7282] transition-colors hover:bg-[#f5f6ff] hover:text-[#5566f6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 print:hidden"
    >
      <Share2 className="size-[18px]" aria-hidden />
    </button>
  );
}
