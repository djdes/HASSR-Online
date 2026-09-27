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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  GLASS_CONTROL_DEFAULT_FREQUENCY,
  GLASS_CONTROL_DOCUMENT_TITLE,
  GLASS_CONTROL_PAGE_TITLE,
  formatRuDateDash,
  getDefaultGlassControlConfig,
  getGlassControlResponsibleOptions,
  normalizeGlassControlConfig,
  toIsoDate,
} from "@/lib/glass-control-document";
import { usePositionEmployeeCascade } from "@/components/shared/position-select";
import { useJournalCreateDefaults } from "@/components/journals/journal-create-defaults";
import { getUserPositionLabel } from "@/lib/user-roles";

import { toast } from "sonner";
import { confirmAsync } from "@/components/ui/confirm-async";
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
  DocumentDialogFeedback,
  readCreatedDocument,
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
  responsibleTitle: string | null;
  responsibleUserId?: string | null;
  dateFrom: string;
  config?: unknown;
};

type Props = {
  activeTab: "active" | "closed";
  routeCode?: string;
  templateCode: string;
  templateName: string;
  users: UserItem[];
  documents: DocumentItem[];
};

type FormState = {
  title: string;
  dateFrom: string;
  controlFrequency: string;
  responsibleTitle: string;
  responsibleUserId: string;
};

function buildDefaultState(users: UserItem[], defaultResponsibleUserId: string | null): FormState {
  // Предвыбор — только человек из «Ответственных за журналы»: первого
  // руководителя по списку сервер не отличил бы от выбора.
  const preset = defaultResponsibleUserId
    ? users.find((user) => user.id === defaultResponsibleUserId) ?? null
    : null;

  return {
    title: GLASS_CONTROL_DOCUMENT_TITLE,
    dateFrom: toIsoDate(new Date()),
    controlFrequency: GLASS_CONTROL_DEFAULT_FREQUENCY,
    responsibleTitle: preset ? getUserPositionLabel(preset) : "",
    responsibleUserId: preset?.id ?? "",
  };
}

function GlassControlFormDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  users: UserItem[];
  initialState: FormState;
  submitLabel: string;
  onSubmit: (state: FormState) => Promise<void>;
}) {
  const [state, setState] = useState<FormState>(props.initialState);
  // Окно закрывается только при успехе, ошибка сервера видна здесь же.
  const submit = useDocumentDialogSubmit({ onOpenChange: props.onOpenChange });
  const submitting = submit.submitting;
  const options = useMemo(
    () => getGlassControlResponsibleOptions(props.users),
    [props.users]
  );
  const cascade = usePositionEmployeeCascade({
    users: props.users,
    positionTitle: state.responsibleTitle,
    userId: state.responsibleUserId,
    onChange: (next) =>
      setState((prev) => ({
        ...prev,
        responsibleTitle: next.positionTitle,
        responsibleUserId: next.userId,
      })),
    autoPick: "none",
  });
  const employeeCandidates = state.responsibleTitle ? cascade.candidates : props.users;

  useEffect(() => {
    if (!props.open) return;
    setState(props.initialState);
  }, [props.initialState, props.open]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent showCloseButton={false} className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[24px] border-0 p-0 sm:max-w-[560px]">
        <DialogHeader className="flex flex-row items-center justify-between border-b px-7 py-5">
          <DialogTitle className="text-[22px] font-semibold tracking-[-0.03em] text-black">
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

        <div className="space-y-4 px-7 py-6">
          <DocumentDialogFeedback state={submit} onOpenChange={props.onOpenChange} />
          <div className="space-y-1">
            <Label className="text-[16px] text-[#6f7282]">Название документа</Label>
            <Input
              value={state.title}
              onChange={(event) =>
                setState((prev) => ({ ...prev, title: event.target.value }))
              }
              className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-[16px] text-[#6f7282]">Дата начала</Label>
            <Input
              type="date"
              value={state.dateFrom}
              onChange={(event) =>
                setState((prev) => ({ ...prev, dateFrom: event.target.value }))
              }
              className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-[16px] text-[#6f7282]">Частота контроля</Label>
            <Input
              value={state.controlFrequency}
              onChange={(event) =>
                setState((prev) => ({
                  ...prev,
                  controlFrequency: event.target.value,
                }))
              }
              className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-[16px] text-[#6f7282]">Должность ответственного</Label>
            <Select
              value={state.responsibleTitle}
              onValueChange={cascade.handlePositionChange}
            >
              <SelectTrigger className="h-10 rounded-xl border-[#dfe1ec] bg-[#f3f4fb] px-3.5 text-[13.5px]">
                <SelectValue placeholder="Выберите должность" />
              </SelectTrigger>
              <SelectContent>
                {options.titles.map((title) => (
                  <SelectItem key={title} value={title}>
                    {title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-[16px] text-[#6f7282]">Сотрудник</Label>
            <Select
              value={state.responsibleUserId}
              onValueChange={cascade.handleEmployeeChange}
              open={cascade.employeeOpen}
              onOpenChange={cascade.setEmployeeOpen}
            >
              <SelectTrigger className="h-10 rounded-xl border-[#dfe1ec] bg-[#f3f4fb] px-3.5 text-[13.5px]">
                <SelectValue placeholder="Выберите сотрудника" />
              </SelectTrigger>
              <SelectContent>
                {employeeCandidates.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end pt-1">
            <Button
              type="button"
              disabled={submitting}
              onClick={async () => {
                await submit.run(() => props.onSubmit(state));
              }}
              className="h-9 rounded-xl bg-[#5863f8] px-3.5 text-[13.5px] font-medium text-white hover:bg-[#4b57f3]"
            >
              {submitting ? "Сохранение..." : props.submitLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function GlassControlDocumentsClient(props: Props) {
  const router = useRouter();
  const routeCode = props.routeCode || props.templateCode;
  // Создание / настройки / удаление документов API отдаёт только
  // руководителю — у остальных эти кнопки не показываем.
  const canManageDocuments = useCanManageDocuments();
  const restore = useRestoreDocument();
  const [creating, setCreating] = useState(false);
  const [editingDocument, setEditingDocument] = useState<DocumentItem | null>(null);
  const createDefaults = useJournalCreateDefaults();
  const defaultState = useMemo(
    () => buildDefaultState(props.users, createDefaults.defaultResponsibleUserId),
    [createDefaults.defaultResponsibleUserId, props.users]
  );

  async function createDocument(state: FormState) {
    const config = {
      ...getDefaultGlassControlConfig(),
      documentName: state.title.trim() || GLASS_CONTROL_DOCUMENT_TITLE,
      controlFrequency:
        state.controlFrequency.trim() || GLASS_CONTROL_DEFAULT_FREQUENCY,
    };

    const response = await fetch("/api/journal-documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateCode: props.templateCode,
        title: config.documentName,
        // Период — по правилу журнала (`journal-period.ts`): стеклоконтроль
        // бессрочный, а окно создавало документ на один день.
        ...resolveJournalPeriodForDate(props.templateCode, state.dateFrom),
        responsibleTitle: state.responsibleTitle || null,
        responsibleUserId: state.responsibleUserId || null,
        config,
      }),
    });

    // Ошибку показывает само окно создания: тост её гасил, а в окно
    // уезжало служебное «create_failed».
    await readCreatedDocument(response);

    router.refresh();
  }

  async function saveSettings(state: FormState) {
    if (!editingDocument) return;

    const response = await fetch(`/api/journal-documents/${editingDocument.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: state.title.trim() || GLASS_CONTROL_DOCUMENT_TITLE,
        dateFrom: state.dateFrom,
        responsibleTitle: state.responsibleTitle || null,
        responsibleUserId: state.responsibleUserId || null,
        config: {
          ...normalizeGlassControlConfig(editingDocument.config),
          documentName: state.title.trim() || GLASS_CONTROL_DOCUMENT_TITLE,
          controlFrequency:
            state.controlFrequency.trim() || GLASS_CONTROL_DEFAULT_FREQUENCY,
        },
      }),
    });

    if (!response.ok) {
      const failure = await response.json().catch(() => null);
      throw new Error(
        failure?.error || "Не удалось сохранить настройки документа"
      );
    }

    setEditingDocument(null);
    router.refresh();
  }

  async function handleDelete(documentId: string, title: string) {
    if (!(await confirmAsync({ title: "Удалить документ?", description: `Документ «${title}» и все его записи будут удалены безвозвратно.`, variant: "danger", confirmLabel: "Удалить" }))) return;

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
          <JournalHeadingName fallback={GLASS_CONTROL_PAGE_TITLE} />
        </h1>
        <JournalListActions
          templateCode="glass_control"
          canManage={canManageDocuments}
          create={
            canManageDocuments && props.activeTab === "active" ? (
              <Button type="button" onClick={() => setCreating(true)} className={JOURNAL_ACTION_CREATE_CLASS}>
                <Plus className="size-4" />
                Создать документ
              </Button>
            ) : null
          }
        />
      </div>

      <JournalTabs activeTab={props.activeTab} templateCode={routeCode} />

      <div className={JOURNAL_LIST_CARDS_CLASS}>
        {props.documents.length === 0 && (
          <EmptyDocumentsState />
        )}

        {props.documents.map((document) => {
          const href = `/journals/${routeCode}/documents/${document.id}`;
          const config = normalizeGlassControlConfig(document.config);
          const responsibleName = document.responsibleUserId
            ? props.users.find((user) => user.id === document.responsibleUserId)?.name || ""
            : "";

          return (
            <div
              key={document.id}
              className={JOURNAL_LIST_CARD_CLASS}
            >
              <Link href={href} className={JOURNAL_CARD_TITLE_CLASS}>
                {config.documentName || document.title || props.templateName}
              </Link>

              <Link href={href} className={JOURNAL_CARD_SECTION_CLASS}>
                <div className={JOURNAL_CARD_LABEL_CLASS}>Ответственный</div>
                <div className={JOURNAL_CARD_VALUE_CLASS}>
                  {document.responsibleTitle
                    ? `${document.responsibleTitle}${responsibleName ? `: ${responsibleName}` : ""}`
                    : "—"}
                </div>
              </Link>

              <Link href={href} className={JOURNAL_CARD_SECTION_CLASS}>
                <div className={JOURNAL_CARD_LABEL_CLASS}>Дата начала</div>
                <div className={JOURNAL_CARD_VALUE_CLASS}>
                  {formatRuDateDash(document.dateFrom)}
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
                            onSelect: () => setEditingDocument(document),
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
                    ...restoreMenuItems({ document, siblings: props.documents, restore }),
                    ...(document.status === "active"
                      ? [
                          {
                            key: "delete",
                            label: "Удалить",
                            icon: <Trash2 className="size-4 text-[#6f7282]" />,
                            tone: "danger" as const,
                            onSelect: () =>
                              handleDelete(
                                document.id,
                                config.documentName || document.title || props.templateName
                              ),
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

      <GlassControlFormDialog
        open={creating}
        onOpenChange={setCreating}
        title="Создание документа"
        users={props.users}
        initialState={defaultState}
        submitLabel="Создать"
        onSubmit={createDocument}
      />

      <GlassControlFormDialog
        open={!!editingDocument}
        onOpenChange={(open) => !open && setEditingDocument(null)}
        title="Настройки документа"
        users={props.users}
        initialState={
          editingDocument
            ? {
                title:
                  normalizeGlassControlConfig(editingDocument.config).documentName ||
                  editingDocument.title ||
                  GLASS_CONTROL_DOCUMENT_TITLE,
                dateFrom: editingDocument.dateFrom,
                controlFrequency:
                  normalizeGlassControlConfig(editingDocument.config).controlFrequency,
                responsibleTitle: editingDocument.responsibleTitle || "",
                responsibleUserId: editingDocument.responsibleUserId || "",
              }
            : defaultState
        }
        submitLabel="Сохранить"
        onSubmit={saveSettings}
      />
    </div>
  );
}
