"use client";

import {
  JOURNAL_ACTION_CREATE_CLASS,
  JOURNAL_LIST_HEADER_ROW_CLASS,
  JOURNAL_LIST_TITLE_CLASS,
  JournalListActions,
} from "@/components/journals/journal-list-actions";
import { TOUR } from "@/lib/tour-anchors";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { BookOpenText, Ellipsis, Pencil, Plus, Printer, Trash2 } from "lucide-react";
import { CreateDocumentDialog } from "@/components/journals/create-document-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { HYGIENE_PERIODICITY_TEXT, getStaffJournalResponsibleTitleOptions } from "@/lib/hygiene-document";
import {
  getTrackedDocumentCreateMode,
  isSourceStyleTrackedTemplate,
} from "@/lib/tracked-document";
import { PestControlDocumentsClient } from "@/components/journals/pest-control-documents-client";
import {
  ACCEPTANCE_DOCUMENT_TEMPLATE_CODE,
  normalizeAcceptanceDocumentConfig,
} from "@/lib/acceptance-document";

import { toast } from "sonner";
import { confirmAsync } from "@/components/ui/confirm-async";
import {
  EmptyDocumentsState,
  filterManageMenuItems,
  restoreMenuItems,
  useRestoreDocument,
  useCanManageDocuments,
} from "@/components/journals/document-list-ui";
import {
  JOURNAL_LIST_STACK_CLASS,
  JOURNAL_CARD_LABEL_CLASS,
  JOURNAL_CARD_TITLE_CLASS,
  JOURNAL_CARD_VALUE_CLASS,
  JOURNAL_LIST_CARD_CLASS,
  JOURNAL_TAB_RAIL_CLASS,
  JOURNAL_TAB_VIEWPORT_CLASS,
  JOURNAL_CARD_SECTION_CLASS,
  JOURNAL_LIST_CARDS_CLASS,
} from "@/components/journals/journal-responsive";
import {
  PositionSelectItems,
  usePositionEmployeeCascade,
} from "@/components/shared/position-select";
import { getUsersForRoleLabel } from "@/lib/user-roles";
import { SharedDocumentBadge } from "@/components/journals/shared-document-badge";
type JournalListDocument = {
  id: string;
  title: string;
  /** Точки: документ без точки рядом с документами точек. */
  shared?: boolean;
  status: "active" | "closed";
  responsibleTitle: string | null;
  responsibleUserId?: string | null;
  responsibleUserName?: string | null;
  periodLabel: string;
  metaLabel: string;
  metaValue: string;
  dateFrom: string;
  dateTo: string;
  config?: Record<string, unknown> | null;
};

type Props = {
  activeTab: "active" | "closed";
  templateCode: string;
  templateName: string;
  heading: string;
  users: { id: string; name: string; role: string }[];
  documents: JournalListDocument[];
};

