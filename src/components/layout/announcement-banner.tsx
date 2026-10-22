"use client";

import { Info, Megaphone, TriangleAlert, Wrench, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import type { Announcement } from "@/lib/platform-status";
import { cn } from "@/lib/utils";

/**
 * Баннер объявления: плановые работы, инцидент, новость. Показывается на
 * сайте и в Mini App, пока ROOT его не выключит или не истечёт окно.
 * Закрытый баннер запоминается по id — новое объявление покажется снова.
 */
const DISMISS_KEY = "wesetup.announcement.dismissed";

const STYLE: Record<Announcement["kind"], { box: string; icon: typeof Info }> = {
  info: { box: "border-[#c7ccea] bg-[#eef1ff] text-[#3848c7]", icon: Megaphone },
  maintenance: { box: "border-[#ffe9b0] bg-[#fffaf0] text-[#7a4a00]", icon: Wrench },
  incident: { box: "border-[#ffd2cc] bg-[#fff4f2] text-[#a13a32]", icon: TriangleAlert },
};

export function AnnouncementBanner({
  announcement,
  variant = "site",
  moreLabel = "Подробнее",
  dismissLabel = "Скрыть объявление",
}: {
  announcement: Announcement | null;
  variant?: "site" | "mini";
  moreLabel?: string;
  dismissLabel?: string;
}) {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (!announcement) return;
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === announcement.id);
    } catch {
      setDismissed(false);
    }
  }, [announcement]);

  if (!announcement || dismissed) return null;
  const style = STYLE[announcement.kind];
  const Icon = style.icon;

  const close = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, announcement.id);
    } catch {
      /* приватный режим — просто скроем до перезагрузки */
    }
  };

  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-3 rounded-2xl border px-4 py-3 text-[13.5px] leading-relaxed",
        variant === "site" ? "mb-4" : "mb-3",
        style.box
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <span>{announcement.text}</span>{" "}
        <Link
          href={announcement.link || "/status"}
          className="font-medium underline underline-offset-2"
          target={announcement.link?.startsWith("http") ? "_blank" : undefined}
          rel="noreferrer"
        >
          {moreLabel}
        </Link>
      </div>
      <button
        type="button"
        onClick={close}
        aria-label={dismissLabel}
        className="-mr-1 -mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg opacity-70 transition-opacity hover:opacity-100"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
