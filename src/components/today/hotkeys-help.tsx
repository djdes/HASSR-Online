"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HOTKEYS, isTypingTarget } from "@/lib/hotkeys";

/**
 * «?» — окно со списком горячих клавиш кабинета (08.11.2026). Клавиши были
 * (⌘K, срочный журнал), но знали о них только те, кто читал «Что нового».
 */
export function HotkeysHelp() {
  const t = useTranslations("common.quickActions");
  const [open, setOpen] = useState(false);
  // Окно открывается только в браузере — там и смотрим, Mac ли это (⌘ вместо Ctrl).
  const mac = open && typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "?" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[420px]" data-testid="hotkeys-help">
        <DialogHeader>
          <DialogTitle>{t("hotkeysTitle")}</DialogTitle>
        </DialogHeader>
        <ul className="divide-y divide-[#ececf4]">
          {HOTKEYS.map((hotkey) => (
            <li key={hotkey.id} className="flex items-center justify-between gap-4 py-2.5">
              <span className="text-[14px] text-[#0b1024]">{t(`hotkeys.${hotkey.id}`)}</span>
              <span className="flex shrink-0 gap-1">
                {hotkey.keys.map((key) => (
                  <kbd
                    key={key}
                    className="inline-flex min-w-7 items-center justify-center rounded-md border border-[#dcdfed] bg-[#fafbff] px-1.5 py-0.5 font-sans text-[12px] font-semibold text-[#3c4053]"
                  >
                    {mac && key === "Ctrl" ? "⌘" : key}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