function EditTrackedDocumentDialog({
  open,
  onOpenChange,
  document,
  templateCode,
  users,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: JournalListDocument | null;
  templateCode: string;
  users: { id: string; name: string; role: string }[];
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [responsibleTitle, setResponsibleTitle] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [areaName, setAreaName] = useState("");
  const [showPackagingField, setShowPackagingField] = useState(false);
  const [responsibleUserId, setResponsibleUserId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Каскад «Должность → Сотрудник» для первого селекта сотрудника
  // (автооткрытие списка). Смена должности сбрасывает сотрудника — как раньше.
  const cascade = usePositionEmployeeCascade({
    users,
    positionTitle: responsibleTitle,
    userId: responsibleUserId,
    onChange: (next) => {
      setResponsibleTitle(next.positionTitle);
      setResponsibleUserId(next.userId);
    },
    autoPick: "none",
  });

  const responsibleOptions = useMemo(
    () => getStaffJournalResponsibleTitleOptions(users),
    [users]
  );

  const createMode = getTrackedDocumentCreateMode(templateCode);
  const isSourceStyle = isSourceStyleTrackedTemplate(templateCode);
  const isAcceptance = templateCode === ACCEPTANCE_DOCUMENT_TEMPLATE_CODE;

  useEffect(() => {
    if (!open || !document) return;
    setTitle(document.title);
    setResponsibleTitle(document.responsibleTitle || responsibleOptions[0] || "");
    setDateFrom(document.dateFrom);
    setDateTo(document.dateTo);
    setAreaName(
      document.config &&
        typeof document.config === "object" &&
        typeof document.config.areaName === "string"
        ? document.config.areaName
        : ""
    );
    const acceptanceConfig = normalizeAcceptanceDocumentConfig(document.config, users);
    setShowPackagingField(acceptanceConfig.showPackagingComplianceField);
    setResponsibleUserId(
      isAcceptance
        ? acceptanceConfig.defaultResponsibleUserId || ""
        : document.responsibleUserId || ""
    );
  }, [document, open, responsibleOptions, users, isAcceptance]);

  async function handleSave() {
    if (!document) return;
    setSubmitting(true);
    try {
      const response = await fetch(`/api/journal-documents/${document.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          responsibleTitle: responsibleTitle || null,
          responsibleUserId: responsibleUserId || null,
          dateFrom,
          dateTo,
          config: areaName.trim() ? { ...(document.config || {}), areaName: areaName.trim() } : document.config,
          ...(isAcceptance
            ? {
                config: {
                  ...normalizeAcceptanceDocumentConfig(document.config, users),
                  showPackagingComplianceField: showPackagingField,
                  defaultResponsibleUserId: responsibleUserId || null,
                  defaultResponsibleTitle: responsibleTitle || null,
                },
              }
            : {}),
        }),
      });

      if (!response.ok) {
        throw new Error();
      }

      onOpenChange(false);
      onSaved();
    } catch {
      toast.error("Не удалось сохранить настройки документа");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[24px] border-0 p-0 sm:max-w-[560px]">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle className="text-[22px] font-medium text-black">Настройки документа</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 px-6 py-5">
          <div className="space-y-3">
            <Label htmlFor="tracked-edit-title" className="sr-only">
              Название документа
            </Label>
            <Input
              id="tracked-edit-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Введите название документа"
              className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
            />
          </div>

          {createMode === "uv" && (
            <div className="space-y-3">
              <Label htmlFor="tracked-edit-area" className="sr-only">
                Наименование цеха
              </Label>
              <Input
                id="tracked-edit-area"
                value={areaName}
                onChange={(e) => setAreaName(e.target.value)}
                placeholder="Введите наименование цеха/участка применения"
                className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
              />
            </div>
          )}

          <div className="space-y-3">
            <Label className="text-[14px] text-[#73738a]">Должность ответственного</Label>
            <Select
              value={responsibleTitle}
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

          {!isAcceptance && (
            <div className="space-y-3">
              <Label className="text-[14px] text-[#73738a]">Сотрудник</Label>
              <Select
                value={responsibleUserId}
                onValueChange={cascade.handleEmployeeChange}
                open={cascade.employeeOpen}
                onOpenChange={cascade.setEmployeeOpen}
              >
                <SelectTrigger className="h-10 rounded-xl border-[#dfe1ec] bg-[#f3f4fb] px-3.5 text-[13.5px]">
                  <SelectValue placeholder="Выберите сотрудника" />
                </SelectTrigger>
                <SelectContent>
                  {(responsibleTitle ? cascade.candidates : users).map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {createMode === "staff" ? (
            <div className="space-y-2 rounded-2xl border border-[#dfe1ec] px-5 py-4">
              <div className="text-[14px] text-[#73738a]">Периодичность контроля</div>
              <div className="text-[15px] leading-[1.35] text-black">{HYGIENE_PERIODICITY_TEXT}</div>
            </div>
          ) : (
            <div className="space-y-3">
              <Label htmlFor="tracked-edit-date-from" className="text-[14px] text-[#73738a]">
                {createMode === "uv" || isAcceptance ? "Дата начала" : "Дата документа"}
              </Label>
              <Input
                id="tracked-edit-date-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
              />
            </div>
          )}

          {isAcceptance && (
            <>
              <div className="space-y-3">
                <Label className="text-[14px] text-[#73738a]">Добавить поля</Label>
                <div className="flex items-center gap-3">
                  <Switch checked={showPackagingField} onCheckedChange={setShowPackagingField} />
                  <span className="text-[14px]">
                    Соответствие внешнего вида упаковки, маркировки требованиям НД
                  </span>
                </div>
              </div>
              <div className="space-y-3">
                <Label className="text-[14px] text-[#73738a]">Сотрудник</Label>
                <Select value={responsibleUserId} onValueChange={setResponsibleUserId}>
                  <SelectTrigger className="h-10 rounded-xl border-[#dfe1ec] bg-[#f3f4fb] px-3.5 text-[13.5px]">
                    <SelectValue placeholder="Выберите сотрудника" />
                  </SelectTrigger>
                  <SelectContent>
                    {(responsibleTitle ? getUsersForRoleLabel(users, responsibleTitle, { keepUserId: responsibleUserId }) : users).map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {isSourceStyle && createMode === "staff" && (
            <div className="hidden">
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
          )}

          <div className="hidden">
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>

          <div className="flex justify-end pt-2">
            <Button
              type="button"
              onClick={handleSave}
              disabled={submitting}
              className="h-10 rounded-xl bg-[#5566f6] px-6 text-[13.5px] text-white hover:bg-[#4b57ff]"
            >
              {submitting ? "Сохранение..." : "Сохранить"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TrackedDocumentsClientImpl({
  activeTab,
  templateCode,
  templateName,
  heading,
  users,
  documents,
}: Props) {
  const router = useRouter();
  // Создание / настройки / удаление документов API отдаёт только
  // руководителю — у остальных эти кнопки не показываем.
  const canManageDocuments = useCanManageDocuments();
  const restore = useRestoreDocument();
  const [editingDocument, setEditingDocument] = useState<JournalListDocument | null>(null);

  function getResponsibleCardValue(document: JournalListDocument) {
    if (document.responsibleTitle && document.responsibleUserName) {
      return `${document.responsibleTitle}: ${document.responsibleUserName}`;
    }

    return document.responsibleTitle || document.responsibleUserName || "—";
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
    <>
      <div className={JOURNAL_LIST_STACK_CLASS}>
        <div className={JOURNAL_LIST_HEADER_ROW_CLASS}>
          <h1 className={JOURNAL_LIST_TITLE_CLASS}>{heading}</h1>
          {/* «QR-точка контроля» над рядом «Создать документ | Инструкция». */}
          <JournalListActions
            templateCode={templateCode}
            journalName={templateName}
            canManage={canManageDocuments}
            guideProps={{ firstDocumentId: activeTab === "active" ? documents[0]?.id : undefined }}
            create={
              canManageDocuments && activeTab === "active" ? (
                <CreateDocumentDialog
                  templateCode={templateCode}
                  templateName={templateName}
                  users={users}
                  triggerClassName={JOURNAL_ACTION_CREATE_CLASS}
                  triggerLabel="Создать документ"
                  triggerIcon={<Plus className="size-4" />}
                  triggerDataTour={TOUR.createDocument}
                />
              ) : null
            }
          />
        </div>

        <div className="border-b border-[#d9dce8]">
          <div className={JOURNAL_TAB_VIEWPORT_CLASS}>
            <div className={JOURNAL_TAB_RAIL_CLASS}>
            <Link
              href={`/journals/${templateCode}`}
              className={`relative pb-5 ${
                activeTab === "active"
                  ? "font-medium text-black after:absolute after:bottom-[-1px] after:left-0 after:h-[3px] after:w-full after:bg-[#5566f6]"
                  : "text-[#6f7282]"
              }`}
            >
              Активные
            </Link>
            <Link
              href={`/journals/${templateCode}?tab=closed`}
              className={`relative pb-5 ${
                activeTab === "closed"
                  ? "font-medium text-black after:absolute after:bottom-[-1px] after:left-0 after:h-[3px] after:w-full after:bg-[#5566f6]"
                  : "text-[#6f7282]"
              }`}
            >
              Закрытые
            </Link>
            </div>
          </div>
        </div>

        <div className={JOURNAL_LIST_CARDS_CLASS}>
          {documents.length === 0 && (
            <EmptyDocumentsState />
          )}

          {documents.map((document) => {
            const href = `/journals/${templateCode}/documents/${document.id}`;

            return (
              <div
                key={document.id}
                className={JOURNAL_LIST_CARD_CLASS}
                data-tour={TOUR.documentCard}
              >
                <Link href={href} className={JOURNAL_CARD_TITLE_CLASS}>
                  {document.title}
              <SharedDocumentBadge shared={document.shared} />
                </Link>

                <Link href={href} className={JOURNAL_CARD_SECTION_CLASS}>
                  <div className={JOURNAL_CARD_LABEL_CLASS}>Ответственный</div>
                  <div className={JOURNAL_CARD_VALUE_CLASS}>
                    {getResponsibleCardValue(document)}
                  </div>
                </Link>

                <Link href={href} className={JOURNAL_CARD_SECTION_CLASS}>
                  <div className={JOURNAL_CARD_LABEL_CLASS}>{document.metaLabel}</div>
                  <div className={JOURNAL_CARD_VALUE_CLASS}>{document.metaValue}</div>
                </Link>

                <div className="flex justify-end pt-1 sm:justify-center sm:pt-0">
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
                      ...restoreMenuItems({ document, siblings: documents, restore }),
                      ...(document.status === "active"
                        ? [
                            {
                              key: "delete",
                              label: "Удалить",
                              icon: <Trash2 className="size-4 text-[#ff3b30]" />,
                              tone: "danger" as const,
                              onSelect: () => handleDelete(document.id, document.title),
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
      </div>

      <EditTrackedDocumentDialog
        open={!!editingDocument}
        onOpenChange={(open) => {
          if (!open) setEditingDocument(null);
        }}
        document={editingDocument}
        templateCode={templateCode}
        users={users}
  onSaved={() => router.refresh()}
      />
    </>
  );
}

export function TrackedDocumentsClient(props: Props) {
  if (props.templateCode === "pest_control") {
    return (
      <PestControlDocumentsClient
        routeCode={props.templateCode}
        activeTab={props.activeTab}
        templateCode={props.templateCode}
        users={props.users}
        documents={props.documents.map((document) => ({
          id: document.id,
          title: document.title,
          status: document.status,
          dateFrom: document.dateFrom,
        }))}
      />
    );
  }

  return <TrackedDocumentsClientImpl {...props} />;
}
