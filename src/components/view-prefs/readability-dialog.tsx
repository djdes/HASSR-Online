"use client";

import { useTranslations } from "next-intl";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ReadabilityControls } from "./readability-controls";

/**
 * Окно «Удобство чтения» из меню профиля: его открывает любой сотрудник —
 * страница «Настройки → Оформление» есть только у руководителя.
 */
export function ReadabilityDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("common.viewPrefs");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]" data-testid="readability-dialog">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>
        <ReadabilityControls />
      </DialogContent>
    </Dialog>
  );
}
