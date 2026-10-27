"use client";
import { useJournalControls } from "@/components/journals/journal-controls-provider";
import { automationOn } from "@/lib/journal-controls";

import { TOUR } from "@/lib/tour-anchors";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  MoreHorizontal,
  Printer,
  PrinterCheck,
  Settings2,
  Sticker,
} from "lucide-react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/locales";
import { useExportLanguageChoice } from "./export-language-choice";
import { printPage, printPdf } from "@/lib/native-bridge";
import { QrCode } from "lucide-react";
import { isJournalObjectQrCode, journalQrHref } from "@/lib/journal-qr-target";
import { resolveJournalCodeAlias } from "@/lib/source-journal-map";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QrFillPreview } from "@/components/qr/qr-fill-preview";
import {
  JOURNAL_DIALOG_CONTENT_CLASS,
  JOURNAL_DIALOG_HEADER_CLASS,
  JOURNAL_DIALOG_TITLE_CLASS,
} from "@/components/journals/journal-responsive";
import { ResponsiveMenu } from "@/components/ui/responsive-menu";
import { DOC_TITLE_ROW_CLASS } from "@/components/journals/journal-responsive";
import type { DocumentBarUndo } from "@/components/journals/undo-redo-buttons";
import { usePublishUndoToHeader } from "@/components/journals/journal-undo-slot";
import { useCanManageJournalDocument } from "@/components/journals/journal-header-edit";
import { JournalOfficialNameNote } from "@/components/shared/custom-names-provider";
import { cn } from "@/lib/utils";

/**
 * Тип и сами кнопки живут в `undo-redo-buttons.tsx`: их переиспользуют
 * журналы со своей шапкой (med-book, tracked, pest-control и другие).
 * Здесь — реэкспорт, чтобы 13 существующих импортов не переписывать.
 */
export type { DocumentBarUndo };

export type DocumentBarMenuItem = {
  key: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  tone?: "default" | "danger";
  disabled?: boolean;
  title?: string;
};

type Props = {
  /**
   * Куда вёл «Назад» — обычно `/journals/<code>`. Кнопки больше нет
   * (её роль выполняют хлебные крошки), но проп сохранён: его передают
   * все 13 клиентов, и он остаётся частью контракта шапки.
   */
  backHref?: string;
  backLabel?: string;
  /** Документ, для которого открывается серверный PDF (единственная печать). */
  documentId?: string;
  /** Скрыть пункт «Печать» — если печать на этой странице не нужна вообще. */
  showPrint?: boolean;
  /**
   * Заголовок страницы (H1) и всё, что живёт под ним (период документа,
   * индикатор «Сохранение…»). На эталоне заголовок стоит СЛЕВА в одной
   * строке с «Настройками журнала», поэтому шапка принимает его слотом,
   * а не рендерится отдельным блоком над/под собой.
   */
  heading?: ReactNode;
  /** Открыть диалог «Настройки журнала». Не передан — кнопки нет. */
  onSettings?: () => void;
  settingsLabel?: string;
  /** Вторичные действия — попадают в меню «⋯» после «Печати». */
  menuItems?: DocumentBarMenuItem[];
  /** Отмена/повтор правок сетки. Не передан — кнопок нет. */
  undo?: DocumentBarUndo;
  className?: string;
  /**
   * Диалоги/поповеры, которым нужен монтаж вне DropdownMenuContent
   * (например, подтверждение «Скопировать вчерашнее»).
   */
  children?: ReactNode;
};

const ACTION_BUTTON_CLASS =
  "h-9 rounded-lg border-0 bg-[#5566f6]/[0.04] px-3.5 text-[14px] font-semibold text-[#5566f6] shadow-none transition-colors hover:bg-[#5566f6]/[0.09]";

/**
 * Единая шапка страницы документа для всех 13 обязательных журналов.
 *
 * Справа — ровно два элемента: «Настройки журнала» и меню «⋯» со
 * вторичными действиями. Печать здесь ОДНА — серверный PDF.
 * Первичные действия («Добавить», автозаполнение, «Карточки/Таблица»)
 * живут на теле страницы, а не в шапке.
 *
 * Кнопки «Назад» тут больше нет — навигацию вверх дают хлебные крошки
 * (`JournalBreadcrumbs`), как на эталоне. `backHref` остаётся в пропсах:
 * его передают все 13 клиентов, и он ещё нужен как fallback-цель.
 * В Mini App этот компонент тоже рендерится, но там своя навигация
 * (ссылка «К списку документов» + нижний MiniNav), так что потери нет.
 */
