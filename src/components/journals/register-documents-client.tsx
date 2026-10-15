"use client";

import Link from "next/link";
import { toast } from "sonner";
import { useGenericRegisterCopy } from "./use-generic-register-copy";
import { registerDate, registerName, registerTitle } from "./generic-register-presentation";

import {
  DocumentActionsMenu,
  EmptyDocumentsState,
  JournalTabs,
  JournalTopBar,
} from "@/components/journals/document-list-ui";
import {
  JOURNAL_CARD_LABEL_CLASS,
  JOURNAL_CARD_SECTION_CLASS,
  JOURNAL_CARD_TITLE_CLASS,
  JOURNAL_CARD_VALUE_CLASS,
  JOURNAL_LIST_CARD_CLASS,
  JOURNAL_LIST_CARDS_CLASS,
} from "@/components/journals/journal-responsive";
import { SharedDocumentBadge } from "@/components/journals/shared-document-badge";
import { useJournalDocumentActions } from "@/components/journals/use-journal-document-actions";
import { getRegisterJournal } from "@/lib/register-journals";

/**
 * Список документов табличного журнала-реестра (суточные пробы,
 * витаминизация, рацион, перевозка, бой посуды, вода в бассейне).
 * Создание — общим `CreateDocumentDialog` (период берётся из
 * `journal-period.ts`), удаление — через `useJournalDocumentActions`
 * с числом записей, которые исчезнут.
 */

type RegisterListDocument = {
  id: string;
  title: string;
  shared?: boolean;
  status: "active" | "closed";
  dateFrom: string;
  dateTo: string;
  rowsCount: number;
};

type Props = {
  activeTab: "active" | "closed";
  routeCode: string;
  templateCode: string;
  templateName: string;
  users: { id: string; name: string; role: string }[];
  documents: RegisterListDocument[];
};

export function RegisterDocumentsClient({
  activeTab,
  routeCode,
  templateCode,
  templateName,
  users,
  documents,
}: Props) {
  const { t, locale, messages, latest } = useGenericRegisterCopy();
  const journal = getRegisterJournal(templateCode);
  const displayName = registerName(templateCode, templateName, messages);
  const displayTitle = (document: RegisterListDocument) => registerTitle(document.title, templateCode, document.dateFrom, document.dateTo, locale, messages, t);
  const actions = useJournalDocumentActions();

  return (
    <div className="space-y-8">
      <JournalTopBar
        heading={activeTab === "closed" ? t("list.closedHeading", { title: displayName }) : displayName}
        activeTab={activeTab}
        templateCode={templateCode}
        templateName={templateName}
        routeCode={routeCode}
        users={users}
        documentCount={documents.length}
        firstDocumentId={documents[0]?.id}
      />
      <JournalTabs activeTab={activeTab} templateCode={routeCode} />

      <div className={JOURNAL_LIST_CARDS_CLASS}>
        {documents.length === 0 ? (
          activeTab === "active" ? (
            <EmptyDocumentsState
              description={
                journal
                  ? messages.genericRegister.journals[templateCode]?.emptyDescription
                  : undefined
              }
              templateCode={templateCode}
              templateName={templateName}
              users={users}
            />
          ) : (
            <EmptyDocumentsState
              label={t("list.closedEmpty")}
              description={t("list.closedDescription")}
              canManage={false}
            />
          )
        ) : null}

        {documents.map((document) => (
          <div key={document.id} className={JOURNAL_LIST_CARD_CLASS}>
            <Link
              href={`/journals/${routeCode}/documents/${document.id}`}
              className={JOURNAL_CARD_TITLE_CLASS}
            >
              {displayTitle(document)}
              <SharedDocumentBadge shared={document.shared} />
            </Link>
            <Link
              href={`/journals/${routeCode}/documents/${document.id}`}
              className={`${JOURNAL_CARD_SECTION_CLASS} justify-self-end`}
            >
              <div className={JOURNAL_CARD_LABEL_CLASS}>{t("list.entryCount")}</div>
              <div className={`${JOURNAL_CARD_VALUE_CLASS} tabular-nums`}>{new Intl.NumberFormat(locale).format(document.rowsCount)}</div>
            </Link>
            <Link
              href={`/journals/${routeCode}/documents/${document.id}`}
              className={`${JOURNAL_CARD_SECTION_CLASS} justify-self-end`}
            >
              <div className={JOURNAL_CARD_LABEL_CLASS}>{t("settings.startDate")}</div>
              <div className={JOURNAL_CARD_VALUE_CLASS}>
                {registerDate(document.dateFrom.slice(0, 10), locale) || document.dateFrom}
              </div>
            </Link>
            <div className="justify-self-end">
              <DocumentActionsMenu
                document={document}
                siblings={documents}
                onPrint={() => actions.openPdf({ documentId: document.id })}
                onDelete={
                  document.status === "active"
                    ? () =>
                        void actions.deleteDocument({
                          documentId: document.id,
                          description: t("list.deleteDescription", { title: displayTitle(document) }),
                          bullets: [
                            {
                              label:
                                document.rowsCount === 0
                                  ? t("list.emptyDeleteCount")
                                  : t("selection.deleteCount", { count: document.rowsCount }),
                              tone: "warn",
                            },
                          ],
                          successMessage: null,
                          onSuccess: () => {
                            const current = latest.current;
                            toast.success(current.t("list.deleted", { title: registerTitle(document.title, templateCode, document.dateFrom, document.dateTo, current.locale, current.messages, current.t) }));
                          },
                        })
                    : undefined
                }
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
