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
import { useState } from "react";
import { BookOpenText, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

import { toast } from "sonner";
import { confirmAsync } from "@/components/ui/confirm-async";
import {
  EmptyDocumentsState,
  useCanManageDocuments,
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
};

type Props = {
  activeTab: "active" | "closed";
  templateCode: string;
  templateName: string;
  documents: JournalDocumentRow[];
  defaultResponsibleTitle?: string | null;
  defaultResponsibleUserId?: string | null;
};

export function ScanJournalDocumentsClient({
  activeTab,
  templateCode,
  templateName,
  documents,
  defaultResponsibleTitle,
  defaultResponsibleUserId,
}: Props) {
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
        throw new Error("Не удалось создать документ");
      }

      const data = await response.json();
      router.push(`/journals/${templateCode}/documents/${data.document.id}`);
      router.refresh();
    } finally {
      setIsCreating(false);
    }
  }

  async function handleDelete(document: JournalDocumentRow) {
    if (!(await confirmAsync({ title: "Удалить документ?", description: `Документ «${document.title}» и все его записи будут удалены безвозвратно.`, variant: "danger", confirmLabel: "Удалить" }))) return;

    const response = await fetch(`/api/journal-documents/${document.id}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      toast.error("Не удалось удалить документ");
      return;
    }

    router.refresh();
  }

  return (
    <div className="space-y-10">
      <div className={JOURNAL_LIST_HEADER_ROW_CLASS}>
        <h1 className={JOURNAL_LIST_TITLE_CLASS}>
          <JournalHeadingName fallback={templateName} />
        </h1>
        <JournalListActions
          templateCode={templateCode}
          journalName={templateName}
          canManage={canManageDocuments}
          create={
            canManageDocuments && activeTab === "active" ? (
              <Button onClick={handleCreate} disabled={isCreating} className={JOURNAL_ACTION_CREATE_CLASS}>
                <Plus className="size-4" />
                {isCreating ? "Создание..." : "Создать документ"}
              </Button>
            ) : null
          }
        />
      </div>

      <div className="border-b border-[#d9dce8]">
        <div className="flex gap-9 text-[15px]">
          <Link
            href={`/journals/${templateCode}`}
            className={`relative pb-4 ${activeTab === "active" ? "font-medium text-black after:absolute after:bottom-[-1px] after:left-0 after:h-[2px] after:w-full after:bg-[#5566f6]" : "text-[#6f7282]"}`}
          >
            Активные
          </Link>
          <Link
            href={`/journals/${templateCode}?tab=closed`}
            className={`relative pb-4 ${activeTab === "closed" ? "font-medium text-black after:absolute after:bottom-[-1px] after:left-0 after:h-[2px] after:w-full after:bg-[#5566f6]" : "text-[#6f7282]"}`}
          >
            Закрытые
          </Link>
        </div>
      </div>

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
                  {document.title}
              <SharedDocumentBadge shared={document.shared} />
                </Link>
                {document.responsibleValue ? (
                  <Link href={href} className={JOURNAL_CARD_SECTION_CLASS}>
                    <div className={JOURNAL_CARD_LABEL_CLASS}>
                      {document.responsibleLabel || "Ответственный"}
                    </div>
                    <div className={JOURNAL_CARD_VALUE_CLASS}>
                      {document.responsibleValue}
                    </div>
                  </Link>
                ) : (
                  <div className="hidden md:block md:border-l md:border-[#e6e6f0]" />
                )}
                <Link href={href} className={JOURNAL_CARD_SECTION_CLASS}>
                  <div className={JOURNAL_CARD_LABEL_CLASS}>{document.dateLabel}</div>
                  <div className={JOURNAL_CARD_VALUE_CLASS}>{document.dateValue}</div>
                </Link>
                <div className="flex justify-center">
                  {canManageDocuments && document.status === "active" && (
                    <button
                      type="button"
                      onClick={() => handleDelete(document)}
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
