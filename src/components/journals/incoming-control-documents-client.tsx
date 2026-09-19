"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Ellipsis, Plus, Printer, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  DateField,
  FloatingInputField,
  FloatingLabelField,
} from "@/components/journals/journal-dialog-field";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ResponsiveMenu } from "@/components/ui/responsive-menu";
import {
  ACCEPTANCE_DOCUMENT_TEMPLATE_CODE,
  getAcceptanceDocumentTitle,
  getAcceptancePageTitle,
  buildAcceptanceDocumentConfigFromData,
  normalizeAcceptanceDocumentConfig,
  type AcceptanceDocumentConfig,
} from "@/lib/acceptance-document";
import { getUserPositionLabel } from "@/lib/user-roles";
import { useJournalCreateDefaults } from "@/components/journals/journal-create-defaults";
import {
  EMPTY_STATE_CREATE_BUTTON_CLASS,
  EmptyDocumentsState,
  JournalTabs,
  JournalTopBar,
  filterManageMenuItems,
  restoreMenuItems,
  useRestoreDocument,
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
import { ControlPeriodicityField } from "@/components/journals/control-periodicity-field";
import {
  getDefaultControlPeriodicity,
  readControlPeriodicity,
} from "@/lib/control-periodicity";
import { localDayKey } from "@/lib/entry-defaults";
import { useAutoDocumentTitle } from "@/components/journals/use-auto-document-title";
import { SharedDocumentBadge } from "@/components/journals/shared-document-badge";

type User = { id: string; name: string; role: string };

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
  templateCode: string;
  documents: DocumentItem[];
  users: User[];
  availableProducts: string[];
  availableManufacturers: string[];
  availableSuppliers: string[];
};

type DialogState = {
  title: string;
  startDate: string;
  expiryFieldLabel: AcceptanceDocumentConfig["expiryFieldLabel"];
  responsibleTitle: string;
  responsibleUserId: string;
  controlPeriodicity: string;
  /**
   * Опциональная 12-я колонка «Соответствие внешнего вида упаковки,
   * маркировки требованиям НД» (I1 аудита) — тумблер «Добавить поля».
   */
  showPackagingCompliance: boolean;
};

