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
  BookOpenText,
  Ellipsis,
  Pencil,
  Plus,
  Printer,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ResponsiveMenu } from "@/components/ui/responsive-menu";
import {
  applyCleaningAutoFillToConfig,
  CLEANING_DOCUMENT_TEMPLATE_CODE,
  CLEANING_DOCUMENT_TITLE,
  CLEANING_PAGE_TITLE,
  CLEANING_ROW_LABELS,
  defaultCleaningDocumentConfig,
  getCleaningCreatePeriodBounds,
  getCleaningPeriodLabel,
  normalizeCleaningDocumentConfig,
  type CleaningDocumentConfig,
} from "@/lib/cleaning-document";
import { getUsersForRoleLabel } from "@/lib/user-roles";
import { buildDocumentAutoTitle } from "@/lib/journal-document-title";
import {
  EMPTY_STATE_CREATE_BUTTON_CLASS,
  EmptyDocumentsState,
  filterManageMenuItems,
  JournalTabs,
  useCanManageDocuments,
} from "@/components/journals/document-list-ui";
import { CreateDocumentEmptyState } from "@/components/journals/create-document-empty-state";
import {
  JOURNAL_CARD_LABEL_CLASS,
  JOURNAL_CARD_SECTION_CLASS,
  JOURNAL_CARD_TITLE_CLASS,
  JOURNAL_CARD_VALUE_CLASS,
  JOURNAL_DIALOG_ACTIONS_CLASS,
  JOURNAL_DIALOG_BODY_CLASS,
  JOURNAL_DIALOG_CONTENT_CLASS,
  JOURNAL_DIALOG_FIELDS_CLASS,
  JOURNAL_DIALOG_FOOTER_CLASS,
  JOURNAL_DIALOG_HEADER_CLASS,
  JOURNAL_DIALOG_SUBMIT_CLASS,
  JOURNAL_DIALOG_TITLE_CLASS,
  JOURNAL_LIST_STACK_CLASS,
  JOURNAL_LIST_CARD_CLASS,
  JOURNAL_LIST_CARDS_CLASS,
} from "@/components/journals/journal-responsive";
import { PositionEmployeePicker } from "@/components/shared/position-select";
import { FloatingInputField } from "@/components/journals/journal-dialog-field";
import { cn } from "@/lib/utils";
import { ControlPeriodicityField } from "@/components/journals/control-periodicity-field";
import {
  getDefaultControlPeriodicity,
  readControlPeriodicity,
} from "@/lib/control-periodicity";
import { SharedDocumentBadge } from "@/components/journals/shared-document-badge";
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
  /** Точки: документ без точки рядом с документами точек. */
  shared?: boolean;
  status: "active" | "closed";
  dateFrom: string;
  dateTo: string;
  config?: unknown;
};

type CreateState = {
  title: string;
  cleaningRole: string;
  cleaningUserId: string;
  controlRole: string;
  controlUserId: string;
  controlPeriodicity: string;
};

type SettingsState = {
  title: string;
  cleaningRole: string;
  cleaningUserId: string;
  controlRole: string;
  controlUserId: string;
  controlPeriodicity: string;
};

type Props = {
  routeCode: string;
  templateCode: string;
  activeTab: "active" | "closed";
  users: UserItem[];
  documents: DocumentItem[];
};

function pickFirstUserId(users: UserItem[], roleLabel: string) {
  return getUsersForRoleLabel(users, roleLabel)[0]?.id || "";
}

function getUserName(users: UserItem[], userId: string) {
  return users.find((user) => user.id === userId)?.name || "";
}

