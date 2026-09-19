"use client";

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

/**
 * «YYYY-MM-DD» → «ДД-ММ-ГГГГ». На эталоне дата в карточке списка бракеража
 * пишется через дефисы («01-04-2026»), а не точками.
 */
function formatDashedDate(isoDate: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!match) return "";
  const [, year, month, day] = match;
  return `${day}-${month}-${year}`;
}

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
  const router = useRouter();
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
      description: `Документ «${document.title}» будет удалён безвозвратно.`,
      bullets: [
        { label: `Записей бракеража: ${cfg.rows.length}`, tone: "warn" },
        { label: `Изделий в справочнике документа: ${cfg.itemsCatalog.length}`, tone: "info" },
        { label: `Период документа: ${document.periodLabel}`, tone: "info" },
      ],
      successMessage: `Документ «${document.title}» удалён`,
      errorMessage: "Не удалось удалить документ",
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
      if (!response.ok) throw new Error();
      setEditingDocument(null);
      router.refresh();
    } catch {
      toast.error("Не удалось сохранить настройки");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className={JOURNAL_LIST_STACK_CLASS}>
      <JournalTopBar
        heading={
          activeTab === "closed"
            ? "Журнал бракеража готовой пищевой продукции (закрытые)"
            : "Журнал бракеража готовой пищевой продукции"
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
                  {document.title}
              <SharedDocumentBadge shared={document.shared} />
                </div>
              </Link>
              {responsible ? (
                <Link
                  href={`/journals/${templateCode}/documents/${document.id}`}
                  className={JOURNAL_CARD_SECTION_CLASS}
                >
                  <div className={JOURNAL_CARD_LABEL_CLASS}>Ответственный</div>
                  <div className={JOURNAL_CARD_VALUE_CLASS}>{responsible}</div>
                </Link>
              ) : null}
              <Link
                href={`/journals/${templateCode}/documents/${document.id}`}
                className={JOURNAL_CARD_SECTION_CLASS}
              >
                <div className={JOURNAL_CARD_LABEL_CLASS}>Дата начала</div>
                <div className={JOURNAL_CARD_VALUE_CLASS}>
                  {formatDashedDate(document.dateFrom) || document.startedAtLabel}
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
              Настройки журнала
            </DialogTitle>
          </DialogHeader>
          <div className={cn(JOURNAL_DIALOG_BODY_CLASS, JOURNAL_DIALOG_FIELDS_CLASS)}>
            <FloatingInputField
              label="Название документа"
              value={title}
              onChange={setTitle}
            />
            <DateField label="Дата начала" value={dateFrom} onChange={setDateFrom} />
            <FloatingLabelField label="Колонка наименования">
              <div className="flex flex-col gap-2 pt-1 text-[14px] text-[#0b1024]">
                <label className="flex items-center gap-2.5">
                  <input
                    type="radio"
                    checked={fieldNameMode === "dish"}
                    onChange={() => setFieldNameMode("dish")}
                    className="size-4 accent-[#5566f6]"
                  />
                  Наименование блюд (изделий)
                </label>
                <label className="flex items-center gap-2.5">
                  <input
                    type="radio"
                    checked={fieldNameMode === "semi"}
                    onChange={() => setFieldNameMode("semi")}
                    className="size-4 accent-[#5566f6]"
                  />
                  Наименование полуфабриката
                </label>
              </div>
            </FloatingLabelField>
            <div className="space-y-2 rounded-xl border p-3">
              <Label>Добавить поля</Label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={showProductTemp} onCheckedChange={(v) => setShowProductTemp(v === true)} />
                T°C внутри продукта
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={showCorrectiveAction}
                  onCheckedChange={(v) => setShowCorrectiveAction(v === true)}
                />
                Корректирующие действия
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={showOxygenLevel} onCheckedChange={(v) => setShowOxygenLevel(v === true)} />
                Остаточный уровень кислорода, % об.
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={showCourierTime} onCheckedChange={(v) => setShowCourierTime(v === true)} />
                Время передачи блюд курьеру
              </label>
            </div>
            <FloatingLabelField label="Кто подписывает">
              <div className="flex flex-col gap-2 pt-1 text-[14px] text-[#0b1024]">
                <label className="flex items-center gap-2.5">
                  <input
                    type="radio"
                    checked={inspectorMode === "inspector_name"}
                    onChange={() => setInspectorMode("inspector_name")}
                    className="size-4 accent-[#5566f6]"
                  />
                  ФИО лица, проводившего бракераж
                </label>
                <label className="flex items-center gap-2.5">
                  <input
                    type="radio"
                    checked={inspectorMode === "commission_signatures"}
                    onChange={() => setInspectorMode("commission_signatures")}
                    className="size-4 accent-[#5566f6]"
                  />
                  Подписи членов бракеражной комиссии
                </label>
              </div>
            </FloatingLabelField>
            <FloatingInputField
              label="Примечание"
              value={footerNote}
              onChange={setFooterNote}
              placeholder="Печатается под таблицей"
            />
          </div>
          <div className={JOURNAL_DIALOG_FOOTER_CLASS}>
            <div className={JOURNAL_DIALOG_ACTIONS_CLASS}>
              <Button
                onClick={saveSettings}
                disabled={isSaving}
                className={JOURNAL_DIALOG_SUBMIT_CLASS}
              >
                {isSaving ? "Сохранение..." : "Сохранить"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
