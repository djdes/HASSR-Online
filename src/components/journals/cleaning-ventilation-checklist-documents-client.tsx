"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  Ellipsis,
  Plus,
  Printer,
  Settings2,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ResponsiveMenu } from "@/components/ui/responsive-menu";
import {
  CLEANING_VENTILATION_CHECKLIST_TITLE,
  getDefaultCleaningVentilationConfig,
} from "@/lib/cleaning-ventilation-checklist-document";

import {
  EMPTY_STATE_CREATE_BUTTON_CLASS,
  EmptyDocumentsState,
  JournalTabs,
  JournalTopBar,
  filterManageMenuItems,
  useCanManageDocuments,
} from "@/components/journals/document-list-ui";
import { resolveJournalPeriodForDate } from "@/lib/journal-period";
import { useJournalDocumentActions } from "@/components/journals/use-journal-document-actions";
import {
  DateField,
  FloatingInputField,
} from "@/components/journals/journal-dialog-field";
import { ControlPeriodicityField } from "@/components/journals/control-periodicity-field";
import {
  getDefaultControlPeriodicity,
  readControlPeriodicity,
} from "@/lib/control-periodicity";
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
  JOURNAL_LIST_CARD_CLASS,
  JOURNAL_LIST_STACK_CLASS,
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
type DocumentItem = {
  id: string;
  title: string;
  /** Точки: документ без точки рядом с документами точек. */
  shared?: boolean;
  status: "active" | "closed";
  dateFrom: string;
  config?: Record<string, unknown> | null;
};

type UserItem = {
  id: string;
  name: string;
  role: string;
};

type Props = {
  activeTab: "active" | "closed";
  routeCode: string;
  templateCode: string;
  users: UserItem[];
  documents: DocumentItem[];
};

type SettingsState = {
  title: string;
  dateFrom: string;
  controlPeriodicity: string;
  /**
   * Процедура «Проветривание» в составе чек-листа (V3 аудита). Тумблер
   * пишет в `config.ventilationEnabled`, который уже управляет строкой
   * периодичности, колонкой процедуры и печатью (см.
   * `cleaning-ventilation-checklist-document.ts` / `-pdf.ts`).
   */
  ventilationEnabled: boolean;
};

function getDefaultDate() {
  return localDayKey();
}

function formatDateLabel(isoDate: string) {
  // Единый вид даты на экране — «дд.мм.гггг» (src/lib/journal-card-date.ts).
  // Раньше тут было «ДД-ММ-ГГГГ», а у дезинсекции и акта забраковки —
  // «ДД.ММ.ГГГГ»: три разных написания одной и той же вещи в одном заходе.
  if (!isoDate) return "—";
  return formatJournalDate(isoDate) || isoDate;
}

/**
 * «Должность: ФИО» главного ответственного документа для карточки списка.
 * `config` приходит уже нормализованным со страницы, поэтому читаем поля
 * напрямую; если должности/сотрудника нет (старый документ) — прочерк.
 */
function getMainResponsibleLabel(document: DocumentItem, users: UserItem[]) {
  const config = document.config ?? null;
  const title =
    typeof config?.mainResponsibleTitle === "string" ? config.mainResponsibleTitle.trim() : "";
  const userId =
    typeof config?.mainResponsibleUserId === "string" ? config.mainResponsibleUserId : "";
  const name = users.find((user) => user.id === userId)?.name?.trim() || "";

  if (title && name) return `${title}: ${name}`;
  return title || name || "—";
}

