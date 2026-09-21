"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  FloatingInputField,
  FloatingLabelField,
} from "@/components/journals/journal-dialog-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { toast } from "sonner";
import { confirmAsync } from "@/components/ui/confirm-async";
import {
  DocumentActionsMenu,
  EmptyDocumentsState,
  JournalTabs,
  JournalTopBar,
} from "@/components/journals/document-list-ui";
import { useJournalDocumentActions } from "@/components/journals/use-journal-document-actions";
import { PageGuide } from "@/components/ui/page-guide";
import { AUTOMATION_ENABLE_BULLETS } from "@/lib/journal-automation";
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
import { SharedDocumentBadge } from "@/components/journals/shared-document-badge";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";

type HealthListDocument = {
  id: string;
  title: string;
  /** Точки: документ без точки рядом с документами точек. */
  shared?: boolean;
  status: "active" | "closed";
  responsibleTitle: string | null;
  periodLabel: string;
  printEmptyRows?: number;
  /** Период документа `YYYY-MM-DD` — его можно менять в настройках. */
  dateFrom?: string;
  dateTo?: string;
};

type Props = {
  activeTab: "active" | "closed";
  templateCode: string;
  templateName: string;
  users: { id: string; name: string; role: string }[];
  documents: HealthListDocument[];
  /** См. HygieneDocumentsClient.automation — тумблер «журнал ведётся сам». */
  automation?: {
    code: string;
    enabled: boolean;
    canManage: boolean;
    noticeSeen: boolean;
  };
  /**
   * Есть ли право создавать / настраивать / удалять документы. Раньше
   * повар видел эти действия, а API отвечал 403.
   */
  canManageDocuments?: boolean;
};

const EMPTY_ROWS_OPTIONS = [0, 1, 2, 3, 4, 5, 10, 15, 20];

