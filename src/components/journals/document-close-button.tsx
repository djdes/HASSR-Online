"use client";

import { type ComponentProps, type MouseEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { confirmAsync } from "@/components/ui/confirm-async";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";
import { readLocalizedApiError } from "@/lib/localized-api-error";
import { useDocumentDisplayTitle } from "./journal-header-edit";

type Props = ComponentProps<typeof Button> & {
  documentId: string;
  title: string;
  confirmMessage?: string;
  successMessage?: string;
  onClosed?: () => void;
};

/**
 * Headless-версия «Закончить журнал» — для пунктов меню «⋯», где кнопка
 * не нужна, а нужен только обработчик с тем же confirm-диалогом и toast'ом.
 */
export function useDocumentCloseAction({
  documentId,
  title,
  confirmMessage,
  confirmDescription,
  successMessage,
  onClosed,
  blocker,
}: {
  documentId: string;
  title: string;
  confirmMessage?: string;
  /**
   * Предупреждение под заголовком — например «Не заполнено дней: 3».
   * Заголовок остаётся коротким вопросом, а тревожная цифра читается
   * отдельной строкой.
   */
  confirmDescription?: string;
  successMessage?: string;
  onClosed?: () => void;
  /**
   * Причина, по которой журнал закрыть нельзя (например, блюда ждут
   * подписи комиссии). Если есть — вместо вопроса показываем объяснение
   * со списком, запрос на сервер не уходит.
   */
  blocker?: () => { title: string; description?: string; bullets: string[] } | null;
}) {
  const t = useTranslations("journalControls.closeDocument");
  const locale = useLocale();
  const displayTitle = useDocumentDisplayTitle(title);
  const router = useRouter();
  const [isClosing, setIsClosing] = useState(false);

  async function closeDocument() {
    if (isClosing) return;
    const blocked = blocker?.();
    if (blocked) {
      await confirmAsync({
      locale,
        title: blocked.title,
        description: blocked.description,
        bullets: blocked.bullets.map((label) => ({ label, tone: "warn" as const })),
        variant: "warn",
        confirmLabel: t("understood"),
        cancelLabel: t("dismiss"),
      });
      return;
    }
    const confirmed = await confirmAsync({
      locale,
      title: confirmMessage || t("confirmTitle", { title: displayTitle }),
      description: confirmDescription,
      variant: "warn",
      confirmLabel: t("close"),
    });
    if (!confirmed) return;

    setIsClosing(true);
    try {
      const response = await fetch(`/api/journal-documents/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "closed" }),
      });
      if (!response.ok) {
        throw new Error(await readLocalizedApiError(response, locale, t("failed")));
      }
      onClosed?.();
      toast.success(successMessage ?? t("closed"));
      router.refresh();
    } catch (error) {
      toast.error(humanizeFetchError(error, t("failed"), t("networkError")));
    } finally {
      setIsClosing(false);
    }
  }

  return { closeDocument, isClosing, closeLabel: t("close") };
}

export function DocumentCloseButton({
  documentId,
  title,
  confirmMessage,
  successMessage,
  onClosed,
  onClick,
  disabled,
  ...buttonProps
}: Props) {
  const t = useTranslations("journalControls.closeDocument");
  const locale = useLocale();
  const displayTitle = useDocumentDisplayTitle(title);
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleClick(event: MouseEvent<HTMLButtonElement>) {
    onClick?.(event);
    if (event.defaultPrevented || disabled || isSubmitting) {
      return;
    }

    const message =
      confirmMessage || t("confirmTitle", { title: displayTitle });
    const confirmed = await confirmAsync({
      locale,
      title: message,
      variant: "warn",
      confirmLabel: t("close"),
    });
    if (!confirmed) {
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/journal-documents/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "closed" }),
      });
      if (!response.ok) {
        throw new Error(await readLocalizedApiError(response, locale, t("failed")));
      }

      onClosed?.();
      toast.success(successMessage ?? t("closed"));
      router.refresh();
    } catch (error) {
      toast.error(humanizeFetchError(error, t("failed"), t("networkError")));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Button
      type="button"
      disabled={disabled || isSubmitting}
      onClick={handleClick}
      {...buttonProps}
    >
      {isSubmitting ? t("closing") : t("close")}
    </Button>
  );
}
