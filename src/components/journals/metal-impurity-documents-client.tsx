"use client";

import { JournalHeadingName } from "@/components/shared/custom-names-provider";
import {
  JOURNAL_ACTION_CREATE_CLASS,
  JOURNAL_LIST_HEADER_ROW_CLASS,
  JOURNAL_LIST_TITLE_CLASS,
  JournalListActions,
} from "@/components/journals/journal-list-actions";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpenText,
  Ellipsis,
  Printer,
  Settings2,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ResponsiveMenu } from "@/components/ui/responsive-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  METAL_IMPURITY_DOCUMENT_TITLE,
  METAL_IMPURITY_PAGE_TITLE,
  METAL_IMPURITY_RESPONSIBLE_POSITIONS,
  METAL_IMPURITY_TEMPLATE_CODE,
  type MetalImpurityUser,
  getDefaultMetalImpurityConfig,
  normalizeMetalImpurityConfig,
} from "@/lib/metal-impurity-document";
import { buildStaffOptionLabel } from "@/lib/journal-staff-binding";
import { openDocumentPdf } from "@/lib/open-document-pdf";
import { getUsersForRoleLabel, pickPrimaryManager } from "@/lib/user-roles";
import { useAutoDocumentTitle } from "@/components/journals/use-auto-document-title";

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
import {
  EMPTY_SELECT_VALUE,
  PositionSelectItems,
  usePositionEmployeeCascade,
} from "@/components/shared/position-select";
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
  users: MetalImpurityUser[];
  availableMaterials: string[];
  availableSuppliers: string[];
};

type SettingsState = {
  title: string;
  startDate: string;
  responsiblePosition: string;
  responsibleEmployeeId: string;
  responsibleEmployee: string;
};

function formatRuDate(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("ru-RU").replace(/\./g, "-");
}

function collectEmployeeOptions(
  users: MetalImpurityUser[],
  documents: DocumentItem[],
  roleLabel: string,
  fallbackEmployeeId?: string | null,
  currentEmployeeId?: string | null
) {
  const values = new Set<string>();
  if (fallbackEmployeeId) values.add(fallbackEmployeeId);
  if (currentEmployeeId) values.add(currentEmployeeId);
  for (const user of getUsersForRoleLabel(users, roleLabel)) {
    values.add(user.id);
  }

  for (const document of documents) {
    const config = normalizeMetalImpurityConfig(document.config);
    if (config.responsiblePosition === roleLabel && config.responsibleEmployeeId) {
      values.add(config.responsibleEmployeeId);
    }
  }

  return Array.from(values)
    .map((employeeId) => users.find((user) => user.id === employeeId) || null)
    .filter((user): user is MetalImpurityUser => user !== null);
}

function getDefaultState(
  users: MetalImpurityUser[],
  availableMaterials: string[],
  availableSuppliers: string[]
): SettingsState {
  const config = getDefaultMetalImpurityConfig({
    users,
    materials: availableMaterials,
    suppliers: availableSuppliers,
  });
  return {
    title: METAL_IMPURITY_DOCUMENT_TITLE,
    startDate: config.startDate,
    responsiblePosition: config.responsiblePosition,
    responsibleEmployeeId: config.responsibleEmployeeId || "",
    responsibleEmployee: config.responsibleEmployee,
  };
}

