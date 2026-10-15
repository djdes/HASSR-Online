"use client";

import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/locales";
import { finishedDate, finishedTitle } from "./finished-product-presentation";
import { formatJournalPeriodLabel } from "@/lib/journal-document-title";
import { readLocalizedApiError } from "@/lib/localized-api-error";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  DocumentActionsMenu,
  EmptyDocumentsState,
  JournalTabs,
  JournalTopBar,
} from "@/components/journals/document-list-ui";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  DateField,
  FloatingInputField,
  FloatingLabelField,
} from "@/components/journals/journal-dialog-field";
import { Label } from "@/components/ui/label";
import { normalizeFinishedProductDocumentConfig } from "@/lib/finished-product-document";
import { syncColumnsWithLegacyFlags } from "@/lib/journal-columns";

import { toast } from "sonner";
import { useJournalDocumentActions } from "@/components/journals/use-journal-document-actions";
import {
  JOURNAL_CARD_LABEL_CLASS,
  JOURNAL_CARD_SECTION_CLASS,
  JOURNAL_CARD_TITLE_CLASS,
  JOURNAL_CARD_VALUE_CLASS,
  JOURNAL_DIALOG_ACTIONS_CLASS,
  JOURNAL_DIALOG_BODY_CLASS,
  JOURNAL_DIALOG_CONTENT_CLASS,
  JOURNAL_DIALOG_FIELDS_CLASS,
  JOURNAL_DIALOG_FOOTER_CLASS,
  JOURNAL_DIALOG_HEADER_CLASS,
  JOURNAL_DIALOG_SUBMIT_CLASS,
  JOURNAL_DIALOG_TITLE_CLASS,
  JOURNAL_LIST_CARD_CLASS,
  JOURNAL_LIST_STACK_CLASS,
  JOURNAL_LIST_CARDS_CLASS,
} from "@/components/journals/journal-responsive";
import { SharedDocumentBadge } from "@/components/journals/shared-document-badge";
type JournalListDocument = {
  id: string;
  title: string;
  /** Точки: документ без точки рядом с документами точек. */
  shared?: boolean;
  status: "active" | "closed";
  responsibleTitle: string | null;
  periodLabel: string;
  startedAtLabel: string;
  dateFrom: string;
  dateTo: string;
  config?: unknown;
};

type Props = {
  activeTab: "active" | "closed";
  templateCode: string;
  templateName: string;
  users: { id: string; name: string; role: string }[];
  documents: JournalListDocument[];
};

