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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { openDocumentPdf } from "@/lib/open-document-pdf";

import { toast } from "sonner";
import { confirmAsync } from "@/components/ui/confirm-async";
import {
  JOURNAL_CARD_LABEL_CLASS,
  JOURNAL_CARD_SECTION_CLASS,
  JOURNAL_CARD_TITLE_CLASS,
  JOURNAL_CARD_VALUE_CLASS,
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

export function StaffTrainingDocumentsClient({
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

  async function handleDelete(documentId: string, titleValue: string) {
    if (!(await confirmAsync({ title: "Удалить документ?", description: `Документ «${titleValue}» и все его записи будут удалены безвозвратно.`, variant: "danger", confirmLabel: "Удалить" }))) return;
    const response = await fetch(`/api/journal-documents/${documentId}`, { method: "DELETE" });
    if (!response.ok) {
      toast.error("Не удалось удалить документ");
      return;
    }
    router.refresh();
  }

  async function saveSettings() {
    if (!editingDocument) return;
    setIsSaving(true);
    try {
      const prevConfig = (editingDocument.config && typeof editingDocument.config === "object" && !Array.isArray(editingDocument.config))
        ? editingDocument.config as Record<string, unknown>
        : {};
      const response = await fetch(`/api/journal-documents/${editingDocument.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          dateFrom,
          config: prevConfig,
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
    <div className="space-y-5">
      <JournalTopBar
        heading="Журнал регистрации инструктажей (обучения) сотрудников"
        activeTab={activeTab}
        templateCode={templateCode}
        templateName={templateName}
        users={users}
      />
      <JournalTabs activeTab={activeTab} templateCode={templateCode} />
      <div className={JOURNAL_LIST_CARDS_CLASS}>
        {documents.length === 0 && <EmptyDocumentsState />}
        {documents.map((document) => (
          <div
            key={document.id}
            className={JOURNAL_LIST_CARD_CLASS}
          >
            <Link href={`/journals/${templateCode}/documents/${document.id}`} className="min-w-0">
              <div className={JOURNAL_CARD_TITLE_CLASS}>{document.title}
              <SharedDocumentBadge shared={document.shared} /></div>
            </Link>
            <Link href={`/journals/${templateCode}/documents/${document.id}`} className={`${JOURNAL_CARD_SECTION_CLASS} sm:justify-self-end`}>
              <div className={JOURNAL_CARD_LABEL_CLASS}>Дата начала</div>
              <div className={JOURNAL_CARD_VALUE_CLASS}>{document.startedAtLabel}</div>
            </Link>
            <DocumentActionsMenu
              size="sm"
              document={document}
              siblings={documents}
              onEdit={() => setEditingDocument(document)}
              onPrint={() => openDocumentPdf(document.id)}
              onDelete={() => handleDelete(document.id, document.title)}
            />
          </div>
        ))}
      </div>

      <Dialog open={!!editingDocument} onOpenChange={(open) => !open && setEditingDocument(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[24px] border-0 p-0 sm:max-w-[560px]">
          <DialogHeader className="border-b px-6 py-5">
            <DialogTitle className="text-[22px] font-medium text-black">Настройки документа</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 px-6 py-5">
            <div className="space-y-2">
              <Label>Название документа</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Дата начала</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div className="flex justify-end">
              <Button onClick={saveSettings} disabled={isSaving}>
                {isSaving ? "Сохранение..." : "Сохранить"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
