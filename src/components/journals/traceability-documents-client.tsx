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
import {
  Archive,
  ArchiveRestore,
  CalendarDays,
  Ellipsis,
  Pencil,
  Plus,
  Printer,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ResponsiveMenu } from "@/components/ui/responsive-menu";
import { cn } from "@/lib/utils";

import { toast } from "sonner";
import { confirmAsync } from "@/components/ui/confirm-async";
import {
  EmptyDocumentsState,
  filterManageMenuItems,
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
import { localDayKey } from "@/lib/entry-defaults";
import { formatJournalDate } from "@/lib/journal-card-date";
import { useAutoDocumentTitle } from "@/components/journals/use-auto-document-title";
import { SharedDocumentBadge } from "@/components/journals/shared-document-badge";
import {
  DocumentDialogFeedback,
  readCreatedDocument,
  useDocumentDialogSubmit,
} from "@/components/journals/use-document-dialog-submit";
type TraceabilityDocumentItem = {
  id: string;
  title: string;
  /** Точки: документ без точки рядом с документами точек. */
  shared?: boolean;
  status: "active" | "closed";
  dateFrom: string;
  config?: Record<string, unknown> | null;
};

type TraceabilityFormState = {
  title: string;
  dateFrom: string;
  showShockTempField: boolean;
  showShipmentBlock: boolean;
};

type Props = {
  activeTab: "active" | "closed";
  routeCode: string;
  templateCode: string;
  templateName: string;
  documents: TraceabilityDocumentItem[];
};

const DEFAULT_TITLE = "Журнал прослеживаемости продукции";

function toIsoDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return localDayKey();
  return parsed.toISOString().slice(0, 10);
}

function formatDateLabel(value: string) {
  // Единый вид даты на экране — «дд.мм.гггг» (src/lib/journal-card-date.ts).
  // Раньше тут было «ДД-ММ-ГГГГ», а у дезинсекции и акта забраковки —
  // «ДД.ММ.ГГГГ»: три разных написания одной и той же вещи в одном заходе.
  if (!value) return "—";
  return formatJournalDate(toIsoDate(value)) || value;
}

function toBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function readFormState(document?: TraceabilityDocumentItem | null): TraceabilityFormState {
  const config = document?.config && typeof document.config === "object" ? document.config : {};
  return {
    title: document?.title || DEFAULT_TITLE,
    dateFrom: document?.dateFrom ? toIsoDate(document.dateFrom) : localDayKey(),
    showShockTempField: toBoolean(config.showShockTempField, false),
    showShipmentBlock: toBoolean(config.showShipmentBlock, false),
  };
}

function buildConfig(state: TraceabilityFormState, baseConfig?: Record<string, unknown> | null) {
  return {
    ...(baseConfig && typeof baseConfig === "object" ? baseConfig : {}),
    showShockTempField: state.showShockTempField,
    showShipmentBlock: state.showShipmentBlock,
  };
}

