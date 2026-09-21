"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpenText,
  Copy,
  Ellipsis,
  Pencil,
  Plus,
  Printer,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DateField,
  FloatingInputField,
  FloatingLabelField,
} from "@/components/journals/journal-dialog-field";
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
  SANITATION_DAY_DOCUMENT_TITLE,
  SANITATION_DAY_HEADING,
  SANITATION_DAY_TEMPLATE_CODE,
  getSanitationApproveLabel,
  getSanitationDayDefaultConfig,
  getSanitationDocumentDateLabel,
  getSanitationYearLabel,
  normalizeSanitationDayConfig,
  type SanitationDayConfig,
} from "@/lib/sanitation-day-document";

import { toast } from "sonner";
import { buildDocumentCopy } from "@/lib/journal-document-copy";
import {
  EMPTY_STATE_CREATE_BUTTON_CLASS,
  EmptyDocumentsState,
  JournalTabs,
  JournalTopBar,
  deletedRecordsBullet,
  filterManageMenuItems,
  useCanManageDocuments,
} from "@/components/journals/document-list-ui";
import { resolveJournalPeriodForDate } from "@/lib/journal-period";
import { useJournalDocumentActions } from "@/components/journals/use-journal-document-actions";
import {
  JOURNAL_CARD_LABEL_CLASS,
  JOURNAL_CARD_SECTION_CLASS,
  JOURNAL_CARD_TITLE_CLASS,
  JOURNAL_CARD_VALUE_CLASS,
  JOURNAL_DIALOG_ACTIONS_CLASS,
  JOURNAL_DIALOG_BODY_CLASS,
  JOURNAL_DIALOG_CONTENT_CLASS,
  JOURNAL_DIALOG_FIELD_TRIGGER_CLASS,
  JOURNAL_DIALOG_FIELDS_CLASS,
  JOURNAL_DIALOG_FOOTER_CLASS,
  JOURNAL_DIALOG_HEADER_CLASS,
  JOURNAL_DIALOG_SUBMIT_CLASS,
  JOURNAL_DIALOG_TITLE_CLASS,
  JOURNAL_LIST_STACK_CLASS,
  JOURNAL_LIST_CARDS_CLASS,
  JOURNAL_LIST_CARD_CLASS,
} from "@/components/journals/journal-responsive";
import { PositionEmployeePicker } from "@/components/shared/position-select";
import { CreateDocumentEmptyState } from "@/components/journals/create-document-empty-state";
import { ControlPeriodicityField } from "@/components/journals/control-periodicity-field";
import {
  getDefaultControlPeriodicity,
  readControlPeriodicity,
} from "@/lib/control-periodicity";
import { localDayKey } from "@/lib/entry-defaults";
import { useAutoDocumentTitle } from "@/components/journals/use-auto-document-title";
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

type SanitationDocumentItem = {
  id: string;
  title: string;
  /** Точки: документ без точки рядом с документами точек. */
  shared?: boolean;
  status: "active" | "closed";
  dateFrom: string;
  dateTo: string;
  config: unknown;
};

type Props = {
  routeCode: string;
  templateCode: string;
  activeTab: "active" | "closed";
  users: UserItem[];
  documents: SanitationDocumentItem[];
};

type SettingsState = {
  title: string;
  documentDate: string;
  year: string;
  approveRole: string;
  approveEmployeeId: string;
  approveEmployee: string;
  responsibleRole: string;
  responsibleEmployeeId: string;
  responsibleEmployee: string;
  controlPeriodicity: string;
};

function toIsoDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    return localDayKey();
  return date.toISOString().slice(0, 10);
}

function toUiState(document: SanitationDocumentItem): SettingsState {
  const normalized = normalizeSanitationDayConfig(document.config);
  return {
    title: document.title || SANITATION_DAY_DOCUMENT_TITLE,
    documentDate: normalized.documentDate,
    year: String(normalized.year),
    approveRole: normalized.approveRole,
    approveEmployeeId: normalized.approveEmployeeId || "",
    approveEmployee: normalized.approveEmployee,
    responsibleRole: normalized.responsibleRole,
    responsibleEmployeeId: normalized.responsibleEmployeeId || "",
    responsibleEmployee: normalized.responsibleEmployee,
    controlPeriodicity: readControlPeriodicity(
      document.config,
      SANITATION_DAY_TEMPLATE_CODE
    ),
  };
}

