"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FilePlus2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DateField,
  FloatingInputField,
  toIsoDateValue,
} from "@/components/journals/journal-dialog-field";
import {
  JOURNAL_DIALOG_ACTIONS_CLASS,
  JOURNAL_DIALOG_BODY_CLASS,
  JOURNAL_DIALOG_CONTENT_CLASS,
  JOURNAL_DIALOG_ERROR_CLASS,
  JOURNAL_DIALOG_FIELDS_CLASS,
  JOURNAL_DIALOG_FOOTER_CLASS,
  JOURNAL_DIALOG_HEADER_CLASS,
  JOURNAL_DIALOG_HINT_CLASS,
  JOURNAL_DIALOG_SUBMIT_CLASS,
  JOURNAL_DIALOG_TITLE_CLASS,
} from "@/components/journals/journal-responsive";
import { PositionEmployeePicker } from "@/components/shared/position-select";
import { buildJournalDocumentTitle } from "@/lib/journal-document-title";
import {
  hasResponsibleColumn,
  hasVerifierColumn,
  personFieldLabels,
} from "@/lib/paper-journal-columns";
import type { PaperJournal } from "@/lib/sphere-journal-rules";
import type { UserLike } from "@/lib/user-roles";
import { cn } from "@/lib/utils";

/** Сотрудник для каскада «должность → человек». */
export type PaperPickerUser = UserLike & { id: string; name: string };

type Person = { positionTitle: string; userId: string };
const EMPTY_PERSON: Person = { positionTitle: "", userId: "" };

