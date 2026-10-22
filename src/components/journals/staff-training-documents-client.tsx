"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLayoutEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/locales";
import { presentStaffTrainingStartDate, staffTrainingServerRevision } from "@/lib/staff-training-presentation";
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
import { useExportLanguageChoice } from "@/components/journals/export-language-choice";
import { getOpenDocumentPdfFailure, openDocumentPdf } from "@/lib/open-document-pdf";

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
  titleFallback?: boolean;
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
  const st = useTranslations("journalStaffTraining");
  const common = useTranslations("common");
  const locale = useLocale() as Locale;
  const chooseExportLanguage = useExportLanguageChoice();
  const feedback = useRef(st);
  useLayoutEffect(() => { feedback.current = st; }, [st]);
  const router = useRouter();
  const [editingDocument, setEditingDocument] = useState<JournalListDocument | null>(null);
  const [title, setTitle] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const currentDocument = editingDocument ? documents.find((item) => item.id === editingDocument.id) : undefined;
  const [editingRevision, setEditingRevision] = useState<string | undefined>();
  const currentRevision = currentDocument ? staffTrainingServerRevision(currentDocument, ["id", "title", "dateFrom", "status", "config"]) : undefined;
  if (editingDocument && !currentDocument) setEditingDocument(null);
  if (editingDocument && currentDocument && currentRevision !== undefined && currentRevision !== editingRevision) {
    setEditingRevision(currentRevision);
    setEditingDocument(currentDocument);
    setTitle(currentDocument.title);
    setDateFrom(currentDocument.dateFrom);
  }

  async function handleDelete(documentId: string, titleValue: string) {
    if (!(await confirmAsync({ title: st("deleteTitle"), description: st("deleteDescription", { title: titleValue }), variant: "danger", confirmLabel: common("delete"), locale }))) return;
    const response = await fetch(`/api/journal-documents/${documentId}`, { method: "DELETE" });
    if (!response.ok) {
      toast.error(feedback.current("deleteFailed"));
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
      toast.error(feedback.current("settingsFailed"));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <JournalTopBar
        heading={st("heading")}
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
              <div className={JOURNAL_CARD_TITLE_CLASS}>{document.titleFallback ? st("defaultTitle") : document.title}
              <SharedDocumentBadge shared={document.shared} /></div>
            </Link>
            <Link href={`/journals/${templateCode}/documents/${document.id}`} className={`${JOURNAL_CARD_SECTION_CLASS} sm:justify-self-end`}>
              <div className={JOURNAL_CARD_LABEL_CLASS}>{st("startDate")}</div>
              <div className={JOURNAL_CARD_VALUE_CLASS}>{presentStaffTrainingStartDate(document.startedAtLabel, locale)}</div>
            </Link>
            <DocumentActionsMenu
              size="sm"
              document={document}
              siblings={documents}
              onEdit={() => { setEditingRevision(undefined); setEditingDocument(document); }}
              onPrint={() => chooseExportLanguage((exportLocale) => {
                void openDocumentPdf(document.id, exportLocale).catch((error: unknown) => {
                  const failure = getOpenDocumentPdfFailure(error);
                  if (failure) toast.error(feedback.current(failure === "popupBlocked" ? "pdfPopupBlocked" : "pdfOpenFailed"));
                  else if (error instanceof Error) toast.error(error.message);
                  else throw error;
                });
              })}
              onDelete={() => handleDelete(document.id, document.title)}
            />
          </div>
        ))}
      </div>

      <Dialog open={!!editingDocument} onOpenChange={(open) => !open && setEditingDocument(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[24px] border-0 p-0 sm:max-w-[560px]">
          <DialogHeader className="border-b px-6 py-5">
            <DialogTitle className="text-[22px] font-medium text-black">{st("settingsTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 px-6 py-5">
            <div className="space-y-2">
              <Label>{st("documentTitle")}</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{st("startDate")}</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div className="flex justify-end">
              <Button onClick={saveSettings} disabled={isSaving}>
                {isSaving ? st("saving") : common("save")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
