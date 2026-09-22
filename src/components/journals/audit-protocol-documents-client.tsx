"use client";

import {
  JOURNAL_ACTION_CREATE_CLASS,
  JOURNAL_LIST_HEADER_ROW_CLASS,
  JOURNAL_LIST_TITLE_CLASS,
  JournalListActions,
} from "@/components/journals/journal-list-actions";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpenText, Copy, Ellipsis, Plus, Printer, Settings2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ResponsiveMenu } from "@/components/ui/responsive-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AUDIT_PROTOCOL_DOCUMENT_TITLE,
  AUDIT_PROTOCOL_TEMPLATE_CODE,
  getDefaultAuditProtocolConfig,
  normalizeAuditProtocolConfig,
} from "@/lib/audit-protocol-document";
import { openDocumentPdf } from "@/lib/open-document-pdf";
import { useAutoDocumentTitle } from "@/components/journals/use-auto-document-title";
import { buildDocumentCopy } from "@/lib/journal-document-copy";
import { localDayKey } from "@/lib/entry-defaults";
import { formatJournalDate } from "@/lib/journal-card-date";

import { toast } from "sonner";
import {
  EmptyDocumentsState,
  filterManageMenuItems,
  restoreMenuItems,
  useRestoreDocument,
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
import { humanizeFetchError } from "@/lib/humanize-fetch-error";
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
  config: unknown;
};

type Props = {
  activeTab: "active" | "closed";
  routeCode: string;
  documents: DocumentItem[];
};

type SettingsState = {
  title: string;
  documentDate: string;
  basisTitle: string;
  auditedObject: string;
};

