"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Ellipsis, Pencil, Printer, RotateCcw, Trash2 } from "lucide-react";
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
  buildUvRuntimeDocumentTitle,
  formatRuDateDash,
  getUvResponsibleTitleOptions,
  normalizeUvRuntimeDocumentConfig,
  type UvRuntimeDocumentConfig,
} from "@/lib/uv-lamp-runtime-document";
import { MENU_ITEM_MUTED_CLASS } from "@/components/ui/menu-styles";
import {
  EMPTY_SELECT_VALUE,
  PositionSelectItems,
  usePositionEmployeeCascade,
} from "@/components/shared/position-select";

/** Старые документы хранят плейсхолдер как значение должности — считаем его «не выбрано». */
const UV_LEGACY_EMPTY_TITLE = "Выберите должность";

import { toast } from "sonner";
import { confirmAsync } from "@/components/ui/confirm-async";
import {
  EmptyDocumentsState,
  JournalTabs,
  JournalTopBar,
  filterManageMenuItems,
  useCanManageDocuments,
} from "@/components/journals/document-list-ui";
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
  JOURNAL_LIST_CARD_CLASS,
  JOURNAL_LIST_STACK_CLASS,
  JOURNAL_LIST_CARDS_CLASS,
} from "@/components/journals/journal-responsive";
type DocumentItem = {
  id: string;
  title: string;
  status: "active" | "closed";
  responsibleTitle: string | null;
  responsibleUserId?: string | null;
  dateFrom: string;
  config?: Record<string, unknown> | null;
};

type Props = {
  activeTab: "active" | "closed";
  routeCode?: string;
  templateCode: string;
  templateName: string;
  users: { id: string; name: string; role: string }[];
  documents: DocumentItem[];
};

type EditingState = {
  id: string;
  title: string;
  dateFrom: string;
  responsibleTitle: string;
  responsibleUserId: string;
  config: UvRuntimeDocumentConfig;
};

function UvRuntimeSettingsDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  users: { id: string; name: string; role: string }[];
  editing: EditingState | null;
  onSaved: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [lampNumber, setLampNumber] = useState("1");
  const [areaName, setAreaName] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [responsibleTitle, setResponsibleTitle] = useState("");
  const [responsibleUserId, setResponsibleUserId] = useState("");
  const cascade = usePositionEmployeeCascade({
    users: props.users,
    positionTitle: responsibleTitle,
    userId: responsibleUserId,
    onChange: (n) => {
      setResponsibleTitle(n.positionTitle);
      setResponsibleUserId(n.userId);
    },
    autoPick: "first",
  });

  const options = useMemo(() => getUvResponsibleTitleOptions(props.users), [props.users]);

  useEffect(() => {
    if (!props.editing) return;
    setLampNumber(props.editing.config.lampNumber);
    setAreaName(props.editing.config.areaName);
    setDateFrom(props.editing.dateFrom);
    setResponsibleTitle(props.editing.responsibleTitle);
    setResponsibleUserId(props.editing.responsibleUserId);
  }, [props.editing]);

  async function handleSave() {
    if (!props.editing) return;
    setSubmitting(true);
    const nextConfig = {
      ...props.editing.config,
      lampNumber: lampNumber.trim() || "1",
      // U1: цех — только из настроек; пусто ⇒ пустая линия бланка.
      areaName: areaName.trim(),
    };

    try {
      const response = await fetch(`/api/journal-documents/${props.editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: buildUvRuntimeDocumentTitle(nextConfig),
          dateFrom,
          config: nextConfig,
          responsibleUserId: responsibleUserId || null,
          responsibleTitle: responsibleTitle || null,
        }),
      });

      if (!response.ok) {
        throw new Error("save_failed");
      }

      props.onOpenChange(false);
      props.onSaved();
    } catch {
      toast.error("Не удалось сохранить настройки документа");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (open && props.editing) {
          setLampNumber(props.editing.config.lampNumber);
          setAreaName(props.editing.config.areaName);
          setDateFrom(props.editing.dateFrom);
          setResponsibleTitle(props.editing.responsibleTitle);
          setResponsibleUserId(props.editing.responsibleUserId);
        }
        props.onOpenChange(open);
      }}
    >
      <DialogContent className={JOURNAL_DIALOG_CONTENT_CLASS}>
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>
            Настройки документа
          </DialogTitle>
        </DialogHeader>

        <div className={cn(JOURNAL_DIALOG_BODY_CLASS, JOURNAL_DIALOG_FIELDS_CLASS)}>
          {/* Подпись «Бактерицидная установка №» путали с названием:
              вводили туда имя, и документ назывался «Бактерицидная
              установка №<имя>». Теперь поле подписано как номер, а итоговое
              название показано ниже — его собирает система. */}
          <FloatingInputField
            label="Номер установки"
            placeholder="Например: 1"
            value={lampNumber}
            onChange={setLampNumber}
          />
          <p className="-mt-1 text-[12.5px] leading-[1.45] text-[#6f7282]">
            Название документа соберётся само:{" "}
            <span className="font-medium text-[#3c4053]">
              «Бактерицидная установка №{lampNumber.trim() || "1"}»
            </span>
          </p>

          <FloatingInputField
            label="Наименование цеха/участка применения"
            value={areaName}
            onChange={setAreaName}
          />

          <DateField label="Дата начала" value={dateFrom} onChange={setDateFrom} />

          <FloatingLabelField label="Должность ответственного">
            <Select
              value={
                responsibleTitle && responsibleTitle !== UV_LEGACY_EMPTY_TITLE
                  ? responsibleTitle
                  : EMPTY_SELECT_VALUE
              }
              onValueChange={cascade.handlePositionChange}
            >
              <SelectTrigger className={JOURNAL_DIALOG_FIELD_TRIGGER_CLASS}>
                <SelectValue placeholder="Выберите должность" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={EMPTY_SELECT_VALUE} className={MENU_ITEM_MUTED_CLASS}>
                  Выберите должность
                </SelectItem>
                <PositionSelectItems users={props.users} groups={options} />
              </SelectContent>
            </Select>
          </FloatingLabelField>

          <FloatingLabelField label="Ответственный">
            <Select
              value={responsibleUserId}
              onValueChange={cascade.handleEmployeeChange}
              open={cascade.employeeOpen}
              onOpenChange={cascade.setEmployeeOpen}
            >
              <SelectTrigger className={JOURNAL_DIALOG_FIELD_TRIGGER_CLASS}>
                <SelectValue placeholder="Выберите сотрудника" />
              </SelectTrigger>
              <SelectContent>
                {(responsibleTitle && responsibleTitle !== UV_LEGACY_EMPTY_TITLE
                  ? cascade.candidates
                  : props.users
                ).map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FloatingLabelField>
        </div>

        <div className={JOURNAL_DIALOG_FOOTER_CLASS}>
          <div className={JOURNAL_DIALOG_ACTIONS_CLASS}>
            <Button
              type="button"
              onClick={handleSave}
              disabled={submitting}
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

export function UvLampRuntimeDocumentsClient(props: Props) {
  const router = useRouter();
  // Настройки / удаление документов API отдаёт только руководителю.
  const canManageDocuments = useCanManageDocuments();
  const [editing, setEditing] = useState<EditingState | null>(null);
  const routeCode = props.routeCode || props.templateCode;
  const heading =
    props.activeTab === "closed"
      ? "Журнал учета работы УФ бактерицидной установки (закрытые)"
      : "Журнал учета работы УФ бактерицидной установки";
  const { deleteDocument, setStatus, openPdf } = useJournalDocumentActions();

  /**
   * Следующий свободный номер бактерицидной установки (U7 аудита).
   * Раньше диалог создания всегда предлагал «1», и вторая установка
   * создавалась дублем первой. Берём max(№) по документам журнала + 1;
   * нечисловые номера («1а») игнорируются при подсчёте максимума.
   */
  const nextLampNumber = useMemo(() => {
    const maxNumber = props.documents.reduce((max, document) => {
      const parsed = Number.parseInt(
        normalizeUvRuntimeDocumentConfig(document.config).lampNumber,
        10
      );
      return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
    }, 0);
    return String(maxNumber + 1);
  }, [props.documents]);

  async function handleDelete(document: DocumentItem, resolvedTitle: string) {
    await deleteDocument({
      documentId: document.id,
      description: `Документ «${resolvedTitle}» будет удалён безвозвратно.`,
      bullets: [
        { label: `Дата начала: ${formatRuDateDash(document.dateFrom)}`, tone: "info" },
        { label: "Удалятся все отметки времени работы установки", tone: "warn" },
      ],
      successMessage: `Документ «${resolvedTitle}» удалён`,
      errorMessage: "Не удалось удалить документ",
    });
  }

  async function handleReactivate(documentId: string, title: string) {
    const confirmed = await confirmAsync({
      title: "Вернуть документ в активные?",
      description: `Документ «${title}» снова станет доступен для редактирования.`,
      variant: "warn",
      confirmLabel: "Вернуть",
    });
    if (!confirmed) return;

    await setStatus("active", { documentId, successMessage: "Документ снова активен" });
  }

  return (
    <div className={JOURNAL_LIST_STACK_CLASS}>
      <JournalTopBar
        routeCode={routeCode}
        heading={heading}
        activeTab={props.activeTab}
        templateCode={props.templateCode}
        templateName={props.templateName}
        users={props.users}
        documentCount={props.documents.length}
        nextLampNumber={nextLampNumber}
      />

      <JournalTabs activeTab={props.activeTab} templateCode={routeCode} />

      <div className={JOURNAL_LIST_CARDS_CLASS}>
        {props.documents.length === 0 && (
          <EmptyDocumentsState
            templateCode={props.templateCode}
            templateName={props.templateName}
            users={props.users}
            nextLampNumber={nextLampNumber}
          />
        )}

        {props.documents.map((document) => {
          const href = `/journals/${routeCode}/documents/${document.id}`;
          const config = normalizeUvRuntimeDocumentConfig(document.config);
          // U1: имя документа всегда собираем из конфига — сохранённые
          // в БД обрезки («… | Журнал учета работы») больше не показываем.
          const resolvedTitle = buildUvRuntimeDocumentTitle(config);
          const responsibleName = document.responsibleUserId
            ? props.users.find((user) => user.id === document.responsibleUserId)?.name || ""
            : "";
          const responsibleLabel = document.responsibleTitle
            ? `${document.responsibleTitle}${responsibleName ? `: ${responsibleName}` : ""}`
            : ":";

          return (
            <div key={document.id} className={JOURNAL_LIST_CARD_CLASS}>
              <Link href={href} className={JOURNAL_CARD_TITLE_CLASS}>
                {resolvedTitle}
              </Link>

              <Link href={href} className={JOURNAL_CARD_SECTION_CLASS}>
                <div className={JOURNAL_CARD_LABEL_CLASS}>Ответственный</div>
                <div className={JOURNAL_CARD_VALUE_CLASS}>
                  {responsibleLabel}
                </div>
              </Link>

              <Link href={href} className={JOURNAL_CARD_SECTION_CLASS}>
                <div className={JOURNAL_CARD_LABEL_CLASS}>Дата начала</div>
                <div className={JOURNAL_CARD_VALUE_CLASS}>
                  {formatRuDateDash(document.dateFrom)}
                </div>
              </Link>

              <div className="flex items-center justify-center text-[#5566f6]">
                <ResponsiveMenu
                  title="Действия"
                  items={filterManageMenuItems([
                    ...(document.status === "active"
                      ? [
                          {
                            key: "settings",
                            label: "Настройки",
                            icon: <Pencil className="size-4 text-[#6f7282]" />,
                            onSelect: () =>
                              setEditing({
                                id: document.id,
                                title: resolvedTitle,
                                dateFrom: document.dateFrom,
                                responsibleTitle: document.responsibleTitle || "",
                                responsibleUserId: document.responsibleUserId || "",
                                config,
                              }),
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
                            key: "restore",
                            label: "Отправить в активные",
                            icon: <RotateCcw className="size-4 text-[#6f7282]" />,
                            onSelect: () => handleReactivate(document.id, resolvedTitle),
                          },
                        ]
                      : []),
                    ...(document.status === "active"
                      ? [
                          {
                            key: "delete",
                            label: "Удалить",
                            icon: <Trash2 className="size-4 text-[#ff3b30]" />,
                            tone: "danger" as const,
                            onSelect: () => handleDelete(document, resolvedTitle),
                          },
                        ]
                      : []),
                  ], canManageDocuments)}
                  trigger={
                    <button
                      type="button"
                      className="flex size-10 items-center justify-center rounded-full hover:bg-[#f5f6ff]"
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

      <UvRuntimeSettingsDialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        editing={editing}
        users={props.users}
        onSaved={() => router.refresh()}
      />
    </div>
  );
}
