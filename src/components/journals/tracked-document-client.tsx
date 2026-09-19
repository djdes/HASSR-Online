"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Plus, Trash2, Wand2 } from "lucide-react";
import {
  JournalDocumentHeader,
} from "@/components/journals/journal-document-header";
import { ResponsiveMenu } from "@/components/ui/responsive-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { JournalDocumentShell } from "@/components/journals/journal-document-shell";
import { RecordCardsView, type RecordCardItem } from "@/components/journals/record-cards-view";
import { submitWithOfflineFallback } from "@/lib/use-offline-submit";
import {
  CardEditSheet,
  type CardEditFieldDef,
  type CardEditValues,
} from "@/components/journals/card-edit-sheet";
import { useMobileView } from "@/lib/use-mobile-view";
import { JournalSettingsModal } from "@/components/journals/v2/journal-settings-modal";
import { FocusTodayScroller } from "@/components/journals/focus-today-scroller";
import {
  DOC_PRIMARY_BUTTON_CLASS,
  JOURNAL_DIALOG_BODY_CLASS,
  JOURNAL_DIALOG_GRID_CLASS,
  JOURNAL_DIALOG_HEADER_CLASS,
} from "@/components/journals/journal-responsive";
import { JournalSelectionBar } from "@/components/journals/journal-selection-bar";
import { SelectionEditButton } from "@/components/journals/selection-edit-button";
import { useSequentialEdit } from "@/components/journals/use-sequential-edit";
import { PestControlDocumentClient } from "@/components/journals/pest-control-document-client";
import {
  isPestControlDocumentFields,
  normalizePestControlEntryData,
} from "@/lib/pest-control-document";

import { toast } from "sonner";
import { useJournalUndo } from "@/lib/journal-undo";
import { confirmAsync } from "@/components/ui/confirm-async";
import { localDayKey } from "@/lib/entry-defaults";
import { useRosterViewerId } from "@/components/journals/use-roster-viewer";
type EmployeeItem = {
  id: string;
  name: string;
  role: string;
};

type FieldOption = {
  value: string;
  label: string;
};

type FieldItem = {
  key: string;
  label: string;
  type: string;
  options: FieldOption[];
};

type EntryItem = {
  id: string;
  employeeId: string;
  date: string;
  data: Record<string, unknown>;
};

type Props = {
  templateCode: string;
  documentId: string;
  title: string;
  organizationName: string;
  dateFrom: string;
  dateTo: string;
  responsibleTitle?: string | null;
  responsibleUserId?: string | null;
  status: string;
  employees: EmployeeItem[];
  fields: FieldItem[];
  initialEntries: EntryItem[];
  /** Design v2 toggle — пробрасывается в PestControlDocumentClient. */
  useV2?: boolean;
};

function formatDateLabel(date: string) {
  const [year, month, day] = date.split("-");
  return `${day}.${month}.${year}`;
}

function fieldValueToString(value: unknown) {
  if (value == null) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function isSelectLikeField(field: FieldItem) {
  return (
    field.type === "select" ||
    field.type === "employee" ||
    field.type === "equipment"
  );
}

function sortedEntries(entries: EntryItem[]) {
  return [...entries].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.employeeId.localeCompare(b.employeeId);
  });
}

