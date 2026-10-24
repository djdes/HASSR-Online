"use client";

import { TOUR } from "@/lib/tour-anchors";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DocumentActionsMenu,
  EmptyDocumentsState,
  JournalTabs,
  JournalTopBar,
} from "@/components/journals/document-list-ui";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { FloatingInputField } from "@/components/journals/journal-dialog-field";
import {
  getStaffJournalResponsibleTitleOptions,
} from "@/lib/hygiene-document";
import { ControlPeriodicityField } from "@/components/journals/control-periodicity-field";
import { getDefaultControlPeriodicity } from "@/lib/control-periodicity";
import {
  getJournalDocumentHeading,
} from "@/lib/journal-document-helpers";
import { useJournalDocumentActions } from "@/components/journals/use-journal-document-actions";

import { toast } from "sonner";
import { confirmAsync } from "@/components/ui/confirm-async";
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
import { PositionEmployeePicker } from "@/components/shared/position-select";
import { PageGuide } from "@/components/ui/page-guide";
import { SharedDocumentBadge } from "@/components/journals/shared-document-badge";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";
type JournalListDocument = {
  id: string;
  title: string;
  /** Точки: документ без точки рядом с документами точек. */
  shared?: boolean;
  status: "active" | "closed";
  responsibleTitle: string | null;
  responsibleUserId: string | null;
  periodLabel: string;
  /** Текст «Периодичность контроля» документа (config.controlPeriodicity). */
  controlPeriodicity?: string;
  /** Период документа `YYYY-MM-DD`. Передан — его можно менять в настройках. */
  dateFrom?: string;
  dateTo?: string;
};

type UserProp = {
  id: string;
  name: string;
  role: string;
  positionTitle?: string | null;
  jobPosition?: { name: string; categoryKey: string } | null;
};

type Props = {
  activeTab: "active" | "closed";
  templateCode: string;
  templateName: string;
  users: UserProp[];
  documents: JournalListDocument[];
  /**
   * Тумблер «журнал ведётся сам». Передаётся только для журналов,
   * которые автоматика умеет обслуживать (hygiene / health_check) —
   * этот же клиент рендерит десяток других журналов.
   */
  automation?: {
    code: string;
    enabled: boolean;
    canManage: boolean;
    noticeSeen: boolean;
  };
  /**
   * Есть ли у смотрящего право создавать / настраивать / удалять
   * документы. Раньше повар видел эти действия, а API отвечал 403.
   */
  canManageDocuments?: boolean;
};

