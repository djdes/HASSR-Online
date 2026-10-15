"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/locales";
import { toast } from "sonner";
import { confirmAsync } from "@/components/ui/confirm-async";
import { useExportLanguageChoice } from "./export-language-choice";
import { readLocalizedApiError } from "@/lib/localized-api-error";

/**
 * Общие действия над `JournalDocument`, которые до этого копипастились
 * в каждом `*-documents-client.tsx` / `*-document-client.tsx`:
 *
 *   • DELETE  /api/journal-documents/[id]      — удалить документ
 *   • PATCH   /api/journal-documents/[id]      — { status: 'active'|'closed' }
 *   • GET     /api/journal-documents/[id]/pdf  — открыть печатную форму
 *
 * Поведение намеренно повторяет то, что было в журналах-донорах
 * (accident / climate / breakdown-history / disinfectant / hygiene):
 * `toast.error` с текстом ошибки от API, `router.refresh()` после
 * успеха, никаких редиректов.
 *
 * Списочные экраны работают с НЕСКОЛЬКИМИ документами, поэтому
 * `documentId` можно не передавать в хук, а указывать в опциях каждого
 * вызова. Экраны одного документа передают id один раз в хук.
 *
 * Пример (список):
 *   const actions = useJournalDocumentActions();
 *   await actions.deleteDocument({
 *     documentId: doc.id,
 *     description: `Документ «${doc.title}» будет удалён.`,
 *     bullets: [{ label: "Записей будет удалено: 42", tone: "warn" }],
 *   });
 *
 * Пример (документ):
 *   const { setStatus, openPdf, isChangingStatus } = useJournalDocumentActions(documentId);
 */

export type JournalDocumentStatus = "active" | "closed";

type ConfirmBullet = { label: string; tone?: "default" | "warn" | "info" };

export type DeleteDocumentOptions = {
  /** Перебивает documentId, переданный в хук (нужно спискам). */
  documentId?: string;
  /** Заголовок confirm-диалога. По умолчанию «Удалить документ?». */
  title?: string;
  /** Описание внутри confirm-диалога. */
  description?: ReactNode;
  /** Список последствий («Записей будет удалено: N»). */
  bullets?: ConfirmBullet[];
  /** Подпись кнопки подтверждения. По умолчанию «Удалить». */
  confirmLabel?: string;
  /** Фраза, которую нужно ввести (для самых опасных удалений). */
  typeToConfirm?: string;
  /** Пропустить confirm — когда вызывающий уже показал свою модалку. */
  skipConfirm?: boolean;
  /** Текст успеха. `null` — не показывать toast. */
  successMessage?: string | null;
  /** Текст ошибки по умолчанию, если API не вернул `error`. */
  errorMessage?: string;
  /** Вызвать `router.refresh()` после успеха. По умолчанию — да. */
  refresh?: boolean;
  onSuccess?: () => void;
};

export type SetStatusOptions = {
  documentId?: string;
  successMessage?: string | null;
  errorMessage?: string;
  refresh?: boolean;
  onSuccess?: () => void;
};

export type OpenPdfOptions = {
  documentId?: string;
  locale?: Locale;
};

export function useJournalDocumentActions(documentId?: string | null) {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("journalControls.documentActions");
  const currentPresentation = useRef({ t, locale });
  useEffect(() => { currentPresentation.current = { t, locale }; }, [t, locale]);
  const chooseExportLanguage = useExportLanguageChoice();
  const [isDeleting, setIsDeleting] = useState(false);
  const [isChangingStatus, setIsChangingStatus] = useState(false);

  const resolveId = useCallback(
    (override?: string) => override || documentId || null,
    [documentId],
  );

  const deleteDocument = useCallback(
    async (opts: DeleteDocumentOptions = {}) => {
      const id = resolveId(opts.documentId);
      if (!id) return false;

      if (!opts.skipConfirm) {
        const confirmed = await confirmAsync({
          locale,
          title: opts.title ?? t("deleteTitle"),
          description:
            opts.description ??
            t("deleteDescription"),
          bullets: opts.bullets,
          variant: "danger",
          confirmLabel: opts.confirmLabel ?? t("delete"),
          typeToConfirm: opts.typeToConfirm,
        });
        if (!confirmed) return false;
      }

      setIsDeleting(true);
      try {
        const response = await fetch(`/api/journal-documents/${id}`, {
          method: "DELETE",
        });
        if (!response.ok) {
          toast.error(
            await readLocalizedApiError(
              response,
              () => currentPresentation.current.locale,
              () => opts.errorMessage ?? currentPresentation.current.t("deleteError"),
            ),
          );
          return false;
        }
        if (opts.successMessage !== null) {
          toast.success(opts.successMessage ?? currentPresentation.current.t("deleted"));
        }
        opts.onSuccess?.();
        if (opts.refresh !== false) router.refresh();
        return true;
      } catch {
        toast.error(currentPresentation.current.t("deleteNetworkError"));
        return false;
      } finally {
        setIsDeleting(false);
      }
    },
    [resolveId, router, t, locale],
  );

  const setStatus = useCallback(
    async (status: JournalDocumentStatus, opts: SetStatusOptions = {}) => {
      const id = resolveId(opts.documentId);
      if (!id) return false;

      setIsChangingStatus(true);
      try {
        const response = await fetch(`/api/journal-documents/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
        if (!response.ok) {
          toast.error(
            await readLocalizedApiError(
              response,
              () => currentPresentation.current.locale,
              () => opts.errorMessage ??
                (status === "closed"
                  ? currentPresentation.current.t("closeError")
                  : currentPresentation.current.t("reopenError")),
            ),
          );
          return false;
        }
        if (opts.successMessage !== null) {
          toast.success(
            opts.successMessage ??
              (status === "closed"
                ? currentPresentation.current.t("closed")
                : currentPresentation.current.t("reopened")),
          );
        }
        opts.onSuccess?.();
        if (opts.refresh !== false) router.refresh();
        return true;
      } catch {
        toast.error(currentPresentation.current.t("statusNetworkError"));
        return false;
      } finally {
        setIsChangingStatus(false);
      }
    },
    [resolveId, router],
  );

  const openPdf = useCallback(
    (opts: OpenPdfOptions = {}) => {
      const id = resolveId(opts.documentId);
      if (!id) return;
      const download = (selectedLocale: Locale) => {
        // Native navigation keeps activation and does not mistake the null
        // return value of window.open(noopener) for a blocked popup.
        const link = document.createElement("a");
        link.href = `/api/journal-documents/${encodeURIComponent(id)}/pdf?locale=${selectedLocale}`;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.click();
      };
      if (opts.locale) {
        download(opts.locale);
        return;
      }
      chooseExportLanguage(download);
    },
    [resolveId, chooseExportLanguage],
  );

  return {
    deleteDocument,
    setStatus,
    openPdf,
    isDeleting,
    isChangingStatus,
  } as const;
}
