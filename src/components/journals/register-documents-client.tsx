"use client";

import Link from "next/link";

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
import { formatJournalDate } from "@/lib/journal-card-date";
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
  const journal = getRegisterJournal(templateCode);
  const actions = useJournalDocumentActions();

  return (
    <div className="space-y-8">
      <JournalTopBar
        heading={activeTab === "closed" ? `${templateName} (закрытые)` : templateName}
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
                  ? `${journal.hint} Создайте документ — записи будут готовы к печати и проверке.`
                  : undefined
              }
              templateCode={templateCode}
              templateName={templateName}
              users={users}
            />
          ) : (
            <EmptyDocumentsState
              label="Закрытых документов нет"
              description="Сюда попадают журналы, которые закончили кнопкой «Закончить журнал»."
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
              {document.title}
              <SharedDocumentBadge shared={document.shared} />
            </Link>
            <Link
              href={`/journals/${routeCode}/documents/${document.id}`}
              className={`${JOURNAL_CARD_SECTION_CLASS} justify-self-end`}
            >
              <div className={JOURNAL_CARD_LABEL_CLASS}>Записей</div>
              <div className={`${JOURNAL_CARD_VALUE_CLASS} tabular-nums`}>{document.rowsCount}</div>
            </Link>
            <Link
              href={`/journals/${routeCode}/documents/${document.id}`}
              className={`${JOURNAL_CARD_SECTION_CLASS} justify-self-end`}
            >
              <div className={JOURNAL_CARD_LABEL_CLASS}>Дата начала</div>
              <div className={JOURNAL_CARD_VALUE_CLASS}>
                {formatJournalDate(document.dateFrom) || document.dateFrom}
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
                          description: `Документ «${document.title}» будет удалён безвозвратно.`,
                          bullets: [
                            {
                              label:
                                document.rowsCount === 0
                                  ? "Записей в документе нет"
                                  : `Записей будет удалено: ${document.rowsCount}`,
                              tone: "warn",
                            },
                          ],
                          successMessage: `Документ «${document.title}» удалён`,
                          errorMessage: "Не удалось удалить документ",
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