function EditDocumentDialog({
  open,
  onOpenChange,
  document,
  users,
  responsibleOptions,
  templateCode,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  document: JournalListDocument | null;
  users: UserProp[];
  responsibleOptions: string[];
  templateCode: string;
}) {
  const router = useRouter();
  const t = useTranslations("journalWidgets.staff");
  const tList = useTranslations("hygiene.list");
  const tCommon = useTranslations("common");
  const [title, setTitle] = useState("");
  const [responsibleTitle, setResponsibleTitle] = useState("");
  const [responsibleUserId, setResponsibleUserId] = useState("");
  const [periodicity, setPeriodicity] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!document || !open) return;
    setTitle(document.title);
    setResponsibleTitle(document.responsibleTitle || responsibleOptions[0] || "");
    setResponsibleUserId(document.responsibleUserId || "");
    setPeriodicity(
      document.controlPeriodicity ?? getDefaultControlPeriodicity(templateCode)
    );
    setFrom(document.dateFrom || "");
    setTo(document.dateTo || "");
  }, [document, open, responsibleOptions, templateCode]);

  const periodEditable = Boolean(document?.dateFrom && document?.dateTo);

  async function handleSave() {
    if (!document) return;
    if (periodEditable) {
      if (!from || !to) {
        toast.error(t("periodRequired"));
        return;
      }
      if (from > to) {
        toast.error(t("dateOrderInvalid"));
        return;
      }
    }

    // Сокращение периода сервер принимает только с явным shrinkPeriod:
    // предупреждаем, что записи за его пределами уйдут из бланка.
    const shrinks =
      periodEditable &&
      (from > (document.dateFrom || "") || to < (document.dateTo || ""));
    if (shrinks) {
      const confirmed = await confirmAsync({
        title: t("shrinkPeriodTitle"),
        description: t("newPeriod", { from, to }),
        variant: "warn",
        confirmLabel: t("shrinkPeriodConfirm"),
        bullets: [
          {
            label: tList("shrinkOutsideHidden"),
            tone: "warn",
          },
          { label: tList("shrinkKeptInDb"), tone: "info" },
        ],
      });
      if (!confirmed) return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/journal-documents/${document.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          responsibleTitle,
          responsibleUserId: responsibleUserId || null,
          controlPeriodicity: periodicity,
          ...(periodEditable
            ? {
                dateFrom: from,
                dateTo: to,
                ...(shrinks ? { shrinkPeriod: true } : {}),
              }
            : {}),
        }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error || t("saveSettingsFailed"));
      }

      onOpenChange(false);
      router.refresh();
    } catch (error) {
      toast.error(humanizeFetchError(error, t("saveSettingsFailed")));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={JOURNAL_DIALOG_CONTENT_CLASS}>
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>{t("settings")}</DialogTitle>
        </DialogHeader>

        <div className={cn(JOURNAL_DIALOG_BODY_CLASS, JOURNAL_DIALOG_FIELDS_CLASS)}>
          <FloatingInputField
            id="edit-doc-title"
            label={t("documentName")}
            value={title}
            onChange={setTitle}
          />

          <PositionEmployeePicker
            users={users}
            value={{ positionTitle: responsibleTitle, userId: responsibleUserId }}
            onChange={(n) => {
              setResponsibleTitle(n.positionTitle);
              setResponsibleUserId(n.userId);
            }}
            positionLabel={t("responsiblePosition")}
            employeeLabel={tList("responsible")}
            variant="floating"
            autoPick="first"
          />

          <ControlPeriodicityField
            value={periodicity}
            onChange={setPeriodicity}
          />

          {/* Период документа сервер умеет менять давно, а UI не давал. */}
          {periodEditable ? (
            <div className="space-y-2">
              <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
                {t("period")}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                  aria-label={t("periodFrom")}
                  className="h-10 w-[165px] rounded-xl border border-[#dcdfed] px-3.5 text-[13.5px] text-[#0b1024] outline-none transition-colors duration-150 focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
                />
                <span className="text-[13.5px] text-[#6f7282]">{t("periodTo")}</span>
                <input
                  type="date"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                  aria-label={t("periodToAria")}
                  className="h-10 w-[165px] rounded-xl border border-[#dcdfed] px-3.5 text-[13.5px] text-[#0b1024] outline-none transition-colors duration-150 focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
                />
              </div>
            </div>
          ) : null}
        </div>

        <div className={JOURNAL_DIALOG_FOOTER_CLASS}>
          <div className={JOURNAL_DIALOG_ACTIONS_CLASS}>
            <Button
              type="button"
              disabled={isSubmitting}
              onClick={handleSave}
              className={JOURNAL_DIALOG_SUBMIT_CLASS}
            >
              {isSubmitting ? tCommon("saving") : tCommon("save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DocumentRow({
  templateCode,
  document,
  siblings,
  canManage,
  onEdit,
  onPrint,
  onDelete,
}: {
  templateCode: string;
  document: JournalListDocument;
  /** Соседи по списку — нужны проверке пересечения при возврате из закрытых. */
  siblings: JournalListDocument[];
  canManage: boolean;
  onEdit: (document: JournalListDocument) => void;
  onPrint: (document: JournalListDocument) => void;
  onDelete: (document: JournalListDocument) => void;
}) {
  const t = useTranslations("journalWidgets.staff");
  const tList = useTranslations("hygiene.list");
  const href = `/journals/${templateCode}/documents/${document.id}`;

  return (
    <div className={JOURNAL_LIST_CARD_CLASS} data-tour={TOUR.documentCard}>
      <Link href={href} className={JOURNAL_CARD_TITLE_CLASS}>
        {document.title}
              <SharedDocumentBadge shared={document.shared} />
      </Link>
      <Link href={href} className={JOURNAL_CARD_SECTION_CLASS}>
        <div className={JOURNAL_CARD_LABEL_CLASS}>{t("responsiblePosition")}</div>
        <div className={JOURNAL_CARD_VALUE_CLASS}>{document.responsibleTitle || ""}</div>
      </Link>
      <Link href={href} className={JOURNAL_CARD_SECTION_CLASS}>
        <div className={JOURNAL_CARD_LABEL_CLASS}>{tList("period")}</div>
        <div className={JOURNAL_CARD_VALUE_CLASS}>{document.periodLabel}</div>
      </Link>
      <div className="flex items-center justify-center text-[#5566f6]">
        <DocumentActionsMenu
          document={document}
          siblings={siblings}
          onEdit={canManage ? () => onEdit(document) : undefined}
          onPrint={() => onPrint(document)}
          onDelete={canManage ? () => onDelete(document) : undefined}
        />
      </div>
    </div>
  );
}

export function HygieneDocumentsClient(props: Props) {
  const {
    activeTab,
    templateCode,
    templateName,
    users,
    documents,
    canManageDocuments = true,
  } = props;
  const tList = useTranslations("hygiene.list");
  const [editingDocument, setEditingDocument] = useState<JournalListDocument | null>(null);
  const responsibleOptions = getStaffJournalResponsibleTitleOptions(users);
  // Единый источник delete / status / pdf для журнальных документов.
  // documentId передаём в каждом вызове — на списке их много.
  const { deleteDocument, openPdf } = useJournalDocumentActions();

  async function handleDelete(document: JournalListDocument) {
    await deleteDocument({
      documentId: document.id,
      description: tList("deleteDescription", { title: document.title }),
      bullets: [
        { label: tList("deletePeriod", { period: document.periodLabel }), tone: "info" },
        {
          label: tList("deleteMarks"),
          tone: "warn",
        },
        { label: tList("deletePrint"), tone: "warn" },
      ],
      successMessage: tList("deleteSuccess", { title: document.title }),
      errorMessage: tList("deleteError"),
    });
  }

  return (
    <>
      <div className={JOURNAL_LIST_STACK_CLASS}>
        <JournalTopBar
          heading={getJournalDocumentHeading(templateCode, activeTab === "closed")}
          activeTab={activeTab}
          templateCode={templateCode}
          templateName={templateName}
          users={users}
          documentCount={documents.length}
          firstDocumentId={activeTab === "active" ? documents[0]?.id : undefined}
          canManage={canManageDocuments}
        />

        <JournalTabs activeTab={activeTab} templateCode={templateCode} />

        {props.automation ? (
          <>
            <PageGuide
              title={tList("automation.title")}
              storageKey="journal-automation-staff-v1"
              bullets={[
                tList("automation.bullet1"),
                tList("automation.bullet2"),
                tList("automation.bullet3"),
                tList("automation.bullet4"),
              ]}
              qa={[
                {
                  q: tList("automation.qa1q"),
                  a: tList("automation.qa1a"),
                },
                {
                  q: tList("automation.qa2q"),
                  a: tList("automation.qa2a"),
                },
                {
                  q: tList("automation.qa3q"),
                  a: tList("automation.qa3a"),
                },
              ]}
            />
          </>
        ) : null}


        <div className={JOURNAL_LIST_CARDS_CLASS}>
          {documents.length === 0 && (
            <EmptyDocumentsState
              templateCode={templateCode}
              templateName={templateName}
              users={users}
              canManage={canManageDocuments}
            />
          )}
          {documents.map((document) => (
            <DocumentRow
              key={document.id}
              templateCode={templateCode}
              document={document}
              siblings={documents}
              // Настройки и удаление — только у руководства: у повара
              // эти пункты были видны, а API отвечал 403.
              canManage={document.status === "active" && canManageDocuments}
              onEdit={setEditingDocument}
              onPrint={(doc) => openPdf({ documentId: doc.id })}
              onDelete={handleDelete}
            />
          ))}
        </div>
      </div>

      <EditDocumentDialog
        open={!!editingDocument}
        onOpenChange={(value) => {
          if (!value) setEditingDocument(null);
        }}
        document={editingDocument}
        users={users}
        responsibleOptions={responsibleOptions}
        templateCode={templateCode}
      />
    </>
  );
}
