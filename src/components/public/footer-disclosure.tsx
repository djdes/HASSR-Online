"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Группа ссылок подвала (правки 21.11.2026: на телефоне подвал был длиной в
 * два экрана). На телефоне (< 640 px) — заголовок-кнопка, ссылки свёрнуты и
 * раскрываются по нажатию; с 640 px — обычный заголовок и всё открыто.
 * Ссылки всегда в HTML: поисковики их видят, перелинковка не теряется.
 */
export function FooterDisclosure({
  title,
  titleClassName,
  className,
  bodyClassName,
  children,
}: {
  title: string;
  titleClassName: string;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <div className={className} data-footer-group={open ? "open" : "closed"}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex min-h-11 w-full items-center justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 sm:hidden"
      >
        <span className={titleClassName}>{title}</span>
        <ChevronDown className={cn("size-4 shrink-0 text-[#9b9fb3] transition-transform duration-150", open && "rotate-180")} aria-hidden />
      </button>
      <div className={cn(titleClassName, "max-sm:hidden")}>{title}</div>
      <div id={bodyId} className={cn(bodyClassName, !open && "max-sm:hidden")}>
        {children}
      </div>
    </div>
  );
}
