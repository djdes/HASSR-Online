"use client";

import { FillGuideLauncher } from "@/components/journals/fill-guide-launcher";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpenText,
  CalendarDays,
  Ellipsis,
  Pencil,
  Plus,
  Printer,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ResponsiveMenu } from "@/components/ui/responsive-menu";
import {
  BREAKDOWN_HISTORY_HEADING,
  BREAKDOWN_HISTORY_DOCUMENT_TITLE,
} from "@/lib/breakdown-history-document";

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
type DocumentItem = {
  id: string;
  title: string;
  /** Точки: документ без точки рядом с документами точек. */
  shared?: boolean;
  status: "active" | "closed";
  dateFrom: string;
  config: unknown;
};

type Props = {
  routeCode: string;
  templateCode: string;
  activeTab: "active" | "closed";
  documents: DocumentItem[];
};

function toIsoDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return localDayKey();
  return date.toISOString().slice(0, 10);
}

function formatDateDMY(iso: string) {
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

/* ---------- Create / Settings Dialog ---------- */

type DialogState = {
  title: string;
  dateFrom: string;
};

function SettingsDialog(props: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  mode: "create" | "edit";
  templateCode: string;
  initial: DialogState | null;
  onSubmit: (value: DialogState) => Promise<void>;
  submitText: string;
  dialogTitle: string;
}) {
  const [state, setState] = useState<DialogState | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const activeState = state || props.initial;
  const auto = useAutoDocumentTitle({
    templateCode: props.templateCode,
    journalName: BREAKDOWN_HISTORY_DOCUMENT_TITLE,
    period: { dateFrom: activeState?.dateFrom },
    enabled: props.mode === "create",
  });
  const { reset: resetAutoTitle, titleForPeriod } = auto;
  const { initial, open, mode } = props;

  // Reset-on-open lives in an effect: Radix `onOpenChange` does not fire
  // for the programmatic `setCreateOpen(true)`, so seeding there is skipped.
  useEffect(() => {
    if (!open) return;
    resetAutoTitle();
    const seeded =
      initial && mode === "create" ? titleForPeriod({ dateFrom: initial.dateFrom }) : null;
    setState(initial ? { ...initial, title: seeded || initial.title } : null);
  }, [initial, mode, open, resetAutoTitle, titleForPeriod]);

  async function handleSubmit() {
    if (!activeState) return;
    setSubmitting(true);
    try {
      await props.onSubmit(activeState);
      props.onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
    >
      <DialogContent showCloseButton={false} className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[28px] border-0 p-0 sm:max-w-[760px]">
        <DialogHeader className="border-b px-5 py-6 sm:px-10 sm:py-8">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-[22px] font-semibold tracking-[-0.03em] text-black">
              {props.dialogTitle}
            </DialogTitle>
            <button
              type="button"
              className="rounded-xl p-2 text-[#0b1024]"
              onClick={() => props.onOpenChange(false)}
            >
              <X className="size-8" />
            </button>
          </div>
        </DialogHeader>
        {activeState && (
          <div className="space-y-5 px-5 py-6 sm:px-10 sm:py-8">
            <div className="space-y-2">
              <Label className="text-[15px] text-[#7a7c8e]">Название документа</Label>
              <Input
                value={activeState.title}
                onChange={(e) => {
                  auto.markTouched();
                  setState({ ...activeState, title: e.target.value });
                }}
                className="h-9 rounded-xl border-[#d8dae6] px-5 text-[16px] tracking-[-0.02em]"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-[15px] text-[#7a7c8e]">Дата начала</Label>
              <div className="relative">
                <Input
                  type="date"
                  value={activeState.dateFrom}
                  onChange={(e) => {
                    const dateFrom = toIsoDate(e.target.value);
                    const next = auto.titleForPeriod({ dateFrom });
                    setState({
                      ...activeState,
                      dateFrom,
                      ...(next !== null ? { title: next } : {}),
                    });
                  }}
                  className="h-9 rounded-xl border-[#d8dae6] px-5 pr-12 text-[16px] tracking-[-0.02em]"
                />
                <CalendarDays className="pointer-events-none absolute right-4 top-1/2 size-6 -translate-y-1/2 text-[#6e7080] sm:right-6 sm:size-8" />
              </div>
            </div>

            <div className="flex justify-end pt-3">
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="h-9 rounded-xl bg-[#5563ff] px-3.5 text-[13.5px] text-white hover:bg-[#4554ff]"
              >
                {submitting ? "Сохранение..." : props.submitText}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Delete Dialog ---------- */

function DeleteDialog(props: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  title: string;
  onConfirm: () => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);

  async function handleDelete() {
    setSubmitting(true);
    try {
      await props.onConfirm();
      props.onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent showCloseButton={false} className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[28px] border-0 p-0 sm:max-w-[760px]">
        <DialogHeader className="border-b px-5 py-6 sm:px-10 sm:py-8">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-[22px] font-semibold tracking-[-0.03em] text-black">
              Удаление документа &laquo;{props.title}&raquo;
            </DialogTitle>
            <button
              type="button"
              className="rounded-xl p-2 text-[#0b1024]"
              onClick={() => props.onOpenChange(false)}
            >
              <X className="size-8" />
            </button>
          </div>
        </DialogHeader>
        <div className="space-y-5 px-5 py-6 sm:px-10 sm:py-8">
          <p className="text-[15px] text-[#7a7c8e]">
            Вы уверены, что хотите удалить этот документ? Это действие нельзя отменить.
          </p>
          <div className="flex justify-end pt-3">
            <Button
              type="button"
              onClick={handleDelete}
              disabled={submitting}
              className="h-9 rounded-xl bg-[#ff3b30] px-3.5 text-[13.5px] text-white hover:bg-[#e0342a]"
            >
              {submitting ? "Удаление..." : "Удалить"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Main Component ---------- */

export function BreakdownHistoryDocumentsClient({
  routeCode,
  templateCode,
  activeTab,
  documents,
}: Props) {
  const router = useRouter();
  const [settingsTarget, setSettingsTarget] = useState<DocumentItem | null>(null);
  // Создание / настройки / удаление документов API отдаёт только
  // руководителю — у остальных эти кнопки не показываем.
  const canManageDocuments = useCanManageDocuments();
  const restore = useRestoreDocument();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DocumentItem | null>(null);

  const defaultCreateState = useMemo<DialogState>(
    () => ({
      title: BREAKDOWN_HISTORY_DOCUMENT_TITLE,
      dateFrom: localDayKey(),
    }),
    []
  );
  const settingsInitialState = useMemo<DialogState | null>(
    () =>
      settingsTarget
        ? {
            title: settingsTarget.title || BREAKDOWN_HISTORY_DOCUMENT_TITLE,
            dateFrom: settingsTarget.dateFrom,
          }
        : null,
    [settingsTarget]
  );

  async function createDocument(payload: DialogState) {
    const response = await fetch("/api/journal-documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateCode,
        title: payload.title.trim() || BREAKDOWN_HISTORY_DOCUMENT_TITLE,
        // Период — по правилу журнала (`journal-period.ts`): история
        // поломок годовая, а окно создавало однодневный документ.
        ...resolveJournalPeriodForDate(templateCode, payload.dateFrom),
        config: { rows: [] },
      }),
    });

    if (!response.ok) {
      // Текст сервера («За этот период уже есть документ «…»») объясняет
      // отказ. Общая фраза оставляла человека без причины и без выхода.
      const failure = await response.json().catch(() => null);
      toast.error(failure?.error || "Не удалось создать документ");
      return;
    }

    const data = (await response.json()) as { document: { id: string } };
    router.push(`/journals/${routeCode}/documents/${data.document.id}`);
    router.refresh();
  }

  async function saveSettings(documentId: string, payload: DialogState) {
    const response = await fetch(`/api/journal-documents/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: payload.title.trim() || BREAKDOWN_HISTORY_DOCUMENT_TITLE,
        dateFrom: payload.dateFrom,
      }),
    });

    if (!response.ok) {
      toast.error("Не удалось сохранить настройки");
      return;
    }

    router.refresh();
  }

  async function handleDelete(documentId: string) {
    const response = await fetch(`/api/journal-documents/${documentId}`, { method: "DELETE" });
    if (!response.ok) {
      toast.error("Не удалось удалить документ");
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className={JOURNAL_LIST_HEADING_CLASS}>
          {BREAKDOWN_HISTORY_HEADING}
          {activeTab === "closed" && " (Закрытые)"}
        </h1>
        <div className={JOURNAL_LIST_ACTIONS_CLASS}>
          <FillGuideLauncher
            code={templateCode}
            page="list"
            variant="button"
          />
          {canManageDocuments && activeTab === "active" && (
            <Button
              className="h-12 w-full rounded-2xl bg-[#5563ff] px-8 text-[16px] text-white hover:bg-[#4554ff] sm:w-auto"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="size-5" />
              Создать документ
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-[#d9dce8]">
        <div className="flex flex-wrap gap-6 text-[15px] sm:gap-12 sm:text-[16px]">
          <Link
            href={`/journals/${routeCode}`}
            className={`relative pb-6 ${
              activeTab === "active"
                ? "font-semibold text-black after:absolute after:bottom-[-1px] after:left-0 after:h-[3px] after:w-full after:bg-[#5566f6]"
                : "text-[#8a8ea4]"
            }`}
          >
            Активные
          </Link>
          <Link
            href={`/journals/${routeCode}?tab=closed`}
            className={`relative pb-6 ${
              activeTab === "closed"
                ? "font-semibold text-black after:absolute after:bottom-[-1px] after:left-0 after:h-[3px] after:w-full after:bg-[#5566f6]"
                : "text-[#8a8ea4]"
            }`}
          >
            Закрытые
          </Link>
        </div>
      </div>

      {/* Document Cards */}
      <div className={JOURNAL_LIST_CARDS_CLASS}>
        {documents.length === 0 && (
          <EmptyDocumentsState />
        )}

        {documents.map((document) => {
          const href = `/journals/${routeCode}/documents/${document.id}`;
          return (
            <div
              key={document.id}
              className={JOURNAL_LIST_CARD_CLASS}
            >
              <Link href={href} className={JOURNAL_CARD_TITLE_CLASS}>
                {document.title || BREAKDOWN_HISTORY_DOCUMENT_TITLE}
              <SharedDocumentBadge shared={document.shared} />
              </Link>

              <Link href={href} className={JOURNAL_CARD_SECTION_CLASS}>
                <div className={JOURNAL_CARD_LABEL_CLASS}>Дата начала</div>
                <div className={JOURNAL_CARD_VALUE_CLASS}>
                  {formatDateDMY(document.dateFrom)}
                </div>
              </Link>

              <div className="flex justify-center">
                <ResponsiveMenu
                  title="Действия с документом"
                  contentClassName="max-w-[calc(100vw-1rem)] rounded-[28px] border-0 p-5 shadow-xl sm:w-[320px]"
                  items={filterManageMenuItems([
                    ...(document.status === "active"
                      ? [
                          {
                            key: "settings",
                            label: "Настройки",
                            icon: <Pencil className="size-4 text-[#6f7282]" />,
                            onSelect: () => setSettingsTarget(document),
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
                            onSelect: () => setDeleteTarget(document),
                            tone: "danger" as const,
                          },
                        ]
                      : []),
                  ], canManageDocuments)}
                  trigger={
                    <button
                      type="button"
                      className="flex size-10 items-center justify-center rounded-full text-[#5566f6] hover:bg-[#f5f6ff]"
                    >
                      <Ellipsis className="size-8" />
                    </button>
                  }
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Create Dialog */}
      <SettingsDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        templateCode={templateCode}
        initial={defaultCreateState}
        onSubmit={createDocument}
        submitText="Создать"
        dialogTitle="Создание документа"
      />

      {/* Settings Dialog */}
      <SettingsDialog
        open={!!settingsTarget}
        onOpenChange={(value) => {
          if (!value) setSettingsTarget(null);
        }}
        mode="edit"
        templateCode={templateCode}
        initial={settingsInitialState}
        onSubmit={async (value) => {
          if (!settingsTarget) return;
          await saveSettings(settingsTarget.id, value);
        }}
        submitText="Сохранить"
        dialogTitle="Настройки документа"
      />

      {/* Delete Dialog */}
      <DeleteDialog
        open={!!deleteTarget}
        onOpenChange={(value) => {
          if (!value) setDeleteTarget(null);
        }}
        title={deleteTarget?.title || BREAKDOWN_HISTORY_DOCUMENT_TITLE}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await handleDelete(deleteTarget.id);
        }}
      />
    </div>
  );
}