function TraceabilitySettingsDialog(props: {
  open: boolean;
  mode: "create" | "edit";
  templateCode: string;
  title: string;
  initial: TraceabilityFormState | null;
  submitLabel: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (state: TraceabilityFormState) => Promise<void>;
}) {
  const [state, setState] = useState<TraceabilityFormState | null>(null);
  // Окно закрывается только при успехе, ошибка сервера видна здесь же.
  const submit = useDocumentDialogSubmit({ onOpenChange: props.onOpenChange });
  const submitting = submit.submitting;

  const activeState = state || props.initial;
  const auto = useAutoDocumentTitle({
    templateCode: props.templateCode,
    journalName: DEFAULT_TITLE,
    period: { dateFrom: activeState?.dateFrom },
    enabled: props.mode === "create",
  });

  const { initial, open, mode } = props;
  const { reset: resetAutoTitle, titleForPeriod } = auto;
  useEffect(() => {
    if (!open) return;
    resetAutoTitle();
    if (!initial) {
      setState(null);
      return;
    }
    const seeded = mode === "create" ? titleForPeriod({ dateFrom: initial.dateFrom }) : null;
    setState({ ...initial, title: seeded || initial.title });
  }, [initial, open, mode, resetAutoTitle, titleForPeriod]);

  async function handleSubmit() {
    if (!activeState) return;
    await submit.run(() => props.onSubmit(activeState));
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent showCloseButton={false} className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[28px] border-0 p-0 sm:max-w-[720px]">
        <DialogHeader className="border-b px-5 py-6 sm:px-10 sm:py-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <DialogTitle className="text-[22px] font-semibold tracking-[-0.03em] text-black">
              {props.title}
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
            <DocumentDialogFeedback state={submit} onOpenChange={props.onOpenChange} />
            <div className="space-y-2">
              <Label className="text-[14px] text-[#7a7c8e]">Название документа</Label>
              <Input
                value={activeState.title}
                onChange={(e) => {
                  auto.markTouched();
                  setState({ ...activeState, title: e.target.value });
                }}
                placeholder="Введите название документа"
                className="h-9 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px] tracking-[-0.02em]"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-[14px] text-[#7a7c8e]">Дата начала</Label>
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
                  className="h-9 rounded-xl border-[#d8dae6] px-7 pr-14 text-[13.5px] tracking-[-0.02em]"
                />
                <CalendarDays className="pointer-events-none absolute right-6 top-1/2 size-7 -translate-y-1/2 text-[#6e7080]" />
              </div>
            </div>

            <div className="space-y-4 rounded-[28px] border border-[#e3e5f0] px-5 py-5">
              <div className="text-[20px] font-medium tracking-[-0.02em] text-black">Добавить поле</div>
              <div className="flex items-center justify-between gap-4 rounded-[24px] bg-[#f7f8fd] px-5 py-4">
                <Label className="text-[18px] leading-tight text-black">
                  T °C продукта после шоковой заморозки
                </Label>
                <Switch
                  checked={activeState.showShockTempField}
                  onCheckedChange={(checked) =>
                    setState({ ...activeState, showShockTempField: checked })
                  }
                />
              </div>
            </div>

            <div className="space-y-4 rounded-[28px] border border-[#e3e5f0] px-5 py-5">
              <div className="text-[20px] font-medium tracking-[-0.02em] text-black">Добавить блок</div>
              <div className="flex items-center justify-between gap-4 rounded-[24px] bg-[#f7f8fd] px-5 py-4">
                <Label className="text-[18px] leading-tight text-black">Отгружено</Label>
                <Switch
                  checked={activeState.showShipmentBlock}
                  onCheckedChange={(checked) =>
                    setState({ ...activeState, showShipmentBlock: checked })
                  }
                />
              </div>
            </div>

            <div className="flex justify-end pt-3">
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="h-9 rounded-xl bg-[#5563ff] px-3.5 text-[13.5px] text-white hover:bg-[#4554ff]"
              >
                {submitting ? "Сохранение..." : props.submitLabel}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TraceabilityActionsMenu(props: {
  document: TraceabilityDocumentItem;
  onSettings: () => void;
  onPrint: () => void;
  onDelete: () => void;
  onArchiveToggle: () => void;
}) {
  const isActive = props.document.status === "active";
  // Настройки / закрытие / удаление API отдаёт только руководителю.
  const canManageDocuments = useCanManageDocuments();

  return (
    <ResponsiveMenu
      title="Действия"
      items={filterManageMenuItems([
        {
          key: "settings",
          label: "Настройки",
          icon: <Pencil className="size-4 text-[#6f7282]" />,
          onSelect: props.onSettings,
        },
        {
          key: "print",
          label: "Печать",
          icon: <Printer className="size-4 text-[#6f7282]" />,
          onSelect: props.onPrint,
        },
        isActive
          ? {
              key: "archive",
              label: "Закрыть",
              icon: <Archive className="size-4 text-[#6f7282]" />,
              onSelect: props.onArchiveToggle,
            }
          : {
              key: "restore",
              label: "В активные",
              icon: <ArchiveRestore className="size-4 text-[#6f7282]" />,
              onSelect: props.onArchiveToggle,
            },
        {
          key: "delete",
          label: "Удалить",
          icon: <Trash2 className="size-4 text-[#ff3b30]" />,
          tone: "danger" as const,
          onSelect: props.onDelete,
        },
      ], canManageDocuments)}
      trigger={
        <button
          type="button"
          className="flex size-10 items-center justify-center rounded-full hover:bg-[#f5f6ff]"
        >
          <Ellipsis className="size-8 text-[#5566f6]" />
        </button>
      }
    />
  );
}

export function TraceabilityDocumentsClient({
  activeTab,
  routeCode,
  templateCode,
  documents,
}: Props) {
  const router = useRouter();
  // Создание документов API отдаёт только руководителю.
  const canManageDocuments = useCanManageDocuments();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingDocument, setEditingDocument] = useState<TraceabilityDocumentItem | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<TraceabilityDocumentItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TraceabilityDocumentItem | null>(null);
  const autoTitleTemplateCode = templateCode || "traceability_test";

  // Stable identities: both feed the dialog's `useEffect([initial, open])`.
  const createInitialState = useMemo(() => readFormState(), []);
  const editInitialState = useMemo(
    () => (editingDocument ? readFormState(editingDocument) : null),
    [editingDocument]
  );

  const heading = useMemo(
    () =>
      DEFAULT_TITLE,
    [activeTab]
  );

  async function persistDocument(
    payload: TraceabilityFormState,
    documentId?: string,
    baseConfig?: Record<string, unknown> | null
  ) {
    const response = await fetch(
      documentId ? `/api/journal-documents/${documentId}` : "/api/journal-documents",
      {
      method: documentId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateCode,
        title: payload.title.trim() || DEFAULT_TITLE,
        dateFrom: payload.dateFrom,
        dateTo: payload.dateFrom,
        config: buildConfig(payload, baseConfig),
      }),
      }
    );

    if (!response.ok) {
      // Текст сервера объясняет отказ («За этот период уже есть
      // документ…»); служебное «request failed» человеку ничего не давало.
      const failure = await response.json().catch(() => null);
      throw new Error(failure?.error || "Не удалось сохранить документ");
    }

    return response.json() as Promise<{ document: { id: string } }>;
  }

  // Ошибку больше не глотаем тостом: её показывает само окно, и окно
  // при отказе не закрывается — введённое остаётся на месте.
  async function handleCreate(payload: TraceabilityFormState) {
    const data = await persistDocument(payload);
    router.push(`/journals/${routeCode}/documents/${data.document.id}`);
    router.refresh();
  }

  async function handleSaveSettings(payload: TraceabilityFormState) {
    if (!editingDocument) return;
    await persistDocument(payload, editingDocument.id, editingDocument.config);
    router.refresh();
  }

  async function handleDelete(doc: TraceabilityDocumentItem) {
    const title = doc.title || DEFAULT_TITLE;
    const ok = await confirmAsync({
      title: "Удалить документ?",
      description: `Документ «${title}» и все его записи будут удалены безвозвратно.`,
      variant: "danger",
      confirmLabel: "Удалить",
    });
    if (!ok) return;
    const response = await fetch(`/api/journal-documents/${doc.id}`, { method: "DELETE" });
    if (!response.ok) {
      toast.error("Не удалось удалить документ");
      return;
    }
    setDeleteTarget(null);
    router.refresh();
  }

  async function handleStatusChange(doc: TraceabilityDocumentItem, nextStatus: "active" | "closed") {
    const response = await fetch(`/api/journal-documents/${doc.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
    if (!response.ok) {
      toast.error(nextStatus === "closed" ? "Не удалось закрыть документ" : "Не удалось восстановить документ");
      return;
    }
    setArchiveTarget(null);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      {/* Порядок как во всех журналах: заголовок и «Создать документ» —
          сверху, вкладки «Активные/Закрытые» — под ними. Раньше на
          телефоне кнопка создания оказывалась ПОСЛЕ вкладок. */}
      <div className={JOURNAL_LIST_HEADER_ROW_CLASS}>
        <h1 className={JOURNAL_LIST_TITLE_CLASS}>
          <JournalHeadingName fallback={heading} />
        </h1>
        <JournalListActions
          templateCode="traceability_test"
          canManage={canManageDocuments}
          create={
            canManageDocuments && activeTab === "active" ? (
              <Button type="button" onClick={() => setCreateOpen(true)} className={JOURNAL_ACTION_CREATE_CLASS}>
                <Plus className="size-4" />
                Создать документ
              </Button>
            ) : null
          }
        />
      </div>
          <div className="flex flex-wrap items-center gap-5 border-b border-[#d8dbe6] text-[15px] sm:gap-10 sm:text-[18px]">
            <Link
              href={`/journals/${routeCode}`}
              className={cn(
                "relative pb-4 text-[#6f7282]",
                activeTab === "active" &&
                  "font-medium text-black after:absolute after:bottom-[-1px] after:left-0 after:h-[3px] after:w-full after:bg-[#5566f6]"
              )}
            >
              Активные
            </Link>
            <Link
              href={`/journals/${routeCode}?tab=closed`}
              className={cn(
                "relative pb-4 text-[#6f7282]",
                activeTab === "closed" &&
                  "font-medium text-black after:absolute after:bottom-[-1px] after:left-0 after:h-[3px] after:w-full after:bg-[#5566f6]"
              )}
            >
              Закрытые
            </Link>
          </div>

      <div className={JOURNAL_LIST_CARDS_CLASS}>
        {documents.length === 0 ? (
          <EmptyDocumentsState />
        ) : (
          documents.map((document) => (
            <div
              key={document.id}
              className={JOURNAL_LIST_CARD_CLASS}
            >
              <Link href={`/journals/${routeCode}/documents/${document.id}`} className="min-w-0">
                <div className={`${JOURNAL_CARD_TITLE_CLASS} truncate`}>
                  {document.title || DEFAULT_TITLE}
              <SharedDocumentBadge shared={document.shared} />
                </div>
              </Link>
              <Link href={`/journals/${routeCode}/documents/${document.id}`} className={`${JOURNAL_CARD_SECTION_CLASS} justify-self-end`}>
                <div className={JOURNAL_CARD_LABEL_CLASS}>Дата начала</div>
                <div className={JOURNAL_CARD_VALUE_CLASS}>
                  {formatDateLabel(document.dateFrom)}
                </div>
              </Link>
              <TraceabilityActionsMenu
                document={document}
                onSettings={() => setEditingDocument(document)}
                onPrint={() => window.open(`/api/journal-documents/${document.id}/pdf`, "_blank")}
                onDelete={() => setDeleteTarget(document)}
                onArchiveToggle={() => setArchiveTarget(document)}
              />
            </div>
          ))
        )}
      </div>

      <TraceabilitySettingsDialog
        open={createOpen}
        mode="create"
        templateCode={autoTitleTemplateCode}
        title="Создание документа"
        initial={createInitialState}
        submitLabel="Создать"
        onOpenChange={setCreateOpen}
        onSubmit={handleCreate}
      />

      <TraceabilitySettingsDialog
        open={!!editingDocument}
        mode="edit"
        templateCode={autoTitleTemplateCode}
        title="Настройки документа"
        initial={editInitialState}
        submitLabel="Сохранить"
        onOpenChange={(open) => !open && setEditingDocument(null)}
        onSubmit={handleSaveSettings}
      />

      <Dialog open={!!archiveTarget} onOpenChange={(open) => !open && setArchiveTarget(null)}>
        <DialogContent showCloseButton={false} className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[28px] border-0 p-0 sm:max-w-[620px]">
          <DialogHeader className="border-b px-5 py-6 sm:px-10 sm:py-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <DialogTitle className="text-[22px] font-semibold tracking-[-0.03em] text-black">
                {archiveTarget?.status === "active"
                  ? `Закрыть документ "${archiveTarget?.title || DEFAULT_TITLE}"`
                  : `Восстановить документ "${archiveTarget?.title || DEFAULT_TITLE}"`}
              </DialogTitle>
              <button
                type="button"
                className="rounded-xl p-2 text-[#0b1024]"
                onClick={() => setArchiveTarget(null)}
              >
                <X className="size-8" />
              </button>
            </div>
          </DialogHeader>
          <div className="flex justify-end px-10 py-10">
            <Button
              type="button"
              onClick={() =>
                archiveTarget &&
                handleStatusChange(
                  archiveTarget,
                  archiveTarget.status === "active" ? "closed" : "active"
                )
              }
              className="h-9 rounded-xl bg-[#5563ff] px-3.5 text-[13.5px] text-white hover:bg-[#4554ff]"
            >
              {archiveTarget?.status === "active" ? "Закрыть" : "Восстановить"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent showCloseButton={false} className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[28px] border-0 p-0 sm:max-w-[620px]">
          <DialogHeader className="border-b px-5 py-6 sm:px-10 sm:py-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <DialogTitle className="text-[22px] font-semibold tracking-[-0.03em] text-black">
                Удаление документа &quot;{deleteTarget?.title || DEFAULT_TITLE}&quot;
              </DialogTitle>
              <button
                type="button"
                className="rounded-xl p-2 text-[#0b1024]"
                onClick={() => setDeleteTarget(null)}
              >
                <X className="size-8" />
              </button>
            </div>
          </DialogHeader>
          <div className="flex justify-end px-10 py-10">
            <Button
              type="button"
              onClick={() => deleteTarget && handleDelete(deleteTarget)}
              className="h-9 rounded-xl bg-[#5563ff] px-3.5 text-[13.5px] text-white hover:bg-[#4554ff]"
            >
              Удалить
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