function formatRuDate(value: string) {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}-${month}-${year}` : value;
}

function getDefaultDialogState(
  templateCode: string,
  users: User[],
  availableProducts: string[],
  availableManufacturers: string[],
  availableSuppliers: string[],
  /** Основной ответственный из «Ответственные за журналы» или null. */
  defaultResponsibleUserId: string | null
): DialogState {
  const config = buildAcceptanceDocumentConfigFromData({
    users,
    products: availableProducts,
    manufacturers: availableManufacturers,
    suppliers: availableSuppliers,
    date: localDayKey(),
  });

  return {
    // Название при создании подставляет диалог: имя журнала + период
    // (`useAutoDocumentTitle`, просьба владельца 2026-09-04).
    title: "",
    startDate: localDayKey(),
    expiryFieldLabel: config.expiryFieldLabel,
    // Предвыбор — только человек из «Ответственных за журналы». Первого
    // по списку не подставляем: сервер не отличил бы его от выбора.
    ...(() => {
      const preset = defaultResponsibleUserId
        ? users.find((user) => user.id === defaultResponsibleUserId) ?? null
        : null;
      return {
        responsibleTitle: preset ? getUserPositionLabel(preset) : "",
        responsibleUserId: preset?.id ?? "",
      };
    })(),
    controlPeriodicity: getDefaultControlPeriodicity(templateCode),
    showPackagingCompliance: config.showPackagingCompliance,
  };
}

function SettingsDialog({
  open,
  onOpenChange,
  title,
  submitLabel,
  initial,
  users,
  showExpiryLabelChoice,
  requireTitle,
  templateCode,
  journalName,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  submitLabel: string;
  initial: DialogState;
  users: User[];
  templateCode: string;
  journalName: string;
  /**
   * Выбор подписи колонки срока имеет смысл только для журнала входного
   * контроля СЫРЬЯ. В журнале приёмки продукции колонка называется
   * «Годен до» всегда — группу там не показываем (эталон
   * incoming_control-grid.png).
   */
  showExpiryLabelChoice: boolean;
  /**
   * Создание: название обязательно; подставляется автоматически из
   * имени журнала и периода (просьба владельца 2026-09-04), человек
   * может переписать.
   */
  requireTitle?: boolean;
  onSubmit: (value: DialogState) => Promise<void>;
}) {
  const [state, setState] = useState(initial);
  const [submitting, setSubmitting] = useState(false);
  const [titleError, setTitleError] = useState("");
  const auto = useAutoDocumentTitle({
    templateCode,
    journalName,
    period: { dateFrom: state.startDate },
    enabled: !!requireTitle,
  });

  // Колбэки хука стабильны (useCallback); сам объект — нет, поэтому в
  // deps идут именно они, иначе эффект сбрасывал бы форму на каждый ввод.
  const { reset: resetAutoTitle, seedTitle } = auto;

  useEffect(() => {
    if (!open) return;
    resetAutoTitle();
    setState({ ...initial, title: initial.title || seedTitle() });
    setSubmitting(false);
    setTitleError("");
  }, [initial, open, resetAutoTitle, seedTitle]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={JOURNAL_DIALOG_CONTENT_CLASS}>
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>{title}</DialogTitle>
        </DialogHeader>
        <div className={cn(JOURNAL_DIALOG_BODY_CLASS, JOURNAL_DIALOG_FIELDS_CLASS)}>
          <FloatingInputField
            label="Название документа"
            placeholder="Введите название документа"
            value={state.title}
            onChange={(value) => {
              auto.markTouched();
              setState({ ...state, title: value });
              if (titleError) setTitleError("");
            }}
            error={titleError || undefined}
          />
          <DateField
            label="Дата начала"
            value={state.startDate}
            onChange={(value) => {
              const next = auto.titleForPeriod({ dateFrom: value });
              setState((current) => ({
                ...current,
                startDate: value,
                ...(next !== null ? { title: next } : {}),
              }));
            }}
          />
          {showExpiryLabelChoice ? (
            <FloatingLabelField label="Колонка срока">
              <div className="flex flex-col gap-2 pt-1 text-[14px] text-[#0b1024]">
                <label className="flex items-center gap-2.5">
                  <input
                    type="radio"
                    name="incoming-control-expiry-label"
                    checked={state.expiryFieldLabel === "expiry_deadline"}
                    onChange={() => setState({ ...state, expiryFieldLabel: "expiry_deadline" })}
                    className="size-4 accent-[#5566f6]"
                  />
                  Предельный срок реализации
                </label>
                <label className="flex items-center gap-2.5">
                  <input
                    type="radio"
                    name="incoming-control-expiry-label"
                    checked={state.expiryFieldLabel === "shelf_life"}
                    onChange={() => setState({ ...state, expiryFieldLabel: "shelf_life" })}
                    className="size-4 accent-[#5566f6]"
                  />
                  Срок годности
                </label>
              </div>
            </FloatingLabelField>
          ) : null}
          {/* «Добавить поля» — тумблер опциональной 12-й колонки таблицы
              (I1 аудита); по умолчанию выключен, как на эталоне. */}
          <FloatingLabelField label="Добавить поля">
            <div className="flex items-start justify-between gap-4 pt-2">
              <div className="min-w-0 text-[14px] leading-[1.35] text-[#0b1024]">
                «Соответствие внешнего вида упаковки, маркировки требованиям НД»
              </div>
              <Switch
                checked={state.showPackagingCompliance}
                onCheckedChange={(value) =>
                  setState((current) => ({
                    ...current,
                    showPackagingCompliance: value === true,
                  }))
                }
                className="mt-0.5 shrink-0"
                aria-label="Соответствие внешнего вида упаковки, маркировки требованиям НД"
              />
            </div>
          </FloatingLabelField>
          <PositionEmployeePicker
            users={users}
            value={{
              positionTitle: state.responsibleTitle,
              userId: state.responsibleUserId,
            }}
            onChange={(next) =>
              setState((current) => ({
                ...current,
                responsibleTitle: next.positionTitle,
                responsibleUserId: next.userId,
              }))
            }
            positionLabel="Должность ответственного"
            employeeLabel="Ответственный"
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
                if (requireTitle && !state.title.trim()) {
                  setTitleError("Поле не заполнено");
                  return;
                }
                setTitleError("");
                setSubmitting(true);
                try {
                  await onSubmit(state);
                  onOpenChange(false);
                } finally {
                  setSubmitting(false);
                }
              }}
              className={JOURNAL_DIALOG_SUBMIT_CLASS}
            >
              {submitting ? "Сохранение..." : submitLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function IncomingControlDocumentsClient({
  activeTab,
  routeCode,
  templateCode,
  documents,
  users,
  availableProducts,
  availableManufacturers,
  availableSuppliers,
}: Props) {
  const router = useRouter();
  // Настройки / удаление документов API отдаёт только руководителю.
  const canManageDocuments = useCanManageDocuments();
  const restore = useRestoreDocument();
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsDocument, setSettingsDocument] = useState<DocumentItem | null>(null);
  // Единый источник delete / pdf для журнальных документов.
  const { deleteDocument, openPdf } = useJournalDocumentActions();
  const defaultDocumentTitle = getAcceptanceDocumentTitle(templateCode);
  const pageTitle = getAcceptancePageTitle(templateCode);
  const isProductAcceptance = templateCode === ACCEPTANCE_DOCUMENT_TEMPLATE_CODE;
  const createDefaults = useJournalCreateDefaults();
  const createState = useMemo(
    () =>
      getDefaultDialogState(
        templateCode,
        users,
        availableProducts,
        availableManufacturers,
        availableSuppliers,
        createDefaults.defaultResponsibleUserId
      ),
    [
      availableManufacturers,
      availableProducts,
      availableSuppliers,
      createDefaults.defaultResponsibleUserId,
      templateCode,
      users,
    ]
  );

  function buildConfigFromPayload(payload: DialogState, includeSampleRows = false) {
    return buildAcceptanceDocumentConfigFromData({
      users,
      products: availableProducts,
      manufacturers: availableManufacturers,
      suppliers: availableSuppliers,
      date: payload.startDate,
      responsibleTitle: payload.responsibleTitle,
      responsibleUserId: payload.responsibleUserId,
      includeSampleRows,
    });
  }

  async function createDocument(payload: DialogState) {
    // Человека не выбрали — не подставляем первого по роли или списку:
    // сервер возьмёт «Ответственных за журналы» или оставит «не назначен».
    const responsibleUserId = payload.responsibleUserId || "";
    const config = {
      // Без строк-образцов: новый документ реальной организации пустой.
      ...buildConfigFromPayload({ ...payload, responsibleUserId }, false),
      // В конфиг — только выбранный человек. Подставленного библиотекой
      // «по умолчанию» не шлём: сервер принял бы его за выбор, а должность
      // разошлась бы с человеком, которого назначат «Ответственные за журналы».
      defaultResponsibleUserId: responsibleUserId || null,
      defaultResponsibleTitle: payload.responsibleTitle || null,
      expiryFieldLabel: payload.expiryFieldLabel,
      showPackagingCompliance: payload.showPackagingCompliance,
    };
    const response = await fetch("/api/journal-documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateCode,
        title: payload.title.trim(),
        // Период — по правилу журнала (`journal-period.ts`), а не «один день».
        ...resolveJournalPeriodForDate(templateCode, payload.startDate),
        responsibleTitle: payload.responsibleTitle,
        responsibleUserId,
        config,
        controlPeriodicity: payload.controlPeriodicity,
      }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.document?.id) {
      throw new Error(result?.error || "Не удалось создать документ");
    }
    router.push(`/journals/${routeCode}/documents/${result.document.id}`);
    router.refresh();
  }

  async function saveSettings(document: DocumentItem, payload: DialogState) {
    const current = normalizeAcceptanceDocumentConfig(document.config, users);
    const response = await fetch(`/api/journal-documents/${document.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: payload.title.trim() || defaultDocumentTitle,
        dateFrom: payload.startDate,
        responsibleTitle: payload.responsibleTitle,
        responsibleUserId: payload.responsibleUserId || null,
        config: {
          ...current,
          expiryFieldLabel: payload.expiryFieldLabel,
          showPackagingCompliance: payload.showPackagingCompliance,
          defaultResponsibleTitle: payload.responsibleTitle || null,
          defaultResponsibleUserId: payload.responsibleUserId || null,
        },
        controlPeriodicity: payload.controlPeriodicity,
      }),
    });
    if (!response.ok) {
      throw new Error("Не удалось сохранить документ");
    }
    router.refresh();
  }

  async function handleDelete(document: DocumentItem) {
    const config = normalizeAcceptanceDocumentConfig(document.config, users);
    const docTitle = document.title || defaultDocumentTitle;
    await deleteDocument({
      documentId: document.id,
      description: `Документ «${docTitle}» будет удалён безвозвратно.`,
      bullets: [
        { label: `Записей о приёмке: ${config.rows.length}`, tone: "warn" },
        {
          label: `Позиций в справочниках документа: ${config.products.length + config.manufacturers.length + config.suppliers.length}`,
          tone: "info",
        },
        { label: `Журнал начат: ${formatRuDate(document.dateFrom)}`, tone: "info" },
      ],
      successMessage: `Документ «${docTitle}» удалён`,
      errorMessage: "Не удалось удалить документ",
    });
  }

  const heading =
    activeTab === "closed" && routeCode === "incoming_control"
      ? `${pageTitle} (закрытые)`
      : pageTitle;

  return (
    <>
      <div className={JOURNAL_LIST_STACK_CLASS}>
        <JournalTopBar
        routeCode={routeCode}
          heading={heading}
          activeTab={activeTab}
          templateCode={templateCode}
          templateName={pageTitle}
          users={users}
          documentCount={documents.length}
          createSlot={
            <Button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="h-10 w-full rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] font-medium text-white transition-colors hover:bg-[#4a5bf0] sm:w-auto"
            >
              <Plus className="size-4" />
              Создать документ
            </Button>
          }
        />

        <JournalTabs activeTab={activeTab} templateCode={routeCode} />

        <div className={JOURNAL_LIST_CARDS_CLASS}>
          {documents.length === 0 && (
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
          )}
          {documents.map((document) => {
            const config = normalizeAcceptanceDocumentConfig(document.config, users);
            const responsibleUser = users.find(
              (user) => user.id === config.defaultResponsibleUserId
            );
            return (
              <div
                key={document.id}
                className={JOURNAL_LIST_CARD_CLASS}
              >
                <Link
                  href={`/journals/${routeCode}/documents/${document.id}`}
                  className={JOURNAL_CARD_TITLE_CLASS}
                >
                  {document.title || defaultDocumentTitle}
              <SharedDocumentBadge shared={document.shared} />
                </Link>
                <Link
                  href={`/journals/${routeCode}/documents/${document.id}`}
                  className={JOURNAL_CARD_SECTION_CLASS}
                >
                  <div className={JOURNAL_CARD_LABEL_CLASS}>Ответственный</div>
                  <div className={JOURNAL_CARD_VALUE_CLASS}>
                    {(config.defaultResponsibleTitle || "Управляющий") +
                      (responsibleUser?.name ? `: ${responsibleUser.name}` : "")}
                  </div>
                </Link>
                <Link
                  href={`/journals/${routeCode}/documents/${document.id}`}
                  className={JOURNAL_CARD_SECTION_CLASS}
                >
                  <div className={JOURNAL_CARD_LABEL_CLASS}>Дата начала</div>
                  <div className={JOURNAL_CARD_VALUE_CLASS}>
                    {formatRuDate(document.dateFrom)}
                  </div>
                </Link>
                <div className="justify-self-end">
                  <ResponsiveMenu
                    title="Действия с документом"
                    contentClassName="w-[280px] rounded-[24px] border-0 p-4 shadow-xl"
                    items={filterManageMenuItems([
                      ...(document.status === "active"
                        ? [
                            {
                              key: "settings",
                              label: "Настройки",
                              onSelect: () => setSettingsDocument(document),
                            },
                          ]
                        : []),
                      {
                        key: "print",
                        label: "Печать",
                        icon: <Printer className="size-4 text-[#6f7282]" />,
                        onSelect: () => openPdf({ documentId: document.id }),
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
                              onSelect: () => void handleDelete(document),
                              tone: "danger" as const,
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

      <SettingsDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Создание документа"
        submitLabel="Создать"
        initial={createState}
        users={users}
        showExpiryLabelChoice={!isProductAcceptance}
        requireTitle
        templateCode={templateCode}
        journalName={defaultDocumentTitle}
        onSubmit={createDocument}
      />

      <SettingsDialog
        open={!!settingsDocument}
        onOpenChange={(open) => {
          if (!open) setSettingsDocument(null);
        }}
        title="Настройки журнала"
        submitLabel="Сохранить"
        initial={
          settingsDocument
            ? {
                title: settingsDocument.title || defaultDocumentTitle,
                startDate: settingsDocument.dateFrom,
                ...(() => {
                  const config = normalizeAcceptanceDocumentConfig(settingsDocument.config, users);
                  return {
                    expiryFieldLabel: config.expiryFieldLabel,
                    responsibleTitle: config.defaultResponsibleTitle || "",
                    responsibleUserId: config.defaultResponsibleUserId || "",
                    controlPeriodicity: readControlPeriodicity(
                      settingsDocument.config,
                      templateCode
                    ),
                    showPackagingCompliance: config.showPackagingCompliance,
                  };
                })(),
              }
            : createState
        }
        users={users}
        showExpiryLabelChoice={!isProductAcceptance}
        templateCode={templateCode}
        journalName={defaultDocumentTitle}
        onSubmit={async (value) => {
          if (!settingsDocument) return;
          await saveSettings(settingsDocument, value);
        }}
      />

    </>
  );
}
