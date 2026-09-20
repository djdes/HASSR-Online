"use client";

import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { toast } from "sonner";

import { JournalCellInput } from "@/components/journals/journal-cell-input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  CONTROL_PERIODICITY_MAX_LENGTH,
  sanitizeControlPeriodicity,
} from "@/lib/control-periodicity";
import { HEADER_TITLE_MAX, sanitizeHeaderTitle } from "@/lib/journal-header-title";
import { ORG_JOURNAL_NAME_MAX, sanitizeOrgJournalName } from "@/lib/org-journal-name";
import { cn } from "@/lib/utils";

/**
 * Правка бумажной шапки прямо в документе: название организации, название
 * документа и периодичность контроля.
 *
 * Шапку рисуют ~35 клиентов журналов через `JournalPaperHeaderRows`, и
 * ни один из них про правку не знает: страница документа один раз
 * оборачивает клиента в `JournalHeaderEditProvider`, а ячейки шапки
 * читают контекст. Без провайдера (образцы, публичные страницы) шапка
 * остаётся просто текстом.
 */

export type JournalHeaderEditValue = {
  documentId: string;
  /** Карандаши в шапке: право управлять журналами и документ не закрыт. */
  canEditDocument: boolean;
  /**
   * Право управлять журналами (`journals.manage` + управляющая роль),
   * БЕЗ учёта того, закрыт документ или нет.
   *
   * Нужно шапке и тулбарам документа: рядовому сотруднику нельзя
   * показывать «Автоматически заполнять журнал», «Настройки журнала» и
   * меню «…» — сервер на такой PATCH отвечает 403, и человек получал
   * тост «Недостаточно прав» вместо результата.
   */
  canManageJournals?: boolean;
  /** «Во всех журналах организации» — только администратор организации. */
  canEditOrganization: boolean;
  /** Название организации для всех журналов (без названия этого документа). */
  organizationJournalName: string;
  /** Что встанет в шапку, если общее название очистить (ЕГРЮЛ или полное). */
  organizationDefaultName: string;
  /** Название организации, заданное только этому документу, или null. */
  documentOrgName: string | null;
  /** Название документа, заданное в шапке, или null — стандартное название бланка. */
  headerTitle: string | null;
  /** Текст периодичности контроля этого документа. */
  controlPeriodicity: string;
};

const JournalHeaderEditContext = createContext<JournalHeaderEditValue | null>(null);

export function JournalHeaderEditProvider({
  value,
  children,
}: {
  value: JournalHeaderEditValue;
  children: ReactNode;
}) {
  return <JournalHeaderEditContext.Provider value={value}>{children}</JournalHeaderEditContext.Provider>;
}

export function useJournalHeaderEdit(): JournalHeaderEditValue | null {
  return useContext(JournalHeaderEditContext);
}

/**
 * Можно ли этому человеку показывать управление документом.
 *
 * Провайдера нет (образцы бланков, публичные страницы, превью) —
 * возвращаем `true`: там управление и так ничего не сохраняет, а
 * прятать его незачем. На настоящей странице документа провайдер есть
 * всегда, и флаг приходит из тех же прав, что проверяет PATCH.
 */
export function useCanManageJournalDocument(): boolean {
  const ctx = useContext(JournalHeaderEditContext);
  if (!ctx) return true;
  return ctx.canManageJournals !== false;
}

async function readError(response: Response, fallback: string): Promise<string> {
  const data = (await response.json().catch(() => null)) as { error?: string } | null;
  return data?.error || fallback;
}

