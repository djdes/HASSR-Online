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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  DateField,
  FloatingInputField,
} from "@/components/journals/journal-dialog-field";

import { toast } from "sonner";
import { useJournalDocumentActions } from "@/components/journals/use-journal-document-actions";
import { normalizePerishableRejectionConfig } from "@/lib/perishable-rejection-document";
import { getJournalDocumentHeading } from "@/lib/journal-document-helpers";
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
  JOURNAL_LIST_STACK_CLASS,
  JOURNAL_LIST_CARD_CLASS,
  JOURNAL_LIST_CARDS_CLASS,
} from "@/components/journals/journal-responsive";
import { SharedDocumentBadge } from "@/components/journals/shared-document-badge";
type JournalListDocument = {
  id: string;
  title: string;
  /** Точки: документ без точки рядом с документами точек. */
  shared?: boolean;
  status: "active" | "closed";
  startedAtLabel: string;
  dateFrom: string;
  config?: unknown;
};

type Props = {
  activeTab: "active" | "closed";
  templateCode: string;
  templateName: string;
  users: { id: string; name: string; role: string }[];
  documents: JournalListDocument[];
};

export function PerishableRejectionDocumentsClient({
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
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!editingDocument) return;
    setTitle(editingDocument.title);
    setDateFrom(editingDocument.dateFrom);
  }, [editingDocument]);

  // Единый источник delete / pdf для журнальных документов.
  const { deleteDocument, openPdf } = useJournalDocumentActions();

  async function handleDelete(document: JournalListDocument) {
    const cfg = normalizePerishableRejectionConfig(document.config);
    const catalogSize =
      cfg.productLists.reduce((sum, list) => sum + list.items.length, 0) +
      cfg.manufacturers.length +
      cfg.suppliers.length;
    await deleteDocument({
      documentId: document.id,
      description: `Документ «${document.title}» будет удалён безвозвратно.`,
      bullets: [
        { label: `Записей бракеража: ${cfg.rows.length}`, tone: "warn" },
        { label: `Позиций в справочниках документа: ${catalogSize}`, tone: "info" },
        { label: `Журнал начат: ${document.startedAtLabel}`, tone: "info" },
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
        body: JSON.stringify({ title, dateFrom }),
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
        heading={getJournalDocumentHeading(templateCode, activeTab === "closed")}
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
        {documents.map((document) => (
          <div
            key={document.id}
            className={JOURNAL_LIST_CARD_CLASS}
          >
            <Link href={`/journals/${templateCode}/documents/${document.id}`} className="min-w-0">
              <div className={JOURNAL_CARD_TITLE_CLASS}>{document.title}
              <SharedDocumentBadge shared={document.shared} /></div>
            </Link>
            <Link href={`/journals/${templateCode}/documents/${document.id}`} className={`${JOURNAL_CARD_SECTION_CLASS} justify-self-end`}>
              <div className={JOURNAL_CARD_LABEL_CLASS}>Дата начала</div>
              <div className={JOURNAL_CARD_VALUE_CLASS}>{document.startedAtLabel}</div>
            </Link>
            <DocumentActionsMenu
              size="sm"
              document={document}
              siblings={documents}
              onEdit={() => setEditingDocument(document)}
              onPrint={() => openPdf({ documentId: document.id })}
              onDelete={() => void handleDelete(document)}
            />
          </div>
        ))}
      </div>

      <Dialog open={!!editingDocument} onOpenChange={(open) => !open && setEditingDocument(null)}>
        <DialogContent className={JOURNAL_DIALOG_CONTENT_CLASS}>
          <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
            <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>Настройки журнала</DialogTitle>
          </DialogHeader>
          <div className={cn(JOURNAL_DIALOG_BODY_CLASS, JOURNAL_DIALOG_FIELDS_CLASS)}>
            <FloatingInputField
              label="Название документа"
              value={title}
              onChange={setTitle}
            />
            <DateField label="Дата начала" value={dateFrom} onChange={setDateFrom} />
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