export function DocumentActionsBar({
  backHref,
  documentId,
  showPrint = true,
  heading,
  onSettings,
  settingsLabel,
  menuItems = [],
  undo,
  className,
  children,
}: Props) {
  const t = useTranslations("journalControls.actions");
  const locale = useLocale();
  const chooseExportLanguage = useExportLanguageChoice();
  const pdfUrl = (language: Locale) => `/api/journal-documents/${encodeURIComponent(documentId ?? "")}/pdf?locale=${language}`;
  const openPdf = (language: Locale) => void printPdf(pdfUrl(language), {
    fallback: () => { window.open(pdfUrl(language), "_blank", "noopener,noreferrer"); },
  });
  const resolvedSettingsLabel = settingsLabel ?? t("settings");
  // Рядовому сотруднику управление документом не показываем: сервер на
  // такой PATCH отвечает 403, и человек видел только тост «Недостаточно
  // прав». Печать остаётся — она никому не запрещена. QR-плакаты и
  // наклейки собирает только руководитель (их API и страница — для него).
  const canManage = useCanManageJournalDocument();
  const router = useRouter();
  const { controls } = useJournalControls();
  const items = (canManage ? menuItems : []).filter((item) => Boolean(item) && (automationOn(controls, "copyYesterday") || item.key !== "copy-yesterday"));
  const hasPrint = Boolean(showPrint && documentId);
  // Код журнала — из `backHref` (`/journals/<code>`): его передают все
  // клиенты, и отдельный проп не нужен. Есть код и документ — есть QR.
  const routeCode = backHref?.match(/^\/journals\/([^/?#]+)/)?.[1] ?? null;
  const journalCode = routeCode ? resolveJournalCodeAlias(routeCode) : null;
  const hasQr = Boolean(canManage && documentId && journalCode);
  // Холодильники, склады, УФ-лампы: плаката журнала нет — записывают по
  // наклейке на самом объекте. Пункт ведёт на наклейки объектов документа.
  const objectQr = hasQr && isJournalObjectQrCode(journalCode);
  const [qrOpen, setQrOpen] = useState(false);

  // Панель рендерят почти все журналы — публикуем состояние отмены в
  // шапку отсюда, чтобы не звать хук в каждом клиенте по отдельности.
  usePublishUndoToHeader(undo ?? null);

  /**
   * «На принтер заведения» — то самое «с телефона жмякнул и готово».
   * Обычная «Печать» открывает PDF в браузере, а это ставит задание в
   * очередь, и бланк выезжает на кассе без похода к компьютеру.
   */
  async function sendToAgent(id: string, language: Locale) {
    const toastId = toast.loading(t("sendPrinter"));
    try {
      const res = await fetch("/api/print/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: id, locale: language }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t("sendFailed"), { id: toastId });
        return;
      }
      // Про офлайн говорим сразу: иначе человек стоит у принтера и не
      // понимает, чего ждёт.
      if (data?.agentOnline) {
        toast.success(t("sentToPrinter", { agentName: data.agentName }), { id: toastId });
      } else {
        toast.warning(
          t("printerOffline"),
          { id: toastId },
        );
      }
    } catch {
      toast.error(t("sendFailed"), { id: toastId });
    }
  }
  const hasMenu = hasPrint || hasQr || items.length > 0;

  return (
    <>
      <div
        className={cn(
          heading
            ? DOC_TITLE_ROW_CLASS
            : "mb-5 flex flex-wrap items-center justify-end gap-2 print:hidden",
          className
        )}
      >
        {heading ? (
          <div className="min-w-0 flex-1">
            {heading}
            {/* Своё название журнала организации и официальное — мелко под
                заголовком документа. Без своего названия строки нет. */}
            <JournalOfficialNameNote />
          </div>
        ) : null}
        {/* shrink-0: кнопки не должны отжимать заголовок в ноль. На
            мобиле ряд и так разложен в колонку — они встают под ним. */}
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {/* Сами кнопки рисует шапка сайта — сюда приходит только их
              состояние, и мы его туда пробрасываем. В длинном журнале
              кнопки нужны там, где человек сейчас смотрит, а не в двух
              экранах прокрутки вверх. */}
          {/* Печать страницы (Ctrl+P) — иконка рядом с «Настройками
              журнала», как на эталоне. Печатные стили документа уже есть,
              поэтому кнопка просто зовёт window.print(). Серверный PDF
              остаётся отдельным пунктом в меню «⋯». */}
          {/* Тот же серверный PDF, что и «Печать» в меню «⋯»: бланк собран
              одинаково на любом устройстве (браузерная печать на телефоне
              сужала шапку). Обычная ссылка — открывается и там, где
              обработчик клика не срабатывал (тёмная тема на телефоне). */}
          {hasPrint ? (
            <a
              href={pdfUrl(locale)}
              onClick={event => {
                if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                chooseExportLanguage(openPdf, t("print"));
              }}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("print")}
              title={t("printPdf")}
              data-testid="print-pdf-link"
              className="relative z-[1] flex size-9 items-center justify-center rounded-lg border-0 bg-[#5566f6]/[0.04] text-[#5566f6] transition-colors duration-150 hover:bg-[#5566f6]/[0.09] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
            >
              <Printer className="size-4" />
            </a>
          ) : (
            <button
              type="button"
              onClick={() => void printPage()}
              aria-label={t("print")}
              title={t("print")}
              className="relative z-[1] flex size-9 items-center justify-center rounded-lg border-0 bg-[#5566f6]/[0.04] text-[#5566f6] transition-colors duration-150 hover:bg-[#5566f6]/[0.09] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
            >
              <Printer className="size-4" />
            </button>
          )}
          {onSettings && canManage ? (
            <Button
              type="button"
              variant="outline"
              onClick={onSettings}
              data-tour={TOUR.journalSettings}
              className={ACTION_BUTTON_CLASS}
            >
              <Settings2 className="size-4" />
              {resolvedSettingsLabel}
            </Button>
          ) : null}
          {hasMenu ? (
            // На телефоне это лист снизу, на компьютере — выпадающий
            // список. Пункты одни и те же (см. `responsive-menu.tsx`).
            <ResponsiveMenu
              title={t("menuAria")}
              items={[
                ...(hasPrint
                  ? [
                      {
                        key: "print-pdf",
                        label: t("print"),
                        icon: <Printer className="size-4 text-[#6f7282]" />,
                        // В приложении — системное окно печати, иначе новая вкладка.
                        onSelect: () => chooseExportLanguage(openPdf, t("print")),
                      },
                      {
                        key: "print-agent",
                        label: t("printAtVenue"),
                        icon: <PrinterCheck className="size-4 text-[#5566f6]" />,
                        onSelect: () => chooseExportLanguage(language => { void sendToAgent(documentId as string, language); }, t("printAtVenue")),
                      },
                    ]
                  : []),
                ...(objectQr
                  ? [
                      {
                        key: "qr-stickers",
                        label: t("objectStickers"),
                        icon: <Sticker className="size-4 text-[#5566f6]" />,
                        title: t("objectStickersHint"),
                        onSelect: () => router.push(journalQrHref(journalCode as string, { documentId })),
                      },
                    ]
                  : hasQr
                    ? [
                        {
                          key: "qr-fill",
                          label: t("qrFill"),
                          icon: <QrCode className="size-4 text-[#5566f6]" />,
                          title: t("qrFillHint"),
                          onSelect: () => setQrOpen(true),
                        },
                      ]
                    : []),
                ...items.map((item) => ({
                  key: item.key,
                  label: item.label,
                  icon: item.icon,
                  onSelect: item.onSelect,
                  disabled: item.disabled,
                  title: item.title,
                  tone: item.tone,
                })),
              ]}
              trigger={
                <button
                  type="button"
                  aria-label={t("moreActions")}
                  title={t("moreActions")}
                  data-tour={TOUR.moreActions}
                  className="flex size-9 items-center justify-center rounded-lg border-0 bg-[#5566f6]/[0.04] text-[#5566f6] transition-colors hover:bg-[#5566f6]/[0.09]"
                >
                  <MoreHorizontal className="size-4" />
                </button>
              }
            />
          ) : null}
        </div>
      </div>
      {children}
      {hasQr && !objectQr ? (
        <Dialog open={qrOpen} onOpenChange={setQrOpen}>
          <DialogContent className={JOURNAL_DIALOG_CONTENT_CLASS}>
            <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
              <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>{t("qrFill")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 px-6 py-5">
              <p className="text-[13px] leading-[1.55] text-[#3c4053]">
                {t("qrExplanation")}
              </p>
              <QrFillPreview
                kind="journal"
                id={journalCode as string}
                heading={t("mainQr")}
                accent
                allHref={journalQrHref(journalCode as string, { documentId })}
                emptyHint={t("qrAfterSave")}
              />
              <QrFillPreview
                kind="journal"
                id={`${journalCode}:${documentId}`}
                heading={t("documentQr")}
                allHref={journalQrHref(journalCode as string, { documentId })}
                emptyHint={t("qrAfterSave")}
              />
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