function buildCreateState(existingTitles: readonly string[]): CreateState {
  return {
    /**
     * Название предзаполняем «Журнал уборки — 1–15 сентября 2026» (владелец,
     * 2026-09-04: во всех журналах название должно собираться из журнала и
     * периода). Опасение P8 — управляющая заводит несколько документов за
     * период («Уборка кухни», «Уборка зала») и получала клоны с одним
     * именем — снимает `uniqueDocumentTitle`: занятое название получает
     * суффикс « (2)», « (3)». Поле остаётся редактируемым и обязательным.
     */
    title: buildDocumentAutoTitle({
      templateCode: CLEANING_DOCUMENT_TEMPLATE_CODE,
      journalName: CLEANING_DOCUMENT_TITLE,
      ...getCleaningCreatePeriodBounds(),
      existingTitles,
    }),
    /**
     * Должности НЕ предзаполняем. Раньше сюда падал первый ответственный
     * из `defaultCleaningDocumentConfig`, и если такой должности не было
     * среди опций селекта, `<SelectValue>` рендерил ПУСТО — а дефолтный
     * `w-fit` у `SelectTrigger` схлопывал его в пустую пилюлю ~50px.
     * Теперь значение всегда одно из опций («Выберите должность»),
     * а сам триггер full-width (JOURNAL_DIALOG_FIELD_TRIGGER_CLASS).
     */
    cleaningRole: "",
    // Сотрудника пользователь выбирает осознанно — без авто-подстановки.
    cleaningUserId: "",
    controlRole: "",
    controlUserId: "",
    controlPeriodicity: getDefaultControlPeriodicity(CLEANING_DOCUMENT_TEMPLATE_CODE),
  };
}