/** Первое и последнее число текущего месяца — период по умолчанию. */
function currentMonthBounds(now: Date): { dateFrom: string; dateTo: string } {
  return {
    dateFrom: toIsoDateValue(new Date(now.getFullYear(), now.getMonth(), 1)),
    dateTo: toIsoDateValue(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
}

/**
 * Модалка создания документа бумажного журнала.
 *
 * Уменьшенная копия диалога электронных журналов: название с
 * автоподстановкой из периода, даты, ответственный и — только там, где
 * в бланке есть такая колонка — проверяющий. После создания человек
 * попадает на отдельную страницу документа, как в электронных журналах.
 */
export function CreatePaperDocumentDialog({
  journal,
  users,
  triggerClassName,
}: {
  journal: PaperJournal;
  users: PaperPickerUser[];
  triggerClassName?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [defaults] = useState(() => currentMonthBounds(new Date()));
  const [dateFrom, setDateFrom] = useState(defaults.dateFrom);
  const [dateTo, setDateTo] = useState(defaults.dateTo);
  const [title, setTitle] = useState(() =>
    buildJournalDocumentTitle({
      journalName: journal.name,
      dateFrom: defaults.dateFrom,
      dateTo: defaults.dateTo,
    }),
  );
  const [titleTouched, setTitleTouched] = useState(false);
  const [responsible, setResponsible] = useState<Person>(EMPTY_PERSON);
  const [verifier, setVerifier] = useState<Person>(EMPTY_PERSON);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const showResponsible = hasResponsibleColumn(journal);
  const showVerifier = hasVerifierColumn(journal);
  const labels = personFieldLabels(journal);
  const hasNoEmployees = users.length === 0;

  /**
   * Единая точка смены периода: кроме даты обновляет автоназвание, пока
   * человек не правил его руками. Через `useEffect` нельзя — эффект
   * перетирал бы ручную правку на любом ре-рендере.
   */
  function applyPeriod(next: { dateFrom?: string; dateTo?: string }) {
    const nextFrom = next.dateFrom ?? dateFrom;
    const nextTo = next.dateTo ?? dateTo;
    if (next.dateFrom !== undefined) setDateFrom(next.dateFrom);
    if (next.dateTo !== undefined) setDateTo(next.dateTo);
    if (titleTouched) return;
    setTitle(
      buildJournalDocumentTitle({
        journalName: journal.name,
        dateFrom: nextFrom,
        dateTo: nextTo,
      }),
    );
    setError("");
  }

  function handleTitleChange(value: string) {
    setTitle(value);
    setTitleTouched(true);
    if (error) setError("");
  }

  function handleOpenChange(next: boolean) {
    if (next && !title.trim()) {
      setTitleTouched(false);
      setTitle(
        buildJournalDocumentTitle({ journalName: journal.name, dateFrom, dateTo }),
      );
    }
    setOpen(next);
  }

  function nameOf(person: Person): string {
    return users.find((user) => user.id === person.userId)?.name ?? "";
  }

  async function submit() {
    if (!title.trim()) {
      setError("Укажите название документа");
      return;
    }
    if (dateFrom && dateTo && dateTo < dateFrom) {
      setError("Дата окончания раньше даты начала");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch(
        `/api/settings/journals/paper/${journal.id}/documents`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title.trim(),
            dateFrom,
            dateTo,
            responsible: showResponsible ? nameOf(responsible) : "",
            responsibleUserId: showResponsible ? responsible.userId : "",
            verifier: showVerifier ? nameOf(verifier) : "",
            verifierUserId: showVerifier ? verifier.userId : "",
          }),
        },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.document?.id) {
        setError(data?.error ?? "Не удалось создать документ");
        return;
      }
      toast.success("Документ создан");
      setOpen(false);
      router.push(
        `/settings/journals/paper/${journal.id}/documents/${data.document.id}`,
      );
    } catch {
      setError("Сеть недоступна. Попробуйте ещё раз");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-9 items-center gap-2 rounded-xl bg-[#5566f6] px-3 text-[13.5px] font-medium text-white transition-colors hover:bg-[#4a5bf0]",
            triggerClassName,
          )}
        >
          <FilePlus2 className="size-4" />
          Новый документ
        </button>
      </DialogTrigger>
      <DialogContent className={JOURNAL_DIALOG_CONTENT_CLASS}>
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>
            Создание документа
          </DialogTitle>
        </DialogHeader>

        <div className={cn(JOURNAL_DIALOG_BODY_CLASS, JOURNAL_DIALOG_FIELDS_CLASS)}>
          {error ? <p className={JOURNAL_DIALOG_ERROR_CLASS}>{error}</p> : null}

          <FloatingInputField
            id="paper-doc-title"
            label="Название документа"
            value={title}
            onChange={handleTitleChange}
            required
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <DateField
              id="paper-doc-date-from"
              label="Дата начала"
              value={dateFrom}
              onChange={(value) => applyPeriod({ dateFrom: value })}
            />
            <DateField
              id="paper-doc-date-to"
              label="Дата окончания"
              value={dateTo}
              onChange={(value) => applyPeriod({ dateTo: value })}
            />
          </div>

          {hasNoEmployees ? (
            <p className={JOURNAL_DIALOG_HINT_CLASS}>
              Активных сотрудников пока нет — документ создастся без
              ответственного, фамилии впишете в журнал от руки.{" "}
              <Link
                href="/settings/users"
                onClick={() => setOpen(false)}
                className="font-medium text-[#3848c7] underline-offset-4 hover:underline"
              >
                Добавить сотрудников
              </Link>
            </p>
          ) : (
            <>
              {showResponsible ? (
                <PositionEmployeePicker
                  users={users}
                  value={responsible}
                  onChange={setResponsible}
                  positionLabel="Должность ответственного"
                  employeeLabel={labels.responsible}
                  variant="floating"
                />
              ) : null}
              {showVerifier ? (
                <PositionEmployeePicker
                  users={users}
                  value={verifier}
                  onChange={setVerifier}
                  positionLabel="Должность проверяющего"
                  employeeLabel={labels.verifier}
                  variant="floating"
                />
              ) : null}
            </>
          )}
        </div>

        <div className={JOURNAL_DIALOG_FOOTER_CLASS}>
          <div className={JOURNAL_DIALOG_ACTIONS_CLASS}>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={saving}
              className={JOURNAL_DIALOG_SUBMIT_CLASS}
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              Создать документ
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
