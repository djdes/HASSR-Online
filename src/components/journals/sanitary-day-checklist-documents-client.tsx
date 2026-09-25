"use client";

import { JournalHeadingName } from "@/components/shared/custom-names-provider";
import {
  JOURNAL_ACTION_CREATE_CLASS,
  JOURNAL_LIST_HEADER_ROW_CLASS,
  JOURNAL_LIST_TITLE_CLASS,
  JournalListActions,
} from "@/components/journals/journal-list-actions";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpenText,
  CalendarDays,
  Copy,
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
import { getSanitaryDayChecklistTitle } from "@/lib/sanitary-day-checklist-document";

import { toast } from "sonner";
import { confirmAsync } from "@/components/ui/confirm-async";
import {
  EmptyDocumentsState,
  filterManageMenuItems,
  useCanManageDocuments,
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
import { formatJournalDate } from "@/lib/journal-card-date";
import { buildDocumentCopy } from "@/lib/journal-document-copy";
import { SharedDocumentBadge } from "@/components/journals/shared-document-badge";
import {
  DocumentDialogFeedback,
  readCreatedDocument,
  useDocumentDialogSubmit,
} from "@/components/journals/use-document-dialog-submit";
type DocumentItem = {
  id: string;
  title: string;
  /** Точки: документ без точки рядом с документами точек. */
  shared?: boolean;
  status: "active" | "closed";
  dateFrom: string;
  config?: Record<string, unknown> | null;
};

type Props = {
  activeTab: "active" | "closed";
  routeCode: string;
  templateCode: string;
  users: { id: string; name: string; role: string }[];
  documents: DocumentItem[];
};

type SettingsState = {
  title: string;
  documentDate: string;
};

function toIsoDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return localDayKey();
  return date.toISOString().slice(0, 10);
}

function getDefaultDate(): string {
  return localDayKey();
}

function toUiState(document: DocumentItem, fallbackTitle: string): SettingsState {
  const cfg = document.config ?? {};
  const documentDate =
    typeof cfg.documentDate === "string" && cfg.documentDate
      ? cfg.documentDate
      : document.dateFrom
        ? toIsoDate(document.dateFrom)
        : getDefaultDate();
  return {
    title: document.title || fallbackTitle,
    documentDate,
  };
}

function formatDateLabel(isoDate: string): string {
  // Единый вид даты на экране — «дд.мм.гггг» (src/lib/journal-card-date.ts).
  // Раньше тут было «ДД-ММ-ГГГГ», а у дезинсекции и акта забраковки —
  // «ДД.ММ.ГГГГ»: три разных написания одной и той же вещи в одном заходе.
  if (!isoDate) return "—";
  return formatJournalDate(isoDate) || isoDate;
}

