"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DateField,
  FloatingInputField,
} from "@/components/journals/journal-dialog-field";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  JOURNAL_LIST_STACK_CLASS,
  JOURNAL_LIST_CARD_CLASS,
  JOURNAL_LIST_CARDS_CLASS,
} from "@/components/journals/journal-responsive";
import { SharedDocumentBadge } from "@/components/journals/shared-document-badge";
import { formatJournalDate } from "@/lib/journal-card-date";
import { FRYER_OIL_PAGE_TITLE } from "@/lib/fryer-oil-document";
type DocumentItem = {
  id: string;
  title: string;
  /** Точки: документ без точки рядом с документами точек. */
  shared?: boolean;
  status: "active" | "closed";
  responsibleTitle: string | null;
  dateFrom: string;
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
};

function formatDateDash(value: string): string {
  // Единый вид даты на экране — «дд.мм.гггг» (src/lib/journal-card-date.ts).
  // Раньше тут было «ДД-ММ-ГГГГ», а у дезинсекции и акта забраковки —
  // «ДД.ММ.ГГГГ»: три разных написания одной и той же вещи в одном заходе.
  if (!value) return "";
  return formatJournalDate(value) || value;
}

function FryerOilSettingsDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: EditingState | null;
  onSaved: () => void;
}) {
  const t = useTranslations("fryerOil");
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState("");
  const [dateFrom, setDateFrom] = useState("");

  useEffect(() => {
    if (!props.editing) return;
    setTitle(props.editing.title);
    setDateFrom(props.editing.dateFrom);
  }, [props.editing]);

  async function handleSave() {
    if (!props.editing) return;
    setSubmitting(true);

    try {
      const response = await fetch(`/api/journal-documents/${props.editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || props.editing.title,
          dateFrom,
        }),
      });

      if (!response.ok) {
        throw new Error("save_failed");
      }

      props.onOpenChange(false);
      props.onSaved();
    } catch {
      toast.error(t("saveSettingsError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (open && props.editing) {
          setTitle(props.editing.title);
          setDateFrom(props.editing.dateFrom);
        }
        props.onOpenChange(open);
      }}
    >
      <DialogContent className={JOURNAL_DIALOG_CONTENT_CLASS}>
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>
            {t("documentSettings")}
          </DialogTitle>
        </DialogHeader>

        <div className={cn(JOURNAL_DIALOG_BODY_CLASS, JOURNAL_DIALOG_FIELDS_CLASS)}>
          <FloatingInputField
            label={t("documentName")}
            value={title}
            onChange={setTitle}
          />

          <DateField label={t("startDate")} value={dateFrom} onChange={setDateFrom} />
        </div>

        <div className={JOURNAL_DIALOG_FOOTER_CLASS}>
          <div className={JOURNAL_DIALOG_ACTIONS_CLASS}>
            <Button
              type="button"
              onClick={handleSave}
              disabled={submitting}
              className={JOURNAL_DIALOG_SUBMIT_CLASS}
            >
              {submitting ? t("saving") : t("save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function FryerOilDocumentsClient(props: Props) {
  const t = useTranslations("fryerOil");
  const router = useRouter();
  const [editing, setEditing] = useState<EditingState | null>(null);
  const routeCode = props.routeCode || props.templateCode;
  const pageTitle = props.activeTab === "closed"
    ? `${t("pageTitle")} ${t("closedDocuments")}`
    : t("pageTitle");

  // Единый источник delete / status / pdf для журнальных документов.
  const { deleteDocument, openPdf } = useJournalDocumentActions();

  async function handleDelete(document: DocumentItem) {
    const displayTitle = document.title === FRYER_OIL_PAGE_TITLE ? t("pageTitle") : document.title;
    await deleteDocument({
      documentId: document.id,
      description: t("documentDeleteDescription", { title: displayTitle }),
      bullets: [
        { label: t("deleteAllRows"), tone: "warn" },
        { label: t("documentStarted", { date: formatDateDash(document.dateFrom) }), tone: "info" },
        { label: t("cannotRestorePrint"), tone: "warn" },
      ],
      successMessage: t("documentDeleted"),
      errorMessage: t("unknownError"),
    });
  }

  return (
    <div className={JOURNAL_LIST_STACK_CLASS}>
      <JournalTopBar
        routeCode={routeCode}
        heading={pageTitle}
        activeTab={props.activeTab}
        templateCode={props.templateCode}
        templateName={props.templateName}
        users={props.users}
        documentCount={props.documents.length}
      />

      <JournalTabs activeTab={props.activeTab} templateCode={routeCode} />

      <div className={JOURNAL_LIST_CARDS_CLASS}>
        {props.documents.length === 0 && (
          <EmptyDocumentsState
            templateCode={props.templateCode}
            templateName={props.templateName}
            users={props.users}
          />
        )}

        {props.documents.map((document) => {
          const href = `/journals/${routeCode}/documents/${document.id}`;

          return (
            <div
              key={document.id}
              className={JOURNAL_LIST_CARD_CLASS}
            >
              <Link href={href} className={JOURNAL_CARD_TITLE_CLASS}>
                {document.title === FRYER_OIL_PAGE_TITLE ? t("pageTitle") : document.title}
              <SharedDocumentBadge shared={document.shared} />
              </Link>

              <Link href={href} className={JOURNAL_CARD_SECTION_CLASS}>
                <div className={JOURNAL_CARD_LABEL_CLASS}>{t("startDate")}</div>
                <div className={JOURNAL_CARD_VALUE_CLASS}>
                  {formatDateDash(document.dateFrom)}
                </div>
              </Link>

              <div className="flex justify-center">
                <DocumentActionsMenu
                  size="sm"
                  document={document}
                  siblings={props.documents}
                  onEdit={
                    document.status === "active"
                      ? () =>
                          setEditing({
                            id: document.id,
                            title: document.title,
                            dateFrom: document.dateFrom,
                          })
                      : undefined
                  }
                  onPrint={() => {
                    openPdf({ documentId: document.id })
                  }}
                  onDelete={
                    document.status === "active"
                      ? () => void handleDelete(document)
                      : undefined
                  }
                />
              </div>
            </div>
          );
        })}
      </div>

      <FryerOilSettingsDialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        editing={editing}
        onSaved={() => router.refresh()}
      />
    </div>
  );
}
