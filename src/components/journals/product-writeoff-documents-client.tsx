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
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { Archive, BookOpenText, Ellipsis, Pencil, Plus, Printer, Trash2 } from "lucide-react";
import { CreateDocumentDialog } from "@/components/journals/create-document-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ResponsiveMenu } from "@/components/ui/responsive-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  formatProductWriteoffDate,
  getProductWriteoffDocumentListTitle,
  normalizeProductWriteoffConfig,
  type ProductWriteoffConfig,
} from "@/lib/product-writeoff-document";

import { toast } from "sonner";
import { confirmAsync } from "@/components/ui/confirm-async";
import {
  EmptyDocumentsState,
  filterManageMenuItems,
  useRestoreMenuItems,
  type RestorableDocument,
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
type JournalListDocument = {
  id: string;
  title: string;
  status: "active" | "closed";
  dateFrom: string;
  config?: unknown;
};

type Props = {
  activeTab: "active" | "closed";
  templateCode: string;
  templateName: string;
  users: { id: string; name: string; role: string }[];
  documents: JournalListDocument[];
};

function ProductWriteoffActionsMenu(props: {
  isActive: boolean;
  onEdit: () => void;
  onPrint: () => void;
  onArchive: () => void;
  onDelete: () => void;
  /** Документ карточки и соседи — для возврата из «Закрытых». */
  document: RestorableDocument;
  siblings: RestorableDocument[];
}) {
  // Настройки / архив / удаление API отдаёт только руководителю.
  const canManageDocuments = useCanManageDocuments();
  const restoreMenu = useRestoreMenuItems();
  const tc = useTranslations("journalControls");
  return (
    <ResponsiveMenu
      title={tc("list.actions")}
      items={filterManageMenuItems([
        {
          key: "settings",
          label: tc("list.settings"),
          icon: <Pencil className="size-4 text-[#6f7282]" />,
          onSelect: props.onEdit,
        },
        {
          key: "print",
          label: tc("list.print"),
          icon: <Printer className="size-4 text-[#6f7282]" />,
          onSelect: props.onPrint,
        },
        // Закрытый документ раньше уходил навсегда: вернуть его в
        // активные было нечем.
        ...restoreMenu({ document: props.document, siblings: props.siblings }),
        ...(props.isActive
          ? [
              {
                key: "archive",
                label: tc("documentLifecycle.sendToClosed"),
                icon: <Archive className="size-4 text-[#6f7282]" />,
                onSelect: props.onArchive,
              },
            ]
          : []),
        {
          key: "delete",
          label: tc("list.delete"),
          icon: <Trash2 className="size-4 text-[#6f7282]" />,
          tone: "danger" as const,
          onSelect: props.onDelete,
        },
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
  );
}

export function ProductWriteoffDocumentsClient({
  activeTab,
  templateCode,
  templateName,
  users,
  documents,
}: Props) {
  const router = useRouter();
  const t = useTranslations("journalUi.productWriteoffList");
  const tc = useTranslations("journalControls");
  // Создание документов API отдаёт только руководителю.
  const canManageDocuments = useCanManageDocuments();
  const [editingDocument, setEditingDocument] = useState<JournalListDocument | null>(null);
  const [settings, setSettings] = useState<ProductWriteoffConfig | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!editingDocument) return;
    setSettings(normalizeProductWriteoffConfig(editingDocument.config));
  }, [editingDocument]);

  const normalizedDocuments = useMemo(
    () =>
      documents.map((document) => {
        const config = normalizeProductWriteoffConfig(document.config);
        return {
          ...document,
          config,
          listTitle: getProductWriteoffDocumentListTitle(config),
        };
      }),
    [documents]
  );

  async function patchDocument(documentId: string, body: Record<string, unknown>) {
    const response = await fetch(`/api/journal-documents/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error();
    }
  }

  async function handleDelete(documentId: string, title: string) {
    if (!(await confirmAsync({ title: tc("documentActions.deleteTitle"), description: tc("documentLifecycle.deleteDescriptionWithTitle", { title }), variant: "danger", confirmLabel: tc("documentActions.delete") }))) return;
    const response = await fetch(`/api/journal-documents/${documentId}`, { method: "DELETE" });
    if (!response.ok) {
      toast.error(tc("documentActions.deleteError"));
      return;
    }
    router.refresh();
  }

  async function handleArchive(documentId: string) {
    const ok = await confirmAsync({
      title: t("archiveTitle"),
      description: t("archiveDescription"),
      bullets: [
        { label: t("archiveNoFill"), tone: "warn" },
        { label: t("archiveRestorable"), tone: "info" },
      ],
      confirmLabel: t("archiveConfirm"),
      variant: "warn",
    });
    if (!ok) return;
    try {
      await patchDocument(documentId, { status: "closed" });
      router.refresh();
    } catch {
      toast.error(tc("documentLifecycle.statusFailed"));
    }
  }

  async function saveSettings() {
    if (!editingDocument || !settings) return;
    setIsSaving(true);
    try {
      await patchDocument(editingDocument.id, {
        title: settings.documentName,
        dateFrom: settings.documentDate,
        dateTo: settings.documentDate,
        config: settings,
      });
      setEditingDocument(null);
      router.refresh();
    } catch {
      toast.error(tc("documentDialog.settingsError"));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-5">
        <div className={JOURNAL_LIST_HEADER_ROW_CLASS}>
          <h1 className={JOURNAL_LIST_TITLE_CLASS}>
            <JournalHeadingName fallback={t("title")} />
          </h1>
          <JournalListActions
            templateCode={templateCode}
            journalName={templateName}
            canManage={canManageDocuments}
            create={
              canManageDocuments && activeTab === "active" ? (
                <CreateDocumentDialog
                  templateCode={templateCode}
                  templateName={templateName}
                  users={users}
                  triggerClassName={JOURNAL_ACTION_CREATE_CLASS}
                  triggerLabel={tc("list.create")}
                  triggerIcon={<Plus className="size-4" />}
                />
              ) : null
            }
          />
        </div>

        <JournalTabs activeTab={activeTab} templateCode={templateCode} />

        <div className={JOURNAL_LIST_CARDS_CLASS}>
          {normalizedDocuments.length === 0 && (
            <EmptyDocumentsState />
          )}

          {normalizedDocuments.map((document) => (
            <div
              key={document.id}
              className={JOURNAL_LIST_CARD_CLASS}
            >
              <Link href={`/journals/${templateCode}/documents/${document.id}`} className="min-w-0">
                <div className={JOURNAL_CARD_TITLE_CLASS}>{document.listTitle}</div>
              </Link>
              <Link
                href={`/journals/${templateCode}/documents/${document.id}`}
                className={`${JOURNAL_CARD_SECTION_CLASS} min-w-0`}
              >
                <div className={JOURNAL_CARD_LABEL_CLASS}>{t("comment")}</div>
                <div className={`${JOURNAL_CARD_VALUE_CLASS} truncate`}>
                  {document.config.comment || "—"}
                </div>
              </Link>
              <Link
                href={`/journals/${templateCode}/documents/${document.id}`}
                className={JOURNAL_CARD_SECTION_CLASS}
              >
                <div className={JOURNAL_CARD_LABEL_CLASS}>{t("documentDate")}</div>
                <div className={JOURNAL_CARD_VALUE_CLASS}>
                  {formatProductWriteoffDate(document.config.documentDate || document.dateFrom)}
                </div>
              </Link>
              <div className="flex justify-start sm:justify-end">
                <ProductWriteoffActionsMenu
                  document={document}
                  siblings={documents}
                  isActive={document.status === "active"}
                  onEdit={() => setEditingDocument(document)}
                  onPrint={() => window.open(`/api/journal-documents/${document.id}/pdf`, "_blank")}
                  onArchive={() => handleArchive(document.id)}
                  onDelete={() => handleDelete(document.id, document.listTitle)}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <Dialog open={!!editingDocument} onOpenChange={(open) => !open && setEditingDocument(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[28px] border-0 p-0 sm:max-w-[720px]">
          <DialogHeader className="border-b px-8 py-6">
            <DialogTitle className="text-[22px] font-medium text-black">{t("settingsTitle")}</DialogTitle>
          </DialogHeader>
          {settings && (
            <div className="space-y-5 px-8 py-6">
              <div className="space-y-2">
                <Label>{t("documentName")}</Label>
                <Input
                  value={settings.documentName}
                  onChange={(event) =>
                    setSettings((prev) => (prev ? { ...prev, documentName: event.target.value } : prev))
                  }
                  className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
                />
              </div>
              <div className="space-y-2">
                <Label>{t("actNumber")}</Label>
                <Input
                  value={settings.actNumber}
                  onChange={(event) =>
                    setSettings((prev) => (prev ? { ...prev, actNumber: event.target.value } : prev))
                  }
                  className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
                />
              </div>
              <div className="space-y-2">
                <Label>{t("documentDate")}</Label>
                <Input
                  type="date"
                  value={settings.documentDate}
                  onChange={(event) =>
                    setSettings((prev) => (prev ? { ...prev, documentDate: event.target.value } : prev))
                  }
                  className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
                />
              </div>
              <div className="space-y-2">
                <Label>{t("comment")}</Label>
                <Textarea
                  value={settings.comment}
                  onChange={(event) =>
                    setSettings((prev) => (prev ? { ...prev, comment: event.target.value } : prev))
                  }
                  className="min-h-[160px] rounded-2xl border-[#dfe1ec] px-5 py-4 text-[18px]"
                />
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={saveSettings}
                  disabled={isSaving}
                  className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] text-white hover:bg-[#4a5bf0]"
                >
                  {isSaving ? t("saving") : t("save")}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
