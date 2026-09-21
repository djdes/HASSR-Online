"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { isManagementRole } from "@/lib/user-roles";
import { toast } from "sonner";
import { useJournalUndo } from "@/lib/journal-undo";
import { Archive, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { JournalSelectionBar } from "@/components/journals/journal-selection-bar";
import { SelectionEditButton } from "@/components/journals/selection-edit-button";
import { useSequentialEdit } from "@/components/journals/use-sequential-edit";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PEST_CONTROL_DOCUMENT_TITLE,
  PEST_CONTROL_PAGE_TITLE,
  createEmptyPestControlEntry,
  formatPestControlDateTime,
  getPestControlRoleOptions,
  getPestControlUsersForRole,
  type PestControlEntryData,
} from "@/lib/pest-control-document";
import { JournalDocumentShell } from "@/components/journals/journal-document-shell";
import { JournalDocumentHeader } from "@/components/journals/journal-document-header";
import { JournalAddRow } from "@/components/journals/journal-add-row";
import { GRID_CELL_CLASS, GRID_HEAD_CELL_CLASS } from "@/components/journals/journal-grid";
import { JournalSettingsModal } from "@/components/journals/v2/journal-settings-modal";
import { FocusTodayScroller } from "@/components/journals/focus-today-scroller";
import { useMobileView } from "@/lib/use-mobile-view";
import {
  RecordCardsView,
  type RecordCardItem,
} from "@/components/journals/record-cards-view";
import { localDayKey } from "@/lib/entry-defaults";
import { useTodayKey } from "@/lib/use-today-key";

type UserItem = {
  id: string;
  name: string;
  role: string;
};

type EntryItem = {
  id: string;
  data: PestControlEntryData;
};

type Props = {
  documentId: string;
  title: string;
  organizationName: string;
  status: string;
  dateFrom: string;
  dateTo: string;
  routeCode: string;
  users: UserItem[];
  initialEntries: EntryItem[];
  /** Design v2 toggle. */
  useV2?: boolean;
};

type EditingEntry = {
  id: string;
  data: PestControlEntryData;
};

function DocumentSettingsDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTitle: string;
  initialDateFrom: string;
  onSubmit: (payload: { title: string; dateFrom: string }) => Promise<void>;
  useV2?: boolean;
}) {
  const [title, setTitle] = useState(props.initialTitle);
  const [dateFrom, setDateFrom] = useState(props.initialDateFrom);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!props.open) return;
    setTitle(props.initialTitle);
    setDateFrom(props.initialDateFrom);
  }, [props.open, props.initialDateFrom, props.initialTitle]);

  async function handleSave() {
    setSubmitting(true);
    try {
      await props.onSubmit({
        title: title.trim() || PEST_CONTROL_DOCUMENT_TITLE,
        dateFrom,
      });
      props.onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  if (props.useV2) {
    return (
      <JournalSettingsModal
        open={props.open}
        onOpenChange={props.onOpenChange}
        title="Настройки документа"
        description="Название документа и дата начала."
        size="md"
        isSaving={submitting}
        saveDisabled={!dateFrom}
        onSave={handleSave}
        onCancel={() => props.onOpenChange(false)}
      >
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            Название документа
          </Label>
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Введите название"
            className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            Дата начала
          </Label>
          <Input
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
            className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
          />
        </div>
      </JournalSettingsModal>
    );
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent showCloseButton={false} className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[24px] border-0 p-0 sm:max-w-[560px]">
        <DialogHeader className="flex flex-row items-center justify-between border-b px-7 py-5">
          <DialogTitle className="text-[24px] font-medium text-black">
            Настройки документа
          </DialogTitle>
          <button
            type="button"
            className="rounded-md p-1 text-black/80 hover:bg-black/5"
            onClick={() => props.onOpenChange(false)}
          >
            <X className="size-6" />
          </button>
        </DialogHeader>
        <div className="space-y-5 px-7 py-6">
          <PestFieldLabel htmlFor="pest-settings-title" label="Название документа">
          <Input
            id="pest-settings-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Введите название документа"
            className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
          />
          </PestFieldLabel>
          <PestFieldLabel htmlFor="pest-settings-date" label="Дата начала">
          <Input
            id="pest-settings-date"
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
            className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
          />
          </PestFieldLabel>
          <div className="flex justify-end">
            <Button
              type="button"
              disabled={submitting || !dateFrom}
              className="h-12 rounded-xl bg-[#5863f8] px-7 text-[18px] text-white hover:bg-[#4b57f3]"
              onClick={handleSave}
            >
              {submitting ? "Сохранение..." : "Сохранить"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  submitLabel: string;
  onSubmit: () => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent showCloseButton={false} className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[24px] border-0 p-0 sm:max-w-[560px]">
        <DialogHeader className="flex flex-row items-center justify-between border-b px-7 py-5">
          <DialogTitle className="text-[24px] font-medium text-black">
            {props.title}
          </DialogTitle>
          <button
            type="button"
            className="rounded-md p-1 text-black/80 hover:bg-black/5"
            onClick={() => props.onOpenChange(false)}
          >
            <X className="size-6" />
          </button>
        </DialogHeader>
        <div className="flex justify-end px-7 py-6">
          <Button
            type="button"
            disabled={submitting}
            className="h-12 rounded-xl bg-[#5863f8] px-7 text-[18px] text-white hover:bg-[#4b57f3]"
            onClick={async () => {
              setSubmitting(true);
              try {
                await props.onSubmit();
                props.onOpenChange(false);
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {submitting ? "Подождите..." : props.submitLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Постоянная подпись над полем окна «Добавление новой строки».
 * Плейсхолдер исчезает при вводе — подпись остаётся.
 */
function PestFieldLabel(props: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={props.htmlFor} className="text-[14px] text-[#6f7282]">
        {props.label}
      </Label>
      {props.children}
    </div>
  );
}

function EntryDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  users: UserItem[];
  title: string;
  submitLabel: string;
  initial: EditingEntry | null;
  onSubmit: (payload: PestControlEntryData, entryId?: string) => Promise<void>;
}) {
  const roleOptions = useMemo(() => getPestControlRoleOptions(props.users), [props.users]);
  const [entry, setEntry] = useState<PestControlEntryData>(
    createEmptyPestControlEntry(props.users, localDayKey())
  );
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!props.open) return;
    if (props.initial?.data) {
      setEntry(props.initial.data);
      return;
    }
    // A7 — auto-fill current HH:MM для новой записи. Шаг select'а минут =
    // 5, поэтому округляем; юзер всегда может сбросить через "--".
    const now = new Date();
    // Округление ВНИЗ: `Math.round` в 10:58 давал 60 → «00», и запись
    // подставлялась как 10:00 — на час назад.
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(Math.floor(now.getMinutes() / 5) * 5).padStart(2, "0");
    setEntry({
      ...createEmptyPestControlEntry(props.users, localDayKey()),
      timeSpecified: true,
      performedHour: hh,
      performedMinute: mm,
    });
  }, [props.initial, props.open, props.users]);

  const employeeOptions = getPestControlUsersForRole(props.users, entry.acceptedRole);

  function updateAcceptedRole(nextRole: string) {
    const nextUsers = getPestControlUsersForRole(props.users, nextRole);
    setEntry((current) => ({
      ...current,
      acceptedRole: nextRole,
      acceptedEmployeeId:
        nextUsers.find((item) => item.id === current.acceptedEmployeeId)?.id ||
        nextUsers[0]?.id ||
        "",
    }));
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent showCloseButton={false} className="max-h-[90vh] supports-[height:100dvh]:max-h-[90dvh] w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-[28px] border-0 p-0 sm:max-w-[620px]">
        <DialogHeader className="flex flex-row items-center justify-between border-b px-7 py-5">
          <DialogTitle className="text-[24px] font-medium text-black">
            {props.title}
          </DialogTitle>
          <button
            type="button"
            className="rounded-md p-1 text-black/80 hover:bg-black/5"
            onClick={() => props.onOpenChange(false)}
          >
            <X className="size-6" />
          </button>
        </DialogHeader>
        <div className="space-y-5 px-7 py-6">
          <div className="rounded-[24px] border border-[#dfe1ec] p-4">
            <div className="mb-3 text-[18px] font-medium">Дата и время проведения</div>
            <Input
              type="date"
              value={entry.performedDate}
              onChange={(event) =>
                setEntry((current) => ({ ...current, performedDate: event.target.value }))
              }
              className="mb-3 h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
            />
            <div className="grid grid-cols-2 gap-3">
              <Select
                value={entry.timeSpecified ? entry.performedHour || "__" : "__"}
                onValueChange={(value) =>
                  setEntry((current) => ({
                    ...current,
                    timeSpecified: value !== "__" || current.performedMinute !== "",
                    performedHour: value === "__" ? "" : value,
                  }))
                }
              >
                <SelectTrigger aria-label="Часы" className="h-10 w-full rounded-xl border-[#dfe1ec] bg-[#f3f4fb] px-3.5 text-[13.5px]">
                  <span className="mr-1 text-[#9b9fb3]">ч</span>
                  <SelectValue placeholder="Часы" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__">--</SelectItem>
                  {Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0")).map((hour) => (
                    <SelectItem key={hour} value={hour}>
                      {hour}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={entry.timeSpecified ? entry.performedMinute || "__" : "__"}
                onValueChange={(value) =>
                  setEntry((current) => ({
                    ...current,
                    timeSpecified: value !== "__" || current.performedHour !== "",
                    performedMinute: value === "__" ? "" : value,
                  }))
                }
              >
                <SelectTrigger aria-label="Минуты" className="h-10 w-full rounded-xl border-[#dfe1ec] bg-[#f3f4fb] px-3.5 text-[13.5px]">
                  <span className="mr-1 text-[#9b9fb3]">мин</span>
                  <SelectValue placeholder="Минуты" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__">--</SelectItem>
                  {Array.from({ length: 12 }, (_, index) => String(index * 5).padStart(2, "0")).map((minute) => (
                    <SelectItem key={minute} value={minute}>
                      {minute}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Постоянные подписи над полями: раньше поля жили на одних
              плейсхолдерах, и после ввода было не понять, что где. */}
          <PestFieldLabel htmlFor="pest-row-event" label="Мероприятие (вид, место)">
          <Input
            id="pest-row-event"
            value={entry.event}
            onChange={(event) =>
              setEntry((current) => ({ ...current, event: event.target.value }))
            }
            placeholder="Например: дератизация, склад сырья"
            className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
          />
          </PestFieldLabel>
          <PestFieldLabel htmlFor="pest-row-area" label="Площадь и (или) объём">
          <Input
            id="pest-row-area"
            value={entry.areaOrVolume}
            onChange={(event) =>
              setEntry((current) => ({ ...current, areaOrVolume: event.target.value }))
            }
            placeholder="Например: 120 м²"
            className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
          />
          </PestFieldLabel>
          <PestFieldLabel htmlFor="pest-row-product" label="Средство обработки">
          <Input
            id="pest-row-product"
            value={entry.treatmentProduct}
            onChange={(event) =>
              setEntry((current) => ({ ...current, treatmentProduct: event.target.value }))
            }
            placeholder="Название средства"
            className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
          />
          </PestFieldLabel>
          <PestFieldLabel htmlFor="pest-row-note" label="Примечание">
          <Textarea
            id="pest-row-note"
            value={entry.note}
            onChange={(event) =>
              setEntry((current) => ({ ...current, note: event.target.value }))
            }
            placeholder="Необязательно"
            className="min-h-[140px] rounded-2xl border-[#dfe1ec] px-4 py-3 text-[18px]"
          />
          </PestFieldLabel>
          <PestFieldLabel htmlFor="pest-row-by" label="Кем проведено">
          <Input
            id="pest-row-by"
            value={entry.performedBy}
            onChange={(event) =>
              setEntry((current) => ({ ...current, performedBy: event.target.value }))
            }
            placeholder="Организация или специалист"
            className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
          />
          </PestFieldLabel>
          <PestFieldLabel label="Должность принявшего работы">
          <Select value={entry.acceptedRole} onValueChange={updateAcceptedRole}>
            <SelectTrigger aria-label="Должность принявшего работы" className="h-10 w-full rounded-xl border-[#dfe1ec] bg-[#f3f4fb] px-3.5 text-[13.5px]">
              <SelectValue placeholder="Выберите должность" />
            </SelectTrigger>
            <SelectContent>
              {roleOptions.map((role) => (
                <SelectItem key={role.value} value={role.value}>
                  {role.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          </PestFieldLabel>
          <PestFieldLabel label="Сотрудник, принявший работы">
          <Select
            value={entry.acceptedEmployeeId}
            onValueChange={(value) =>
              setEntry((current) => ({ ...current, acceptedEmployeeId: value }))
            }
          >
            <SelectTrigger aria-label="Сотрудник, принявший работы" className="h-10 w-full rounded-xl border-[#dfe1ec] bg-[#f3f4fb] px-3.5 text-[13.5px]">
              <SelectValue placeholder="Выберите сотрудника" />
            </SelectTrigger>
            <SelectContent>
              {employeeOptions.map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {user.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          </PestFieldLabel>

          <div className="flex justify-end">
            <Button
              type="button"
              disabled={submitting || !entry.performedDate || !entry.event.trim() || !entry.acceptedEmployeeId}
              className="h-12 rounded-xl bg-[#5863f8] px-7 text-[18px] text-white hover:bg-[#4b57f3]"
              onClick={async () => {
                setSubmitting(true);
                try {
                  await props.onSubmit(entry, props.initial?.id);
                  props.onOpenChange(false);
                } finally {
                  setSubmitting(false);
                }
              }}
            >
              {submitting ? "Подождите..." : props.submitLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PestControlDocumentClient(props: Props) {
  const router = useRouter();
  // DELETE на сервере требует управленческой роли — кнопку «Удалить»
  // рядовому сотруднику не показываем, иначе она просто отдавала 403.
  const { data: sessionData } = useSession();
  const canDelete =
    sessionData?.user?.isRoot === true ||
    isManagementRole(sessionData?.user?.role ?? "");
  // Сервер отдаёт записи в порядке (employeeId, date) — нумерация «№»
  // получалась не хронологической. Сортируем по дате и времени.
  const entries = useMemo(
    () =>
      [...props.initialEntries].sort((a, b) => {
        const keyOf = (item: EntryItem) =>
          `${item.data.performedDate || ""}T${
            item.data.timeSpecified
              ? `${(item.data.performedHour || "00").padStart(2, "0")}:${(
                  item.data.performedMinute || "00"
                ).padStart(2, "0")}`
              : "00:00"
          }`;
        const diff = keyOf(a).localeCompare(keyOf(b));
        return diff !== 0 ? diff : a.id.localeCompare(b.id);
      }),
    [props.initialEntries]
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<EditingEntry | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);

  const userMap = useMemo(
    () => Object.fromEntries(props.users.map((user) => [user.id, user])),
    [props.users]
  );
  const readOnly = props.status === "closed";
  // История отмены: только правки этого человека в этой вкладке.
  const undoStack = useJournalUndo({ enabled: !readOnly });
  const allSelected = entries.length > 0 && selectedIds.length === entries.length;
  const { mobileView, switchMobileView } = useMobileView("pest_control");
  // «Сегодня» в поясе организации — якорь для «Перейти к сегодня».
  const todayKey = useTodayKey();

  const cardItems: RecordCardItem[] = entries.map((entry, index) => {
    const acceptedUser = userMap[entry.data.acceptedEmployeeId];
    const dateTime = formatPestControlDateTime(entry.data);
    return {
      id: entry.id,
      title: (
        <span
          data-focus-today={
            entry.data.performedDate === todayKey ? "" : undefined
          }
        >
          {`№${index + 1} · ${dateTime.dateLabel || "—"}`}
        </span>
      ),
      subtitle: entry.data.event || undefined,
      leading: !readOnly ? (
        <Checkbox
          checked={selectedIds.includes(entry.id)}
          onCheckedChange={(checked) =>
            setSelectedIds((current) =>
              checked === true
                ? [...new Set([...current, entry.id])]
                : current.filter((id) => id !== entry.id)
            )
          }
          className="size-5"
        />
      ) : null,
      fields: [
        { label: "Время", value: dateTime.timeLabel, hideIfEmpty: true },
        { label: "Площадь/объём", value: entry.data.areaOrVolume, hideIfEmpty: true },
        { label: "Средство обработки", value: entry.data.treatmentProduct, hideIfEmpty: true },
        { label: "Примечание", value: entry.data.note, hideIfEmpty: true },
        { label: "Кем проведено", value: entry.data.performedBy, hideIfEmpty: true },
        {
          label: "Принявший",
          value: [entry.data.acceptedRole, acceptedUser?.name].filter(Boolean).join(", "),
          hideIfEmpty: true,
        },
      ],
      onClick: !readOnly
        ? () => setEditing({ id: entry.id, data: entry.data })
        : undefined,
      actions: !readOnly ? (
        <button
          type="button"
          onClick={() => setEditing({ id: entry.id, data: entry.data })}
          className="inline-flex h-10 items-center justify-center rounded-2xl bg-[#5863f8] px-4 text-[14px] font-medium text-white hover:bg-[#4752e6]"
        >
          Редактировать
        </button>
      ) : null,
    };
  });

  async function createEntry(data: PestControlEntryData) {
    const response = await fetch(
      `/api/journal-documents/${props.documentId}/pest-control-entries`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }
    );

    if (!response.ok) {
      const result = await response.json().catch(() => null);
      toast.error(result?.error || "Не удалось добавить строку");
      return;
    }

    router.refresh();
  }

  /**
   * Правка строки. Отмена (Ctrl+Z) — это повторная запись прежних
   * значений тем же PATCH, а не правка состояния на клиенте: серверные
   * запреты (закрытый журнал, права) обязаны сработать и на откате.
   *
   * `silent` — вызов из истории: нового шага не кладём и бросаем ошибку
   * наружу, чтобы протухший шаг вылетел из стека.
   */
  /** Правка выделенных строк по очереди — окном «Редактирование». */
  const seq = useSequentialEdit({
    open: (id) => {
      const entry = entries.find((item) => item.id === id);
      if (!entry || readOnly) return false;
      setEditing({ id: entry.id, data: entry.data });
      return true;
    },
    close: () => setEditing(null),
  });
  // EntryDialog сам зовёт onOpenChange(false) после сохранения — этот вызов
  // не должен прерывать очередь, поэтому помечаем «уже сохранено».
  const seqSavedRef = useRef(false);

  async function updateEntry(
    data: PestControlEntryData,
    entryId?: string,
    options?: { silent?: boolean }
  ) {
    if (!entryId) return;
    const previousData = entries.find((item) => item.id === entryId)?.data;

    const response = await fetch(
      `/api/journal-documents/${props.documentId}/pest-control-entries`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: entryId, ...data }),
      }
    );

    if (!response.ok) {
      const result = await response.json().catch(() => null);
      const message = result?.error || "Не удалось сохранить строку";
      if (options?.silent) throw new Error(message);
      toast.error(message);
      return;
    }

    if (!options?.silent && previousData) {
      undoStack.push({
        undo: () => updateEntry(previousData, entryId, { silent: true }),
        redo: () => updateEntry(data, entryId, { silent: true }),
      });
    }

    router.refresh();
    if (!options?.silent) {
      // Очередь правок откроет следующую строку или закроет окно.
      seqSavedRef.current = true;
      seq.saved();
    }
  }

  async function deleteEntries(ids: string[]) {
    const response = await fetch(
      `/api/journal-documents/${props.documentId}/pest-control-entries`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      }
    );

    if (!response.ok) {
      const result = await response.json().catch(() => null);
      toast.error(result?.error || "Не удалось удалить строки");
      return;
    }

    setSelectedIds([]);
    router.refresh();
  }

  async function saveDocumentSettings(payload: { title: string; dateFrom: string }) {
    const response = await fetch(`/api/journal-documents/${props.documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: payload.title,
        dateFrom: payload.dateFrom,
      }),
    });

    if (!response.ok) {
      toast.error("Не удалось сохранить настройки документа");
      return;
    }

    router.refresh();
  }

  async function closeDocument() {
    const today = localDayKey();
    const response = await fetch(`/api/journal-documents/${props.documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "closed",
        dateTo: today,
      }),
    });

    if (!response.ok) {
      toast.error("Не удалось завершить журнал");
      return;
    }

    router.push(`/journals/${props.routeCode}?tab=closed`);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <FocusTodayScroller selector="[data-focus-today]" emptyTitle="Записей пока нет" emptyBody="Нажмите «Добавить» в таблице ниже, чтобы создать запись." />

      {!readOnly && selectedIds.length > 0 && (
        <JournalSelectionBar
          count={selectedIds.length}
          onClear={() => setSelectedIds([])}
          onDelete={canDelete ? () => void deleteEntries(selectedIds) : undefined}
          hint={
            canDelete
              ? "Записи будут удалены без возможности отмены"
              : "Удалять записи может только управляющий"
          }
        >
          <SelectionEditButton count={selectedIds.length} disabled={readOnly} onClick={() => seq.start(selectedIds)} />
        </JournalSelectionBar>
      )}

      <JournalDocumentShell
        title={props.title || PEST_CONTROL_DOCUMENT_TITLE}
        documentId={props.documentId}
        backHref={`/journals/${props.routeCode}`}
        onSettings={!readOnly ? () => setSettingsOpen(true) : undefined}
        closed={readOnly}
        closedHint="Откройте журнал заново, чтобы добавлять и редактировать мероприятия."
        undo={
          !readOnly
            ? {
                canUndo: undoStack.canUndo,
                canRedo: undoStack.canRedo,
                onUndo: () => void undoStack.undo(),
                onRedo: () => void undoStack.redo(),
                undoCount: undoStack.undoCount,
              }
            : undefined
        }
        menuItems={
          !readOnly
            ? [
                {
                  key: "close-journal",
                  label: "Закончить журнал",
                  icon: <Archive className="size-4" />,
                  onSelect: () => setCloseOpen(true),
                },
              ]
            : []
        }
        mobileView={mobileView}
        onMobileView={switchMobileView}
        cards={<RecordCardsView items={cardItems} emptyLabel="Мероприятий пока не проводилось." />}
        paperHeader={
          <JournalDocumentHeader
            orgName={props.organizationName}
            title={props.title || PEST_CONTROL_DOCUMENT_TITLE}
            startedAt={props.dateFrom}
            finishedAt={props.dateTo && props.dateTo !== props.dateFrom ? props.dateTo : null}
          />
        }
        sheetTitle={PEST_CONTROL_PAGE_TITLE}
        toolbar={
          !readOnly ? (
            <Button
              type="button"
              className="h-9 rounded-xl bg-[#5863f8] px-3.5 text-[13.5px] text-white hover:bg-[#4b57f3]"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="size-5" />
              Добавить
            </Button>
          ) : null
        }
      >
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className={`w-12 ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>
                {!readOnly && (
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={(checked) =>
                      setSelectedIds(checked === true ? entries.map((entry) => entry.id) : [])
                    }
                  />
                )}
              </th>
              <th className={`min-w-[110px] sm:min-w-[140px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>Дата и время проведения</th>
              <th className={`min-w-[170px] sm:min-w-[220px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>Мероприятие (вид, место)</th>
              <th className={`min-w-[120px] sm:min-w-[150px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>Площадь и (или) объем</th>
              <th className={`min-w-[150px] sm:min-w-[190px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>Средство обработки</th>
              <th className={`min-w-[220px] sm:min-w-[320px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>Примечание</th>
              <th className={`min-w-[120px] sm:min-w-[150px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>Кем проведено</th>
              <th className={`min-w-[170px] sm:min-w-[220px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>ФИО принявшего работы</th>
            </tr>
          </thead>
          <tbody>
            {(entries.length > 0 ? entries : [{ id: "empty", data: createEmptyPestControlEntry(props.users, props.dateFrom) }]).map((entry) => {
              const acceptedUser = userMap[entry.data.acceptedEmployeeId];
              const dateTime = formatPestControlDateTime(entry.data);
              const isPlaceholder = entry.id === "empty";

              return (
                <tr
                  key={entry.id}
                  // Якорь «Перейти к сегодня»: атрибут не ставила ни одна
                  // строка, и скроллер всегда говорил «Записей пока нет».
                  data-focus-today={
                    !isPlaceholder && entry.data.performedDate === todayKey
                      ? ""
                      : undefined
                  }
                  // Строка-заготовка (нет ни одной записи) раньше висела на
                  // экране как единственная пустая строка, но не открывала
                  // добавление. Теперь эту роль играет кликабельная
                  // JournalAddRow ниже, а заготовка остаётся только в печати.
                  className={
                    isPlaceholder
                      ? "hidden print:table-row"
                      : !readOnly
                        ? "cursor-pointer hover:bg-[#f5f6ff]"
                        : ""
                  }
                  onClick={() => {
                    if (readOnly || isPlaceholder) return;
                    setEditing({ id: entry.id, data: entry.data });
                  }}
                >
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`} onClick={(event) => event.stopPropagation()}>
                    {!readOnly && !isPlaceholder && (
                      <Checkbox
                        checked={selectedIds.includes(entry.id)}
                        onCheckedChange={(checked) =>
                          setSelectedIds((current) =>
                            checked === true
                              ? [...new Set([...current, entry.id])]
                              : current.filter((id) => id !== entry.id)
                          )
                        }
                      />
                    )}
                  </td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>
                    {isPlaceholder ? "" : (
                      <>
                        <div>{dateTime.dateLabel}</div>
                        <div>{dateTime.timeLabel}</div>
                      </>
                    )}
                  </td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{isPlaceholder ? "" : entry.data.event}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{isPlaceholder ? "" : entry.data.areaOrVolume}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{isPlaceholder ? "" : entry.data.treatmentProduct}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{isPlaceholder ? "" : entry.data.note}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{isPlaceholder ? "" : entry.data.performedBy}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>
                    {isPlaceholder
                      ? ""
                      : [entry.data.acceptedRole, acceptedUser?.name].filter(Boolean).join(", ")}
                  </td>
                </tr>
              );
            })}
            {!readOnly ? (
              <JournalAddRow
                // Галочка — leading, подпись растянута на «Дата и время
                // проведения» + «Мероприятие», остальные 5 колонок остаются
                // пустыми ячейками.
                leading={1}
                labelSpan={2}
                trailing={5}
                label="Добавить"
                onClick={() => setCreateOpen(true)}
              />
            ) : null}
          </tbody>
        </table>
      </JournalDocumentShell>

      <DocumentSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        initialTitle={props.title || PEST_CONTROL_DOCUMENT_TITLE}
        initialDateFrom={props.dateFrom}
        onSubmit={saveDocumentSettings}
        useV2={props.useV2}
      />

      <EntryDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        users={props.users}
        title="Добавление новой строки"
        submitLabel="Добавить"
        initial={null}
        onSubmit={(payload) => createEntry(payload)}
      />

      <EntryDialog
        open={!!editing}
        onOpenChange={(open) => {
          if (open) return;
          if (seqSavedRef.current) {
            seqSavedRef.current = false;
            return;
          }
          // Закрытие без сохранения прерывает очередь («Изменено k из N»).
          seq.cancelled();
        }}
        users={props.users}
        title={`Редактирование строки${seq.progress ? ` ${seq.progress}` : ""}`}
        submitLabel="Сохранить"
        initial={editing}
        onSubmit={(payload, entryId) => updateEntry(payload, entryId)}
      />

      <ConfirmDialog
        open={closeOpen}
        onOpenChange={setCloseOpen}
        title={`Закончить журнал "${props.title || PEST_CONTROL_DOCUMENT_TITLE}"`}
        submitLabel="Закончить"
        onSubmit={closeDocument}
      />
    </div>
  );
}
