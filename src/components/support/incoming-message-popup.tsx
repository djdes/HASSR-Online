"use client";

import { ArrowRight, MessageCircle, X } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { IncomingPopup } from "./use-incoming-messages";

/**
 * «Пришло новое сообщение» — карточка справа снизу, над кнопками чата.
 * Вся карточка кликабельна и ведёт прямо в переписку; крестик — просто
 * убрать. Цвета через токены темы, чтобы карточка была своей и в тёмном
 * кабинете, и на ночном лендинге.
 */
export function IncomingMessagePopup({
  popup,
  onOpen,
  onDismiss,
  icon: Icon = MessageCircle,
  className,
}: {
  popup: IncomingPopup | null;
  onOpen: () => void;
  onDismiss: () => void;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  className?: string;
}) {
  const t = useTranslations("publicSupport");
  if (!popup) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "fixed bottom-[76px] right-4 z-50 w-[min(340px,calc(100vw-2rem))] sm:right-5",
        "motion-safe:animate-[incoming-popup-in_220ms_cubic-bezier(0.16,1,0.3,1)_both]",
        className
      )}
    >
      <div className="relative overflow-hidden rounded-3xl border border-[var(--app-border,#ececf4)] bg-[var(--app-surface,#ffffff)] shadow-[0_30px_80px_-20px_rgba(11,16,36,0.45)]">
        <button
          type="button"
          onClick={onOpen}
          className="flex w-full items-start gap-3 px-4 py-3.5 pr-11 text-left transition-colors duration-150 hover:bg-[var(--app-tint-indigo,#f5f6ff)]"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#5566f6] text-white shadow-[0_10px_24px_-10px_rgba(85,102,246,0.65)]">
            <Icon className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--app-indigo-deep,#3848c7)]">
              {t("widget.incomingNewMessage")}
            </span>
            <span className="mt-0.5 block truncate text-[14px] font-semibold text-[var(--app-text,#0b1024)]">
              {popup.title}
            </span>
            {popup.preview ? (
              <span className="mt-0.5 line-clamp-2 block text-[13px] leading-[1.45] text-[var(--app-text-muted,#6f7282)]">
                {popup.preview}
              </span>
            ) : null}
            <span className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-medium text-[#5566f6]">
              {t("widget.incomingOpenChat")}
              <ArrowRight className="size-3.5" />
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="absolute right-2.5 top-2.5 rounded-lg p-1 text-[var(--app-text-faint,#9b9fb3)] transition-colors hover:bg-[var(--app-tint-indigo,#f5f6ff)] hover:text-[var(--app-text,#0b1024)]"
          aria-label={t("widget.incomingDismiss")}
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}

/**
 * Бейдж непрочитанного на кнопке чата: счётчик + пульсирующее кольцо.
 * Кнопка должна быть `fixed`/`relative` — кольцо позиционируется внутри.
 */
export function LauncherBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-full bg-[#5566f6] opacity-40 motion-safe:animate-ping"
      />
      <span className="pointer-events-none absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#d2453d] px-1.5 text-[11px] font-semibold tabular-nums text-white ring-2 ring-[var(--app-surface,#ffffff)]">
        {count > 99 ? "99+" : count}
      </span>
    </>
  );
}