function buildSettingsState(document: DocumentItem, users: UserItem[]): SettingsState {
  const config = normalizeCleaningDocumentConfig(document.config, { users });
  return {
    title: document.title || CLEANING_DOCUMENT_TITLE,
    cleaningRole: config.cleaningResponsibles[0]?.title || "",
    cleaningUserId: config.cleaningResponsibles[0]?.userId || "",
    controlRole: config.controlResponsibles[0]?.title || "",
    controlUserId: config.controlResponsibles[0]?.userId || "",
    controlPeriodicity: readControlPeriodicity(
      document.config,
      CLEANING_DOCUMENT_TEMPLATE_CODE
    ),
  };
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
      <DialogContent className={JOURNAL_DIALOG_CONTENT_CLASS}>
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <div className="flex items-start justify-between gap-6">
            <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>
              {props.title}
            </DialogTitle>
          </div>
        </DialogHeader>
        <div className="space-y-4 px-6 py-5">
          <DocumentDialogFeedback state={submit} onOpenChange={props.onOpenChange} />
          <div className="flex justify-end">
          <Button
            type="button"
            disabled={submitting}
            onClick={async () => {
              await submit.run(() => props.onSubmit());
            }}
            className="h-9 rounded-xl bg-[#5563ff] px-3.5 text-[13.5px] text-white hover:bg-[#4554ff]"
          >
            {submitting ? "Сохранение..." : props.submitLabel}
          </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  users: UserItem[];
  /** Существующие документы — чтобы автоназвание не повторяло занятое. */
  documents: DocumentItem[];
  onSubmit: (state: CreateState) => Promise<void>;
}) {
  const existingTitles = useMemo(
    () => props.documents.map((document) => document.title),
    [props.documents]
  );
  const [state, setState] = useState<CreateState>(() => buildCreateState(existingTitles));
  // Окно закрывается только при успехе, ошибка сервера видна здесь же.
  const submit = useDocumentDialogSubmit({ onOpenChange: props.onOpenChange });
  const submitting = submit.submitting;
  const [titleError, setTitleError] = useState("");

  useEffect(() => {
    if (!props.open) return;
    setState(buildCreateState(existingTitles));
    setTitleError("");
  }, [props.open, existingTitles]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className={JOURNAL_DIALOG_CONTENT_CLASS}>
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <div className="flex items-center justify-between">
            <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>
              Создание документа
            </DialogTitle>
          </div>
        </DialogHeader>
        {props.users.length === 0 ? (
          <div className="px-6 py-5">
            <CreateDocumentEmptyState onNavigate={() => props.onOpenChange(false)} />
          </div>
        ) : (
        <>
        <div className={cn(JOURNAL_DIALOG_BODY_CLASS, JOURNAL_DIALOG_FIELDS_CLASS)}>
          <DocumentDialogFeedback state={submit} onOpenChange={props.onOpenChange} />
          <FloatingInputField
            label="Название документа"
            placeholder="Введите название документа"
            value={state.title}
            onChange={(value) => {
              if (titleError) setTitleError("");
              setState((current) => ({ ...current, title: value }));
            }}
            error={titleError || undefined}
          />
          <PositionEmployeePicker
            users={props.users}
            value={{ positionTitle: state.cleaningRole, userId: state.cleaningUserId }}
            onChange={(next) =>
              setState((current) => ({
                ...current,
                cleaningRole: next.positionTitle,
                cleaningUserId: next.userId,
              }))
            }
            positionLabel="Должность ответственного за уборку"
            employeeLabel={CLEANING_ROW_LABELS.cleaning}
            variant="floating"
          />
          <PositionEmployeePicker
            users={props.users}
            value={{ positionTitle: state.controlRole, userId: state.controlUserId }}
            onChange={(next) =>
              setState((current) => ({
                ...current,
                controlRole: next.positionTitle,
                controlUserId: next.userId,
              }))
            }
            positionLabel="Должность ответственного за контроль"
            employeeLabel={CLEANING_ROW_LABELS.control}
            variant="floating"
          />
          <ControlPeriodicityField
            value={state.controlPeriodicity}
            onChange={(value) =>
              setState((current) => ({ ...current, controlPeriodicity: value }))
            }
          />
        </div>
        <div className={JOURNAL_DIALOG_FOOTER_CLASS}>
          <div className={JOURNAL_DIALOG_ACTIONS_CLASS}>
            <Button
              type="button"
              disabled={submitting}
              onClick={async () => {
                if (!state.title.trim()) {
                  setTitleError("Поле не заполнено");
                  return;
                }
                setTitleError("");
                await submit.run(() => props.onSubmit(state));
              }}
              className={JOURNAL_DIALOG_SUBMIT_CLASS}
            >
              {submitting ? "Создание..." : "Создать"}
            </Button>
          </div>
        </div>
        </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SettingsDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  users: UserItem[];
  initialState: SettingsState | null;
  onSubmit: (state: SettingsState) => Promise<void>;
}) {
  const [state, setState] = useState<SettingsState | null>(props.initialState);
  // Окно закрывается только при успехе, ошибка сервера видна здесь же.
  const submit = useDocumentDialogSubmit({ onOpenChange: props.onOpenChange });
  const submitting = submit.submitting;

  useEffect(() => {
    if (!props.open) return;
    setState(props.initialState);
  }, [props.initialState, props.open]);

  if (!state) return null;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className={JOURNAL_DIALOG_CONTENT_CLASS}>
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <div className="flex items-center justify-between">
            <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>
              Настройки документа
            </DialogTitle>
          </div>
        </DialogHeader>
        <div className={cn(JOURNAL_DIALOG_BODY_CLASS, JOURNAL_DIALOG_FIELDS_CLASS)}>
          <DocumentDialogFeedback state={submit} onOpenChange={props.onOpenChange} />
          <FloatingInputField
            label="Название документа"
            value={state.title}
            onChange={(value) =>
              setState((current) => (current ? { ...current, title: value } : current))
            }
          />
          <PositionEmployeePicker
            users={props.users}
            value={{ positionTitle: state.cleaningRole, userId: state.cleaningUserId }}
            onChange={(next) =>
              setState((current) =>
                current
                  ? {
                      ...current,
                      cleaningRole: next.positionTitle,
                      cleaningUserId: next.userId,
                    }
                  : current
              )
            }
            positionLabel="Должность ответственного за уборку"
            employeeLabel={CLEANING_ROW_LABELS.cleaning}
            variant="floating"
          />
          <PositionEmployeePicker
            users={props.users}
            value={{ positionTitle: state.controlRole, userId: state.controlUserId }}
            onChange={(next) =>
              setState((current) =>
                current
                  ? {
                      ...current,
                      controlRole: next.positionTitle,
                      controlUserId: next.userId,
                    }
                  : current
              )
            }
            positionLabel="Должность ответственного за контроль"
            employeeLabel={CLEANING_ROW_LABELS.control}
            variant="floating"
          />
          <ControlPeriodicityField
            value={state.controlPeriodicity}
            onChange={(value) =>
              setState((current) =>
                current ? { ...current, controlPeriodicity: value } : current
              )
            }
          />
        </div>
        <div className={JOURNAL_DIALOG_FOOTER_CLASS}>
          <div className={JOURNAL_DIALOG_ACTIONS_CLASS}>
            <Button
              type="button"
              disabled={submitting}
              onClick={async () => {
                await submit.run(() => props.onSubmit(state));
              }}
              className={JOURNAL_DIALOG_SUBMIT_CLASS}
            >
              {submitting ? "Сохранение..." : "Сохранить"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CleaningDocumentsClient(props: Props) {
  const router = useRouter();
  // Создание / настройки / удаление документов API отдаёт только
  // руководителю — у остальных эти кнопки не показываем.
  const canManageDocuments = useCanManageDocuments();
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsDocument, setSettingsDocument] = useState<DocumentItem | null>(null);
  const [deleteDocument, setDeleteDocument] = useState<DocumentItem | null>(null);
  const [archiveDocument, setArchiveDocument] = useState<DocumentItem | null>(null);

  async function createDocument(state: CreateState) {
    const period = getCleaningCreatePeriodBounds();
    const baseConfig = defaultCleaningDocumentConfig(props.users);
    // Пользователь может выбрать конкретного сотрудника в диалоге;
    // если не выбрал — fallback на первого подходящего по должности.
    const cleaningUserId =
      state.cleaningUserId || pickFirstUserId(props.users, state.cleaningRole);
    const controlUserId =
      state.controlUserId || pickFirstUserId(props.users, state.controlRole);

    const nextConfig: CleaningDocumentConfig = normalizeCleaningDocumentConfig(
      {
        ...baseConfig,
        cleaningResponsibles: [
          {
            ...baseConfig.cleaningResponsibles[0],
            title: state.cleaningRole,
            userId: cleaningUserId,
            userName: getUserName(props.users, cleaningUserId),
          },
        ],
        controlResponsibles: [
          {
            ...baseConfig.controlResponsibles[0],
            title: state.controlRole,
            userId: controlUserId,
            userName: getUserName(props.users, controlUserId),
          },
        ],
      },
      { users: props.users }
    );

    const filledConfig = applyCleaningAutoFillToConfig({
      config: nextConfig,
      dateFrom: period.dateFrom,
      dateTo: period.dateTo,
    });

    const response = await fetch("/api/journal-documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateCode: CLEANING_DOCUMENT_TEMPLATE_CODE,
        title: state.title.trim() || CLEANING_DOCUMENT_TITLE,
        dateFrom: period.dateFrom,
        dateTo: period.dateTo,
        responsibleTitle: state.controlRole || null,
        responsibleUserId: controlUserId || null,
        config: filledConfig,
        controlPeriodicity: state.controlPeriodicity,
      }),
    });

    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.document?.id) {
      throw new Error(result?.error || "Не удалось создать документ");
    }

    router.push(`/journals/${props.routeCode}/documents/${result.document.id}`);
    router.refresh();
  }

  async function saveSettings(state: SettingsState) {
    if (!settingsDocument) return;

    const config = normalizeCleaningDocumentConfig(settingsDocument.config, {
      users: props.users,
    });

    const nextConfig = normalizeCleaningDocumentConfig(
      {
        ...config,
        cleaningResponsibles: [
          {
            ...(config.cleaningResponsibles[0] || {}),
            id: config.cleaningResponsibles[0]?.id || "cleaning-primary",
            kind: "cleaning",
            title: state.cleaningRole,
            userId: state.cleaningUserId,
            userName: getUserName(props.users, state.cleaningUserId),
            code: "С1",
          },
          ...config.cleaningResponsibles.slice(1),
        ],
        controlResponsibles: [
          {
            ...(config.controlResponsibles[0] || {}),
            id: config.controlResponsibles[0]?.id || "control-primary",
            kind: "control",
            title: state.controlRole,
            userId: state.controlUserId,
            userName: getUserName(props.users, state.controlUserId),
            code: "С1",
          },
          ...config.controlResponsibles.slice(1),
        ],
      },
      { users: props.users }
    );

    const response = await fetch(`/api/journal-documents/${settingsDocument.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: state.title.trim() || CLEANING_DOCUMENT_TITLE,
        responsibleTitle: state.controlRole || null,
        responsibleUserId: state.controlUserId || null,
        config: nextConfig,
        controlPeriodicity: state.controlPeriodicity,
      }),
    });

    if (!response.ok) {
      throw new Error("Не удалось сохранить документ");
    }

    setSettingsDocument(null);
    router.refresh();
  }

  async function deleteCurrentDocument() {
    if (!deleteDocument) return;
    const response = await fetch(`/api/journal-documents/${deleteDocument.id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      throw new Error("Не удалось удалить документ");
    }
    setDeleteDocument(null);
    router.refresh();
  }

  async function toggleDocumentStatus() {
    if (!archiveDocument) return;
    const nextStatus = archiveDocument.status === "active" ? "closed" : "active";
    const response = await fetch(`/api/journal-documents/${archiveDocument.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
    if (!response.ok) {
      throw new Error("Не удалось изменить статус документа");
    }
    setArchiveDocument(null);
    router.refresh();
  }

  return (
    <>
      <div className={JOURNAL_LIST_STACK_CLASS}>
        <div className={JOURNAL_LIST_HEADER_ROW_CLASS}>
          <h1 className={JOURNAL_LIST_TITLE_CLASS}>
            <JournalHeadingName fallback={CLEANING_PAGE_TITLE} />
          </h1>
          <JournalListActions
            templateCode="cleaning"
            canManage={canManageDocuments}
            create={
              // Пока документов нет, единственная точка входа — кнопка
              // внутри карточки пустого состояния (эталон).
              canManageDocuments && props.activeTab === "active" && props.documents.length > 0 ? (
                <Button type="button" onClick={() => setCreateOpen(true)} className={JOURNAL_ACTION_CREATE_CLASS}>
                  <Plus className="size-4" />
                  Создать документ
                </Button>
              ) : null
            }
          />
        </div>

        <JournalTabs activeTab={props.activeTab} templateCode={props.routeCode} />

        <div className={JOURNAL_LIST_CARDS_CLASS}>
          {props.documents.length === 0 ? (
            <EmptyDocumentsState
              action={
                <Button
                  type="button"
                  className={EMPTY_STATE_CREATE_BUTTON_CLASS}
                  onClick={() => setCreateOpen(true)}
                >
                  <Plus className="size-5" strokeWidth={2.5} />
                  Создать документ
                </Button>
              }
            />
          ) : null}

          {props.documents.map((document) => {
            const config = normalizeCleaningDocumentConfig(document.config, {
              users: props.users,
            });
            const cleaningLines = config.cleaningResponsibles
              .filter((item) => item.userName || (item.title && item.title !== "Ответственный за уборку"))
              .map((item) => `${item.title}: ${item.userName || "—"}`);
            if (cleaningLines.length === 0) cleaningLines.push("—");
            const controlLine =
              config.controlResponsibles[0] && (config.controlResponsibles[0].userName || (config.controlResponsibles[0].title && config.controlResponsibles[0].title !== "Ответственный за контроль"))
                ? `${config.controlResponsibles[0].title}: ${config.controlResponsibles[0].userName || "—"}`
                : "—";
            const href = `/journals/${props.routeCode}/documents/${document.id}`;

            return (
              <div
                key={document.id}
                className={JOURNAL_LIST_CARD_CLASS}
              >
                <Link href={href} className={`${JOURNAL_CARD_TITLE_CLASS} min-w-0`}>
                  {document.title || CLEANING_DOCUMENT_TITLE}
              <SharedDocumentBadge shared={document.shared} />
                </Link>
                <Link href={href} className={JOURNAL_CARD_SECTION_CLASS}>
                  <div className={JOURNAL_CARD_LABEL_CLASS}>{CLEANING_ROW_LABELS.cleaning}</div>
                  <div className={`${JOURNAL_CARD_VALUE_CLASS} space-y-1`}>
                    {cleaningLines.map((line) => (
                      <div key={line}>{line}</div>
                    ))}
                  </div>
                </Link>
                <Link href={href} className={JOURNAL_CARD_SECTION_CLASS}>
                  <div className={JOURNAL_CARD_LABEL_CLASS}>{CLEANING_ROW_LABELS.control}</div>
                  <div className={JOURNAL_CARD_VALUE_CLASS}>
                    {controlLine}
                  </div>
                </Link>
                <Link href={href} className={JOURNAL_CARD_SECTION_CLASS}>
                  <div className={JOURNAL_CARD_LABEL_CLASS}>Период</div>
                  <div className={JOURNAL_CARD_VALUE_CLASS}>
                    {getCleaningPeriodLabel(document.dateFrom, document.dateTo)}
                  </div>
                </Link>
                <div className="flex justify-start sm:justify-end">
                  <ResponsiveMenu
                    title="Действия с документом"
                    items={filterManageMenuItems([
                      {
                        key: "archive",
                        label: document.status === "active" ? "Закрыть" : "Восстановить",
                        icon:
                          document.status === "active" ? (
                            <Archive className="size-4 text-[#6f7282]" />
                          ) : (
                            <ArchiveRestore className="size-4 text-[#6f7282]" />
                          ),
                        onSelect: () => setArchiveDocument(document),
                      },
                      ...(document.status === "active"
                        ? [
                            {
                              key: "settings",
                              label: "Настройки",
                              icon: <Pencil className="size-4 text-[#6f7282]" />,
                              onSelect: () => setSettingsDocument(document),
                            },
                          ]
                        : []),
                      {
                        key: "print",
                        label: "Печать",
                        icon: <Printer className="size-4 text-[#6f7282]" />,
                        onSelect: () =>
                          window.open(
                            `/api/journal-documents/${document.id}/pdf`,
                            "_blank",
                            "noopener,noreferrer"
                          ),
                      },
                      ...(document.status === "active"
                        ? [
                            {
                              key: "delete",
                              label: "Удалить",
                              icon: <Trash2 className="size-4 text-[#6f7282]" />,
                              onSelect: () => setDeleteDocument(document),
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
      </div>

      <CreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        users={props.users}
        documents={props.documents}
        onSubmit={createDocument}
      />

      <SettingsDialog
        open={!!settingsDocument}
        onOpenChange={(open) => {
          if (!open) setSettingsDocument(null);
        }}
        users={props.users}
        initialState={settingsDocument ? buildSettingsState(settingsDocument, props.users) : null}
        onSubmit={saveSettings}
      />

      <ConfirmDialog
        open={!!archiveDocument}
        onOpenChange={(open) => {
          if (!open) setArchiveDocument(null);
        }}
        title={
          archiveDocument?.status === "active"
            ? `Закрыть документ "${archiveDocument?.title || CLEANING_DOCUMENT_TITLE}"`
            : `Восстановить документ "${archiveDocument?.title || CLEANING_DOCUMENT_TITLE}"`
        }
        submitLabel={archiveDocument?.status === "active" ? "Закрыть" : "Восстановить"}
        onSubmit={toggleDocumentStatus}
      />

      <ConfirmDialog
        open={!!deleteDocument}
        onOpenChange={(open) => {
          if (!open) setDeleteDocument(null);
        }}
        title={`Удаление документа "${deleteDocument?.title || CLEANING_DOCUMENT_TITLE}"`}
        submitLabel="Удалить"
        onSubmit={deleteCurrentDocument}
      />
    </>
  );
}