function endOfMonth(dateValue: string) {
  const [year, month] = dateValue.split("-").map(Number);
  if (!year || !month) return dateValue;
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

export function FinishedProductDocumentsClient({
  activeTab,
  templateCode,
  templateName,
  users,
  documents,
}: Props) {
  const t = useTranslations("finishedProduct");
  const router = useRouter();
  const locale = useLocale() as Locale;
  const documentTitle = (document: JournalListDocument) => finishedTitle(document.title, document.dateFrom, document.dateTo, locale, t);
  const [editingDocument, setEditingDocument] = useState<JournalListDocument | null>(null);
  const [title, setTitle] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [fieldNameMode, setFieldNameMode] = useState<"dish" | "semi">("dish");
  const [inspectorMode, setInspectorMode] = useState<"inspector_name" | "commission_signatures">(
    "inspector_name"
  );
  const [showProductTemp, setShowProductTemp] = useState(false);
  const [showCorrectiveAction, setShowCorrectiveAction] = useState(false);
  const [showOxygenLevel, setShowOxygenLevel] = useState(false);
  const [showCourierTime, setShowCourierTime] = useState(false);
  const [footerNote, setFooterNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!editingDocument) return;
    const cfg = normalizeFinishedProductDocumentConfig(editingDocument.config);
    setTitle(editingDocument.title);
    setDateFrom(editingDocument.dateFrom);
    setFieldNameMode(cfg.fieldNameMode);
    setInspectorMode(cfg.inspectorMode);
    setShowProductTemp(cfg.showProductTemp);
    setShowCorrectiveAction(cfg.showCorrectiveAction);
    setShowOxygenLevel(cfg.showOxygenLevel);
    setShowCourierTime(cfg.showCourierTime);
    setFooterNote(cfg.footerNote);
  }, [editingDocument]);

  // Единый источник delete / pdf для журнальных документов.
  const { deleteDocument, openPdf } = useJournalDocumentActions();

  async function handleDelete(document: JournalListDocument) {
    const cfg = normalizeFinishedProductDocumentConfig(document.config);
    await deleteDocument({
      documentId: document.id,
      description: t("list.deleteDescription", { title: documentTitle(document) }),
      bullets: [
        { label: t("list.records", { count: cfg.rows.length }), tone: "warn" },
        { label: t("list.products", { count: cfg.itemsCatalog.length }), tone: "info" },
        { label: t("list.period", { period: formatJournalPeriodLabel(document.dateFrom, document.dateTo, locale) }), tone: "info" },
      ],
      successMessage: t("list.deleted", { title: documentTitle(document) }),
      errorMessage: t("errors.delete"),
    });
  }

  async function saveSettings() {
    if (!editingDocument) return;
    setIsSaving(true);
    try {
      const response = await fetch(`/api/journal-documents/${editingDocument.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          dateFrom,
          dateTo: endOfMonth(dateFrom),
          // Переключатели этой формы правят флаги; если у документа есть
          // набор колонок, флаги переносятся в него — иначе набор бы их перебил.
          config: syncColumnsWithLegacyFlags("finished_product", {
            ...(normalizeFinishedProductDocumentConfig(editingDocument.config) || {}),
            fieldNameMode,
            inspectorMode,
            showProductTemp,
            showCorrectiveAction,
            showOxygenLevel,
            showCourierTime,
            footerNote,
          }),
        }),
      });
      if (!response.ok) throw new Error(await readLocalizedApiError(response, locale, t("errors.settings")));
      setEditingDocument(null);
      router.refresh();
    } catch (error) {
      toast.error(humanizeFetchError(error, t("errors.settings"), t("errors.network")));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className={JOURNAL_LIST_STACK_CLASS}>
      <JournalTopBar
        heading={
          activeTab === "closed"
            ? t("closedTitle")
            : t("title")
        }
        activeTab={activeTab}
        templateCode={templateCode}
        templateName={templateName}
        users={users}
        documentCount={documents.length}
      />
      <JournalTabs activeTab={activeTab} templateCode={templateCode} />
      <div className={JOURNAL_LIST_CARDS_CLASS}>
        {documents.length === 0 && (
          <EmptyDocumentsState
            templateCode={templateCode}
            templateName={templateName}
            users={users}
          />
        )}
        {documents.map((document) => {
          // Колонка «Ответственный» появляется только когда он у документа
          // задан — как в incoming_control и uv_lamp_runtime. Без него
          // карточка остаётся двухколоночной, пустой ячейки не рисуем.
          const responsible = document.responsibleTitle?.trim() || "";
          return (
            <div
              key={document.id}
              className={JOURNAL_LIST_CARD_CLASS}
            >
              <Link href={`/journals/${templateCode}/documents/${document.id}`} className="min-w-0">
                <div className={`${JOURNAL_CARD_TITLE_CLASS} truncate`}>
                  {documentTitle(document)}
              <SharedDocumentBadge shared={document.shared} />
                </div>
              </Link>
              {responsible ? (
                <Link
                  href={`/journals/${templateCode}/documents/${document.id}`}
                  className={JOURNAL_CARD_SECTION_CLASS}
                >
                  <div className={JOURNAL_CARD_LABEL_CLASS}>{t("people.responsibleLabel")}</div>
                  <div className={JOURNAL_CARD_VALUE_CLASS}>{responsible}</div>
                </Link>
              ) : null}
              <Link
                href={`/journals/${templateCode}/documents/${document.id}`}
                className={JOURNAL_CARD_SECTION_CLASS}
              >
                <div className={JOURNAL_CARD_LABEL_CLASS}>{t("fields.dateFrom")}</div>
                <div className={JOURNAL_CARD_VALUE_CLASS}>
                  {finishedDate(document.dateFrom, locale) || document.startedAtLabel}
                </div>
              </Link>
              <DocumentActionsMenu
                size="sm"
                document={document}
                siblings={documents}
                onEdit={activeTab === "active" ? () => setEditingDocument(document) : undefined}
                onPrint={() => openPdf({ documentId: document.id })}
                onDelete={
                  activeTab === "active" ? () => void handleDelete(document) : undefined
                }
              />
            </div>
          );
        })}
      </div>

      <Dialog open={!!editingDocument} onOpenChange={(open) => !open && setEditingDocument(null)}>
        <DialogContent className={JOURNAL_DIALOG_CONTENT_CLASS}>
          <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
            <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>
              {t("settings.title")}</DialogTitle>
          </DialogHeader>
          <div className={cn(JOURNAL_DIALOG_BODY_CLASS, JOURNAL_DIALOG_FIELDS_CLASS)}>
            <FloatingInputField
              label={t("settings.documentTitle")}
              value={title}
              onChange={setTitle}
            />
            <DateField label={t("fields.dateFrom")} value={dateFrom} onChange={setDateFrom} />
            <FloatingLabelField label={t("settings.nameColumn")}>
              <div className="flex flex-col gap-2 pt-1 text-[14px] text-[#0b1024]">
                <label className="flex items-center gap-2.5">
                  <input
                    type="radio"
                    checked={fieldNameMode === "dish"}
                    onChange={() => setFieldNameMode("dish")}
                    className="size-4 accent-[#5566f6]"
                  />
                  {t("settings.dishName")}</label>
                <label className="flex items-center gap-2.5">
                  <input
                    type="radio"
                    checked={fieldNameMode === "semi"}
                    onChange={() => setFieldNameMode("semi")}
                    className="size-4 accent-[#5566f6]"
                  />
                  {t("settings.semiName")}</label>
              </div>
            </FloatingLabelField>
            <div className="space-y-2 rounded-xl border p-3">
              <Label>{t("settings.addFields")}</Label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={showProductTemp} onCheckedChange={(v) => setShowProductTemp(v === true)} />
                {t("fields.temperature")}</label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={showCorrectiveAction}
                  onCheckedChange={(v) => setShowCorrectiveAction(v === true)}
                />
                {t("fields.corrective")}</label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={showOxygenLevel} onCheckedChange={(v) => setShowOxygenLevel(v === true)} />
                {t("fields.oxygen")}</label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={showCourierTime} onCheckedChange={(v) => setShowCourierTime(v === true)} />
                {t("fields.courierFull")}</label>
            </div>
            <FloatingLabelField label={t("settings.whoSigns")}>
              <div className="flex flex-col gap-2 pt-1 text-[14px] text-[#0b1024]">
                <label className="flex items-center gap-2.5">
                  <input
                    type="radio"
                    checked={inspectorMode === "inspector_name"}
                    onChange={() => setInspectorMode("inspector_name")}
                    className="size-4 accent-[#5566f6]"
                  />
                  {t("people.inspectorFull")}</label>
                <label className="flex items-center gap-2.5">
                  <input
                    type="radio"
                    checked={inspectorMode === "commission_signatures"}
                    onChange={() => setInspectorMode("commission_signatures")}
                    className="size-4 accent-[#5566f6]"
                  />
                  {t("commission.fullSignatures")}</label>
              </div>
            </FloatingLabelField>
            <FloatingInputField
              label={t("fields.note")}
              value={footerNote}
              onChange={setFooterNote}
              placeholder={t("settings.footerHint")}
            />
          </div>
          <div className={JOURNAL_DIALOG_FOOTER_CLASS}>
            <div className={JOURNAL_DIALOG_ACTIONS_CLASS}>
              <Button
                onClick={saveSettings}
                disabled={isSaving}
                className={JOURNAL_DIALOG_SUBMIT_CLASS}
              >
                {isSaving ? t("actions.saving") : t("actions.save")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
