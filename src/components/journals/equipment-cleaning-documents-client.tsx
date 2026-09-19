"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DocumentActionsMenu,
  EmptyDocumentsState,
  JournalTabs,
  JournalTopBar,
} from "@/components/journals/document-list-ui";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  EQUIPMENT_CLEANING_VARIANT_LABELS,
  type EquipmentCleaningFieldVariant,
} from "@/lib/equipment-cleaning-document";

import { toast } from "sonner";
import {
  JOURNAL_CARD_LABEL_CLASS,
  JOURNAL_CARD_SECTION_CLASS,
  JOURNAL_CARD_TITLE_CLASS,
  JOURNAL_CARD_VALUE_CLASS,
  JOURNAL_LIST_CARD_CLASS,
  JOURNAL_LIST_CARDS_CLASS,
} from "@/components/journals/journal-responsive";
import { SharedDocumentBadge } from "@/components/journals/shared-document-badge";
type EquipmentCleaningListDocument = {
  id: string;
  title: string;
  /** Точки: документ без точки рядом с документами точек. */
  shared?: boolean;
  status: "active" | "closed";
  startedAtLabel: string;
  dateFrom: string;
  fieldVariant: EquipmentCleaningFieldVariant;
};

type Props = {
  activeTab: "active" | "closed";
  templateCode: string;
  templateName: string;
  users: { id: string; name: string; role: string }[];
  documents: EquipmentCleaningListDocument[];
};

export function EquipmentCleaningDocumentsClient({
  activeTab,
  templateCode,
  templateName,
  users,
  documents,
}: Props) {
  const router = useRouter();
  const [editingDocument, setEditingDocument] =
    useState<EquipmentCleaningListDocument | null>(null);
  const [deletingDocument, setDeletingDocument] =
    useState<EquipmentCleaningListDocument | null>(null);
  const [title, setTitle] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [fieldVariant, setFieldVariant] =
    useState<EquipmentCleaningFieldVariant>("rinse_temperature");
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!editingDocument) return;
    setTitle(editingDocument.title);
    setDateFrom(editingDocument.dateFrom);
    setFieldVariant(editingDocument.fieldVariant);
  }, [editingDocument]);

  async function saveSettings() {
    if (!editingDocument) return;
    setIsSaving(true);
    try {
      const response = await fetch(`/api/journal-documents/${editingDocument.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          dateFrom,
          dateTo: dateFrom,
          config: {
            fieldVariant,
          },
        }),
      });
      if (!response.ok) {
        throw new Error();
      }
      setEditingDocument(null);
      router.refresh();
    } catch {
      toast.error("Не удалось сохранить настройки документа");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!deletingDocument) return;
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/journal-documents/${deletingDocument.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error();
      }
      setDeletingDocument(null);
      router.refresh();
    } catch {
      toast.error("Не удалось удалить документ");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="space-y-5">
      <JournalTopBar
        heading="Журнал мойки и дезинфекции оборудования"
        activeTab={activeTab}
        templateCode={templateCode}
        templateName={templateName}
        users={users}
        compact={false}
      />
      <JournalTabs activeTab={activeTab} templateCode={templateCode} compact={false} />

      <div className={JOURNAL_LIST_CARDS_CLASS}>
        {documents.length === 0 && <EmptyDocumentsState />}
        {documents.map((document) => (
          <div
            key={document.id}
            className={JOURNAL_LIST_CARD_CLASS}
          >
            <Link href={`/journals/${templateCode}/documents/${document.id}`} className="min-w-0">
              <div className={JOURNAL_CARD_TITLE_CLASS}>
                {document.title}
              <SharedDocumentBadge shared={document.shared} />
              </div>
            </Link>
            <Link
              href={`/journals/${templateCode}/documents/${document.id}`}
              className={`${JOURNAL_CARD_SECTION_CLASS} justify-self-end`}
            >
              <div className={JOURNAL_CARD_LABEL_CLASS}>Дата начала</div>
              <div className={JOURNAL_CARD_VALUE_CLASS}>
                {document.startedAtLabel}
              </div>
            </Link>
            <DocumentActionsMenu
              size="sm"
              document={document}
              siblings={documents}
              onEdit={() => setEditingDocument(document)}
              onPrint={() => window.open(`/api/journal-documents/${document.id}/pdf`, "_blank")}
              onDelete={() => setDeletingDocument(document)}
            />
          </div>
        ))}
      </div>

      <Dialog open={!!editingDocument} onOpenChange={(open) => !open && setEditingDocument(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[24px] border-0 p-0 sm:max-w-[720px]">
          <DialogHeader className="border-b px-6 py-5">
            <DialogTitle className="text-[22px] font-medium text-black">
              Настройки документа
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-5 px-6 py-5">
            <div className="space-y-2">
              <Label>Название документа</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Дата начала</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div className="space-y-3">
              <div className="text-[18px] font-semibold text-black">Название поля</div>
              <div className="flex flex-col gap-3 text-[18px] text-black sm:flex-row sm:gap-8">
                {(Object.keys(EQUIPMENT_CLEANING_VARIANT_LABELS) as EquipmentCleaningFieldVariant[]).map((variant) => (
                  <label key={variant} className="flex items-center gap-3">
                    <input
                      type="radio"
                      checked={fieldVariant === variant}
                      onChange={() => setFieldVariant(variant)}
                      className="size-5 accent-[#5566f6]"
                    />
                    {EQUIPMENT_CLEANING_VARIANT_LABELS[variant]}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={saveSettings} disabled={isSaving} className="bg-[#5566f6] text-white hover:bg-[#4d58f5]">
                {isSaving ? "Сохранение..." : "Сохранить"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deletingDocument} onOpenChange={(open) => !open && setDeletingDocument(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[24px] border-0 p-0 sm:max-w-[560px]">
          <DialogHeader className="border-b px-6 py-5">
            <DialogTitle className="text-[22px] font-medium text-black">
              {`Удаление документа "${deletingDocument?.title || ""}"`}
            </DialogTitle>
          </DialogHeader>
          <div className="flex justify-end px-6 py-6">
            <Button
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-[#5566f6] text-white hover:bg-[#4d58f5]"
            >
              {isDeleting ? "Удаление..." : "Удалить"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
