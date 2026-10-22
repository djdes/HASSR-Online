"use client";

import { JournalHeadingName } from "@/components/shared/custom-names-provider";
import {
  JOURNAL_ACTION_CREATE_CLASS,
  JOURNAL_LIST_HEADER_ROW_CLASS,
  JOURNAL_LIST_TITLE_CLASS,
  JournalListActions,
} from "@/components/journals/journal-list-actions";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { scanDisplayText, scanResponsibleLabel, type ScanDisplayKey, type ScanTranslate } from "@/lib/scan-journal-presentation";
import { BookOpenText, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

import { toast } from "sonner";
import { confirmAsync } from "@/components/ui/confirm-async";
import {
  EmptyDocumentsState,
  useCanManageDocuments,
  JournalTabs,
} from "@/components/journals/document-list-ui";
import {
  JOURNAL_CARD_LABEL_CLASS,
  JOURNAL_CARD_SECTION_CLASS,
  JOURNAL_CARD_TITLE_CLASS,
  JOURNAL_CARD_VALUE_CLASS,
  JOURNAL_LIST_CARD_CLASS,
  JOURNAL_LIST_CARDS_CLASS,
} from "@/components/journals/journal-responsive";
import { SharedDocumentBadge } from "@/components/journals/shared-document-badge";
type JournalDocumentRow = {
  id: string;
  title: string;
  /** Точки: документ без точки рядом с документами точек. */
  shared?: boolean;
  status: "active" | "closed";
  dateLabel: string;
  dateValue: string;
  responsibleLabel?: string | null;
  responsibleValue?: string | null;
  titleDisplayKey?: ScanDisplayKey;
  dateLabelDisplayKey?: ScanDisplayKey;
  responsibleLabelDisplayKey?: ScanDisplayKey;
};

type Props = {
  activeTab: "active" | "closed";
  templateCode: string;
  templateName: string;
  documents: JournalDocumentRow[];
  defaultResponsibleTitle?: string | null;
  defaultResponsibleUserId?: string | null;
  templateDisplayKey?: ScanDisplayKey;
};

export function ScanJournalDocumentsClient({
  activeTab,
  templateCode,
  templateName,
  documents,
  defaultResponsibleTitle,
  defaultResponsibleUserId,
  templateDisplayKey,
}: Props) {
  const t = useTranslations() as unknown as ScanTranslate;
  const committed = useRef(t);
  useLayoutEffect(() => { committed.current = t; }, [t]);
  const say = useCallback<ScanTranslate>((key, values) => committed.current(key, values), []);
  const router = useRouter();
  // Создание и удаление документов API отдаёт только руководителю.
  const canManageDocuments = useCanManageDocuments();
  const [isCreating, setIsCreating] = useState(false);

  async function handleCreate() {
    setIsCreating(true);
    try {
      const now = new Date();
      const date = now.toISOString().slice(0, 10);
      const response = await fetch("/api/journal-documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateCode,
          title: templateName,
          dateFrom: date,
          dateTo: date,
          responsibleUserId: defaultResponsibleUserId || null,
          responsibleTitle: defaultResponsibleTitle || "Ответственный",
          config: {},
        }),
      });

      if (!response.ok) {
        throw new Error(say("journalControls.documentDialog.createError"));
      }

      const data = await response.json();
      router.push(`/journals/${templateCode}/documents/${data.document.id}`);
      router.refresh();
    } finally {
      setIsCreating(false);
    }
  }

  async function handleDelete(document: JournalDocumentRow) {
    if (!(await confirmAsync({ title: say("journalControls.documentActions.deleteTitle"), description: say("journalControls.documentLifecycle.deleteDescriptionWithTitle", { title: document.title }), variant: "danger", confirmLabel: say("common.delete") }))) return;

    const response = await fetch(`/api/journal-documents/${document.id}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      toast.error(say("journalControls.documentActions.deleteError"));
      return;
    }

    router.refresh();
  }

  return (
    <div className="space-y-10">
      <div className={JOURNAL_LIST_HEADER_ROW_CLASS}>
        <h1 className={JOURNAL_LIST_TITLE_CLASS}>
          <JournalHeadingName fallback={scanDisplayText(templateName, templateDisplayKey, t)} />
        </h1>
        <JournalListActions
          templateCode={templateCode}
          journalName={scanDisplayText(templateName, templateDisplayKey, t)}
          canManage={canManageDocuments}
          create={
            canManageDocuments && activeTab === "active" ? (
              <Button onClick={handleCreate} disabled={isCreating} className={JOURNAL_ACTION_CREATE_CLASS}>
                <Plus className="size-4" />
                {isCreating ? t("journalScan.list.creating") : t("journalControls.list.create")}
              </Button>
            ) : null
          }
        />
      </div>

      <JournalTabs activeTab={activeTab} templateCode={templateCode} />

      <div className={JOURNAL_LIST_CARDS_CLASS}>
        {documents.length === 0 ? (
          <EmptyDocumentsState />
        ) : (
          documents.map((document) => {
            const href = `/journals/${templateCode}/documents/${document.id}`;
            return (
              <div
                key={document.id}
                className={JOURNAL_LIST_CARD_CLASS}
              >
                <Link href={href} className={JOURNAL_CARD_TITLE_CLASS}>
                  {scanDisplayText(document.title, document.titleDisplayKey, t)}
              <SharedDocumentBadge shared={document.shared} copy={{ label: t("journalScan.shared.label"), title: t("journalScan.shared.title") }} />
                </Link>
                {document.responsibleValue ? (
                  <Link href={href} className={JOURNAL_CARD_SECTION_CLASS}>
                    <div className={JOURNAL_CARD_LABEL_CLASS}>
                      {scanResponsibleLabel(document.responsibleLabel, document.responsibleLabelDisplayKey, t)}
                    </div>
                    <div className={JOURNAL_CARD_VALUE_CLASS}>
                      {document.responsibleValue}
                    </div>
                  </Link>
                ) : (
                  <div className="hidden md:block md:border-l md:border-[#e6e6f0]" />
                )}
                <Link href={href} className={JOURNAL_CARD_SECTION_CLASS}>
                  <div className={JOURNAL_CARD_LABEL_CLASS}>{scanDisplayText(document.dateLabel, document.dateLabelDisplayKey, t)}</div>
                  <div className={JOURNAL_CARD_VALUE_CLASS}>{document.dateValue}</div>
                </Link>
                <div className="flex justify-center">
                  {canManageDocuments && document.status === "active" && (
                    <button
                      type="button"
                      onClick={() => handleDelete(document)}
                      aria-label={t("common.delete")}
                      className="flex size-8 items-center justify-center rounded-full text-[#ff3b30] hover:bg-[#fff0ef]"
                    >
                      <Trash2 className="size-6" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
