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
import { useFormatter, useTranslations } from "next-intl";
import {
  Archive,
  Copy,
  Ellipsis,
  Pencil,
  Plus,
  Printer,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ResponsiveMenu } from "@/components/ui/responsive-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getUsersForRoleLabel, pickPrimaryManager } from "@/lib/user-roles";
import {
  GLASS_LIST_DOCUMENT_TITLE,
  GLASS_LIST_PAGE_TITLE,
  GLASS_LIST_TEMPLATE_CODE,
  getDefaultGlassListConfig,
  normalizeGlassListConfig,
  toIsoDate,
  type GlassListConfig,
} from "@/lib/glass-list-document";

import { toast } from "sonner";
import {
  EmptyDocumentsState,
  filterManageMenuItems,
  useRestoreMenuItems,
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
import { PositionNativeOptions } from "@/components/shared/position-select";
import { useAutoDocumentTitle } from "@/components/journals/use-auto-document-title";
import { buildDocumentCopy } from "@/lib/journal-document-copy";
import { localDayKey } from "@/lib/entry-defaults";
import { isFetchNetworkError } from "@/lib/humanize-fetch-error";
import {
  DocumentDialogFeedback,
  useDocumentDialogSubmit,
} from "@/components/journals/use-document-dialog-submit";
type UserItem = {
  id: string;
  name: string;
  role: string;
};

type DocumentItem = {
  id: string;
  title: string;
  status: "active" | "closed";
  dateFrom: string;
  responsibleTitle: string | null;
  responsibleUserId: string | null;
  config?: unknown;
};

type FormState = {
  documentName: string;
  location: string;
  documentDate: string;
  responsibleTitle: string;
  responsibleUserId: string;
};

type Props = {
  activeTab: "active" | "closed";
  routeCode?: string;
  templateCode: string;
  templateName: string;
  users: UserItem[];
  documents: DocumentItem[];
};

function getDefaultFormState(users: UserItem[]): FormState {
  const defaultConfig = getDefaultGlassListConfig();
  const responsibleUser =
    pickPrimaryManager(users);

  return {
    documentName: defaultConfig.documentName,
    location: defaultConfig.location,
    documentDate: toIsoDate(new Date()),
    responsibleTitle: defaultConfig.responsibleTitle,
    responsibleUserId: responsibleUser?.id || "",
  };
}

function dateForDisplay(value: string | Date): Date {
  if (value instanceof Date) return value;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return dateOnly
    ? new Date(Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])))
    : new Date(value);
}

function formatDisplayDate(format: ReturnType<typeof useFormatter>, value: string | Date): string {
  const date = dateForDisplay(value);
  return Number.isNaN(date.getTime())
    ? ""
    : format.dateTime(date, { dateStyle: "short", timeZone: "UTC" });
}

function GlassListFormDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  dialogTitle: string;
  submitLabel: string;
  users: UserItem[];
  initialState: FormState;
  onSubmit: (state: FormState) => Promise<void>;
}) {
  const t = useTranslations("glassInventory");
  const [state, setState] = useState<FormState>(props.initialState);
  // Окно закрывается только при успехе, ошибка сервера видна здесь же.
  const submit = useDocumentDialogSubmit({
    onOpenChange: props.onOpenChange,
    fallbackError: props.mode === "create" ? t("createError") : t("saveError"),
  });
  const submitting = submit.submitting;

  const auto = useAutoDocumentTitle({
    templateCode: GLASS_LIST_TEMPLATE_CODE,
    journalName: GLASS_LIST_DOCUMENT_TITLE,
    period: { dateFrom: state.documentDate },
    enabled: props.mode === "create",
  });
  const { reset: resetAutoTitle, titleForPeriod } = auto;
  const { initialState, open, mode } = props;

  useEffect(() => {
    if (!open) return;
    resetAutoTitle();
    const seeded =
      mode === "create" ? titleForPeriod({ dateFrom: initialState.documentDate }) : null;
    setState({ ...initialState, documentName: seeded || initialState.documentName });
  }, [initialState, mode, open, resetAutoTitle, titleForPeriod]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent showCloseButton={false} className="max-w-[calc(100vw-1rem)] rounded-[32px] border-0 p-0 sm:max-w-[720px]">
        <DialogHeader className="flex flex-row items-center justify-between border-b px-14 py-10">
          <DialogTitle className="text-[22px] font-medium text-black">
            {props.dialogTitle}
          </DialogTitle>
          <button
            type="button"
            className="rounded-full p-2 text-black hover:bg-black/5"
            onClick={() => props.onOpenChange(false)}
          >
            <X className="size-8" />
          </button>
        </DialogHeader>
        <div className="space-y-8 px-14 py-12">
          <DocumentDialogFeedback state={submit} onOpenChange={props.onOpenChange} />
          <div className="space-y-3">
            <Label className="text-[14px] text-[#73738a]">{t("documentNameLabel")}</Label>
            <Input
              value={state.documentName}
              onChange={(event) => {
                auto.markTouched();
                setState((prev) => ({ ...prev, documentName: event.target.value }));
              }}
              placeholder={t("documentNamePlaceholder")}
              className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
            />
          </div>
          <div className="space-y-3">
            <Label className="text-[14px] text-[#73738a]">{t("rowLocationLabel")}</Label>
            <Input
              value={state.location}
              onChange={(event) =>
                setState((prev) => ({ ...prev, location: event.target.value }))
              }
              placeholder={t("locationInputPlaceholder")}
              className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
            />
          </div>
          <div className="space-y-3">
            <Label className="text-[14px] text-[#73738a]">{t("documentDateLabel")}</Label>
            <Input
              type="date"
              value={state.documentDate}
              onChange={(event) => {
                const documentDate = event.target.value;
                const next = auto.titleForPeriod({ dateFrom: documentDate });
                setState((prev) => ({
                  ...prev,
                  documentDate,
                  ...(next !== null ? { documentName: next } : {}),
                }));
              }}
              className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
            />
          </div>
          <div className="space-y-3">
            <Label className="text-[14px] text-[#73738a]">{t("responsibleRoleLabel")}</Label>
            <select
              value={state.responsibleTitle}
              onChange={(event) =>
                setState((prev) => ({
                  ...prev,
                  responsibleTitle: event.target.value,
                  responsibleUserId: "",
                }))
              }
              className="h-9 w-full rounded-xl border border-[#dfe1ec] bg-[#f3f4fb] px-3.5 text-[13.5px]"
            >
              <option value="">{t("chooseRole")}</option>
              <PositionNativeOptions users={props.users} />
            </select>
          </div>
          <div className="space-y-3">
            <Label className="text-[14px] text-[#73738a]">{t("responsibleEmployeeLabel")}</Label>
            <select
              value={state.responsibleUserId}
              onChange={(event) =>
                setState((prev) => ({ ...prev, responsibleUserId: event.target.value }))
              }
              className="h-9 w-full rounded-xl border border-[#dfe1ec] bg-[#f3f4fb] px-3.5 text-[13.5px]"
            >
              <option value="">{t("chooseEmployee")}</option>
              {(state.responsibleTitle
                ? getUsersForRoleLabel(props.users, state.responsibleTitle, { keepUserId: state.responsibleUserId })
                : props.users
              ).map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              disabled={submitting}
              onClick={async () => {
                await submit.run(async () => {
                  try {
                    await props.onSubmit(state);
                  } catch (error) {
                    if (isFetchNetworkError(error)) {
                      throw new Error(props.mode === "create" ? t("createError") : t("saveError"));
                    }
                    throw error;
                  }
                });
              }}
              className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] text-white hover:bg-[#4b57ff]"
            >
              {submitting ? t("saving") : props.submitLabel}
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
  const t = useTranslations("glassInventory");
  // Окно закрывается только при успехе, ошибка сервера видна здесь же.
  const submit = useDocumentDialogSubmit({ onOpenChange: props.onOpenChange, fallbackError: t("saveError") });
  const submitting = submit.submitting;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent showCloseButton={false} className="max-w-[calc(100vw-1rem)] rounded-[32px] border-0 p-0 sm:max-w-[760px]">
        <DialogHeader className="flex flex-row items-start justify-between border-b px-14 py-10">
          <DialogTitle className="pr-12 text-[22px] font-medium leading-[1.15] text-black">
            {props.title}
          </DialogTitle>
          <button
            type="button"
            className="rounded-full p-2 text-black hover:bg-black/5"
            onClick={() => props.onOpenChange(false)}
          >
            <X className="size-8" />
          </button>
        </DialogHeader>
        <div className="flex justify-end px-14 py-12">
          <Button
            type="button"
            disabled={submitting}
            onClick={async () => {
              await submit.run(async () => {
                try {
                  await props.onSubmit();
                } catch (error) {
                  if (isFetchNetworkError(error)) throw new Error(t("saveError"));
                  throw error;
                }
              });
            }}
            className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] text-white hover:bg-[#4b57ff]"
          >
            {submitting ? t("saving") : props.submitLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function GlassListDocumentsClient(props: Props) {
  const t = useTranslations("glassInventory");
  const format = useFormatter();
  const router = useRouter();
  const routeCode = props.routeCode || props.templateCode;
  const defaultFormState = useMemo(() => getDefaultFormState(props.users), [props.users]);
  // Создание / настройки / удаление документов API отдаёт только
  // руководителю — у остальных эти кнопки не показываем.
  const canManageDocuments = useCanManageDocuments();
  const restoreMenu = useRestoreMenuItems();
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsDocument, setSettingsDocument] = useState<DocumentItem | null>(null);
  const [archiveDocument, setArchiveDocument] = useState<DocumentItem | null>(null);
  const [deleteDocument, setDeleteDocument] = useState<DocumentItem | null>(null);

  // Stable identity: feeds the dialog's `useEffect([initialState, open])`.
  const settingsFormState = useMemo<FormState>(() => {
    if (!settingsDocument) return defaultFormState;
    const config = normalizeGlassListConfig(settingsDocument.config);
    return {
      documentName: config.documentName || settingsDocument.title,
      location: config.location,
      documentDate: config.documentDate || settingsDocument.dateFrom,
      responsibleTitle:
        config.responsibleTitle || settingsDocument.responsibleTitle || "Управляющий",
      responsibleUserId:
        config.responsibleUserId ||
        settingsDocument.responsibleUserId ||
        defaultFormState.responsibleUserId,
    };
  }, [defaultFormState, settingsDocument]);

  async function createDocument(state: FormState) {
    const response = await fetch("/api/journal-documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateCode: GLASS_LIST_TEMPLATE_CODE,
        title: state.documentName.trim() || GLASS_LIST_DOCUMENT_TITLE,
        // Период — по правилу журнала (`journal-period.ts`): перечень
        // стекла годовой. «Дата документа» остаётся в шапке.
        ...resolveJournalPeriodForDate(
          GLASS_LIST_TEMPLATE_CODE,
          state.documentDate
        ),
        responsibleTitle: state.responsibleTitle || null,
        responsibleUserId: state.responsibleUserId || null,
        config: {
          ...getDefaultGlassListConfig(new Date(state.documentDate)),
          documentName: state.documentName.trim() || GLASS_LIST_DOCUMENT_TITLE,
          location: state.location.trim() || "Производство",
          documentDate: state.documentDate,
          responsibleTitle: state.responsibleTitle || "Управляющий",
          responsibleUserId: state.responsibleUserId || "",
        },
      }),
    });

    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.document?.id) {
      throw new Error(result?.error || t("createError"));
    }

    router.refresh();
    router.push(`/journals/${routeCode}/documents/${result.document.id}`);
  }

  async function saveSettings(state: FormState) {
    if (!settingsDocument) return;
    const currentConfig = normalizeGlassListConfig(settingsDocument.config);
    const nextConfig: GlassListConfig = {
      ...currentConfig,
      documentName: state.documentName.trim() || GLASS_LIST_DOCUMENT_TITLE,
      location: state.location.trim() || currentConfig.location,
      documentDate: state.documentDate,
      responsibleTitle: state.responsibleTitle || currentConfig.responsibleTitle,
      responsibleUserId: state.responsibleUserId || currentConfig.responsibleUserId,
    };

    const response = await fetch(`/api/journal-documents/${settingsDocument.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: nextConfig.documentName,
        dateFrom: nextConfig.documentDate,
        dateTo: nextConfig.documentDate,
        responsibleTitle: nextConfig.responsibleTitle,
        responsibleUserId: nextConfig.responsibleUserId || null,
        config: nextConfig,
      }),
    });

    if (!response.ok) {
      throw new Error(t("saveError"));
    }

    setSettingsDocument(null);
    router.refresh();
  }

  async function copyDocument(document: DocumentItem) {
    // Копия — перечень на следующий год. Сама опись (список изделий) —
    // это структура и переносится целиком; меняются только период,
    // дата документа и название (`buildDocumentCopy`). Раньше копия
    // повторяла период источника и не создавалась вовсе.
    const copy = buildDocumentCopy({
      templateCode: GLASS_LIST_TEMPLATE_CODE,
      journalName: GLASS_LIST_DOCUMENT_TITLE,
      sourceConfig: normalizeGlassListConfig(document.config),
      sourcePeriod: { dateFrom: document.dateFrom, dateTo: document.dateFrom },
      today: localDayKey(),
      existingTitles: props.documents.map((item) => item.title),
    });
    const config = copy.config as { responsibleTitle?: string; responsibleUserId?: string };
    let response: Response;
    try {
      response = await fetch("/api/journal-documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateCode: GLASS_LIST_TEMPLATE_CODE,
          title: copy.title,
          dateFrom: copy.dateFrom,
          dateTo: copy.dateTo,
          responsibleTitle:
            config.responsibleTitle || document.responsibleTitle || "Управляющий",
          responsibleUserId:
            config.responsibleUserId || document.responsibleUserId || null,
          config: copy.config,
        }),
      });
    } catch (error) {
      toast.error(isFetchNetworkError(error) ? t("copyError") : error instanceof Error && error.message ? error.message : t("copyError"));
      return;
    }

    if (!response.ok) {
      const failure = await response.json().catch(() => null);
      toast.error(failure?.error || t("copyError"));
      return;
    }

    router.refresh();
  }

  async function archiveCurrentDocument() {
    if (!archiveDocument) return;
    const response = await fetch(`/api/journal-documents/${archiveDocument.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "closed" }),
    });

    if (!response.ok) {
      throw new Error(t("archiveError"));
    }

    setArchiveDocument(null);
    router.refresh();
  }

  async function deleteCurrentDocument() {
    if (!deleteDocument) return;
    const response = await fetch(`/api/journal-documents/${deleteDocument.id}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      throw new Error(t("deleteError"));
    }

    setDeleteDocument(null);
    router.refresh();
  }

  return (
    <>
      <div className="space-y-10">
        <div className={JOURNAL_LIST_HEADER_ROW_CLASS}>
          <h1 className={JOURNAL_LIST_TITLE_CLASS}>
            <JournalHeadingName fallback={GLASS_LIST_PAGE_TITLE} />
          </h1>
          <JournalListActions
            templateCode="glass_items_list"
            canManage={canManageDocuments}
            create={
              canManageDocuments && props.activeTab === "active" ? (
                <Button type="button" onClick={() => setCreateOpen(true)} className={JOURNAL_ACTION_CREATE_CLASS}>
                  <Plus className="size-4" />
                  {t("createDocumentAction")}
                </Button>
              ) : null
            }
          />
        </div>

        <JournalTabs activeTab={props.activeTab} templateCode={routeCode} />

        <div className={JOURNAL_LIST_CARDS_CLASS}>
          {props.documents.length === 0 && <EmptyDocumentsState />}

          {props.documents.map((document) => {
            const href = `/journals/${routeCode}/documents/${document.id}`;
            const config = normalizeGlassListConfig(document.config);
            const responsibleUser = props.users.find(
              (user) => user.id === (config.responsibleUserId || document.responsibleUserId)
            );
            const responsibleTitle =
              config.responsibleTitle || document.responsibleTitle || "—";

            return (
              <div
                key={document.id}
                className={JOURNAL_LIST_CARD_CLASS}
              >
                <Link href={href} className={`${JOURNAL_CARD_TITLE_CLASS} min-w-0`}>
                  {config.documentName || document.title || props.templateName}
                </Link>
                <Link href={href} className={JOURNAL_CARD_SECTION_CLASS}>
                  <div className={JOURNAL_CARD_LABEL_CLASS}>{t("locationLabel")}</div>
                  <div className={JOURNAL_CARD_VALUE_CLASS}>
                    {config.location || "—"}
                  </div>
                </Link>
                <Link href={href} className={JOURNAL_CARD_SECTION_CLASS}>
                  <div className={JOURNAL_CARD_LABEL_CLASS}>{t("responsibleRoleLabel")}</div>
                  <div className={JOURNAL_CARD_VALUE_CLASS}>
                    {responsibleUser
                      ? `${responsibleTitle === "Управляющий" ? t("defaultResponsibleTitle") : responsibleTitle}: ${responsibleUser.name}`
                      : responsibleTitle === "Управляющий" ? t("defaultResponsibleTitle") : responsibleTitle}
                  </div>
                </Link>
                <Link href={href} className={JOURNAL_CARD_SECTION_CLASS}>
                  <div className={JOURNAL_CARD_LABEL_CLASS}>{t("documentDateLabel")}</div>
                  <div className={JOURNAL_CARD_VALUE_CLASS}>
                    {formatDisplayDate(format, config.documentDate || document.dateFrom)}
                  </div>
                </Link>
                <div className="flex justify-end">
                  <ResponsiveMenu
                    title={t("actionsMenu")}
                    items={filterManageMenuItems([
                      {
                        key: "settings",
                        label: t("menuSettings"),
                        icon: <Pencil className="size-4 text-[#6f7282]" />,
                        onSelect: () => setSettingsDocument(document),
                      },
                      {
                        key: "copy",
                        label: t("menuCopy"),
                        icon: <Copy className="size-4 text-[#6f7282]" />,
                        onSelect: () => copyDocument(document),
                      },
                      {
                        key: "print",
                        label: t("menuPrint"),
                        icon: <Printer className="size-4 text-[#6f7282]" />,
                        onSelect: () =>
                          window.open(`/api/journal-documents/${document.id}/pdf`, "_blank"),
                      },
                      // Закрытый документ раньше уходил навсегда: вернуть
                      // его в активные было нечем.
                      ...restoreMenu({ document, siblings: props.documents }),
                      ...(document.status === "active"
                        ? [
                            {
                              key: "archive",
                              label: t("menuArchive"),
                              icon: <Archive className="size-4 text-[#6f7282]" />,
                              onSelect: () => setArchiveDocument(document),
                            },
                          ]
                        : []),
                      {
                        key: "delete",
                        label: t("deleteAction"),
                        icon: <Trash2 className="size-4 text-[#6f7282]" />,
                        tone: "danger" as const,
                        onSelect: () => setDeleteDocument(document),
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
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <GlassListFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        dialogTitle={t("createDialogTitle")}
        submitLabel={t("create")}
        users={props.users}
        initialState={defaultFormState}
        onSubmit={createDocument}
      />

      <GlassListFormDialog
        open={!!settingsDocument}
        onOpenChange={(open) => !open && setSettingsDocument(null)}
        mode="edit"
        dialogTitle={t("settingsTitle")}
        submitLabel={t("save")}
        users={props.users}
        initialState={settingsFormState}
        onSubmit={saveSettings}
      />

      <ConfirmDialog
        open={!!archiveDocument}
        onOpenChange={(open) => !open && setArchiveDocument(null)}
        title={t("archiveTitle", { documentTitle: archiveDocument?.title || GLASS_LIST_DOCUMENT_TITLE })}
        submitLabel={t("archiveSubmit")}
        onSubmit={archiveCurrentDocument}
      />

      <ConfirmDialog
        open={!!deleteDocument}
        onOpenChange={(open) => !open && setDeleteDocument(null)}
        title={t("deleteTitle", { documentTitle: deleteDocument?.title || GLASS_LIST_DOCUMENT_TITLE })}
        submitLabel={t("deleteAction")}
        onSubmit={deleteCurrentDocument}
      />
    </>
  );
}
