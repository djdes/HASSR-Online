"use client";

import { Printer } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

type DocumentPageHeaderProps = {
  /**
   * Куда вела кнопка «Назад». Кнопки больше нет — вверх ведут хлебные
   * крошки над заголовком, как на эталоне. Проп сохранён ради контракта
   * с вызывающими клиентами.
   */
  backHref?: string;
  backLabel?: string;
  documentId?: string;
  showPrint?: boolean;
  className?: string;
  rightActions?: React.ReactNode;
};

/**
 * Shared top bar for every journal document page.
 * Renders a back-button on the left and a consistent action row on the right
 * (print + whatever the host page passes in, like "Настройки"/"Закончить").
 *
 * NOTE: the print URL calls the existing session-gated PDF endpoint,
 * so it works for admins/managers browsing the UI.
 */
export function DocumentPageHeader({
  documentId,
  showPrint = true,
  className,
  rightActions,
}: DocumentPageHeaderProps) {
  const t = useTranslations("common");
  const hasPrint = Boolean(showPrint && documentId);
  const hasActions = hasPrint || Boolean(rightActions);
  if (!hasActions) return null;

  return (
    <div
      className={
        className ??
        "mb-5 flex flex-col gap-2 print:hidden sm:flex-row sm:flex-wrap sm:items-center sm:justify-end"
      }
    >
      {/* На телефоне действия идут строкой с переносом, а не столбиком во всю ширину: три кнопки занимали половину первого экрана. */}
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
        {hasPrint ? (
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              window.open(
                `/api/journal-documents/${documentId}/pdf`,
                "_blank",
                "noopener,noreferrer"
              )
            }
            className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
          >
            <Printer className="size-4" />
            {t("print")}
          </Button>
        ) : null}
        {rightActions}
      </div>
    </div>
  );
}
