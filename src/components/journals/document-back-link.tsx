"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

type DocumentBackLinkProps = {
  href: string;
  label?: string;
  className?: string;
  /**
   * When provided, renders a "Печать" button aligned to the right that opens
   * the existing session-gated PDF endpoint in a new tab. Keeps the old
   * single-button usage working — callers that don't need print just omit
   * this prop.
   */
  documentId?: string;
  /**
   * Показывать ли саму кнопку «Назад».
   *
   * После появления хлебных крошек (`JournalBreadcrumbs`) навигация вверх
   * живёт в них — как на эталоне lk.haccp-online.ru. Внутри дашборда
   * шапки документов передают `showBack={false}` и оставляют только
   * «Печать». Проп сохранён (а не выпилен), потому что компонент —
   * общий и переиспользуется вне раздела журналов.
   */
  showBack?: boolean;
};

export function DocumentBackLink({
  href,
  label,
  className,
  documentId,
  // По умолчанию «Назад» скрыта: и в дашборде, и в Mini App навигация
  // вверх уже есть (крошки / стрелка шапки), вторая ссылка дублировала её.
  showBack = false,
}: DocumentBackLinkProps) {
  const t = useTranslations("common");
  const showPrint = Boolean(documentId);
  if (!showBack && !showPrint) return null;

  return (
    <div
      className={
        className ??
        (showPrint
          ? "mb-5 flex flex-wrap items-center justify-between gap-2 print:hidden"
          : "mb-5")
      }
    >
      {showBack ? (
        <Button
          asChild
          variant="ghost"
          className="h-9 rounded-xl px-3 text-[13.5px] text-[#5566f6] hover:bg-[#eef1ff]"
        >
          <Link href={href}>
            <ArrowLeft className="size-4" />
            {label ?? t("back")}
          </Link>
        </Button>
      ) : null}
      {showPrint ? (
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
    </div>
  );
}
