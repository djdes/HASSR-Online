"use client";

import { JournalHeadingName } from "@/components/shared/custom-names-provider";
import {
  JOURNAL_ACTION_CREATE_CLASS,
  JOURNAL_LIST_HEADER_ROW_CLASS,
  JOURNAL_LIST_TITLE_CLASS,
  JournalListActions,
} from "@/components/journals/journal-list-actions";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpenText, Ellipsis, Pencil, Plus, Printer, Trash2, X } from "lucide-react";
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
  PEST_CONTROL_DOCUMENT_TITLE,
  PEST_CONTROL_PAGE_TITLE,
  PEST_CONTROL_TEMPLATE_CODE,
  formatPestControlDate,
} from "@/lib/pest-control-document";
import { useAutoDocumentTitle } from "@/components/journals/use-auto-document-title";
import { openDocumentPdf } from "@/lib/open-document-pdf";

import { toast } from "sonner";
import {
  EmptyDocumentsState,
  filterManageMenuItems,
  restoreMenuItems,
  useRestoreDocument,
  useCanManageDocuments,
  JournalTabs,
} from "@/components/journals/document-list-ui";
import { resolveJournalPeriodForDate } from "@/lib/journal-period";
import {
  JOURNAL_CARD_LABEL_CLASS,
  JOURNAL_CARD_SECTION_CLASS,
  JOURNAL_CARD_TITLE_CLASS,
  JOURNAL_CARD_VALUE_CLASS,
  JOURNAL_LIST_CARD_CLASS,
  JOURNAL_LIST_CARDS_CLASS,
} from "@/components/journals/journal-responsive";
import { localDayKey } from "@/lib/entry-defaults";
import { SharedDocumentBadge } from "@/components/journals/shared-document-badge";
import {
  DocumentDialogFeedback,
  readCreatedDocument,
  useDocumentDialogSubmit,
} from "@/components/journals/use-document-dialog-submit";
type UserItem = { id: string; name: string; role: string };

type DocumentItem = {
  id: string;
  title: string;
  /** Точки: документ без точки рядом с документами точек. */
  shared?: boolean;
  status: "active" | "closed";
  dateFrom: string;
};

type Props = {
  activeTab: "active" | "closed";
  routeCode: string;
  templateCode: string;
  users: UserItem[];
  documents: DocumentItem[];
};

type EditingState = {
  id: string;
  title: string;
  dateFrom: string;
};

function SettingsDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  submitLabel: string;
  initial: EditingState | null;
  onSubmit: (payload: { title: string; dateFrom: string }) => Promise<void>;
  mode: "create" | "edit";
}) {
  const [form, setForm] = useState({ title: "", dateFrom: "" });
  // Окно закрывается только при успехе, ошибка сервера видна здесь же.
  const submit = useDocumentDialogSubmit({ onOpenChange: props.onOpenChange });
  const submitting = submit.submitting;

  const auto = useAutoDocumentTitle({
    templateCode: PEST_CONTROL_TEMPLATE_CODE,
    journalName: PEST_CONTROL_DOCUMENT_TITLE,
    period: { dateFrom: form.dateFrom },
    enabled: props.mode === "create",
  });
  const { reset: resetAuto, seedTitle } = auto;

  const initial = props.initial;
  useEffect(() => {
    if (!initial) return;
    resetAuto();
    setForm({
      title: initial.title || seedTitle(),
      dateFrom: initial.dateFrom,
    });
  }, [initial, resetAuto, seedTitle]);

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (open && props.initial) {
          auto.reset();
          setForm({
            title: props.initial.title || auto.seedTitle(),
            dateFrom: props.initial.dateFrom,
          });
        }
        props.onOpenChange(open);
      }}
    >
      <DialogContent showCloseButton={false} className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[24px] border-0 p-0 sm:max-w-[560px]">
        <DialogHeader className="flex flex-row items-center justify-between border-b px-7 py-5">
          <DialogTitle className="text-[22px] font-medium text-black">
            {props.title}
          </DialogTitle>
          <button
            type="button"
            className="rounded-md p-1 text-black/80 hover:bg-black/5"
            onClick={() => props.onOpenChange(false)}
          >
            <X className="size-6" />
          </button>
        </DialogHeader>

        <div className="space-y-5 px-7 py-6">
          <DocumentDialogFeedback state={submit} onOpenChange={props.onOpenChange} />
          {/* Постоянные подписи над полями: раньше оба поля жили на одном
              плейсхолдере (у даты — вообще без подписи), и после ввода
              было непонятно, что где. */}
          <div className="space-y-1.5">
            <Label htmlFor="pest-doc-title" className="text-[14px] text-[#6f7282]">
              Название документа
            </Label>
          <Input
            id="pest-doc-title"
            value={form.title}
            onChange={(event) => {
              auto.markTouched();
              setForm((current) => ({ ...current, title: event.target.value }));
            }}
            placeholder="Введите название документа"
            className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
          />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pest-doc-date" className="text-[14px] text-[#6f7282]">
              Дата начала
            </Label>
          <Input
            id="pest-doc-date"
            type="date"
            value={form.dateFrom}
            onChange={(event) => {
              const dateFrom = event.target.value;
              const next = auto.titleForPeriod({ dateFrom });
              setForm((current) => ({
                ...current,
                dateFrom,
                ...(next !== null ? { title: next } : {}),
              }));
            }}
            className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
          />
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              disabled={submitting || !form.dateFrom}
              className="h-12 rounded-xl bg-[#5863f8] px-7 text-[18px] text-white hover:bg-[#4b57f3]"
              onClick={async () => {
                await submit.run(() => props.onSubmit({
                    title: form.title.trim() || PEST_CONTROL_DOCUMENT_TITLE,
                    dateFrom: form.dateFrom,
                  }));
              }}
            >
              {submitting ? "Сохранение..." : props.submitLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  submitLabel: string;
  onSubmit: () => Promise<void>;
}) {
  // Окно закрывается только при успехе, ошибка сервера видна здесь же.
  const submit = useDocumentDialogSubmit({ onOpenChange: props.onOpenChange });
  const submitting = submit.submitting;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent showCloseButton={false} className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[24px] border-0 p-0 sm:max-w-[560px]">
        <DialogHeader className="flex flex-row items-center justify-between border-b px-7 py-5">
          <DialogTitle className="text-[22px] font-medium text-black">
            {props.title}
          </DialogTitle>
          <button
            type="button"
            className="rounded-md p-1 text-black/80 hover:bg-black/5"
            onClick={() => props.onOpenChange(false)}
          >
            <X className="size-6" />
          </button>
        </DialogHeader>

        <div className="flex justify-end px-7 py-6">
          <Button
            type="button"
            disabled={submitting}
            className="h-12 rounded-xl bg-[#5863f8] px-7 text-[18px] text-white hover:bg-[#4b57f3]"
            onClick={async () => {
              await submit.run(() => props.onSubmit());
            }}
          >
            {submitting ? "Подождите..." : props.submitLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PestControlDocumentsClient(props: Props) {
  const router = useRouter();
  // Создание / настройки / удаление документов API отдаёт только
  // руководителю — у остальных эти кнопки не показываем.
  const canManageDocuments = useCanManageDocuments();
  const restore = useRestoreDocument();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [deleting, setDeleting] = useState<DocumentItem | null>(null);

  // useMemo: раньше объект пересоздавался каждый рендер, и `useEffect`
  // в SettingsDialog перетирал набранный текст. Название подставляется
  // автоматически из имени журнала + периода (`useAutoDocumentTitle`,
  // просьба владельца 2026-09-04).
  const createState = useMemo<EditingState>(
    () => ({
      id: "",
      title: "",
      dateFrom: localDayKey(),
    }),
    []
  );

  // Образцы документов (дезинсекция «ИП Хижняк» 2025 года) раньше создавал
  // сам клиент — в любой организации, открывшей пустой журнал. Образцы
  // теперь сеет только сервер и только в демо-организации
  // (`ensurePestControlSampleDocuments` на странице журнала).

  async function createDocument(payload: { title: string; dateFrom: string }) {
    const response = await fetch("/api/journal-documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateCode: props.templateCode,
        title: payload.title,
        // Период — по правилу журнала (`journal-period.ts`): дезинсекция
        // годовая, а окно создавало однодневный документ поверх годового.
        ...resolveJournalPeriodForDate(props.templateCode, payload.dateFrom),
      }),
    });

    // Ошибку показывает само окно создания: тост её гасил, а окно
    // закрывалось вместе с введённым.
    const created = await readCreatedDocument(response);
    router.push(`/journals/${props.routeCode}/documents/${created.id}`);
    router.refresh();
  }

  async function saveDocumentSettings(
    documentId: string,
    payload: { title: string; dateFrom: string }
  ) {
    const response = await fetch(`/api/journal-documents/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: payload.title,
        dateFrom: payload.dateFrom,
      }),
    });

    if (!response.ok) {
      const failure = await response.json().catch(() => null);
      throw new Error(failure?.error || "Не удалось сохранить настройки документа");
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
      <div className={JOURNAL_LIST_HEADER_ROW_CLASS}>
        <h1 className={JOURNAL_LIST_TITLE_CLASS}>
          <JournalHeadingName fallback={PEST_CONTROL_PAGE_TITLE} />
        </h1>
        <JournalListActions
          templateCode="pest_control"
          canManage={canManageDocuments}
          create={
            canManageDocuments && props.activeTab === "active" ? (
              <Button className={JOURNAL_ACTION_CREATE_CLASS} onClick={() => setCreating(true)}>
                <Plus className="size-4" />
                Создать документ
              </Button>
            ) : null
          }
        />
      </div>

      <JournalTabs activeTab={props.activeTab} templateCode={props.routeCode} />

      <div className={JOURNAL_LIST_CARDS_CLASS}>
        {props.documents.length === 0 && (
          <EmptyDocumentsState />
        )}

        {props.documents.map((document) => {
          const href = `/journals/${props.routeCode}/documents/${document.id}`;
          return (
            <div
              key={document.id}
              className={JOURNAL_LIST_CARD_CLASS}
            >
              <Link href={href} className={JOURNAL_CARD_TITLE_CLASS}>
                {document.title || PEST_CONTROL_DOCUMENT_TITLE}
              <SharedDocumentBadge shared={document.shared} />
              </Link>

              <Link href={href} className={JOURNAL_CARD_SECTION_CLASS}>
                <div className={JOURNAL_CARD_LABEL_CLASS}>Дата начала</div>
                <div className={JOURNAL_CARD_VALUE_CLASS}>
                  {formatPestControlDate(document.dateFrom)}
                </div>
              </Link>

              <div className="flex justify-center">
                <ResponsiveMenu
                  title="Действия"
                  items={filterManageMenuItems([
                    ...(document.status === "active"
                      ? [
                          {
                            key: "settings",
                            label: "Настройки",
                            icon: <Pencil className="size-4 text-[#6f7282]" />,
                            onSelect: () =>
                              setEditing({
                                id: document.id,
                                title: document.title || PEST_CONTROL_DOCUMENT_TITLE,
                                dateFrom: document.dateFrom,
                              }),
                          },
                        ]
                      : []),
                    {
                      key: "print",
                      label: "Печать",
                      icon: <Printer className="size-4 text-[#6f7282]" />,
                      onSelect: () => openDocumentPdf(document.id),
                    },
                    // Закрытый документ раньше уходил навсегда: вернуть
                    // его в активные было нечем.
                    ...restoreMenuItems({ document, siblings: props.documents, restore }),
                    ...(document.status === "active"
                      ? [
                          {
                            key: "delete",
                            label: "Удалить",
                            icon: <Trash2 className="size-4 text-[#6f7282]" />,
                            tone: "danger" as const,
                            onSelect: () => setDeleting(document),
                          },
                        ]
                      : []),
                  ], canManageDocuments)}
                  trigger={
                    <button
                      type="button"
                      className="flex size-8 items-center justify-center rounded-full text-[#5566f6] hover:bg-[#f5f6ff]"
                    >
                      <Ellipsis className="size-6" />
                    </button>
                  }
                />
              </div>
            </div>
          );
        })}
      </div>

      <SettingsDialog
        open={creating}
        onOpenChange={setCreating}
        title="Создание документа"
        submitLabel="Создать"
        initial={createState}
        onSubmit={createDocument}
        mode="create"
      />

      <SettingsDialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        title="Настройки документа"
        submitLabel="Сохранить"
        initial={editing}
        onSubmit={async (payload) => {
          if (!editing) return;
          await saveDocumentSettings(editing.id, payload);
        }}
        mode="edit"
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={`Удаление документа "${deleting?.title || PEST_CONTROL_DOCUMENT_TITLE}"`}
        submitLabel="Удалить"
        onSubmit={async () => {
          if (!deleting) return;
          await deleteDocument(deleting.id);
        }}
      />
    </div>
  );
}