function SettingsDialog(props: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  initial: SettingsState | null;
  onSubmit: (value: SettingsState) => Promise<void>;
  submitText: string;
  title: string;
}) {
  const [state, setState] = useState<SettingsState | null>(null);
  // Окно закрывается только при успехе, ошибка сервера видна здесь же.
  const submit = useDocumentDialogSubmit({ onOpenChange: props.onOpenChange });
  const submitting = submit.submitting;

  const activeState = state || props.initial;

  async function handleSubmit() {
    if (!activeState) return;
    await submit.run(() => props.onSubmit(activeState));
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={(value) => {
        if (value) {
          setState(props.initial);
        }
        props.onOpenChange(value);
      }}
    >
      <DialogContent showCloseButton={false} className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[28px] border-0 p-0 sm:max-w-[760px]">
        <DialogHeader className="border-b px-5 py-6 sm:px-10 sm:py-8">
          <div className="flex items-center justify-between">
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
              <Label className="text-[15px] text-[#7a7c8e]">Название документа</Label>
              <Input
                value={activeState.title}
                onChange={(e) => setState({ ...activeState, title: e.target.value })}
                className="h-9 rounded-xl border-[#d8dae6] px-5 text-[16px] tracking-[-0.02em]"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-[15px] text-[#7a7c8e]">Дата проведения</Label>
              <div className="relative">
                <Input
                  type="date"
                  value={activeState.documentDate}
                  onChange={(e) =>
                    setState({ ...activeState, documentDate: toIsoDate(e.target.value) })
                  }
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

export function SanitaryDayChecklistDocumentsClient({
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
  const [createOpen, setCreateOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<DocumentItem | null>(null);
  const checklistTitle = getSanitaryDayChecklistTitle(templateCode);

  async function createDocument(payload: SettingsState) {
    const config = {
      documentDate: payload.documentDate,
    };

    const response = await fetch("/api/journal-documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateCode,
        title: payload.title.trim() || checklistTitle,
        // Период — по правилу журнала (`journal-period.ts`): чек-лист
        // санитарного дня бессрочный, документ один на всё время.
        ...resolveJournalPeriodForDate(templateCode, payload.documentDate),
        config,
      }),
    });

    // Ошибку показывает само окно создания: тост её гасил, а окно
    // закрывалось вместе с введённым.
    const created = await readCreatedDocument(response);
    router.push(`/journals/${routeCode}/documents/${created.id}`);
    router.refresh();
  }

  async function saveSettings(documentId: string, payload: SettingsState) {
    const current = documents.find((item) => item.id === documentId);
    if (!current) return;
    const config = {
      ...(current.config ?? {}),
      documentDate: payload.documentDate,
    };

    const response = await fetch(`/api/journal-documents/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: payload.title.trim() || checklistTitle,
        dateFrom: payload.documentDate,
        dateTo: payload.documentDate,
        config,
      }),
    });

    if (!response.ok) {
      const failure = await response.json().catch(() => null);
      throw new Error(failure?.error || "Не удалось сохранить настройки");
    }

    router.refresh();
  }

  async function handleDelete(documentId: string, title: string) {
    if (!(await confirmAsync({ title: "Удалить документ?", description: `Документ «${title}» и все его записи будут удалены безвозвратно.`, variant: "danger", confirmLabel: "Удалить" }))) return;
    const response = await fetch(`/api/journal-documents/${documentId}`, { method: "DELETE" });
    if (!response.ok) {
      toast.error("Не удалось удалить документ");
      return;
    }
    router.refresh();
  }

  async function moveToClosed(documentId: string) {
    const response = await fetch(`/api/journal-documents/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "closed" }),
    });
    if (!response.ok) {
      toast.error("Не удалось закрыть документ");
      return;
    }
    setArchiveTarget(null);
    router.refresh();
  }

  async function moveToActive(documentId: string) {
    const response = await fetch(`/api/journal-documents/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "active" }),
    });
    if (!response.ok) {
      toast.error("Не удалось отправить в активные");
      return;
    }
    router.refresh();
  }

  async function cloneDocument(documentId: string) {
    const current = documents.find((item) => item.id === documentId);
    if (!current) return;
    // Копия — чистый чек-лист: зоны, пункты и общие принципы переносятся,
    // отметки живут в записях документа и не копируются. Период и
    // название пересобираются (`buildDocumentCopy`), иначе копия
    // повторяла период источника и не создавалась.
    const copy = buildDocumentCopy({
      templateCode,
      // Не берём `checklistTitle` из области видимости: React Compiler
      // тогда считает его изменяемым и отказывается мемоизировать форму.
      journalName: getSanitaryDayChecklistTitle(templateCode),
      sourceConfig: current.config ?? {},
      sourcePeriod: {
        dateFrom: toIsoDate(current.dateFrom),
        dateTo: toIsoDate(current.dateFrom),
      },
      today: localDayKey(),
      existingTitles: documents.map((item) => item.title),
    });
    const response = await fetch("/api/journal-documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateCode,
        title: copy.title,
        dateFrom: copy.dateFrom,
        dateTo: copy.dateTo,
        config: copy.config,
      }),
    });
    if (!response.ok) {
      const failure = await response.json().catch(() => null);
      toast.error(failure?.error || "Не удалось сделать копию");
      return;
    }
    router.refresh();
  }

  const defaultCreateState = useMemo<SettingsState>(
    () => ({
      title: checklistTitle,
      documentDate: getDefaultDate(),
    }),
    [checklistTitle],
  );

  return (
    <div className="space-y-5">
      <div className={JOURNAL_LIST_HEADER_ROW_CLASS}>
        <h1 className={JOURNAL_LIST_TITLE_CLASS}>
          <JournalHeadingName
            fallback={
              <>
                {checklistTitle}
                {activeTab === "closed" && " (Закрытые)"}
              </>
            }
            suffix={activeTab === "closed" ? " (Закрытые)" : null}
          />
        </h1>
        <JournalListActions
          templateCode={templateCode}
          canManage={canManageDocuments}
          create={
            canManageDocuments && activeTab === "active" ? (
              <Button className={JOURNAL_ACTION_CREATE_CLASS} onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" />
                Создать документ
              </Button>
            ) : null
          }
        />
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
        {documents.length === 0 && (
          <EmptyDocumentsState />
        )}

        {documents.map((document) => {
          const cfg = document.config ?? {};
          const documentDate =
            typeof cfg.documentDate === "string" && cfg.documentDate
              ? cfg.documentDate
              : toIsoDate(document.dateFrom);
          const href = `/journals/${routeCode}/documents/${document.id}`;
          return (
            <div
              key={document.id}
              className={JOURNAL_LIST_CARD_CLASS}
            >
              <Link href={href} className={JOURNAL_CARD_TITLE_CLASS}>
                {document.title || checklistTitle}
              <SharedDocumentBadge shared={document.shared} />
              </Link>

              <Link href={href} className={JOURNAL_CARD_SECTION_CLASS}>
                <div className={JOURNAL_CARD_LABEL_CLASS}>Дата проведения</div>
                <div className={JOURNAL_CARD_VALUE_CLASS}>
                  {formatDateLabel(documentDate)}
                </div>
              </Link>

              <div className="flex justify-center">
                <ResponsiveMenu
                  title="Действия с документом"
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
                      key: "clone",
                      label: "Сделать копию",
                      icon: <Copy className="size-4 text-[#6f7282]" />,
                      onSelect: () => cloneDocument(document.id),
                    },
                    {
                      key: "print",
                      label: "Печать",
                      icon: <Printer className="size-4 text-[#6f7282]" />,
                      onSelect: () =>
                        window.open(`/api/journal-documents/${document.id}/pdf`, "_blank"),
                    },
                    ...(document.status === "closed"
                      ? [
                          {
                            key: "activate",
                            label: "Отправить в активные",
                            icon: <BookOpenText className="size-4 text-[#6f7282]" />,
                            onSelect: () => moveToActive(document.id),
                          },
                        ]
                      : []),
                    ...(document.status === "active"
                      ? [
                          {
                            key: "archive",
                            label: "Отправить в закрытые",
                            icon: <BookOpenText className="size-4 text-[#6f7282]" />,
                            onSelect: () => setArchiveTarget(document),
                          },
                          {
                            key: "delete",
                            label: "Удалить",
                            icon: <Trash2 className="size-4 text-[#ff3b30]" />,
                            onSelect: () => handleDelete(document.id, document.title),
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

      {/* Archive confirmation dialog */}
      <Dialog open={!!archiveTarget} onOpenChange={(v) => { if (!v) setArchiveTarget(null); }}>
        <DialogContent showCloseButton={false} className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[28px] border-0 p-0 sm:max-w-[560px]">
          <DialogHeader className="border-b px-5 py-6 sm:px-10 sm:py-8">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-[22px] font-semibold tracking-[-0.03em] text-black">
                Перенести в архив
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
          {archiveTarget && (
            <div className="px-10 py-8 space-y-6">
              <p className="text-[15px] text-[#3a3d52]">
                Перенести в архив документ &quot;{archiveTarget.title || checklistTitle}&quot;?
              </p>
              <div className="flex flex-wrap justify-end gap-3">
                <Button
                  variant="outline"
                  className="h-9 rounded-xl px-8 text-[13.5px]"
                  onClick={() => setArchiveTarget(null)}
                >
                  Отмена
                </Button>
                <Button
                  className="h-9 rounded-xl bg-[#5563ff] px-3.5 text-[13.5px] text-white hover:bg-[#4554ff]"
                  onClick={() => moveToClosed(archiveTarget.id)}
                >
                  В архив
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <SettingsDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        initial={defaultCreateState}
        onSubmit={createDocument}
        submitText="Создать"
        title="Создание документа"
      />

      <SettingsDialog
        open={!!settingsTarget}
        onOpenChange={(value) => {
          if (!value) setSettingsTarget(null);
        }}
        initial={settingsTarget ? toUiState(settingsTarget, checklistTitle) : null}
        onSubmit={async (value) => {
          if (!settingsTarget) return;
          await saveSettings(settingsTarget.id, value);
        }}
        submitText="Сохранить"
        title="Настройки документа"
      />
    </div>
  );
}
