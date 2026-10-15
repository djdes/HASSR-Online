"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { FloatingInputField } from "@/components/journals/journal-dialog-field";
import { getHygienePositionLabel } from "@/lib/hygiene-document";

import { toast } from "sonner";
import {
  DocumentActionsMenu,
  EmptyDocumentsState,
  JournalTabs,
  JournalTopBar,
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
import { SharedDocumentBadge } from "@/components/journals/shared-document-badge";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";
import { formatDate as formatLocalizedDate, type Locale } from "@/i18n/locales";
type UserItem = {
  id: string;
  name: string;
  role: string;
};

type JournalListDocument = {
  id: string;
  title: string;
  /** Точки: документ без точки рядом с документами точек. */
  shared?: boolean;
  status: "active" | "closed";
  responsibleTitle: string | null;
  responsibleUserId: string | null;
  responsibleUserName: string | null;
  periodLabel: string;
  dateFrom: string;
  dateTo: string;
};

function periodLabel(dateFrom: string, dateTo: string, locale: Locale) {
  const format = (dateKey: string) => {
    const [year, month, day] = dateKey.slice(0, 10).split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day, 12));
    return formatLocalizedDate(locale, date, "UTC", { day: "numeric", month: "short", year: "numeric" });
  };
  return dateFrom === dateTo ? format(dateFrom) : `${format(dateFrom)} — ${format(dateTo)}`;
}

type Props = {
  activeTab: "active" | "closed";
  routeCode: string;
  templateCode: string;
  templateName: string;
  users: UserItem[];
  documents: JournalListDocument[];
};

function EditDocumentDialog({
  open,
  onOpenChange,
  document,
  users,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: JournalListDocument | null;
  users: UserItem[];
  onSaved: () => void;
}) {
  const t = useTranslations("coldEquipment");
  const common = useTranslations("common");
  const [title, setTitle] = useState("");
  const [responsibleTitle, setResponsibleTitle] = useState("");
  const [responsibleUserId, setResponsibleUserId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const titleOptions = useMemo(
    () => [...new Set(users.map((user) => getHygienePositionLabel(user.role)))],
    [users]
  );

  useEffect(() => {
    if (!open || !document) return;
    setTitle(document.title);
    setResponsibleTitle(document.responsibleTitle || titleOptions[0] || "");
    setResponsibleUserId(document.responsibleUserId || "");
  }, [document, open, titleOptions, users]);

  async function handleSave() {
    if (!document) return;
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/journal-documents/${document.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          responsibleTitle: responsibleTitle || null,
          responsibleUserId: responsibleUserId || null,
        }),
      });

      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error || t("errors.saveSettings"));
      }

      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(
        humanizeFetchError(error, t("errors.saveSettings"))
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={JOURNAL_DIALOG_CONTENT_CLASS}>
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>
            {t("ui.docTitle")}
          </DialogTitle>
        </DialogHeader>

        <div className={cn(JOURNAL_DIALOG_BODY_CLASS, JOURNAL_DIALOG_FIELDS_CLASS)}>
          <FloatingInputField
            id="cold-document-title"
            label={t("ui.documentName")}
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
            positionLabel={t("ui.responsiblePosition")}
            employeeLabel={t("ui.employee")}
            variant="floating"
            autoPick="first"
          />

        </div>

        <div className={JOURNAL_DIALOG_FOOTER_CLASS}>
          <div className={JOURNAL_DIALOG_ACTIONS_CLASS}>
            <Button
              type="button"
              onClick={handleSave}
              disabled={isSubmitting || title.trim() === ""}
              className={JOURNAL_DIALOG_SUBMIT_CLASS}
            >
              {isSubmitting ? common("saving") : common("save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ColdEquipmentDocumentsClient({
  activeTab,
  routeCode,
  templateCode,
  templateName,
  users,
  documents,
}: Props) {
  const t = useTranslations("coldEquipment");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [editingDocument, setEditingDocument] = useState<JournalListDocument | null>(null);
  const { deleteDocument, openPdf } = useJournalDocumentActions();

  async function handleDelete(document: JournalListDocument) {
    await deleteDocument({
      documentId: document.id,
      description: t("dialogs.deleteDocumentDescription", { title: document.title }),
      bullets: [
        { label: t("dialogs.documentPeriod", { period: periodLabel(document.dateFrom, document.dateTo, locale) }), tone: "info" },
        { label: t("dialogs.deleteAllMeasurements"), tone: "warn" },
      ],
      successMessage: t("toasts.documentDeleted", { title: document.title }),
      errorMessage: t("errors.deleteDocument"),
    });
  }

  return (
    <>
      <div className={JOURNAL_LIST_STACK_CLASS}>
        <JournalTopBar
        routeCode={routeCode}
          heading={templateName}
          activeTab={activeTab}
          templateCode={templateCode}
          templateName={templateName}
          users={users}
          documentCount={documents.length}
        />

        <JournalTabs activeTab={activeTab} templateCode={routeCode} />

        <div className={JOURNAL_LIST_CARDS_CLASS}>
          {documents.length === 0 ? (
            <EmptyDocumentsState
              templateCode={templateCode}
              templateName={templateName}
              users={users}
            />
          ) : null}

          {documents.map((document) => {
            const href = `/journals/${routeCode}/documents/${document.id}`;

            return (
              <div key={document.id} className={JOURNAL_LIST_CARD_CLASS}>
                <Link href={href} className={JOURNAL_CARD_TITLE_CLASS}>
                  {document.title}
              <SharedDocumentBadge shared={document.shared} />
                </Link>

                <Link href={href} className={JOURNAL_CARD_SECTION_CLASS}>
                  <div className={JOURNAL_CARD_LABEL_CLASS}>{t("ui.employee")}</div>
                  <div className={JOURNAL_CARD_VALUE_CLASS}>
                    {document.responsibleTitle && document.responsibleUserName
                      ? `${document.responsibleTitle}: ${document.responsibleUserName}`
                      : document.responsibleTitle || document.responsibleUserName || t("ui.unassigned")}
                  </div>
                </Link>

                <Link href={href} className={JOURNAL_CARD_SECTION_CLASS}>
                  <div className={JOURNAL_CARD_LABEL_CLASS}>{t("ui.periodLabel")}</div>
                  <div className={JOURNAL_CARD_VALUE_CLASS}>
                    {periodLabel(document.dateFrom, document.dateTo, locale)}
                  </div>
                </Link>

                <div className="flex items-center justify-center text-[#5566f6]">
                  <DocumentActionsMenu
                    document={document}
                    siblings={documents}
                    onEdit={document.status === "active" ? () => setEditingDocument(document) : undefined}
                    onPrint={() => openPdf({ documentId: document.id })}
                    onDelete={document.status === "active" ? () => handleDelete(document) : undefined}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <EditDocumentDialog
        open={!!editingDocument}
        onOpenChange={(open) => {
          if (!open) setEditingDocument(null);
        }}
        document={editingDocument}
        users={users}
        onSaved={() => router.refresh()}
      />
    </>
  );
}