function SettingsDialog(props: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  initial: SettingsState | null;
  onSubmit: (value: SettingsState) => Promise<void>;
  submitText: string;
  title: string;
  /**
   * Создание: название обязательно; подставляется автоматически из
   * имени журнала и периода (просьба владельца 2026-09-04), человек
   * может переписать.
   */
  requireTitle?: boolean;
  templateCode: string;
}) {
  const [state, setState] = useState<SettingsState | null>(null);
  // Окно закрывается только при успехе, ошибка сервера видна здесь же.
  const submit = useDocumentDialogSubmit({ onOpenChange: props.onOpenChange });
  const submitting = submit.submitting;
  const [titleError, setTitleError] = useState("");
  const auto = useAutoDocumentTitle({
    templateCode: props.templateCode,
    journalName: CLEANING_VENTILATION_CHECKLIST_TITLE,
    period: { dateFrom: (state || props.initial)?.dateFrom },
    enabled: !!props.requireTitle,
  });
  // Диалог открывается кнопкой снаружи (Radix не зовёт onOpenChange(true)),
  // поэтому автоназвание подставляем и в fallback «состояния ещё нет».
  const activeState =
    state ||
    (props.initial
      ? { ...props.initial, title: props.initial.title || auto.seedTitle() }
      : null);

  return (
    <Dialog
      open={props.open}
      onOpenChange={(value) => {
        auto.reset();
        if (value) {
          setState(activeState);
          setTitleError("");
        } else {
          // Сброс на закрытии — следующее открытие снова от `initial`.
          setState(null);
        }
        props.onOpenChange(value);
      }}
    >
      <DialogContent className={JOURNAL_DIALOG_CONTENT_CLASS}>
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <div className="flex items-center justify-between">
            <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>
              {props.title}
            </DialogTitle>
          </div>
        </DialogHeader>
        {activeState ? (
          <div className={cn(JOURNAL_DIALOG_BODY_CLASS, JOURNAL_DIALOG_FIELDS_CLASS)}>
            <DocumentDialogFeedback state={submit} onOpenChange={props.onOpenChange} />
            <FloatingInputField
              label="Название документа"
              placeholder="Введите название документа"
              value={activeState.title}
              onChange={(value) => {
                auto.markTouched();
                setState({ ...activeState, title: value });
                if (titleError) setTitleError("");
              }}
              error={titleError || undefined}
            />
            {/* «Дата начала» — так же, как называется колонка карточки в
                списке документов (V8 аудита); «Дата проведения» была
                единственным местом со своей формулировкой. */}
            <DateField
              label="Дата начала"
              value={activeState.dateFrom}
              onChange={(value) => {
                const next = auto.titleForPeriod({ dateFrom: value });
                setState({
                  ...activeState,
                  dateFrom: value,
                  ...(next !== null ? { title: next } : {}),
                });
              }}
            />
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[14px] leading-[1.35] text-[#0b1024]">
                  Проветривание
                </div>
                <div className="mt-1 text-[12px] leading-[1.35] text-[#8a8fa3]">
                  Если у вас есть окна и возможность проветривать помещение
                </div>
              </div>
              <Switch
                checked={activeState.ventilationEnabled}
                onCheckedChange={(value) =>
                  setState({ ...activeState, ventilationEnabled: value === true })
                }
                className="mt-0.5 shrink-0"
                aria-label="Проветривание"
              />
            </div>
            <ControlPeriodicityField
              value={activeState.controlPeriodicity}
              onChange={(value) =>
                setState({ ...activeState, controlPeriodicity: value })
              }
            />
          </div>
        ) : null}
        {activeState ? (
          <div className={JOURNAL_DIALOG_FOOTER_CLASS}>
            <div className={JOURNAL_DIALOG_ACTIONS_CLASS}>
              <Button
                type="button"
                onClick={async () => {
                  if (!activeState) return;
                  if (props.requireTitle && !activeState.title.trim()) {
                    setTitleError("Поле не заполнено");
                    return;
                  }
                  setTitleError("");
                  await submit.run(() => props.onSubmit(activeState));
                }}
                disabled={submitting}
                className={JOURNAL_DIALOG_SUBMIT_CLASS}
              >
                {submitting ? "Сохранение..." : props.submitText}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function CleaningVentilationChecklistDocumentsClient({
  routeCode,
  templateCode,
  activeTab,
  users,
  documents,
}: Props) {
  const router = useRouter();
  // Настройки / удаление документов API отдаёт только руководителю.
  const canManageDocuments = useCanManageDocuments();
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsTarget, setSettingsTarget] = useState<DocumentItem | null>(null);
  const { deleteDocument, setStatus, openPdf } = useJournalDocumentActions();

  const createInitial = useMemo<SettingsState>(
    () => ({
      // Название при создании подставляет диалог: имя журнала + период
      // (`useAutoDocumentTitle`, просьба владельца 2026-09-04).
      title: "",
      dateFrom: getDefaultDate(),
      controlPeriodicity: getDefaultControlPeriodicity(templateCode),
      ventilationEnabled: true,
    }),
    [templateCode]
  );

  async function createDocument(payload: SettingsState) {
    const defaults = getDefaultCleaningVentilationConfig(users);
    const config = {
      ...defaults,
      ventilationEnabled: payload.ventilationEnabled,
      procedures: defaults.procedures.map((procedure) =>
        procedure.id === "ventilation"
          ? { ...procedure, enabled: payload.ventilationEnabled }
          : procedure
      ),
    };
    const response = await fetch("/api/journal-documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateCode,
        title: payload.title.trim(),
        // Период — по правилу журнала (`journal-period.ts`), а не «один день».
        ...resolveJournalPeriodForDate(templateCode, payload.dateFrom),
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

    const baseConfig =
      (current.config as Record<string, unknown> | null) ??
      getDefaultCleaningVentilationConfig(users);

    const response = await fetch(`/api/journal-documents/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: payload.title.trim() || CLEANING_VENTILATION_CHECKLIST_TITLE,
        dateFrom: payload.dateFrom,
        dateTo: payload.dateFrom,
        config: { ...baseConfig, ventilationEnabled: payload.ventilationEnabled },
        controlPeriodicity: payload.controlPeriodicity,
      }),
    });

    if (!response.ok) {
      const failure = await response.json().catch(() => null);
      throw new Error(failure?.error || "Не удалось сохранить настройки");
    }

    router.refresh();
  }

  async function handleDelete(document: DocumentItem) {
    await deleteDocument({
      documentId: document.id,
      description: `Документ «${document.title || CLEANING_VENTILATION_CHECKLIST_TITLE}» будет удалён безвозвратно.`,
      bullets: [
        { label: `Дата начала: ${formatDateLabel(document.dateFrom)}`, tone: "info" },
        { label: "Удалятся все отметки чек-листа за этот документ", tone: "warn" },
      ],
      successMessage: `Документ «${document.title || CLEANING_VENTILATION_CHECKLIST_TITLE}» удалён`,
      errorMessage: "Не удалось удалить документ",
    });
  }

  return (
    <div className={JOURNAL_LIST_STACK_CLASS}>
      <JournalTopBar
        routeCode={routeCode}
        heading={`${CLEANING_VENTILATION_CHECKLIST_TITLE}${activeTab === "closed" ? " (закрытые)" : ""}`}
        activeTab={activeTab}
        templateCode={templateCode}
        templateName={CLEANING_VENTILATION_CHECKLIST_TITLE}
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
          const href = `/journals/${routeCode}/documents/${document.id}`;
          return (
            <div key={document.id} className={JOURNAL_LIST_CARD_CLASS}>
              <Link href={href} className={JOURNAL_CARD_TITLE_CLASS}>
                {document.title || CLEANING_VENTILATION_CHECKLIST_TITLE}
              <SharedDocumentBadge shared={document.shared} />
              </Link>

              <Link href={href} className={JOURNAL_CARD_SECTION_CLASS}>
                <div className={JOURNAL_CARD_LABEL_CLASS}>Дата начала</div>
                <div className={JOURNAL_CARD_VALUE_CLASS}>
                  {formatDateLabel(document.dateFrom)}
                </div>
              </Link>

              {/* Эталон показывает в карточке ответственного, а не «Статус:
                  Активный» (V2 аудита): вкладка «Активные/Закрытые» и так
                  говорит о статусе, а ответственный — единственные полезные
                  данные документа в списке. Берём главного ответственного из
                  нормализованного config; у старых документов без него —
                  прочерк. */}
              <Link href={href} className={JOURNAL_CARD_SECTION_CLASS}>
                <div className={JOURNAL_CARD_LABEL_CLASS}>Ответственный</div>
                <div className={JOURNAL_CARD_VALUE_CLASS}>
                  {getMainResponsibleLabel(document, users)}
                </div>
              </Link>

              <div className="flex items-center justify-center text-[#5566f6]">
                <ResponsiveMenu
                  title="Действия с документом"
                  items={filterManageMenuItems([
                    {
                      key: "settings",
                      label: "Настройки",
                      icon: <Settings2 className="size-4 text-[#6f7282]" />,
                      onSelect: () => setSettingsTarget(document),
                    },
                    {
                      key: "print",
                      label: "Печать",
                      icon: <Printer className="size-4 text-[#6f7282]" />,
                      onSelect: () => openPdf({ documentId: document.id }),
                    },
                    {
                      key: "toggle-status",
                      label: document.status === "active" ? "Закрыть" : "Вернуть в активные",
                      icon: <CalendarDays className="size-4 text-[#6f7282]" />,
                      onSelect: () =>
                        setStatus(document.status === "active" ? "closed" : "active", {
                          documentId: document.id,
                        }),
                    },
                    {
                      key: "delete",
                      label: "Удалить",
                      icon: <Trash2 className="size-4 text-[#ff3b30]" />,
                      onSelect: () => handleDelete(document),
                      tone: "danger" as const,
                    },
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
        initial={createInitial}
        onSubmit={createDocument}
        submitText="Создать"
        title="Создание документа"
        requireTitle
        templateCode={templateCode}
      />

      <SettingsDialog
        open={Boolean(settingsTarget)}
        onOpenChange={(value) => {
          if (!value) setSettingsTarget(null);
        }}
        initial={
          settingsTarget
            ? {
                title: settingsTarget.title || CLEANING_VENTILATION_CHECKLIST_TITLE,
                dateFrom: settingsTarget.dateFrom || getDefaultDate(),
                controlPeriodicity: readControlPeriodicity(
                  settingsTarget.config,
                  templateCode
                ),
                ventilationEnabled:
                  (settingsTarget.config as { ventilationEnabled?: unknown } | null)
                    ?.ventilationEnabled !== false,
              }
            : null
        }
        onSubmit={async (value) => {
          if (!settingsTarget) return;
          await saveSettings(settingsTarget.id, value);
        }}
        submitText="Сохранить"
        title="Настройки документа"
        templateCode={templateCode}
      />
    </div>
  );
}
