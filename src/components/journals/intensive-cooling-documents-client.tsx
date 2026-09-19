"use client";

import { FillGuideLauncher } from "@/components/journals/fill-guide-launcher";

import Link from "next/link";
import { useMemo, useState } from "react";
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
  INTENSIVE_COOLING_DEFAULT_DOCUMENT_NAME,
  INTENSIVE_COOLING_DOCUMENT_TITLE,
  INTENSIVE_COOLING_TEMPLATE_CODE,
  getDefaultIntensiveCoolingConfig,
} from "@/lib/intensive-cooling-document";

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
import { SharedDocumentBadge } from "@/components/journals/shared-document-badge";
type UserItem = {
  id: string;
  name: string;
  role: string;
};

type DocumentItem = {
  id: string;
  title: string;
  /** Точки: документ без точки рядом с документами точек. */
  shared?: boolean;
  status: "active" | "closed";
  dateFrom: string;
  config?: unknown;
};

type Props = {
  routeCode: string;
  activeTab: "active" | "closed";
  documents: DocumentItem[];
  users: UserItem[];
  dishSuggestions: string[];
};

type DialogState = {
  title: string;
  dateFrom: string;
};

function formatDateDMY(value: string) {
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}-${month}-${year}`;
}

function DocumentDialog(props: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  initial: DialogState | null;
  dialogTitle: string;
  submitText: string;
  onSubmit: (value: DialogState) => Promise<void>;
}) {
  const [state, setState] = useState<DialogState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const activeState = state || props.initial;

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
      onOpenChange={(value) => {
        if (value) setState(props.initial);
        props.onOpenChange(value);
      }}
    >
      <DialogContent showCloseButton={false} className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[28px] border-0 p-0 sm:max-w-[720px]">
        <DialogHeader className="border-b px-8 py-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <DialogTitle className="text-[22px] font-medium text-black">
              {props.dialogTitle}
            </DialogTitle>
            <button
              type="button"
              className="rounded-xl p-2 text-[#101425]"
              onClick={() => props.onOpenChange(false)}
            >
              <X className="size-7" />
            </button>
          </div>
        </DialogHeader>
        {activeState ? (
          <div className="space-y-6 px-8 py-7">
            <div className="space-y-2">
              <Label className="text-base text-[#6e7387]">
                Название документа
              </Label>
              <Input
                value={activeState.title}
                onChange={(event) =>
                  setState({ ...activeState, title: event.target.value })
                }
                placeholder="Введите название документа"
                className="h-9 rounded-xl border-[#d7dbea] px-3.5 text-[13.5px]"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-base text-[#6e7387]">Дата начала</Label>
              <div className="relative">
                <Input
                  type="date"
                  value={activeState.dateFrom}
                  onChange={(event) =>
                    setState({ ...activeState, dateFrom: event.target.value })
                  }
                  className="h-9 rounded-xl border-[#d7dbea] px-3.5 text-[13.5px]"
                />
                <CalendarDays className="pointer-events-none absolute right-5 top-1/2 size-6 -translate-y-1/2 text-[#6e7387]" />
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="h-9 rounded-xl bg-[#5563ff] px-10 text-[13.5px] text-white hover:bg-[#4452ee]"
              >
                {submitting ? "Сохранение..." : props.submitText}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

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
      <DialogContent showCloseButton={false} className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[28px] border-0 p-0 sm:max-w-[720px]">
        <DialogHeader className="border-b px-8 py-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <DialogTitle className="text-[22px] font-medium text-black">
              Удаление документа &quot;{props.title}&quot;
            </DialogTitle>
            <button
              type="button"
              className="rounded-xl p-2 text-[#101425]"
              onClick={() => props.onOpenChange(false)}
            >
              <X className="size-7" />
            </button>
          </div>
        </DialogHeader>
        <div className="flex justify-end px-8 py-7">
          <Button
            type="button"
            onClick={handleDelete}
            disabled={submitting}
            className="h-9 rounded-xl bg-[#5563ff] px-10 text-[13.5px] text-white hover:bg-[#4452ee]"
          >
            {submitting ? "Удаление..." : "Удалить"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function IntensiveCoolingDocumentsClient({
  routeCode,
  activeTab,
  documents,
  users,
  dishSuggestions,
}: Props) {
  const router = useRouter();
  // Создание / настройки / удаление документов API отдаёт только
  // руководителю — у остальных эти кнопки не показываем.
  const canManageDocuments = useCanManageDocuments();
  const restore = useRestoreDocument();
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsTarget, setSettingsTarget] = useState<DocumentItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DocumentItem | null>(null);

  const createInitialState = useMemo<DialogState>(
    () => ({
      title: INTENSIVE_COOLING_DEFAULT_DOCUMENT_NAME,
      dateFrom: localDayKey(),
    }),
    []
  );

  async function createDocument(payload: DialogState) {
    const response = await fetch("/api/journal-documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateCode: INTENSIVE_COOLING_TEMPLATE_CODE,
        title: payload.title.trim() || INTENSIVE_COOLING_DEFAULT_DOCUMENT_NAME,
        // Период — по правилу журнала (`journal-period.ts`): интенсивное
        // охлаждение бессрочное, а окно создавало документ на один день.
        ...resolveJournalPeriodForDate(
          INTENSIVE_COOLING_TEMPLATE_CODE,
          payload.dateFrom
        ),
        config: getDefaultIntensiveCoolingConfig(users, dishSuggestions),
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
        title: payload.title.trim() || INTENSIVE_COOLING_DEFAULT_DOCUMENT_NAME,
        dateFrom: payload.dateFrom,
        dateTo: payload.dateFrom,
      }),
    });

    if (!response.ok) {
      toast.error("Не удалось сохранить настройки");
      return;
    }

    router.refresh();
  }

  async function deleteDocument(documentId: string) {
    const response = await fetch(`/api/journal-documents/${documentId}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      toast.error("Не удалось удалить документ");
      return;
    }

    router.refresh();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <h1 className={JOURNAL_LIST_HEADING_CLASS}>
          {INTENSIVE_COOLING_DOCUMENT_TITLE}
        </h1>
        <div className={JOURNAL_LIST_ACTIONS_CLASS}>
          <FillGuideLauncher
            code="intensive_cooling"
            page="list"
            variant="button"
          />
          {canManageDocuments && activeTab === "active" ? (
            <Button
              className="h-12 w-full rounded-2xl bg-[#5563ff] px-8 text-[15px] text-white hover:bg-[#4452ee] sm:w-auto"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="size-5" />
              Создать документ
            </Button>
          ) : null}
        </div>
      </div>

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

      <div className={JOURNAL_LIST_CARDS_CLASS}>
        {documents.length === 0 ? (
          <EmptyDocumentsState />
        ) : null}

        {documents.map((document) => {
          const href = `/journals/${routeCode}/documents/${document.id}`;
          return (
            <div
              key={document.id}
              className={JOURNAL_LIST_CARD_CLASS}
            >
              <Link href={href} className={JOURNAL_CARD_TITLE_CLASS}>
                {document.title || INTENSIVE_COOLING_DEFAULT_DOCUMENT_NAME}
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
                  contentClassName="w-[320px] rounded-[28px] border-0 p-5 shadow-xl"
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
                      onClick={(event) => event.stopPropagation()}
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

      <DocumentDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        initial={createInitialState}
        onSubmit={createDocument}
        submitText="Создать"
        dialogTitle="Создание документа"
      />

      <DocumentDialog
        open={!!settingsTarget}
        onOpenChange={(value) => {
          if (!value) setSettingsTarget(null);
        }}
        initial={
          settingsTarget
            ? {
                title:
                  settingsTarget.title || INTENSIVE_COOLING_DEFAULT_DOCUMENT_NAME,
                dateFrom: settingsTarget.dateFrom,
              }
            : null
        }
        onSubmit={async (payload) => {
          if (!settingsTarget) return;
          await saveSettings(settingsTarget.id, payload);
        }}
        submitText="Сохранить"
        dialogTitle="Настройки документа"
      />

      <DeleteDialog
        open={!!deleteTarget}
        onOpenChange={(value) => {
          if (!value) setDeleteTarget(null);
        }}
        title={deleteTarget?.title || INTENSIVE_COOLING_DEFAULT_DOCUMENT_NAME}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteDocument(deleteTarget.id);
        }}
      />
    </div>
  );
}