function DocumentDialog({
  open,
  onOpenChange,
  mode,
  initial,
  submitLabel,
  title,
  users,
  documents,
  showEmployeeField,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  initial: SettingsState;
  submitLabel: string;
  title: string;
  users: MetalImpurityUser[];
  documents: DocumentItem[];
  showEmployeeField: boolean;
  onSubmit: (value: SettingsState) => Promise<void>;
}) {
  const [state, setState] = useState(initial);
  // Окно закрывается только при успехе, ошибка сервера видна здесь же.
  const submit = useDocumentDialogSubmit({ onOpenChange });
  const submitting = submit.submitting;
  const { reset: resetSubmit } = submit;
  const defaultEmployeeId = pickPrimaryManager(users)?.id || "";
  // Rendered list: keeps the currently selected employee even if the
  // position no longer matches (hydrated documents).
  const employeeOptions = useMemo(
    () =>
      collectEmployeeOptions(
        users,
        documents,
        state.responsiblePosition,
        defaultEmployeeId,
        state.responsibleEmployeeId
      ),
    [defaultEmployeeId, documents, state.responsibleEmployeeId, state.responsiblePosition, users]
  );
  // Cascade candidates: without the current id, so a position change
  // re-picks the first employee of the new position (previous behaviour).
  const resolveCandidates = useCallback(
    (positionTitle: string) =>
      collectEmployeeOptions(users, documents, positionTitle, defaultEmployeeId),
    [defaultEmployeeId, documents, users]
  );
  const handleCascadeChange = useCallback(
    (next: { positionTitle: string; userId: string }) => {
      setState((current) => ({
        ...current,
        responsiblePosition: next.positionTitle,
        responsibleEmployeeId: next.userId,
        responsibleEmployee: users.find((item) => item.id === next.userId)?.name || "",
      }));
    },
    [users]
  );
  const cascade = usePositionEmployeeCascade({
    users,
    positionTitle: state.responsiblePosition,
    userId: state.responsibleEmployeeId,
    onChange: handleCascadeChange,
    resolveCandidates,
    autoPick: "first",
  });

  const auto = useAutoDocumentTitle({
    templateCode: METAL_IMPURITY_TEMPLATE_CODE,
    journalName: METAL_IMPURITY_DOCUMENT_TITLE,
    period: { dateFrom: state.startDate },
    enabled: mode === "create",
  });
  const { reset: resetAutoTitle, titleForPeriod } = auto;

  useEffect(() => {
    if (open) {
      resetAutoTitle();
      const seeded =
        mode === "create" ? titleForPeriod({ dateFrom: initial.startDate }) : null;
      setState({ ...initial, title: seeded || initial.title });
      // Открыли заново — старая ошибка сервера не должна висеть.
      resetSubmit();
    }
  }, [initial, mode, open, resetAutoTitle, resetSubmit, titleForPeriod]);

  useEffect(() => {
    if (!open || employeeOptions.length === 0) return;
    if (!employeeOptions.some((user) => user.id === state.responsibleEmployeeId)) {
      setState((current) => ({
        ...current,
        responsibleEmployeeId: employeeOptions[0]?.id || "",
        responsibleEmployee: employeeOptions[0]?.name || "",
      }));
    }
  }, [employeeOptions, open, state.responsibleEmployeeId]);

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
              placeholder="Введите название документа"
              onChange={(event) => {
                auto.markTouched();
                setState({ ...state, title: event.target.value });
              }}
              className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
            />
          </div>
          <div className="space-y-3">
            <Label className="text-[14px] text-[#73738a]">Дата начала</Label>
            <Input
              type="date"
              value={state.startDate}
              onChange={(event) => {
                const startDate = event.target.value;
                const next = auto.titleForPeriod({ dateFrom: startDate });
                setState({
                  ...state,
                  startDate,
                  ...(next !== null ? { title: next } : {}),
                });
              }}
              className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
            />
          </div>
          <div className="space-y-3">
            <Label className="text-[14px] text-[#73738a]">Должность ответственного</Label>
            <Select
              value={state.responsiblePosition}
              onValueChange={cascade.handlePositionChange}
            >
              <SelectTrigger className="h-10 rounded-xl border-[#dfe1ec] bg-[#f3f4fb] px-3.5 text-[13.5px]">
                <SelectValue placeholder="Выберите должность" />
              </SelectTrigger>
              <SelectContent>
                <PositionSelectItems users={users} />
              </SelectContent>
            </Select>
          </div>
          {showEmployeeField && (
            <div className="space-y-3">
              <Label className="text-[14px] text-[#73738a]">Сотрудник</Label>
              <Select
                value={state.responsibleEmployeeId || EMPTY_SELECT_VALUE}
                onValueChange={cascade.handleEmployeeChange}
                open={cascade.employeeOpen}
                onOpenChange={cascade.setEmployeeOpen}
              >
                <SelectTrigger className="h-10 rounded-xl border-[#dfe1ec] bg-[#f3f4fb] px-3.5 text-[13.5px]">
                  <SelectValue placeholder="Выберите сотрудника" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={EMPTY_SELECT_VALUE}>Выберите сотрудника</SelectItem>
                  {employeeOptions.map((employee) => (
                    <SelectItem key={employee.id} value={employee.id}>
                      {buildStaffOptionLabel(employee)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
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

function DeleteDialog({
  open,
  onOpenChange,
  title,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  onDelete: () => Promise<void>;
}) {
  // Окно закрывается только при успехе, ошибка сервера видна здесь же.
  const submit = useDocumentDialogSubmit({ onOpenChange });
  const submitting = submit.submitting;
  const { reset: resetSubmit } = submit;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-1rem)] rounded-[32px] border-0 p-0 sm:max-w-[680px]">
        <DialogHeader className="border-b px-12 py-10">
          <DialogTitle className="pr-10 text-[22px] font-medium text-black">
            {`Удаление документа "${title}"`}
          </DialogTitle>
        </DialogHeader>
        <div className="flex justify-end px-12 py-10">
          <Button
            type="button"
            disabled={submitting}
            onClick={async () => {
              await submit.run(() => onDelete());
            }}
            className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] text-white hover:bg-[#4b57ff]"
          >
            {submitting ? "Удаление..." : "Удалить"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function MetalImpurityDocumentsClient({
  activeTab,
  routeCode,
  documents,
  users,
  availableMaterials,
  availableSuppliers,
}: Props) {
  const router = useRouter();
  // Создание / настройки / удаление документов API отдаёт только
  // руководителю — у остальных эти кнопки не показываем.
  const canManageDocuments = useCanManageDocuments();
  const restore = useRestoreDocument();
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsDocument, setSettingsDocument] = useState<DocumentItem | null>(null);
  const [deleteDocument, setDeleteDocument] = useState<DocumentItem | null>(null);

  const createState = useMemo<SettingsState>(
    () => getDefaultState(users, availableMaterials, availableSuppliers),
    [availableMaterials, availableSuppliers, users]
  );
  // Stable identity: feeds the dialog's `useEffect([initial, open])`.
  const settingsState = useMemo<SettingsState>(() => {
    if (!settingsDocument) return createState;
    const config = normalizeMetalImpurityConfig(settingsDocument.config);
    return {
      title: settingsDocument.title,
      startDate: config.startDate,
      responsiblePosition: config.responsiblePosition,
      responsibleEmployeeId: config.responsibleEmployeeId || "",
      responsibleEmployee: config.responsibleEmployee,
    };
  }, [createState, settingsDocument]);

  async function createDocument(payload: SettingsState) {
    const config = getDefaultMetalImpurityConfig({
      users,
      materials: availableMaterials,
      suppliers: availableSuppliers,
      date: payload.startDate,
      responsibleEmployeeId: payload.responsibleEmployeeId || null,
      responsibleName: payload.responsibleEmployee,
      responsiblePosition: payload.responsiblePosition,
    });

    const response = await fetch("/api/journal-documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateCode: METAL_IMPURITY_TEMPLATE_CODE,
        title: payload.title.trim() || METAL_IMPURITY_DOCUMENT_TITLE,
        // Период — по правилу журнала (`journal-period.ts`), а не «один день».
        ...resolveJournalPeriodForDate(
          METAL_IMPURITY_TEMPLATE_CODE,
          payload.startDate
        ),
        responsibleTitle: payload.responsiblePosition,
        responsibleUserId: payload.responsibleEmployeeId || config.responsibleEmployeeId || null,
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

  async function saveSettings(document: DocumentItem, payload: SettingsState) {
    const current = normalizeMetalImpurityConfig(document.config, {
      users,
      materials: availableMaterials,
      suppliers: availableSuppliers,
      date: payload.startDate,
      responsibleEmployeeId: payload.responsibleEmployeeId || null,
      responsibleName: payload.responsibleEmployee,
      responsiblePosition: payload.responsiblePosition,
    });

    const response = await fetch(`/api/journal-documents/${document.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: payload.title.trim() || METAL_IMPURITY_DOCUMENT_TITLE,
        dateFrom: payload.startDate,
        dateTo: current.endDate || payload.startDate,
        responsibleTitle: payload.responsiblePosition,
        responsibleUserId: payload.responsibleEmployeeId || current.responsibleEmployeeId || null,
        config: {
          ...current,
          startDate: payload.startDate,
          responsiblePosition: payload.responsiblePosition,
          responsibleEmployeeId: payload.responsibleEmployeeId || null,
          responsibleEmployee: payload.responsibleEmployee,
        },
      }),
    });

    if (!response.ok) {
      throw new Error("Не удалось сохранить документ");
    }
    router.refresh();
  }

  async function deleteById(documentId: string) {
    const response = await fetch(`/api/journal-documents/${documentId}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      throw new Error("Не удалось удалить документ");
    }
    router.refresh();
  }

  return (
    <>
      <div className="space-y-10">
        <div className={JOURNAL_LIST_HEADER_ROW_CLASS}>
          <h1 className={JOURNAL_LIST_TITLE_CLASS}>
            <JournalHeadingName
              fallback={
                activeTab === "closed"
                  ? `${METAL_IMPURITY_PAGE_TITLE} (Закрытые)`
                  : METAL_IMPURITY_PAGE_TITLE
              }
              suffix={activeTab === "closed" ? " (Закрытые)" : null}
            />
          </h1>
          <JournalListActions
            templateCode="metal_impurity"
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

        <JournalTabs activeTab={activeTab} templateCode={routeCode} />

        <div className={JOURNAL_LIST_CARDS_CLASS}>
          {documents.length === 0 && (
            <EmptyDocumentsState />
          )}

          {documents.map((document) => {
            const config = normalizeMetalImpurityConfig(document.config);
            return (
              <div
                key={document.id}
                className={JOURNAL_LIST_CARD_CLASS}
              >
                <Link
                  href={`/journals/${routeCode}/documents/${document.id}`}
                  className={JOURNAL_CARD_TITLE_CLASS}
                >
                  {document.title || METAL_IMPURITY_DOCUMENT_TITLE}
              <SharedDocumentBadge shared={document.shared} />
                </Link>
                <Link
                  href={`/journals/${routeCode}/documents/${document.id}`}
                  className={JOURNAL_CARD_SECTION_CLASS}
                >
                  <div className={JOURNAL_CARD_LABEL_CLASS}>Ответственный</div>
                  <div className={JOURNAL_CARD_VALUE_CLASS}>
                    {`${config.responsiblePosition}: ${config.responsibleEmployee}`}
                  </div>
                </Link>
                <Link
                  href={`/journals/${routeCode}/documents/${document.id}`}
                  className={JOURNAL_CARD_SECTION_CLASS}
                >
                  <div className={JOURNAL_CARD_LABEL_CLASS}>Дата начала</div>
                  <div className={JOURNAL_CARD_VALUE_CLASS}>
                    {formatRuDate(config.startDate)}
                  </div>
                </Link>
                <div className="justify-self-end">
                  <ResponsiveMenu
                    title="Действия"
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
                          void openDocumentPdf(document.id).catch((error) =>
                            toast.error(
                              humanizeFetchError(error, "Не удалось открыть PDF")
                            )
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
                              tone: "danger" as const,
                              onSelect: () => setDeleteDocument(document),
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
            );
          })}
        </div>
      </div>

      <DocumentDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        initial={createState}
        submitLabel="Создать"
        title="Создание документа"
        users={users}
        documents={documents}
        showEmployeeField={false}
        onSubmit={createDocument}
      />

      <DocumentDialog
        open={!!settingsDocument}
        onOpenChange={(open) => {
          if (!open) setSettingsDocument(null);
        }}
        mode="edit"
        initial={settingsState}
        submitLabel="Сохранить"
        title="Настройки документа"
        users={users}
        documents={documents}
        showEmployeeField={true}
        onSubmit={async (value) => {
          if (!settingsDocument) return;
          await saveSettings(settingsDocument, value);
        }}
      />

      <DeleteDialog
        open={!!deleteDocument}
        onOpenChange={(open) => {
          if (!open) setDeleteDocument(null);
        }}
        title={deleteDocument?.title || METAL_IMPURITY_DOCUMENT_TITLE}
        onDelete={async () => {
          if (!deleteDocument) return;
          await deleteById(deleteDocument.id);
        }}
      />
    </>
  );
}