async function patchDocument(documentId: string, body: Record<string, unknown>) {
  const response = await fetch(`/api/journal-documents/${documentId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await readError(response, "Не удалось сохранить шапку"));
}

/**
 * Карандаш показывается при наведении на ячейку (группа задаётся в
 * `JournalPaperHeaderRows`), на телефоне — всегда. В печать не попадает.
 */
const REVEAL_CLASS = {
  org: "[@media(hover:hover)]:group-hover/header-org:opacity-100",
  title: "[@media(hover:hover)]:group-hover/header-title:opacity-100",
  periodicity: "[@media(hover:hover)]:group-hover/header-periodicity:opacity-100",
} as const;

type HeaderCellKind = keyof typeof REVEAL_CLASS;

function InlineHeaderEditor({
  kind,
  label,
  initialValue,
  maxLength,
  multiline = false,
  inputClassName,
  sanitize,
  onCommit,
  children,
}: {
  kind: HeaderCellKind;
  /** Подпись карандаша и поля: «Изменить название организации». */
  label: string;
  initialValue: string;
  maxLength: number;
  multiline?: boolean;
  inputClassName?: string;
  sanitize: (value: unknown) => string;
  /**
   * Сохранить новое значение. `true` — правка завершена; `false` — поле
   * остаётся открытым (ошибка или ждём выбора в диалоге, который сам
   * вызовет `finish`).
   */
  onCommit: (value: string, finish: () => void) => Promise<boolean>;
  children: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialValue);
  const cancelled = useRef(false);
  const busy = useRef(false);

  function start() {
    cancelled.current = false;
    setDraft(initialValue);
    setEditing(true);
  }

  function finish() {
    setEditing(false);
  }

  async function commit() {
    if (busy.current) return;
    if (cancelled.current) {
      cancelled.current = false;
      finish();
      return;
    }
    const next = sanitize(draft);
    if (next === sanitize(initialValue)) {
      finish();
      return;
    }
    busy.current = true;
    try {
      if (await onCommit(next, finish)) finish();
    } finally {
      busy.current = false;
    }
  }

  if (editing) {
    return (
      <span className="block print:hidden">
        <JournalCellInput
          value={draft}
          autoFocus
          aria-label={label}
          maxLength={maxLength}
          multiline={multiline}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              cancelled.current = true;
              event.currentTarget.blur();
              return;
            }
            // Enter сохраняет и в многострочном поле — так ожидают в ячейке
            // бланка; перенос строки — Shift+Enter. Иначе текст «не сохранялся»:
            // Enter добавлял строку, а уход курсора из поля никто не делал.
            if (multiline && event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
          onBlur={() => void commit()}
          className={cn("bg-[#f5f6ff] ring-4 ring-[#5566f6]/15", inputClassName)}
        />
        <span className="mt-1 block text-[11px] font-normal normal-case not-italic leading-snug text-[#6f7282]">
          Enter — сохранить{multiline ? ", Shift+Enter — новая строка" : ""} · Esc — отменить
        </span>
      </span>
    );
  }

  return (
    <span className="relative inline-flex max-w-full items-start justify-center gap-1">
      <span className="min-w-0">{children}</span>
      <button
        type="button"
        onClick={start}
        title={label}
        aria-label={label}
        className={cn(
          "inline-flex size-6 shrink-0 items-center justify-center rounded-lg text-[#5566f6] transition-[opacity,background-color] duration-150 hover:bg-[#eef1ff] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 print:hidden [@media(hover:hover)]:opacity-0",
          REVEAL_CLASS[kind]
        )}
      >
        <Pencil className="size-3.5" />
      </button>
    </span>
  );
}

type OrgNameScope = "organization" | "document";

/** Ячейка организации: текст, карандаш и выбор «во всех журналах / только здесь». */
export function HeaderOrgName({ orgName }: { orgName: string }) {
  const edit = useJournalHeaderEdit();
  const router = useRouter();
  const [pending, setPending] = useState<{ value: string; finish: () => void } | null>(null);
  const [scope, setScope] = useState<OrgNameScope>("organization");

  if (!edit?.canEditDocument) return <>{orgName}</>;
  const context = edit;

  const current = context.documentOrgName ?? context.organizationJournalName;
  const preview = (value: string, target: OrgNameScope) =>
    value || (target === "organization" ? context.organizationDefaultName : context.organizationJournalName);

  async function save() {
    if (!pending) return;
    const { value, finish } = pending;
    try {
      if (scope === "organization") {
        const response = await fetch("/api/settings/organization", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ journalShortName: value }),
        });
        if (!response.ok) throw new Error(await readError(response, "Не удалось сохранить название"));
        // Своё название этого документа перебивало бы общее — снимаем его.
        if (context.documentOrgName) await patchDocument(context.documentId, { headerOrgName: "" });
        toast.success("Название обновлено в шапке всех журналов");
      } else {
        await patchDocument(context.documentId, { headerOrgName: value });
        toast.success(value ? "Название изменено только в этом документе" : "В этом документе снова общее название");
      }
      setPending(null);
      finish();
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить название");
    }
  }

  const options: Array<{ value: OrgNameScope; label: string; hint: string; disabled: boolean }> = [
    {
      value: "organization",
      label: "Во всех журналах организации",
      hint: context.canEditOrganization
        ? "Шапка каждого журнала и PDF. Документы с отдельным названием сохранят своё."
        : "Общее название меняет администратор организации.",
      disabled: !context.canEditOrganization,
    },
    {
      value: "document",
      label: "Только в этом документе",
      hint: "Остальные журналы не изменятся.",
      disabled: false,
    },
  ];

  return (
    <>
      <InlineHeaderEditor
        kind="org"
        label="Изменить название организации"
        initialValue={current}
        maxLength={ORG_JOURNAL_NAME_MAX}
        inputClassName="text-center text-[13px] font-semibold"
        sanitize={sanitizeOrgJournalName}
        onCommit={async (value, finish) => {
          setScope(context.canEditOrganization ? "organization" : "document");
          setPending({ value, finish });
          return false;
        }}
      >
        {orgName}
      </InlineHeaderEditor>
      <ConfirmDialog
        open={pending !== null}
        onClose={() => {
          pending?.finish();
          setPending(null);
        }}
        onConfirm={save}
        variant="info"
        title="Где поменять название?"
        description={
          pending ? (
            <>
              В шапке будет: <b className="font-semibold text-[#0b1024]">«{preview(pending.value, scope)}»</b>
            </>
          ) : null
        }
        confirmLabel="Сохранить"
      >
        <div className="space-y-2" role="radiogroup" aria-label="Где поменять название">
          {options.map((option) => (
            <label
              key={option.value}
              className={cn(
                "flex gap-3 rounded-2xl border px-4 py-3 transition-colors duration-150",
                option.disabled
                  ? "cursor-not-allowed border-[#ececf4] bg-[#fafbff] opacity-70"
                  : scope === option.value
                    ? "cursor-pointer border-[#5566f6] bg-[#f5f6ff]"
                    : "cursor-pointer border-[#ececf4] bg-white hover:bg-[#fafbff]"
              )}
            >
              <input
                type="radio"
                name="journal-header-org-scope"
                value={option.value}
                checked={scope === option.value}
                disabled={option.disabled}
                onChange={() => setScope(option.value)}
                className="mt-1 size-4 accent-[#5566f6]"
              />
              <span>
                <span className="block text-[14px] font-medium text-[#0b1024]">{option.label}</span>
                <span className="block text-[12.5px] text-[#6f7282]">{option.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </ConfirmDialog>
    </>
  );
}

/** Средняя ячейка: название документа (своё из шапки или стандартное бланка). */
export function HeaderTitle({ title }: { title: string }) {
  const edit = useJournalHeaderEdit();
  const router = useRouter();
  const shown = edit?.headerTitle || title;
  if (!edit?.canEditDocument) return <>{shown}</>;
  const context = edit;

  return (
    <InlineHeaderEditor
      kind="title"
      label="Изменить название документа"
      initialValue={shown}
      maxLength={HEADER_TITLE_MAX}
      inputClassName="text-center text-[13px] uppercase italic"
      sanitize={sanitizeHeaderTitle}
      onCommit={async (value) => {
        // Стандартное название не храним: пусто или совпало — снимаем своё.
        const next = value && value.toLocaleUpperCase("ru") !== title.toLocaleUpperCase("ru") ? value : "";
        try {
          await patchDocument(context.documentId, { headerTitle: next });
          toast.success(next ? "Название документа изменено" : "Вернули стандартное название документа");
          router.refresh();
          return true;
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Не удалось сохранить название");
          return false;
        }
      }}
    >
      {shown}
    </InlineHeaderEditor>
  );
}

/**
 * Значение строки «Периодичность контроля». Карандаш — только когда строка
 * показывает периодичность документа (`config.controlPeriodicity`): часть
 * журналов печатает здесь своё поле, и правка ушла бы не туда.
 */
export function HeaderPeriodicity({ text }: { text: string }) {
  const edit = useJournalHeaderEdit();
  const router = useRouter();
  if (!edit?.canEditDocument || text.trim() !== edit.controlPeriodicity.trim()) return <>{text}</>;
  const context = edit;

  return (
    <InlineHeaderEditor
      kind="periodicity"
      label="Изменить периодичность контроля"
      initialValue={text}
      maxLength={CONTROL_PERIODICITY_MAX_LENGTH}
      multiline
      inputClassName="text-[12.5px] leading-[1.4]"
      sanitize={sanitizeControlPeriodicity}
      onCommit={async (value) => {
        try {
          await patchDocument(context.documentId, { controlPeriodicity: value });
          toast.success(
            value
              ? "Периодичность контроля обновлена"
              : "Строка периодичности скрыта. Вернуть её можно в «Настройках журнала»"
          );
          router.refresh();
          return true;
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Не удалось сохранить периодичность");
          return false;
        }
      }}
    >
      {text}
    </InlineHeaderEditor>
  );
}