function EditDocumentDialog(props: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  document: HealthListDocument | null;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [emptyRows, setEmptyRows] = useState("0");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!props.document || !props.open) return;
    setTitle(props.document.title);
    setEmptyRows(String(props.document.printEmptyRows ?? 0));
    setFrom(props.document.dateFrom || "");
    setTo(props.document.dateTo || "");
  }, [props.document, props.open]);

  const periodEditable = Boolean(props.document?.dateFrom && props.document?.dateTo);

  async function handleSave() {
    if (!props.document) return;
    if (periodEditable) {
      if (!from || !to) {
        toast.error("Укажите период документа");
        return;
      }
      if (from > to) {
        toast.error("Дата начала не может быть позже даты окончания");
        return;
      }
    }

    // Сокращение периода сервер принимает только с явным shrinkPeriod —
    // предупреждаем, что отметки за его пределами уйдут из бланка.
    const shrinks =
      periodEditable &&
      (from > (props.document.dateFrom || "") || to < (props.document.dateTo || ""));
    if (shrinks) {
      const confirmed = await confirmAsync({
        title: "Сократить период документа?",
        description: `Новый период: ${from} — ${to}.`,
        variant: "warn",
        confirmLabel: "Сократить период",
        bullets: [
          {
            label: "Записи вне нового периода пропадут из бланка и печати",
            tone: "warn",
          },
          { label: "Из базы они не удаляются", tone: "info" },
        ],
      });
      if (!confirmed) return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/journal-documents/${props.document.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || "Журнал здоровья",
          config: {
            printEmptyRows: Math.max(0, Number(emptyRows) || 0),
          },
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
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "Не удалось сохранить настройки документа");
      }

      props.onOpenChange(false);
      router.refresh();
    } catch (error) {
      toast.error(
        humanizeFetchError(error, "Не удалось сохранить настройки документа")
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className={JOURNAL_DIALOG_CONTENT_CLASS}>
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>
            Настройки журнала
          </DialogTitle>
        </DialogHeader>

        <div className={cn(JOURNAL_DIALOG_BODY_CLASS, JOURNAL_DIALOG_FIELDS_CLASS)}>
          <FloatingInputField
            id="edit-health-doc-title"
            label="Название документа"
            value={title}
            onChange={setTitle}
          />

          <FloatingLabelField label="Добавлять пустых строк при печати">
            <Select value={emptyRows} onValueChange={setEmptyRows}>
              <SelectTrigger className={JOURNAL_DIALOG_FIELD_TRIGGER_CLASS}>
                {/* P8: то же, что в диалоге создания — значение рендерим
                    явными children, иначе «0» не показывается вовсе. */}
                <SelectValue placeholder="0">{emptyRows}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {EMPTY_ROWS_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FloatingLabelField>

          {/* Период документа: в гигиене его менять давали, в здоровье — нет. */}
          {periodEditable ? (
            <div className="space-y-2">
              <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
                Период документа
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                  aria-label="Период документа: с"
                  className="h-10 w-[165px] rounded-xl border border-[#dcdfed] px-3.5 text-[13.5px] text-[#0b1024] outline-none transition-colors duration-150 focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
                />
                <span className="text-[13.5px] text-[#6f7282]">по</span>
                <input
                  type="date"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                  aria-label="Период документа: по"
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
              {isSubmitting ? "Сохранение..." : "Сохранить"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function HealthDocumentRow(props: {
  document: HealthListDocument;
  /** Соседи по списку — нужны проверке пересечения при возврате из закрытых. */
  siblings: HealthListDocument[];
  templateCode: string;
  canManage?: boolean;
  onEdit: (document: HealthListDocument) => void;
  onPrint: (document: HealthListDocument) => void;
  onDelete: (document: HealthListDocument) => void;
}) {
  const href = `/journals/${props.templateCode}/documents/${props.document.id}`;
  const canManage = props.document.status === "active" && props.canManage !== false;

  return (
    <div className={JOURNAL_LIST_CARD_CLASS}>
      <Link href={href} className={JOURNAL_CARD_TITLE_CLASS}>
        {props.document.title}
              <SharedDocumentBadge shared={props.document.shared} />
      </Link>
      <Link href={href} className={JOURNAL_CARD_SECTION_CLASS}>
        <div className={JOURNAL_CARD_LABEL_CLASS}>Период</div>
        <div className={JOURNAL_CARD_VALUE_CLASS}>{props.document.periodLabel}</div>
      </Link>
      {/* Пустая мета-колонка БЕЗ делителя: раньше здесь стоял
          `JOURNAL_CARD_SECTION_CLASS`, и карточка рисовала вертикальную
          линию, за которой ничего не было. */}
      <div />
      <div className="flex items-center justify-center text-[#5566f6]">
        <DocumentActionsMenu
          document={props.document}
          siblings={props.siblings}
          onEdit={canManage ? () => props.onEdit(props.document) : undefined}
          onPrint={() => props.onPrint(props.document)}
          onDelete={canManage ? () => props.onDelete(props.document) : undefined}
        />
      </div>
    </div>
  );
}

export function HealthDocumentsClient(props: Props) {
  const [editingDocument, setEditingDocument] = useState<HealthListDocument | null>(null);
  const heading = props.activeTab === "closed" ? "Журнал здоровья (закрытые)" : "Журнал здоровья";
  const { deleteDocument, openPdf } = useJournalDocumentActions();

  async function handleDelete(document: HealthListDocument) {
    await deleteDocument({
      documentId: document.id,
      description: `Документ «${document.title}» будет удалён безвозвратно.`,
      bullets: [
        { label: `Период документа: ${document.periodLabel}`, tone: "info" },
        { label: "Удалятся все отметки сотрудников за этот период", tone: "warn" },
        { label: "Печатную форму этого документа восстановить будет нельзя", tone: "warn" },
      ],
      successMessage: `Документ «${document.title}» удалён`,
      errorMessage: "Ошибка удаления документа",
    });
  }

  return (
    <>
      <div className={JOURNAL_LIST_STACK_CLASS}>
        <JournalTopBar
          heading={heading}
          activeTab={props.activeTab}
          templateCode={props.templateCode}
          templateName={props.templateName}
          users={props.users}
          documentCount={props.documents.length}
          canManage={props.canManageDocuments !== false}
        />

        <JournalTabs activeTab={props.activeTab} templateCode={props.templateCode} />

        {props.automation ? (
          <>
            <PageGuide
              title="Как журнал ведётся сам"
              storageKey="journal-automation-staff-v1"
              bullets={[...AUTOMATION_ENABLE_BULLETS]}
              qa={[
                {
                  q: "А если у сотрудника температура?",
                  a: "Откройте журнал в тот же день и поменяйте отметку. Прошлые дни закрыты — задним числом журнал править нельзя.",
                },
                {
                  q: "Нужно ли создавать документ вручную?",
                  a: "Нет. Каждый день в 06:00 документ на текущий период создаётся сам. Вручную — только если нужен документ на другой период.",
                },
                {
                  q: "Как выключить?",
                  a: "Автосоздание — тумблер на этой странице, ежедневное заполнение — в самом документе. Уже заполненное останется на месте.",
                },
              ]}
            />
          </>
        ) : null}


        <div className={JOURNAL_LIST_CARDS_CLASS}>
          {props.documents.length === 0 && (
            <EmptyDocumentsState
              templateCode={props.templateCode}
              templateName={props.templateName}
              users={props.users}
              canManage={props.canManageDocuments !== false}
            />
          )}
          {props.documents.map((document) => (
            <HealthDocumentRow
              key={document.id}
              document={document}
              siblings={props.documents}
              templateCode={props.templateCode}
              canManage={props.canManageDocuments !== false}
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
      />
    </>
  );
}