function DocumentDialog({
  open,
  onOpenChange,
  title,
  initial,
  submitLabel,
  mode,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  initial: SettingsState;
  submitLabel: string;
  /** Создание — название подставляется автоматически (просьба владельца 2026-09-04). */
  mode: "create" | "edit";
  onSubmit: (value: SettingsState) => Promise<void>;
}) {
  const [state, setState] = useState(initial);
  // Окно закрывается только при успехе, ошибка сервера видна здесь же.
  const submit = useDocumentDialogSubmit({ onOpenChange });
  const submitting = submit.submitting;
  const { reset: resetSubmit } = submit;
  const auto = useAutoDocumentTitle({
    templateCode: AUDIT_PROTOCOL_TEMPLATE_CODE,
    journalName: AUDIT_PROTOCOL_DOCUMENT_TITLE,
    period: { dateFrom: state.documentDate },
    enabled: mode === "create",
  });
  // Колбэки хука стабильны, объект — нет: в deps только колбэки.
  const { reset: resetAutoTitle, seedTitle } = auto;

  useEffect(() => {
    if (open) {
      resetAutoTitle();
      // В create-режиме `initial.title` — константа, поэтому автоназвание
      // важнее; в edit-режиме хук отключён и вернёт "".
      setState({ ...initial, title: seedTitle() || initial.title });
      // Открыли заново — старая ошибка сервера не должна висеть.
      resetSubmit();
    }
  }, [initial, open, resetAutoTitle, resetSubmit, seedTitle]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-1rem)] rounded-[32px] border-0 p-0 sm:max-w-[760px]">
        <DialogHeader className="border-b px-12 py-10">
          <DialogTitle className="text-[22px] font-medium text-black">{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-6 px-12 py-10">
          <DocumentDialogFeedback state={submit} onOpenChange={onOpenChange} />
          <div className="space-y-3">
            <Label className="text-[14px] text-[#73738a]">Название документа</Label>
            <Input
              value={state.title}
              onChange={(event) => {
                auto.markTouched();
                setState({ ...state, title: event.target.value });
              }}
              className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
            />
          </div>
          <div className="space-y-3">
            <Label className="text-[14px] text-[#73738a]">Дата документа</Label>
            <Input
              type="date"
              value={state.documentDate}
              onChange={(event) => {
                const value = event.target.value;
                const next = auto.titleForPeriod({ dateFrom: value });
                setState((current) => ({
                  ...current,
                  documentDate: value,
                  ...(next !== null ? { title: next } : {}),
                }));
              }}
              className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
            />
          </div>
          <div className="space-y-3">
            <Label className="text-[14px] text-[#73738a]">Основание проверки</Label>
            <Input
              value={state.basisTitle}
              onChange={(event) => setState({ ...state, basisTitle: event.target.value })}
              className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
            />
          </div>
          <div className="space-y-3">
            <Label className="text-[14px] text-[#73738a]">Проверяемый объект</Label>
            <Input
              value={state.auditedObject}
              onChange={(event) => setState({ ...state, auditedObject: event.target.value })}
              className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
            />
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              disabled={submitting}
              onClick={async () => {
                await submit.run(() => onSubmit(state));
              }}
              className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] text-white hover:bg-[#4b57ff]"
            >
              {submitting ? "Сохранение..." : submitLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AuditProtocolDocumentsClient({
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
  const [settingsDocument, setSettingsDocument] = useState<DocumentItem | null>(null);
  const [deleteDocument, setDeleteDocument] = useState<DocumentItem | null>(null);

  const createState = useMemo<SettingsState>(() => {
    const config = getDefaultAuditProtocolConfig();
    return {
      title: AUDIT_PROTOCOL_DOCUMENT_TITLE,
      documentDate: config.documentDate,
      basisTitle: config.basisTitle,
      auditedObject: config.auditedObject,
    };
  }, []);

  // Мемоизируем: `initial` — зависимость эффекта сброса в диалоге, литерал
  // на каждый рендер перетирал бы ввод.
  const settingsState = useMemo<SettingsState>(() => {
    if (!settingsDocument) return createState;
    const config = normalizeAuditProtocolConfig(settingsDocument.config);
    return {
      title: settingsDocument.title,
      documentDate: config.documentDate,
      basisTitle: config.basisTitle,
      auditedObject: config.auditedObject,
    };
  }, [createState, settingsDocument]);

  async function createDocument(payload: SettingsState) {
    const config = {
      ...getDefaultAuditProtocolConfig(),
      documentDate: payload.documentDate,
      basisTitle: payload.basisTitle,
      auditedObject: payload.auditedObject,
    };

    const response = await fetch("/api/journal-documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateCode: AUDIT_PROTOCOL_TEMPLATE_CODE,
        title: payload.title.trim() || AUDIT_PROTOCOL_DOCUMENT_TITLE,
        dateFrom: payload.documentDate,
        dateTo: payload.documentDate,
        config,
      }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.document?.id) {
      throw new Error(result?.error || "Не удалось создать документ");
    }
    router.push(`/journals/${routeCode}/documents/${result.document.id}`);
    router.refresh();
  }

  async function saveDocument(document: DocumentItem, payload: SettingsState) {
    const current = normalizeAuditProtocolConfig(document.config);
    const response = await fetch(`/api/journal-documents/${document.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: payload.title.trim() || AUDIT_PROTOCOL_DOCUMENT_TITLE,
        dateFrom: payload.documentDate,
        dateTo: payload.documentDate,
        config: {
          ...current,
          documentDate: payload.documentDate,
          basisTitle: payload.basisTitle,
          auditedObject: payload.auditedObject,
        },
      }),
    });
    if (!response.ok) throw new Error("Не удалось сохранить документ");
    router.refresh();
  }

  async function copyDocument(document: DocumentItem) {
    // Копия — чистый бланк на следующий период: перечень требований
    // остаётся, результаты «да/нет», замечания и ПОДПИСИ обнуляются
    // (`buildDocumentCopy`). Раньше копия уносила подписи и дату
    // подписания чужой проверки — на бумаге это подлог.
    const copy = buildDocumentCopy({
      templateCode: AUDIT_PROTOCOL_TEMPLATE_CODE,
      journalName: AUDIT_PROTOCOL_DOCUMENT_TITLE,
      sourceConfig: normalizeAuditProtocolConfig(document.config),
      sourcePeriod: { dateFrom: document.dateFrom, dateTo: document.dateFrom },
      today: localDayKey(),
      existingTitles: documents.map((item) => item.title),
    });
    const response = await fetch("/api/journal-documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateCode: AUDIT_PROTOCOL_TEMPLATE_CODE,
        title: copy.title,
        dateFrom: copy.dateFrom,
        dateTo: copy.dateTo,
        config: copy.config,
      }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.document?.id) {
      // Текст сервера (например «За этот период уже есть документ «…»»)
      // показываем как есть: пункт меню промис не ловил, и копия просто
      // молча не появлялась.
      toast.error(result?.error || "Не удалось сделать копию");
      return;
    }
    router.push(`/journals/${routeCode}/documents/${result.document.id}`);
    router.refresh();
  }

  async function deleteById(documentId: string) {
    const response = await fetch(`/api/journal-documents/${documentId}`, {
      method: "DELETE",
    });
    if (!response.ok) throw new Error("Не удалось удалить документ");
    router.refresh();
  }

  return (
    <>
      <div className="space-y-10">
        <div className={JOURNAL_LIST_HEADER_ROW_CLASS}>
          <h1 className={JOURNAL_LIST_TITLE_CLASS}>
            {activeTab === "closed"
              ? `${AUDIT_PROTOCOL_DOCUMENT_TITLE} (закрытые)`
              : AUDIT_PROTOCOL_DOCUMENT_TITLE}
          </h1>
          <JournalListActions
            templateCode="audit_protocol"
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

        <div className="border-b border-[#d9dce8]">
          <div className="flex gap-9 text-[15px]">
            <Link href={`/journals/${routeCode}`} className={`relative pb-4 ${activeTab === "active" ? "font-medium text-black after:absolute after:bottom-[-1px] after:left-0 after:h-[2px] after:w-full after:bg-[#5566f6]" : "text-[#6f7282]"}`}>Активные</Link>
            <Link href={`/journals/${routeCode}?tab=closed`} className={`relative pb-4 ${activeTab === "closed" ? "font-medium text-black after:absolute after:bottom-[-1px] after:left-0 after:h-[2px] after:w-full after:bg-[#5566f6]" : "text-[#6f7282]"}`}>Закрытые</Link>
          </div>
        </div>

        <div className={JOURNAL_LIST_CARDS_CLASS}>
          {documents.length === 0 && (
            <EmptyDocumentsState />
          )}

          {documents.map((document) => {
            const config = normalizeAuditProtocolConfig(document.config);
            return (
              <div key={document.id} className={JOURNAL_LIST_CARD_CLASS}>
                <Link href={`/journals/${routeCode}/documents/${document.id}`} className={JOURNAL_CARD_TITLE_CLASS}>
                  {document.title || AUDIT_PROTOCOL_DOCUMENT_TITLE}
              <SharedDocumentBadge shared={document.shared} />
                </Link>
                <Link href={`/journals/${routeCode}/documents/${document.id}`} className={JOURNAL_CARD_SECTION_CLASS}>
                  <div className={JOURNAL_CARD_LABEL_CLASS}>Основание проверки</div>
                  <div className={JOURNAL_CARD_VALUE_CLASS}>{config.basisTitle}</div>
                </Link>
                <Link href={`/journals/${routeCode}/documents/${document.id}`} className={JOURNAL_CARD_SECTION_CLASS}>
                  <div className={JOURNAL_CARD_LABEL_CLASS}>Дата документа</div>
                  {/* Было сырое «2026-09-18» из config — на экране дата везде «дд.мм.гггг». */}
                  <div className={JOURNAL_CARD_VALUE_CLASS}>{formatJournalDate(config.documentDate)}</div>
                </Link>
                <div className="justify-self-start sm:justify-self-end">
                  <ResponsiveMenu
                    title="Действия с документом"
                    contentClassName="w-[290px] rounded-[24px] border-0 p-4 shadow-xl"
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
                      ...(document.status === "active"
                        ? [
                            {
                              key: "copy",
                              label: "Сделать копию",
                              icon: <Copy className="size-4 text-[#6f7282]" />,
                              onSelect: () => copyDocument(document),
                            },
                          ]
                        : []),
                      {
                        key: "print",
                        label: "Печать",
                        icon: <Printer className="size-4 text-[#6f7282]" />,
                        onSelect: () =>
                          void openDocumentPdf(document.id).catch((error) =>
                            toast.error(humanizeFetchError(error, "Не удалось открыть PDF"))
                          ),
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
                      <button type="button" className="flex size-9 items-center justify-center rounded-full text-[#5566f6] hover:bg-[#f5f6ff]">
                        <Ellipsis className="size-6" />
                      </button>
                    }
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <DocumentDialog open={createOpen} onOpenChange={setCreateOpen} title="Создание документа" initial={createState} submitLabel="Создать" mode="create" onSubmit={createDocument} />

      <DocumentDialog
        open={!!settingsDocument}
        onOpenChange={(open) => {
          if (!open) setSettingsDocument(null);
        }}
        title="Настройки документа"
        initial={settingsState}
        submitLabel="Сохранить"
        mode="edit"
        onSubmit={async (value) => {
          if (!settingsDocument) return;
          await saveDocument(settingsDocument, value);
        }}
      />

      <Dialog open={!!deleteDocument} onOpenChange={(open) => !open && setDeleteDocument(null)}>
        <DialogContent className="max-w-[calc(100vw-1rem)] rounded-[32px] border-0 p-0 sm:max-w-[680px]">
          <DialogHeader className="border-b px-12 py-10">
            <DialogTitle className="pr-10 text-[22px] font-medium text-black">
              {`Удалить документ "${deleteDocument?.title || AUDIT_PROTOCOL_DOCUMENT_TITLE}"`}
            </DialogTitle>
          </DialogHeader>
          <div className="flex justify-end px-12 py-10">
            <Button
              type="button"
              onClick={async () => {
                if (!deleteDocument) return;
                await deleteById(deleteDocument.id);
                setDeleteDocument(null);
              }}
              className="h-9 rounded-xl bg-[#ff5e57] px-10 text-[18px] text-white hover:bg-[#ef4b44]"
            >
              Удалить
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