function SettingsDialog(props: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  mode: "create" | "edit";
  users: UserItem[];
  initial: SettingsState | null;
  onSubmit: (value: SettingsState) => Promise<void>;
  submitText: string;
  title: string;
  /** Онбординг-гейт: только для диалога создания документа. */
  showEmptyState?: boolean;
}) {
  const [state, setState] = useState<SettingsState | null>(null);
  // Окно закрывается только при успехе, ошибка сервера видна здесь же.
  const submit = useDocumentDialogSubmit({ onOpenChange: props.onOpenChange });
  const submitting = submit.submitting;

  const activeState = state || props.initial;
  const auto = useAutoDocumentTitle({
    templateCode: SANITATION_DAY_TEMPLATE_CODE,
    journalName: SANITATION_DAY_DOCUMENT_TITLE,
    period: { dateFrom: activeState?.documentDate, year: activeState?.year },
    enabled: props.mode === "create",
  });
  const { reset: resetAutoTitle, titleForPeriod } = auto;
  const { initial, open, mode } = props;

  // Reset-on-open lives in an effect: Radix `onOpenChange` does not fire
  // for the programmatic `setCreateOpen(true)`, so seeding there is skipped.
  useEffect(() => {
    if (!open) return;
    resetAutoTitle();
    const seeded =
      initial && mode === "create"
        ? titleForPeriod({ dateFrom: initial.documentDate, year: initial.year })
        : null;
    setState(initial ? { ...initial, title: seeded || initial.title } : null);
  }, [initial, mode, open, resetAutoTitle, titleForPeriod]);

  async function handleSubmit() {
    if (!activeState) return;
    await submit.run(() => props.onSubmit(activeState));
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
    >
      <DialogContent className={JOURNAL_DIALOG_CONTENT_CLASS}>
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <div className="flex items-center justify-between">
            <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>
              {props.title}
            </DialogTitle>
          </div>
        </DialogHeader>

        {props.showEmptyState && props.users.length === 0 ? (
          <div className="px-6 py-5">
            <CreateDocumentEmptyState onNavigate={() => props.onOpenChange(false)} />
          </div>
        ) : activeState ? (
          <>
          <div className={cn(JOURNAL_DIALOG_BODY_CLASS, JOURNAL_DIALOG_FIELDS_CLASS)}>
            <DocumentDialogFeedback state={submit} onOpenChange={props.onOpenChange} />
            <FloatingInputField
              label="Название документа"
              value={activeState.title}
              onChange={(value) => {
                auto.markTouched();
                setState({ ...activeState, title: value });
              }}
            />

            <DateField
              label="Дата начала"
              value={activeState.documentDate}
              onChange={(value) => {
                const documentDate = toIsoDate(value);
                const next = auto.titleForPeriod({
                  dateFrom: documentDate,
                  year: activeState.year,
                });
                setState({
                  ...activeState,
                  documentDate,
                  ...(next !== null ? { title: next } : {}),
                });
              }}
            />

            <FloatingLabelField label="Год">
              <Select
                value={activeState.year}
                onValueChange={(value) => {
                  const next = auto.titleForPeriod({
                    dateFrom: activeState.documentDate,
                    year: value,
                  });
                  setState({
                    ...activeState,
                    year: value,
                    ...(next !== null ? { title: next } : {}),
                  });
                }}
              >
                <SelectTrigger className={JOURNAL_DIALOG_FIELD_TRIGGER_CLASS}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 8 }).map((_, idx) => {
                    const year = String(new Date().getFullYear() - 2 + idx);
                    return (
                      <SelectItem key={year} value={year}>
                        {year}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </FloatingLabelField>

            <PositionEmployeePicker
              users={props.users}
              value={{
                positionTitle: activeState.approveRole,
                userId: activeState.approveEmployeeId,
              }}
              onChange={(next) =>
                setState({
                  ...activeState,
                  approveRole: next.positionTitle,
                  approveEmployeeId: next.userId,
                  approveEmployee:
                    props.users.find((item) => item.id === next.userId)?.name || "",
                })
              }
              positionLabel={'Должность «Утверждаю»'}
              employeeLabel={'Утверждающий'}
              variant="floating"
            />

            <PositionEmployeePicker
              users={props.users}
              value={{
                positionTitle: activeState.responsibleRole,
                userId: activeState.responsibleEmployeeId,
              }}
              onChange={(next) =>
                setState({
                  ...activeState,
                  responsibleRole: next.positionTitle,
                  responsibleEmployeeId: next.userId,
                  responsibleEmployee:
                    props.users.find((item) => item.id === next.userId)?.name || "",
                })
              }
              positionLabel="Должность ответственного"
              employeeLabel="Ответственный"
              variant="floating"
            />

            <ControlPeriodicityField
              value={activeState.controlPeriodicity}
              onChange={(value) =>
                setState({ ...activeState, controlPeriodicity: value })
              }
            />
          </div>

          <div className={JOURNAL_DIALOG_FOOTER_CLASS}>
            <div className={JOURNAL_DIALOG_ACTIONS_CLASS}>
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className={JOURNAL_DIALOG_SUBMIT_CLASS}
              >
                {submitting ? "Сохранение..." : props.submitText}
              </Button>
            </div>
          </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function SanitationDayDocumentsClient({
  routeCode,
  templateCode,
  activeTab,
  users,
  documents,
}: Props) {
  const router = useRouter();
  // Настройки / удаление документов API отдаёт только руководителю.
  const canManageDocuments = useCanManageDocuments();
  const [settingsTarget, setSettingsTarget] =
    useState<SanitationDocumentItem | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const { deleteDocument, setStatus, openPdf } = useJournalDocumentActions();

  async function createDocument(payload: SettingsState) {
    const config = {
      ...getSanitationDayDefaultConfig(
        new Date(`${payload.year}-01-01T00:00:00Z`),
      ),
      year: Number(payload.year),
      documentDate: payload.documentDate,
      approveRole: payload.approveRole,
      approveEmployeeId: payload.approveEmployeeId || null,
      approveEmployee: payload.approveEmployee,
      responsibleRole: payload.responsibleRole,
      responsibleEmployeeId: payload.responsibleEmployeeId || null,
      responsibleEmployee: payload.responsibleEmployee,
      // 2026-09-04: строки сидирует сервер из справочника помещений
      // (Room); пустой список = «взять помещения организации».
      rows: [],
    } as SanitationDayConfig;

    const response = await fetch("/api/journal-documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateCode,
        title: payload.title.trim() || SANITATION_DAY_DOCUMENT_TITLE,
        // Период — по правилу журнала (`journal-period.ts`): график
        // генуборок годовой. «Дата документа» остаётся в шапке.
        ...resolveJournalPeriodForDate(templateCode, payload.documentDate),
        responsibleTitle: payload.responsibleRole,
        config,
        controlPeriodicity: payload.controlPeriodicity,
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

    const currentConfig = normalizeSanitationDayConfig(current.config);
    const config: SanitationDayConfig = {
      ...currentConfig,
      year: Number(payload.year),
      documentDate: payload.documentDate,
      approveRole: payload.approveRole,
      approveEmployeeId: payload.approveEmployeeId || null,
      approveEmployee: payload.approveEmployee,
      responsibleRole: payload.responsibleRole,
      responsibleEmployeeId: payload.responsibleEmployeeId || null,
      responsibleEmployee: payload.responsibleEmployee,
    };

    const response = await fetch(`/api/journal-documents/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: payload.title.trim() || SANITATION_DAY_DOCUMENT_TITLE,
        dateFrom: payload.documentDate,
        dateTo: payload.documentDate,
        responsibleTitle: payload.responsibleRole,
        config,
        controlPeriodicity: payload.controlPeriodicity,
      }),
    });

    if (!response.ok) {
      const failure = await response.json().catch(() => null);
      throw new Error(failure?.error || "Не удалось сохранить настройки");
    }

    router.refresh();
  }

  async function handleDelete(document: SanitationDocumentItem) {
    const cfg = normalizeSanitationDayConfig(document.config);
    await deleteDocument({
      documentId: document.id,
      description: `Документ «${document.title || SANITATION_DAY_DOCUMENT_TITLE}» будет удалён безвозвратно.`,
      bullets: [
        { label: `Дата документа: ${getSanitationDocumentDateLabel(cfg.documentDate)}`, tone: "info" },
        // Сколько записей пропадёт — раньше окно про объём потери молчало.
        ...(deletedRecordsBullet(document.config) ? [deletedRecordsBullet(document.config)!] : []),
        { label: "Удалятся все строки и отметки санитарного дня", tone: "warn" },
      ],
      successMessage: `Документ «${document.title || SANITATION_DAY_DOCUMENT_TITLE}» удалён`,
      errorMessage: "Не удалось удалить документ",
    });
  }

  async function cloneDocument(documentId: string) {
    const current = documents.find((item) => item.id === documentId);
    if (!current) return;

    // Копия — график на следующий год: состав помещений и ПЛАН по
    // месяцам переносятся, ФАКТ («убрано такого-то числа») обнуляется
    // (`buildDocumentCopy`). Раньше новый график рождался выполненным,
    // да ещё и на период источника — сервер отказывал его создавать.
    const cfg = normalizeSanitationDayConfig(current.config);
    const copy = buildDocumentCopy({
      templateCode,
      journalName: SANITATION_DAY_DOCUMENT_TITLE,
      sourceConfig: cfg,
      sourcePeriod: { dateFrom: current.dateFrom, dateTo: current.dateFrom },
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
        responsibleTitle: cfg.responsibleRole,
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

  const defaultCreateState = useMemo<SettingsState>(() => {
    const cfg = getSanitationDayDefaultConfig();
    return {
      title: SANITATION_DAY_DOCUMENT_TITLE,
      documentDate: cfg.documentDate,
      year: String(cfg.year),
      approveRole: cfg.approveRole,
      approveEmployeeId: cfg.approveEmployeeId || "",
      approveEmployee: cfg.approveEmployee,
      responsibleRole: cfg.responsibleRole,
      responsibleEmployeeId: cfg.responsibleEmployeeId || "",
      responsibleEmployee: cfg.responsibleEmployee,
      controlPeriodicity: getDefaultControlPeriodicity(SANITATION_DAY_TEMPLATE_CODE),
    };
  }, []);
  const settingsInitialState = useMemo(
    () => (settingsTarget ? toUiState(settingsTarget) : null),
    [settingsTarget]
  );

  return (
    <div className={JOURNAL_LIST_STACK_CLASS}>
      <JournalTopBar
        routeCode={routeCode}
        heading={`${SANITATION_DAY_HEADING}${activeTab === "closed" ? " (закрытые)" : ""}`}
        activeTab={activeTab}
        templateCode={templateCode}
        templateName={SANITATION_DAY_HEADING}
        users={users}
        documentCount={documents.length}
        createSlot={
          <Button
            className="h-10 w-full rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] font-medium text-white transition-colors hover:bg-[#4a5bf0] sm:w-auto"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="size-4" />
            Создать документ
          </Button>
        }
      />

      <JournalTabs activeTab={activeTab} templateCode={routeCode} />

      <div className={JOURNAL_LIST_CARDS_CLASS}>
        {documents.length === 0 ? (
          <EmptyDocumentsState
            action={<Button
              type="button"
              className={EMPTY_STATE_CREATE_BUTTON_CLASS}
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="size-5" strokeWidth={2.5} />
              Создать документ
            </Button>}
          />
        ) : null}

        {documents.map((document) => {
          const cfg = normalizeSanitationDayConfig(document.config);
          const href = `/journals/${routeCode}/documents/${document.id}`;

          return (
            <div
              key={document.id}
              className={JOURNAL_LIST_CARD_CLASS}
            >
              <Link
                href={href}
                className={JOURNAL_CARD_TITLE_CLASS}
              >
                {document.title || SANITATION_DAY_DOCUMENT_TITLE}
              <SharedDocumentBadge shared={document.shared} />
              </Link>

              <Link
                href={href}
                className={JOURNAL_CARD_SECTION_CLASS}
              >
                <div className={JOURNAL_CARD_LABEL_CLASS}>Год</div>
                <div className={JOURNAL_CARD_VALUE_CLASS}>
                  {getSanitationYearLabel(cfg.year)}
                </div>
              </Link>

              <Link
                href={href}
                className={JOURNAL_CARD_SECTION_CLASS}
              >
                <div className={JOURNAL_CARD_LABEL_CLASS}>
                  Должность &quot;Утверждаю&quot;
                </div>
                <div className={JOURNAL_CARD_VALUE_CLASS}>
                  {getSanitationApproveLabel(
                    cfg.approveRole,
                    cfg.approveEmployee,
                  )}
                </div>
              </Link>

              <Link
                href={href}
                className={JOURNAL_CARD_SECTION_CLASS}
              >
                <div className={JOURNAL_CARD_LABEL_CLASS}>Ответственный</div>
                <div className={JOURNAL_CARD_VALUE_CLASS}>
                  {getSanitationApproveLabel(
                    cfg.responsibleRole,
                    cfg.responsibleEmployee,
                  )}
                </div>
              </Link>

              <Link
                href={href}
                className={JOURNAL_CARD_SECTION_CLASS}
              >
                <div className={JOURNAL_CARD_LABEL_CLASS}>Дата документа</div>
                <div className={JOURNAL_CARD_VALUE_CLASS}>
                  {getSanitationDocumentDateLabel(cfg.documentDate)}
                </div>
              </Link>

              <div className="flex items-center justify-start text-[#5566f6] sm:justify-center">
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
                          {
                            key: "clone",
                            label: "Сделать копию",
                            icon: <Copy className="size-4 text-[#6f7282]" />,
                            onSelect: () => cloneDocument(document.id),
                          },
                        ]
                      : []),
                    {
                      key: "print",
                      label: "Печать",
                      icon: <Printer className="size-4 text-[#6f7282]" />,
                      onSelect: () => openPdf({ documentId: document.id }),
                    },
                    ...(document.status === "closed"
                      ? [
                          {
                            key: "activate",
                            label: "Отправить в активные",
                            icon: <BookOpenText className="size-4 text-[#6f7282]" />,
                            onSelect: () => setStatus("active", { documentId: document.id }),
                          },
                        ]
                      : [
                          {
                            key: "archive",
                            label: "Отправить в закрытые",
                            icon: <BookOpenText className="size-4 text-[#6f7282]" />,
                            onSelect: () => setStatus("closed", { documentId: document.id }),
                          },
                          {
                            key: "delete",
                            label: "Удалить",
                            icon: <Trash2 className="size-4 text-[#ff3b30]" />,
                            onSelect: () => handleDelete(document),
                            tone: "danger" as const,
                          },
                        ]),
                  ], canManageDocuments)}
                  trigger={
                    <button
                      type="button"
                      className="flex size-10 items-center justify-center rounded-full hover:bg-[#f5f6ff]"
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

      <SettingsDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        users={users}
        initial={defaultCreateState}
        onSubmit={createDocument}
        submitText="Создать"
        title="Создание документа"
        showEmptyState
      />

      <SettingsDialog
        open={!!settingsTarget}
        onOpenChange={(value) => {
          if (!value) setSettingsTarget(null);
        }}
        mode="edit"
        users={users}
        initial={settingsInitialState}
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
