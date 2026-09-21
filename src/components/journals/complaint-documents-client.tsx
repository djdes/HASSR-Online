"use client";

import { FillGuideLauncher } from "@/components/journals/fill-guide-launcher";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpenText, Ellipsis, Plus, Printer, Settings2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ResponsiveMenu } from "@/components/ui/responsive-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  COMPLAINT_REGISTER_TEMPLATE_CODE,
  COMPLAINT_REGISTER_TITLE,
  formatComplaintDate,
  type ComplaintDocumentConfig,
} from "@/lib/complaint-document";

import { toast } from "sonner";
import {
  EmptyDocumentsState,
  filterManageMenuItems,
  restoreMenuItems,
  useRestoreDocument,
  useCanManageDocuments,
} from "@/components/journals/document-list-ui";
import { resolveJournalPeriodForDate } from "@/lib/journal-period";
import {
  JOURNAL_CARD_LABEL_CLASS,
  JOURNAL_CARD_SECTION_CLASS,
  JOURNAL_CARD_TITLE_CLASS,
  JOURNAL_CARD_VALUE_CLASS,
  JOURNAL_LIST_ACTIONS_CLASS,
  JOURNAL_LIST_HEADING_CLASS,
  JOURNAL_LIST_CARD_CLASS,
  JOURNAL_LIST_CARDS_CLASS,
} from "@/components/journals/journal-responsive";
import { localDayKey } from "@/lib/entry-defaults";
import { useAutoDocumentTitle } from "@/components/journals/use-auto-document-title";
import { SharedDocumentBadge } from "@/components/journals/shared-document-badge";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";
type ComplaintListDocument = {
  id: string;
  title: string;
  /** Точки: документ без точки рядом с документами точек. */
  shared?: boolean;
  status: "active" | "closed";
  dateFrom: string;
  config: ComplaintDocumentConfig | null;
};

type Props = {
  activeTab: "active" | "closed";
  routeCode: string;
  documents: ComplaintListDocument[];
};

function CreateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const router = useRouter();
  const today = localDayKey();
  const [dateFrom, setDateFrom] = useState(today);
  const [submitting, setSubmitting] = useState(false);
  // Автоназвание «Журнал … — 2026 год» из имени журнала и года даты начала
  // (просьба владельца 2026-09-04); диалог только для создания.
  const auto = useAutoDocumentTitle({
    templateCode: COMPLAINT_REGISTER_TEMPLATE_CODE,
    journalName: COMPLAINT_REGISTER_TITLE,
    period: { dateFrom },
    enabled: true,
  });
  const { reset: resetAutoTitle, seedTitle } = auto;
  const [title, setTitle] = useState(() => seedTitle() || COMPLAINT_REGISTER_TITLE);

  useEffect(() => {
    if (!open) return;
    resetAutoTitle();
    setDateFrom(today);
    setTitle(seedTitle() || COMPLAINT_REGISTER_TITLE);
  }, [open, resetAutoTitle, seedTitle, today]);

  async function handleCreate() {
    setSubmitting(true);
    try {
      const response = await fetch("/api/journal-documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateCode: COMPLAINT_REGISTER_TEMPLATE_CODE,
          title: title.trim() || COMPLAINT_REGISTER_TITLE,
          // Период — по правилу журнала (`journal-period.ts`): реестр
          // претензий годовой, а окно создавало однодневный документ.
          ...resolveJournalPeriodForDate(
            COMPLAINT_REGISTER_TEMPLATE_CODE,
            dateFrom
          ),
        }),
      });

      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.document?.id) {
        throw new Error(result?.error || "Не удалось создать документ");
      }

      onOpenChange(false);
      onCreated();
      router.push(`/journals/${COMPLAINT_REGISTER_TEMPLATE_CODE}/documents/${result.document.id}`);
    } catch (error) {
      toast.error(humanizeFetchError(error, "Ошибка создания документа"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-1rem)] rounded-[32px] border-0 p-0 sm:max-w-[720px]">
        <DialogHeader className="border-b px-14 py-12">
          <DialogTitle className="text-[22px] font-medium text-black">
            Создание документа
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-8 px-14 py-12">
          <div className="space-y-3">
            <Label className="sr-only" htmlFor="complaint-doc-title">
              Название документа
            </Label>
            <Input
              id="complaint-doc-title"
              value={title}
              onChange={(event) => {
                auto.markTouched();
                setTitle(event.target.value);
              }}
              placeholder="Введите название документа"
              className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
            />
          </div>
          <div className="space-y-3">
            <Label className="text-[14px] text-[#73738a]" htmlFor="complaint-doc-start">
              Дата начала
            </Label>
            <Input
              id="complaint-doc-start"
              type="date"
              value={dateFrom}
              onChange={(event) => {
                const value = event.target.value;
                const next = auto.titleForPeriod({ dateFrom: value });
                setDateFrom(value);
                if (next !== null) setTitle(next);
              }}
              className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
            />
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={handleCreate}
              disabled={submitting}
              className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] text-white hover:bg-[#4b57ff]"
            >
              {submitting ? "Создание..." : "Создать"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SettingsDialog({
  open,
  onOpenChange,
  document,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: ComplaintListDocument | null;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !document) return;
    setTitle(document.title);
    setDateFrom(document.dateFrom);
  }, [document, open]);

  async function handleSave() {
    if (!document) return;
    setSubmitting(true);
    try {
      const response = await fetch(`/api/journal-documents/${document.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || COMPLAINT_REGISTER_TITLE,
          dateFrom,
          dateTo: dateFrom,
        }),
      });

      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.error || "Не удалось сохранить документ");
      }

      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(humanizeFetchError(error, "Ошибка сохранения документа"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-1rem)] rounded-[32px] border-0 p-0 sm:max-w-[760px]">
        <DialogHeader className="border-b px-14 py-12">
          <DialogTitle className="text-[22px] font-medium text-black">
            Настройки документа
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-8 px-14 py-12">
          <div className="space-y-3">
            <Label className="text-[14px] text-[#73738a]" htmlFor="complaint-settings-title">
              Название документа
            </Label>
            <Input
              id="complaint-settings-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
            />
          </div>
          <div className="space-y-3">
            <Label className="text-[14px] text-[#73738a]" htmlFor="complaint-settings-start">
              Дата начала
            </Label>
            <Input
              id="complaint-settings-start"
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
            />
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={handleSave}
              disabled={submitting}
              className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] text-white hover:bg-[#4b57ff]"
            >
              {submitting ? "Сохранение..." : "Сохранить"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({
  open,
  onOpenChange,
  document,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: ComplaintListDocument | null;
  onDeleted: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);

  async function handleDelete() {
    if (!document) return;
    setSubmitting(true);
    try {
      const response = await fetch(`/api/journal-documents/${document.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Не удалось удалить документ");
      }

      onOpenChange(false);
      onDeleted();
    } catch (error) {
      toast.error(humanizeFetchError(error, "Ошибка удаления документа"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-1rem)] rounded-[32px] border-0 p-0 sm:max-w-[760px]">
        <DialogHeader className="border-b px-14 py-10">
          <DialogTitle className="pr-14 text-[22px] font-medium leading-[1.15] text-black">
            {`Удаление документа "${document?.title || COMPLAINT_REGISTER_TITLE}"`}
          </DialogTitle>
        </DialogHeader>
        <div className="flex justify-end px-14 py-12">
          <Button
            type="button"
            onClick={handleDelete}
            disabled={submitting}
            className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] text-white hover:bg-[#4b57ff]"
          >
            {submitting ? "Удаление..." : "Удалить"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ComplaintDocumentsClient({
  activeTab,
  routeCode,
  documents,
}: Props) {
  const router = useRouter();
  // Создание / настройки / удаление документов API отдаёт только
  // руководителю — у остальных эти кнопки не показываем.
  const canManageDocuments = useCanManageDocuments();
  const restore = useRestoreDocument();
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsDocument, setSettingsDocument] = useState<ComplaintListDocument | null>(null);
  const [deleteDocument, setDeleteDocument] = useState<ComplaintListDocument | null>(null);

  return (
    <>
      <div className="space-y-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 className={JOURNAL_LIST_HEADING_CLASS}>
            {COMPLAINT_REGISTER_TITLE}
          </h1>
          <div className={JOURNAL_LIST_ACTIONS_CLASS}>
            <FillGuideLauncher
              code="complaint_register"
              page="list"
              variant="button"
            />
            {canManageDocuments && activeTab === "active" && (
              <Button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="h-12 w-full rounded-xl bg-[#5566f6] px-5 text-[14px] font-medium text-white hover:bg-[#4a5bf0] sm:w-auto"
              >
                <Plus className="size-4" />
                Создать документ
              </Button>
            )}
          </div>
        </div>

        <div className="border-b border-[#d9dce8]">
          <div className="flex gap-9 text-[15px]">
            <Link
              href={`/journals/${routeCode}`}
              className={`relative pb-4 ${
                activeTab === "active"
                  ? "font-medium text-black after:absolute after:bottom-[-1px] after:left-0 after:h-[2px] after:w-full after:bg-[#5566f6]"
                  : "text-[#6f7282]"
              }`}
            >
              Активные
            </Link>
            <Link
              href={`/journals/${routeCode}?tab=closed`}
              className={`relative pb-4 ${
                activeTab === "closed"
                  ? "font-medium text-black after:absolute after:bottom-[-1px] after:left-0 after:h-[2px] after:w-full after:bg-[#5566f6]"
                  : "text-[#6f7282]"
              }`}
            >
              Закрытые
            </Link>
          </div>
        </div>

        <div className={JOURNAL_LIST_CARDS_CLASS}>
          {documents.length === 0 && <EmptyDocumentsState />}

          {documents.map((document) => (
            <div
              key={document.id}
              className={JOURNAL_LIST_CARD_CLASS}
            >
              <Link
                href={`/journals/${routeCode}/documents/${document.id}`}
                className={JOURNAL_CARD_TITLE_CLASS}
              >
                {document.title}
              <SharedDocumentBadge shared={document.shared} />
              </Link>
              <Link
                href={`/journals/${routeCode}/documents/${document.id}`}
                className={`${JOURNAL_CARD_SECTION_CLASS} justify-self-end`}
              >
                <div className={JOURNAL_CARD_LABEL_CLASS}>Дата начала</div>
                <div className={JOURNAL_CARD_VALUE_CLASS}>
                  {formatComplaintDate(document.dateFrom)}
                </div>
              </Link>
              <div className="justify-self-end">
                <ResponsiveMenu
                  title="Действия с документом"
                  contentClassName="w-[280px] rounded-[24px] border-0 p-4 shadow-xl"
                  items={filterManageMenuItems([
                    ...(document.status === "active"
                      ? [
                          {
                            key: "settings",
                            label: "Настройки",
                            icon: <Settings2 className="size-4 text-[#6f7282]" />,
                            onSelect: () => setSettingsDocument(document),
                          },
                        ]
                      : []),
                    {
                      key: "print",
                      label: "Печать",
                      icon: <Printer className="size-4 text-[#6f7282]" />,
                      onSelect: () =>
                        window.open(`/api/journal-documents/${document.id}/pdf`, "_blank"),
                    },
                    // Закрытый документ раньше уходил навсегда: вернуть
                    // его в активные было нечем.
                    ...restoreMenuItems({ document, siblings: documents, restore }),
                    ...(document.status === "active"
                      ? [
                          {
                            key: "delete",
                            label: "Удалить",
                            icon: <Trash2 className="size-4 text-[#ff3b30]" />,
                            onSelect: () => setDeleteDocument(document),
                            tone: "danger" as const,
                          },
                        ]
                      : []),
                  ], canManageDocuments)}
                  trigger={
                    <button
                      type="button"
                      className="flex size-9 items-center justify-center rounded-full text-[#5566f6] hover:bg-[#f5f6ff]"
                    >
                      <Ellipsis className="size-6" />
                    </button>
                  }
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <CreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => router.refresh()}
      />

      <SettingsDialog
        open={!!settingsDocument}
        onOpenChange={(open) => {
          if (!open) setSettingsDocument(null);
        }}
        document={settingsDocument}
        onSaved={() => router.refresh()}
      />

      <DeleteDialog
        open={!!deleteDocument}
        onOpenChange={(open) => {
          if (!open) setDeleteDocument(null);
        }}
        document={deleteDocument}
        onDeleted={() => router.refresh()}
      />
    </>
  );
}