function TrackedDocumentClientImpl({
  templateCode,
  documentId,
  title,
  dateFrom,
  dateTo,
  responsibleTitle,
  responsibleUserId,
  status,
  employees,
  fields,
  initialEntries,
  organizationName,
  useV2 = false,
}: Props) {
  const router = useRouter();
  const [entries, setEntries] = useState(sortedEntries(initialEntries));
  const [isCreating, setIsCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addRowOpen, setAddRowOpen] = useState(false);
  const [titleInput, setTitleInput] = useState(title);
  // Ни ответственного, ни новую строку не записываем на «первого в списке»:
  // строку по умолчанию — на вошедшего, если он в ростере документа.
  const viewerId = useRosterViewerId(employees);
  const [responsibleUserIdInput, setResponsibleUserIdInput] = useState(
    responsibleUserId || ""
  );
  const [responsibleTitleInput, setResponsibleTitleInput] = useState(
    responsibleTitle || ""
  );
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [newEmployeeId, setNewEmployeeId] = useState(viewerId);
  const [newDate, setNewDate] = useState(localDayKey());

  useEffect(() => {
    setEntries(sortedEntries(initialEntries));
  }, [initialEntries]);

  useEffect(() => {
    if (!settingsOpen) return;
    setTitleInput(title);
    setResponsibleUserIdInput(responsibleUserId || "");
    setResponsibleTitleInput(responsibleTitle || "");
  }, [settingsOpen, title, responsibleUserId, responsibleTitle]);

  useEffect(() => {
    if (!addRowOpen) return;
    setNewEmployeeId(viewerId);
    setNewDate(localDayKey());
  }, [addRowOpen, viewerId]);

  const { mobileView, switchMobileView } = useMobileView(templateCode);
  // Generic-клиент обслуживает все документные журналы без своей
  // реализации; его карточки не имели ни одного обработчика, то есть на
  // телефоне такие журналы не заполнялись вовсе.
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  /** Правка выделенных строк по очереди — тем же листом. */
  const seq = useSequentialEdit({
    open: (id) => {
      if (status !== "active" || !entries.some((item) => item.id === id)) return false;
      setEditingEntryId(id);
      return true;
    },
    close: () => setEditingEntryId(null),
  });

  const employeeMap = useMemo(
    () => Object.fromEntries(employees.map((item) => [item.id, item])),
    [employees]
  );

  /** Карточный вид телефона — те же строки, что в таблице. */
  const cardItems: RecordCardItem[] = entries.map((entry) => ({
    id: entry.id,
    title: formatDateLabel(entry.date),
    subtitle: employeeMap[entry.employeeId]?.name || "",
    onClick: status === "active" ? () => setEditingEntryId(entry.id) : undefined,
    // Без чекбокса строку нельзя было выделить и удалить с телефона.
    leading:
      status === "active" ? (
        <Checkbox
          checked={selectedRowIds.includes(entry.id)}
          onCheckedChange={(checked) =>
            setSelectedRowIds((current) =>
              checked === true
                ? [...new Set([...current, entry.id])]
                : current.filter((id) => id !== entry.id)
            )
          }
          className="size-5"
        />
      ) : null,
    fields: fields.map((field) => {
      const value = entry.data[field.key];
      return {
        label: field.label,
        value:
          typeof value === "boolean" ? (value ? "Да" : "Нет") : String(value ?? ""),
        hideIfEmpty: true,
      };
    }),
  }));
  const allSelected = entries.length > 0 && selectedRowIds.length === entries.length;
  // История отмены: только правки этого человека в этой вкладке.
  const undoStack = useJournalUndo({ enabled: status === "active" });

  /**
   * Запись строки. Отмена (Ctrl+Z) — это повторная запись прежнего
   * значения тем же PUT, а не правка состояния на клиенте: серверные
   * запреты (закрытый день, права) обязаны сработать и на откате.
   *
   * `silent` — вызов из истории: нового шага не кладём.
   */
  /**
   * `template.fields[]` → схема листа правки. Типы совпадают один в один,
   * кроме `equipment`/`employee` — они приходят уже развёрнутыми в
   * `options` на сервере (`documents/[docId]/page.tsx`), поэтому здесь это
   * обычный select.
   */
  function buildEntryEditFields(): CardEditFieldDef[] {
    return [
      { type: "date", key: "__date", label: "Дата" } as CardEditFieldDef,
      ...fields.map((field): CardEditFieldDef => {
        if (field.type === "number") {
          return {
            type: "number",
            key: field.key,
            label: field.label,
            step: 0.1,
          };
        }
        if (field.type === "boolean") {
          return { type: "boolean", key: field.key, label: field.label };
        }
        if (field.type === "date") {
          return { type: "date", key: field.key, label: field.label };
        }
        if (field.options.length > 0) {
          return {
            type: "select",
            key: field.key,
            label: field.label,
            options: field.options,
          };
        }
        return { type: "text", key: field.key, label: field.label };
      }),
    ];
  }

  function buildEntryEditValues(entryId: string): CardEditValues {
    const entry = entries.find((item) => item.id === entryId);
    if (!entry) return {};
    const values: CardEditValues = { __date: entry.date };
    for (const field of fields) {
      const value = entry.data[field.key];
      values[field.key] =
        typeof value === "boolean" ? value : value == null ? "" : String(value);
    }
    return values;
  }

  async function saveEntryFromSheet(entryId: string, values: CardEditValues) {
    const entry = entries.find((item) => item.id === entryId);
    if (!entry) return;

    const nextData: Record<string, unknown> = { ...entry.data };
    for (const field of fields) {
      const raw = values[field.key];
      if (field.type === "boolean") {
        nextData[field.key] = raw === true;
      } else if (field.type === "number") {
        const text = String(raw ?? "").trim().replace(",", ".");
        nextData[field.key] = text === "" ? null : Number(text);
      } else {
        nextData[field.key] = raw == null ? "" : String(raw);
      }
    }

    setEditingEntryId(null);
    try {
      await saveEntry({
        ...entry,
        date: String(values.__date ?? entry.date),
        data: nextData,
      });
      // Очередь правок откроет следующую строку.
      seq.saved();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Ошибка сохранения"
      );
      seq.cancelled();
    }
  }

  async function saveEntry(nextEntry: EntryItem, options?: { silent?: boolean }) {
    const previousEntry = entries.find((item) => item.id === nextEntry.id);
    // Строка уже существует ⇒ шлём её id: сервер ПЕРЕНОСИТ запись, а не
    // создаёт вторую с новой парой (сотрудник, дата).
    const entryId = previousEntry ? nextEntry.id : undefined;
    // Generic-клиент обслуживает большинство документных журналов, и
    // заполняют их там же, где и работают — в цеху, на складе, у линии.
    // Без связи запись раньше просто терялась.
    const submit = await submitWithOfflineFallback({
      method: "PUT",
      url: `/api/journal-documents/${documentId}/entries`,
      body: {
        ...(entryId ? { entryId } : {}),
        employeeId: nextEntry.employeeId,
        date: nextEntry.date,
        data: nextEntry.data,
      },
      label: `${templateCode} · ${nextEntry.date}`,
      group: templateCode,
    });

    if (submit.status === "queued") {
      toast.info("Нет связи — запись сохранится, когда она появится");
      return;
    }

    const response = submit.response;
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.entry) {
      throw new Error(result?.error || "Не удалось сохранить строку");
    }

    setEntries((current) => {
      const withoutCurrent = current.filter((item) => item.id !== nextEntry.id);
      return sortedEntries([
        ...withoutCurrent,
        { ...nextEntry, id: result.entry.id },
      ]);
    });

    // Шаг кладём ТОЛЬКО после успешного PUT: при ошибке значение и так
    // не изменилось, и отмена стала бы «лишней».
    if (!options?.silent && previousEntry) {
      const restored = { ...previousEntry, id: result.entry.id };
      undoStack.push({
        undo: () => saveEntry(restored, { silent: true }),
        redo: () => saveEntry({ ...nextEntry, id: result.entry.id }, { silent: true }),
      });
    }
  }

  async function createEntry(employeeId: string, date: string) {
    setIsCreating(true);
    try {
      const response = await fetch(`/api/journal-documents/${documentId}/entries`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId,
          date,
          data: {},
        }),
      });

      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.entry) {
        throw new Error(result?.error || "Не удалось добавить строку");
      }

      setEntries((current) =>
        sortedEntries([
          ...current,
          {
            id: result.entry.id,
            employeeId,
            date,
            data: {},
          },
        ])
      );
      setAddRowOpen(false);
    } finally {
      setIsCreating(false);
    }
  }

  async function fillForToday() {
    if (employees.length === 0) return;
    setIsCreating(true);
    try {
      const today = localDayKey();
      await Promise.all(
        employees.map((employee) =>
          fetch(`/api/journal-documents/${documentId}/entries`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              employeeId: employee.id,
              date: today,
              data: {},
            }),
          })
        )
      );
      router.refresh();
    } finally {
      setIsCreating(false);
    }
  }

  async function saveSettings() {
    const response = await fetch(`/api/journal-documents/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: titleInput.trim() || title,
        responsibleUserId: responsibleUserIdInput || null,
        responsibleTitle: responsibleTitleInput.trim() || null,
      }),
    });

    const result = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(result?.error || "Не удалось сохранить настройки");
    }

    setSettingsOpen(false);
    router.refresh();
  }

  async function removeEntry(entryId: string) {
    if (
      !(await confirmAsync({
        title: "Удалить строку?",
        description: "Запись исчезнет из журнала. Восстановить нельзя.",
        variant: "danger",
        confirmLabel: "Удалить",
      }))
    )
      return;

    const response = await fetch(`/api/journal-documents/${documentId}/entries`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [entryId] }),
    });

    if (!response.ok) {
      toast.error("Не удалось удалить строку");
      return;
    }

    setEntries((current) => current.filter((item) => item.id !== entryId));
    setSelectedRowIds((current) => current.filter((id) => id !== entryId));
  }

  async function removeSelectedEntries() {
    if (selectedRowIds.length === 0) return;
    const count = selectedRowIds.length;
    if (!(await confirmAsync({ title: "Удалить выбранные строки?", description: `Будет удалено строк: ${count}. Восстановить нельзя.`, variant: "danger", confirmLabel: "Удалить" }))) return;

    try {
      const response = await fetch(`/api/journal-documents/${documentId}/entries`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedRowIds }),
      });

      if (!response.ok) {
        throw new Error("Не удалось удалить строки");
      }

      setEntries((current) => current.filter((item) => !selectedRowIds.includes(item.id)));
      setSelectedRowIds([]);
      toast.success(`Удалено строк: ${count}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось удалить выбранные строки");
    }
  }

  return (
    <div className="space-y-5">
      {status === "active" ? (
        <JournalSelectionBar
          count={selectedRowIds.length}
          onClear={() => setSelectedRowIds([])}
          onDelete={() =>
            removeSelectedEntries().catch((error) =>
              toast.error(error instanceof Error ? error.message : "Ошибка удаления строк")
            )
          }
        >
          <SelectionEditButton count={selectedRowIds.length} onClick={() => seq.start(selectedRowIds)} />
        </JournalSelectionBar>
      ) : null}

      <FocusTodayScroller selector="[data-focus-today]" emptyTitle="Записей пока нет" emptyBody="Нажмите «Добавить» в таблице ниже, чтобы создать запись." />
      <JournalDocumentShell
        title={title}
        subtitle={`Период: ${formatDateLabel(dateFrom)} - ${formatDateLabel(dateTo)}`}
        documentId={documentId}
        backHref={`/journals/${templateCode}`}
        onSettings={() => setSettingsOpen(true)}
        settingsLabel="Настройки"
        closed={status !== "active"}
        closedHint="Откройте журнал заново, чтобы добавлять и править строки."
        undo={
          status === "active"
            ? {
                canUndo: undoStack.canUndo,
                canRedo: undoStack.canRedo,
                onUndo: () => void undoStack.undo(),
                onRedo: () => void undoStack.redo(),
                undoCount: undoStack.undoCount,
              }
            : undefined
        }
        mobileView={mobileView}
        onMobileView={switchMobileView}
        cards={<RecordCardsView items={cardItems} emptyLabel="Записей пока нет." />}
        paperHeader={
          <JournalDocumentHeader
            orgName={organizationName}
            title={title}
            startedAt={dateFrom}
            finishedAt={status === "closed" ? dateTo : null}
          />
        }
        sheetTitle={title}
        sheetMinWidth={1200}
        toolbar={
          status === "active" ? (
            <>
              <ResponsiveMenu
                title="Добавить"
                align="start"
                contentClassName="min-w-[260px] rounded-2xl border-0 p-2 shadow-xl"
                items={[
                  {
                    key: "add-row",
                    label: "Добавить строку",
                    icon: <Plus className="size-4 text-[#6f7282]" />,
                    onSelect: () => setAddRowOpen(true),
                  },
                  {
                    key: "fill-today",
                    label: "Заполнить за сегодня",
                    icon: <Wand2 className="size-4 text-[#6f7282]" />,
                    onSelect: () => {
                      fillForToday().catch((error) =>
                        toast.error(
                          error instanceof Error ? error.message : "Ошибка автозаполнения"
                        )
                      );
                    },
                  },
                ]}
                trigger={
                  <Button
                    type="button"
                    disabled={isCreating || employees.length === 0}
                    className={DOC_PRIMARY_BUTTON_CLASS}
                  >
                    <Plus className="size-5" />
                    Добавить
                    <ChevronDown className="size-4" />
                  </Button>
                }
              />
              {selectedRowIds.length > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    removeSelectedEntries().catch((error) =>
                      toast.error(error instanceof Error ? error.message : "Ошибка удаления строк")
                    )
                  }
                  className="h-9 rounded-xl border-[#ffd7d3] px-3.5 text-[13.5px] text-[#ff3b30] hover:bg-[#fff3f2]"
                >
                  <Trash2 className="size-5" />
                  Удалить ({selectedRowIds.length})
                </Button>
              ) : null}
            </>
          ) : null
        }
      >
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-[#f7f8fd]">
              {status === "active" && (
                <th className="w-[52px] border border-[#eceef5] px-2 py-3 text-center">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={(checked) =>
                      setSelectedRowIds(checked === true ? entries.map((entry) => entry.id) : [])
                    }
                    disabled={entries.length === 0}
                  />
                </th>
              )}
              <th className="border border-[#eceef5] px-4 py-3 text-left font-medium text-[#5b6075]">
                Дата
              </th>
              <th className="border border-[#eceef5] px-4 py-3 text-left font-medium text-[#5b6075]">
                Сотрудник
              </th>
              {fields.map((field) => (
                <th
                  key={field.key}
                  className="border border-[#eceef5] px-4 py-3 text-left font-medium text-[#5b6075]"
                >
                  {field.label}
                </th>
              ))}
              {status === "active" && (
                <th className="border border-[#eceef5] px-4 py-3 text-center font-medium text-[#5b6075]">
                  Действия
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className="hover:bg-[#fbfbfe]">
                {status === "active" && (
                  <td className="border border-[#eceef5] p-2 text-center align-top">
                    <div className="flex h-10 items-center justify-center">
                      <Checkbox
                        checked={selectedRowIds.includes(entry.id)}
                        onCheckedChange={(checked) =>
                          setSelectedRowIds((current) =>
                            checked === true
                              ? [...new Set([...current, entry.id])]
                              : current.filter((id) => id !== entry.id)
                          )
                        }
                      />
                    </div>
                  </td>
                )}
                <td className="border border-[#eceef5] p-2 align-top">
                  {status === "active" ? (
                    <Input
                      type="date"
                      defaultValue={entry.date}
                      className="h-10 rounded-xl border-[#dfe1ec]"
                      onBlur={(event) => {
                        // Поле неуправляемое: если сервер отверг перенос
                        // (у сотрудника уже есть запись на эту дату),
                        // возвращаем прежнюю дату руками.
                        const input = event.currentTarget;
                        saveEntry({
                          ...entry,
                          date: input.value,
                        }).catch((error) => {
                          input.value = entry.date;
                          toast.error(
                            error instanceof Error ? error.message : "Ошибка сохранения"
                          );
                        });
                      }}
                    />
                  ) : (
                    <div className="px-2 py-2 text-[15px] text-black">
                      {formatDateLabel(entry.date)}
                    </div>
                  )}
                </td>

                <td className="border border-[#eceef5] p-2 align-top">
                  {status === "active" ? (
                    <Select
                      value={entry.employeeId}
                      onValueChange={(value) => {
                        saveEntry({ ...entry, employeeId: value }).catch((error) =>
                          toast.error(
                            error instanceof Error ? error.message : "Ошибка сохранения"
                          )
                        );
                      }}
                    >
                      <SelectTrigger className="h-10 rounded-xl border-[#dfe1ec]">
                        <SelectValue placeholder="Сотрудник" />
                      </SelectTrigger>
                      <SelectContent>
                        {employees.map((employee) => (
                          <SelectItem key={employee.id} value={employee.id}>
                            {employee.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="px-2 py-2 text-[15px] text-black">
                      {employeeMap[entry.employeeId]?.name || ""}
                    </div>
                  )}
                </td>

                {fields.map((field) => {
                  const value = entry.data[field.key];
                  const stringValue = fieldValueToString(value);

                  return (
                    <td
                      key={`${entry.id}:${field.key}`}
                      className="border border-[#eceef5] p-2 align-top"
                    >
                      {status !== "active" ? (
                        <div className="px-2 py-2 text-[15px] text-black">
                          {stringValue || "-"}
                        </div>
                      ) : field.type === "boolean" ? (
                        <div className="flex h-10 items-center px-2">
                          <Checkbox
                            checked={value === true}
                            onCheckedChange={(checked) => {
                              saveEntry({
                                ...entry,
                                data: {
                                  ...entry.data,
                                  [field.key]: checked === true,
                                },
                              }).catch((error) =>
                                toast.error(
                                  error instanceof Error ? error.message : "Ошибка сохранения"
                                )
                              );
                            }}
                          />
                        </div>
                      ) : isSelectLikeField(field) && field.options.length > 0 ? (
                        <Select
                          value={stringValue || undefined}
                          onValueChange={(nextValue) => {
                            saveEntry({
                              ...entry,
                              data: {
                                ...entry.data,
                                [field.key]: nextValue,
                              },
                            }).catch((error) =>
                              toast.error(
                                error instanceof Error ? error.message : "Ошибка сохранения"
                              )
                            );
                          }}
                        >
                          <SelectTrigger className="h-10 rounded-xl border-[#dfe1ec]">
                            <SelectValue placeholder="Выберите значение" />
                          </SelectTrigger>
                          <SelectContent>
                            {field.options.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          type={
                            field.type === "number"
                              ? "number"
                              : field.type === "date"
                                ? "date"
                                : "text"
                          }
                          defaultValue={stringValue}
                          className="h-10 rounded-xl border-[#dfe1ec]"
                          onBlur={(event) =>
                            saveEntry({
                              ...entry,
                              data: {
                                ...entry.data,
                                [field.key]: event.target.value,
                              },
                            }).catch((error) =>
                              toast.error(
                                error instanceof Error ? error.message : "Ошибка сохранения"
                              )
                            )
                          }
                        />
                      )}
                    </td>
                  );
                })}

                {status === "active" && (
                  <td className="border border-[#eceef5] p-2 text-center align-top">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => removeEntry(entry.id)}
                      className="h-10 rounded-xl border-[#ffd7d3] px-3 text-[#ff3b30] hover:bg-[#fff3f2]"
                    >
                      <Trash2 className="size-4" />
                      Удалить
                    </Button>
                  </td>
                )}
              </tr>
            ))}

            {entries.length === 0 && (
              <tr>
                <td
                  colSpan={status === "active" ? fields.length + 4 : fields.length + 2}
                  className="border border-[#eceef5] p-8 text-center text-[16px] text-[#7d8196]"
                >
                  Пока нет строк. Добавьте первую запись.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </JournalDocumentShell>

      <Dialog open={addRowOpen} onOpenChange={setAddRowOpen}>
        <DialogContent className="max-h-[92vh] supports-[height:100dvh]:max-h-[92dvh] w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-[32px] border-0 p-0 sm:max-w-[760px]">
          <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
            <DialogTitle className="text-[22px] font-medium text-black">
              Добавить строку
            </DialogTitle>
          </DialogHeader>

          <div className={JOURNAL_DIALOG_BODY_CLASS}>
            <div className="space-y-3">
              <Label className="text-[14px] text-[#73738a]">Дата</Label>
              <Input
                type="date"
                value={newDate}
                onChange={(event) => setNewDate(event.target.value)}
                className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
              />
            </div>

            <div className="space-y-3">
              <Label className="text-[14px] text-[#73738a]">Сотрудник</Label>
              <Select value={newEmployeeId} onValueChange={setNewEmployeeId}>
                <SelectTrigger className="h-10 rounded-xl border-[#dfe1ec] bg-[#f3f4fb] px-3.5 text-[13.5px]">
                  <SelectValue placeholder="Выберите сотрудника" />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((employee) => (
                    <SelectItem key={employee.id} value={employee.id}>
                      {employee.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-end pt-2">
              <Button
                type="button"
                onClick={() =>
                  createEntry(newEmployeeId, newDate).catch((error) =>
                    toast.error(
                      error instanceof Error ? error.message : "Ошибка создания строки"
                    )
                  )
                }
                disabled={isCreating || !newDate || !newEmployeeId}
                className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] text-white hover:bg-[#4b57ff]"
              >
                {isCreating ? "Создание..." : "Создать"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {useV2 ? (
        <JournalSettingsModal
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          title="Настройки журнала"
          description="Название журнала и ответственный сотрудник."
          size="md"
          onSave={async () => {
            try {
              await saveSettings();
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Ошибка сохранения настроек");
            }
          }}
          onCancel={() => setSettingsOpen(false)}
        >
          <div className="space-y-2">
            <Label
              htmlFor="tracked-title-v2"
              className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]"
            >
              Название журнала
            </Label>
            <Input
              id="tracked-title-v2"
              value={titleInput}
              onChange={(event) => setTitleInput(event.target.value)}
              className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              Ответственный
            </Label>
            <Select
              value={responsibleUserIdInput}
              onValueChange={(value) => setResponsibleUserIdInput(value)}
            >
              <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-white text-[13.5px]">
                <SelectValue placeholder="— Выберите —" />
              </SelectTrigger>
              <SelectContent>
                {employees.map((employee) => (
                  <SelectItem key={employee.id} value={employee.id}>
                    {employee.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              Должность ответственного
            </Label>
            <Input
              value={responsibleTitleInput}
              onChange={(event) => setResponsibleTitleInput(event.target.value)}
              placeholder="Например: Технолог"
              className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
            />
          </div>
        </JournalSettingsModal>
      ) : (
        <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DialogContent className="max-h-[92vh] supports-[height:100dvh]:max-h-[92dvh] w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-[32px] border-0 p-0 sm:max-w-[860px]">
            <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
              <DialogTitle className="text-[22px] font-medium text-black">
                Настройки журнала
              </DialogTitle>
            </DialogHeader>

            <div className={JOURNAL_DIALOG_BODY_CLASS}>
              <div className="space-y-3">
                <Label htmlFor="journal-title" className="text-[14px] text-[#73738a]">
                  Название журнала
                </Label>
                <Input
                  id="journal-title"
                  value={titleInput}
                  onChange={(event) => setTitleInput(event.target.value)}
                  className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
                />
              </div>

              <div className={JOURNAL_DIALOG_GRID_CLASS}>
                <div className="space-y-3">
                  <Label className="text-[14px] text-[#73738a]">Ответственный</Label>
                  <Select
                    value={responsibleUserIdInput}
                    onValueChange={(value) => setResponsibleUserIdInput(value)}
                  >
                    <SelectTrigger className="h-10 rounded-xl border-[#dfe1ec] bg-[#f3f4fb] px-3.5 text-[13.5px]">
                      <SelectValue placeholder="Выберите сотрудника" />
                    </SelectTrigger>
                    <SelectContent>
                      {employees.map((employee) => (
                        <SelectItem key={employee.id} value={employee.id}>
                          {employee.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-3">
                  <Label htmlFor="journal-responsible-title" className="text-[14px] text-[#73738a]">
                    Должность ответственного
                  </Label>
                  <Input
                    id="journal-responsible-title"
                    value={responsibleTitleInput}
                    onChange={(event) => setResponsibleTitleInput(event.target.value)}
                    className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
                    placeholder="Например: Технолог"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <Button
                  type="button"
                  onClick={() =>
                    saveSettings().catch((error) =>
                      toast.error(
                        error instanceof Error ? error.message : "Ошибка сохранения настроек"
                      )
                    )
                  }
                  className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] text-white hover:bg-[#4b57ff]"
                >
                  Сохранить
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Правка строки из карточного режима — схема собирается из
          template.fields, тех же, по которым построена таблица. */}
      <CardEditSheet
        open={editingEntryId !== null}
        title={`Запись журнала${seq.progress ? ` ${seq.progress}` : ""}`}
        subtitle={
          editingEntryId
            ? formatDateLabel(
                entries.find((entry) => entry.id === editingEntryId)?.date ?? ""
              )
            : undefined
        }
        fields={editingEntryId ? buildEntryEditFields() : []}
        values={editingEntryId ? buildEntryEditValues(editingEntryId) : {}}
        onClose={() => seq.cancelled()}
        onSubmit={(values) => {
          if (!editingEntryId) return;
          void saveEntryFromSheet(editingEntryId, values);
        }}
      />
    </div>
  );
}

export function TrackedDocumentClient(props: Props) {
  if (props.templateCode === "pest_control" || isPestControlDocumentFields(props.fields)) {
    return (
      <PestControlDocumentClient
        documentId={props.documentId}
        title={props.title}
        organizationName={props.organizationName}
        dateFrom={props.dateFrom}
        dateTo={props.dateTo}
        status={props.status}
        routeCode="pest_control"
        users={props.employees}
        initialEntries={props.initialEntries.map((entry) => ({
          id: entry.id,
          data: normalizePestControlEntryData(
            entry.data,
            entry.date,
            props.employees,
            entry.employeeId
          ),
        }))}
        useV2={props.useV2}
      />
    );
  }

  return <TrackedDocumentClientImpl {...props} />;
}
