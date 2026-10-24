"use client";

import { useLocale, useTranslations } from "next-intl";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { JournalDocumentShell } from "@/components/journals/journal-document-shell";
import { JournalDocumentHeader } from "@/components/journals/journal-document-header";
import { GRID_CELL_CLASS, GRID_HEAD_CELL_CLASS } from "@/components/journals/journal-grid";
import { JournalAddRow } from "@/components/journals/journal-add-row";
import { JournalSettingsModal } from "@/components/journals/v2/journal-settings-modal";
import { FocusTodayScroller } from "@/components/journals/focus-today-scroller";
import {
  Archive,
  CalendarDays,
  History,
  Plus,
  X,
} from "lucide-react";
import { JournalSelectionBar } from "@/components/journals/journal-selection-bar";
import { SelectionEditButton } from "@/components/journals/selection-edit-button";
import { useSequentialEdit } from "@/components/journals/use-sequential-edit";
import { SuggestInput } from "@/components/journals/suggest-input";
import { useNameSuggestions } from "@/components/journals/use-name-suggestions";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  TimeField,
  joinTimeValue,
  splitTimeValue,
} from "@/components/journals/time-field";
import { Label } from "@/components/ui/label";
import { getRowEmployeeTitle } from "@/lib/user-roles";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createIntensiveCoolingRow,
  formatIntensiveCoolingDate,
  formatIntensiveCoolingDateTime,
  formatTemperatureLabel,
  INTENSIVE_COOLING_DEFAULT_DOCUMENT_NAME,
  INTENSIVE_COOLING_DOCUMENT_TITLE,
  normalizeIntensiveCoolingConfig,
  type IntensiveCoolingConfig,
  type IntensiveCoolingRow,
  type IntensiveCoolingRowHistoryEntry,
} from "@/lib/intensive-cooling-document";

import { toast } from "sonner";
import { confirmAsync } from "@/components/ui/confirm-async";
import {
  PositionSelectItems,
  usePositionEmployeeCascade,
} from "@/components/shared/position-select";
import { useMobileView } from "@/lib/use-mobile-view";
import {
  RecordCardsView,
  type RecordCardItem,
} from "@/components/journals/record-cards-view";
import { ORG_NAME_FALLBACK } from "@/lib/journal-constants";
import { useRosterViewerId } from "@/components/journals/use-roster-viewer";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";
import { attachLifecycleErrorMetadata, presentLifecycleError, useLifecycleFeedbackRef, type LifecycleFeedbackRef } from "@/components/journals/document-lifecycle-error";

type UserItem = {
  id: string;
  name: string;
  role: string;
  // Должность из карточки (как в UserLike) — её показываем в строке.
  positionTitle?: string | null;
  jobPosition?: { name: string; categoryKey: string } | null;
};

type Props = {
  routeCode: string;
  documentId: string;
  title: string;
  organizationName: string;
  dateFrom: string;
  /** Дата окончания документа — запасной вариант для шапки закрытого журнала. */
  dateTo?: string;
  status: string;
  config: unknown;
  users: UserItem[];
  /** Design v2 toggle. */
  useV2?: boolean;
};

function hourOptions() {
  return Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0"));
}

function minuteOptions() {
  return Array.from({ length: 60 }, (_, index) => String(index).padStart(2, "0"));
}

function getResponsibleLabel(row: IntensiveCoolingRow, users: UserItem[]) {
  const employee = users.find((item) => item.id === row.responsibleUserId);
  const name = employee?.name || "";
  // Должность этого сотрудника, а не копия строки (туда попадала должность
  // по умолчанию документа) и не «Повар» для ненайденного.
  const title = getRowEmployeeTitle(employee, row.responsibleTitle);
  if (!title && !name) return "—";
  return [title, name].filter(Boolean).join(", ");
}

function RowDialog(props: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  initialRow: IntensiveCoolingRow | null;
  config: IntensiveCoolingConfig;
  users: UserItem[];
  /** Блюда организации (последние сверху) — поверх подсказок документа. */
  dishOptions?: readonly string[];
  /** «(k из N)» при правке выделенных строк по очереди. */
  titleSuffix?: string;
  onSave: (row: IntensiveCoolingRow) => Promise<void>;
}) {
  const tCooling = useTranslations("journalUi.intensiveCooling");
  const common = useTranslations("common");
  const [row, setRow] = useState<IntensiveCoolingRow>(() => createIntensiveCoolingRow());
  const [submitting, setSubmitting] = useState(false);
  const viewerId = useRosterViewerId(props.users);

  useEffect(() => {
    if (!props.open) return;
    if (props.initialRow) {
      const rowUser = props.users.find(
        (user) => user.id === props.initialRow?.responsibleUserId
      );
      // Должность — как в ячейке, иначе селект открывался со старой копией.
      setRow({
        ...props.initialRow,
        responsibleTitle: getRowEmployeeTitle(rowUser, props.initialRow.responsibleTitle),
      });
      return;
    }
    // Ответственный журнала, иначе вошедший — не «первый в списке».
    const fallbackUser =
      props.users.find((user) => user.id === props.config.defaultResponsibleUserId) ||
      props.users.find((user) => user.id === viewerId) ||
      null;
    // A7 — auto-fill current HH:MM для новой строки. Минуты — точные
    // (шаг select'а = 1), юзер всегда может перевыбрать.
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    setRow(
      createIntensiveCoolingRow({
        responsibleUserId: fallbackUser?.id || "",
        // Должность того, кто подставлен: fallbackUser может быть вошедшим,
        // а должность по умолчанию документа — ответственного.
        responsibleTitle: getRowEmployeeTitle(
          fallbackUser,
          props.config.defaultResponsibleTitle
        ),
        productionHour: hh,
        productionMinute: mm,
      })
    );
  }, [props.config, props.initialRow, props.open, props.users, viewerId]);

  function setValue<K extends keyof IntensiveCoolingRow>(
    key: K,
    value: IntensiveCoolingRow[K]
  ) {
    setRow((current) => ({ ...current, [key]: value }));
  }

  const responsibleCascade = usePositionEmployeeCascade({
    users: props.users,
    positionTitle: row.responsibleTitle,
    userId: row.responsibleUserId,
    onChange: (next) =>
      setRow((current) => ({
        ...current,
        responsibleTitle: next.positionTitle,
        responsibleUserId: next.userId,
      })),
    autoPick: "first",
  });

  async function handleSave() {
    setSubmitting(true);
    try {
      // Окно закрывает родитель: при правке по очереди он откроет следующую строку.
      await props.onSave(row);
    } catch (error) {
      // ПОЧЕМУ: окно закрывалось в finally — сотрудник видел «сохранено»,
      // хотя сервер отказал, и правка терялась. Показываем текст сервера
      // и оставляем окно открытым.
      toast.error(
        humanizeFetchError(error, tCooling("saveRowFailed"))
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent showCloseButton={false} className="max-h-[92vh] supports-[height:100dvh]:max-h-[92dvh] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-[28px] border-0 p-0 sm:max-w-[620px]">
        <DialogHeader className="border-b px-8 py-6">
          <div className="flex items-center justify-between gap-4">
            <DialogTitle className="text-[30px] font-medium text-black">
              {props.initialRow ? `${tCooling("editRowTitle")}${props.titleSuffix ? ` ${props.titleSuffix}` : ""}` : tCooling("addRowTitle")}
            </DialogTitle>
            <button
              type="button"
              className="rounded-xl p-2 text-[#101425]"
              onClick={() => props.onOpenChange(false)}
            >
              <X className="size-7" />
            </button>
          </div>
        </DialogHeader>
        <div className="space-y-5 px-8 py-6">
          <fieldset className="space-y-3 rounded-[18px] border border-[#e5e8f2] p-4">
            <legend className="px-1 text-base font-medium">
              {tCooling("productionDateTime")}
            </legend>
            <div className="relative">
              <Input
                type="date"
                value={row.productionDate}
                onChange={(event) => setValue("productionDate", event.target.value)}
                className="h-9 rounded-xl border-[#d7dbea] pr-12"
              />
              <CalendarDays className="pointer-events-none absolute right-4 top-1/2 size-5 -translate-y-1/2 text-[#6e7387]" />
            </div>
            {/* Журнал время-критичный (+65 → +5 °C за два часа), и время
                производства фиксируют по факту — одно поле плюс «Сейчас»
                вместо двух списков. */}
            <TimeField
              value={joinTimeValue(row.productionHour, row.productionMinute)}
              onChange={(next) => {
                const { hour, minute } = splitTimeValue(next);
                setValue("productionHour", hour);
                setValue("productionMinute", minute);
              }}
            />
          </fieldset>

          <SuggestInput
            ariaLabel={tCooling("dishName")}
            value={row.dishName}
            options={props.dishOptions ?? Array.from(new Set(props.config.dishSuggestions))}
            placeholder={tCooling("dishNamePlaceholder")}
            onChange={(next) => setValue("dishName", next)}
          />

          <Input
            value={row.startTemperature}
            onChange={(event) => setValue("startTemperature", event.target.value)}
            className="h-9 rounded-xl border-[#d7dbea]"
            placeholder={tCooling("startTempPlaceholder")}
          />

          <Input
            value={row.endTemperature}
            onChange={(event) => setValue("endTemperature", event.target.value)}
            className="h-9 rounded-xl border-[#d7dbea]"
            placeholder={tCooling("endTempPlaceholder")}
          />

          <Textarea
            value={row.correctiveAction}
            onChange={(event) => setValue("correctiveAction", event.target.value)}
            className="min-h-32 rounded-2xl border-[#d7dbea]"
            placeholder={tCooling("correctiveActions")}
          />

          <Textarea
            value={row.comment}
            onChange={(event) => setValue("comment", event.target.value)}
            className="min-h-32 rounded-2xl border-[#d7dbea]"
            placeholder={tCooling("comment")}
          />

          <div className="space-y-2">
            <Label className="text-base text-[#6e7387]">
              {tCooling("controlPerson")}
            </Label>
            <Select
              value={row.responsibleTitle || "__empty__"}
              onValueChange={responsibleCascade.handlePositionChange}
            >
              <SelectTrigger className="h-10 rounded-xl border-[#d7dbea]">
                <SelectValue placeholder={tCooling("controlPerson")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__empty__">{tCooling("choosePosition")}</SelectItem>
                <PositionSelectItems users={props.users} />
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-base text-[#6e7387]">{tCooling("employee")}</Label>
            <Select
              value={row.responsibleUserId || "__empty__"}
              onValueChange={(value) => {
                if (value === "__empty__") {
                  setValue("responsibleUserId", "");
                  return;
                }
                const user = props.users.find((item) => item.id === value);
                setRow((current) => ({
                  ...current,
                  responsibleUserId: value,
                  responsibleTitle: getRowEmployeeTitle(user, current.responsibleTitle),
                }));
              }}
              open={responsibleCascade.employeeOpen}
              onOpenChange={responsibleCascade.setEmployeeOpen}
            >
              <SelectTrigger className="h-10 rounded-xl border-[#d7dbea]">
                <SelectValue placeholder={tCooling("employee")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__empty__">{tCooling("chooseEmployee")}</SelectItem>
                {(row.responsibleTitle ? responsibleCascade.candidates : props.users).map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {props.initialRow?.history && props.initialRow.history.length > 0 ? (
            <RowHistorySection
              history={props.initialRow.history}
              users={props.users}
            />
          ) : null}

          <div className="flex justify-end">
            <Button
              type="button"
              onClick={handleSave}
              disabled={submitting}
              className="h-9 rounded-xl bg-[#5563ff] px-8 text-[13.5px] text-white hover:bg-[#4452ee]"
            >
              {submitting
                ? common("saving")
                : props.initialRow
                  ? common("save")
                  : common("add")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatHistoryTimestamp(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}.${mm}.${yyyy} ${hh}:${mi}`;
}

function RowHistorySection(props: {
  history: IntensiveCoolingRowHistoryEntry[];
  users: UserItem[];
}) {
  const tCooling = useTranslations("journalUi.intensiveCooling");
  // Reverse-chronological — newest first.
  const ordered = [...props.history].sort((a, b) => {
    return new Date(b.at).getTime() - new Date(a.at).getTime();
  });
  return (
    <fieldset className="space-y-3 rounded-[18px] border border-[#e5e8f2] bg-[#fafbff] p-4">
      <legend className="px-1 text-base font-medium text-[#3848c7]">
        <span className="inline-flex items-center gap-2">
          <History className="size-4" />
          {tCooling("historyTitle", { count: props.history.length })}
        </span>
      </legend>
      <p className="text-[12px] leading-snug text-[#6f7282]">
        {tCooling("historyNote")}
      </p>
      <ul className="space-y-3">
        {ordered.map((entry, idx) => {
          const editorName =
            entry.byName ||
            (entry.by
              ? props.users.find((u) => u.id === entry.by)?.name
              : null) ||
            "—";
          return (
            <li
              key={`${entry.at}-${idx}`}
              className="rounded-2xl border border-[#dcdfed] bg-white p-3 text-[13px] leading-snug"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-[#6f7282]">
                <span className="font-medium text-[#0b1024]">
                  {formatHistoryTimestamp(entry.at)}
                </span>
                <span>{tCooling("changedBy", { name: editorName })}</span>
              </div>
              <dl className="mt-2 grid grid-cols-1 gap-y-1 sm:grid-cols-2 sm:gap-x-4">
                <HistoryField label={tCooling("dish")} value={entry.prev.dishName} />
                <HistoryField
                  label={tCooling("time")}
                  value={
                    entry.prev.productionHour || entry.prev.productionMinute
                      ? `${entry.prev.productionHour || "00"}:${entry.prev.productionMinute || "00"}`
                      : ""
                  }
                />
                <HistoryField
                  label={tCooling("tempStart")}
                  value={
                    entry.prev.startTemperature
                      ? `${entry.prev.startTemperature} °C`
                      : ""
                  }
                />
                <HistoryField
                  label={tCooling("tempOneHour")}
                  value={
                    entry.prev.endTemperature
                      ? `${entry.prev.endTemperature} °C`
                      : ""
                  }
                />
                <HistoryField
                  label={tCooling("correctiveActions")}
                  value={entry.prev.correctiveAction}
                />
                <HistoryField label={tCooling("comment")} value={entry.prev.comment} />
              </dl>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

function HistoryField({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2">
      <dt className="text-[12px] text-[#6f7282]">{label}:</dt>
      <dd className="text-[12px] text-[#0b1024]">{value}</dd>
    </div>
  );
}

function SettingsDialog(props: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  title: string;
  dateFrom: string;
  onSave: (payload: { title: string; dateFrom: string }) => Promise<void>;
  useV2?: boolean;
}) {
  const tStaff = useTranslations("journalWidgets.staff");
  const tCooling = useTranslations("journalUi.intensiveCooling");
  const common = useTranslations("common");
  const [title, setTitle] = useState(props.title);
  const [dateFrom, setDateFrom] = useState(props.dateFrom);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!props.open) return;
    setTitle(props.title);
    setDateFrom(props.dateFrom);
  }, [props.dateFrom, props.open, props.title]);

  async function handleSave() {
    setSubmitting(true);
    try {
      await props.onSave({ title: title.trim(), dateFrom });
      props.onOpenChange(false);
    } catch (error) {
      // Не закрываем окно при отказе сервера — иначе правка теряется молча.
      toast.error(
        humanizeFetchError(error, tCooling("saveSettingsFailed"))
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (props.useV2) {
    return (
      <JournalSettingsModal
        open={props.open}
        onOpenChange={props.onOpenChange}
        title={tStaff("settings")}
        description={tCooling("settingsDescription")}
        size="md"
        isSaving={submitting}
        onSave={handleSave}
        onCancel={() => props.onOpenChange(false)}
      >
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            {tStaff("documentName")}
          </Label>
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            {tCooling("startDate")}
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
      <DialogContent showCloseButton={false} className="max-w-[calc(100vw-1rem)] rounded-[28px] border-0 p-0 sm:max-w-[560px]">
        <DialogHeader className="border-b px-8 py-6">
          <div className="flex items-center justify-between gap-4">
            <DialogTitle className="text-[30px] font-medium text-black">
              {tStaff("settings")}
            </DialogTitle>
            <button
              type="button"
              className="rounded-xl p-2 text-[#101425]"
              onClick={() => props.onOpenChange(false)}
            >
              <X className="size-7" />
            </button>
          </div>
        </DialogHeader>
        <div className="space-y-5 px-8 py-6">
          <div className="space-y-2">
            <Label className="text-base text-[#6e7387]">{tStaff("documentName")}</Label>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="h-9 rounded-xl border-[#d7dbea]"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-base text-[#6e7387]">{tCooling("startDate")}</Label>
            <div className="relative">
              <Input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                className="h-9 rounded-xl border-[#d7dbea] pr-12"
              />
              <CalendarDays className="pointer-events-none absolute right-4 top-1/2 size-5 -translate-y-1/2 text-[#6e7387]" />
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={handleSave}
              disabled={submitting}
              className="h-9 rounded-xl bg-[#5563ff] px-8 text-[13.5px] text-white hover:bg-[#4452ee]"
            >
              {submitting ? common("saving") : common("save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FinishDialog(props: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  title: string;
  onConfirm: () => Promise<void>;
  feedbackRef: LifecycleFeedbackRef;
}) {
  const t = useTranslations("journalControls");
  const common = useTranslations("common");
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    setSubmitting(true);
    try {
      await props.onConfirm();
      props.onOpenChange(false);
    } catch (error) {
      const feedback = props.feedbackRef.current;
      toast.error(presentLifecycleError(error, feedback.locale, (key) => props.feedbackRef.current.translate(key)));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent showCloseButton={false} className="max-w-[calc(100vw-1rem)] rounded-[28px] border-0 p-0 sm:max-w-[560px]">
        <DialogHeader className="border-b px-8 py-6">
          <div className="flex items-center justify-between gap-4">
            <DialogTitle className="text-[30px] font-medium text-black">
              {t("documentLifecycle.finishTitle", { title: props.title })}
            </DialogTitle>
            <button
              type="button"
              aria-label={common("close")}
              className="rounded-xl p-2 text-[#101425]"
              onClick={() => props.onOpenChange(false)}
            >
              <X className="size-7" />
            </button>
          </div>
        </DialogHeader>
        <div className="flex justify-end px-8 py-6">
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className="h-9 rounded-xl bg-[#5563ff] px-8 text-[13.5px] text-white hover:bg-[#4452ee]"
          >
            {submitting ? t("documentLifecycle.finishing") : t("documentLifecycle.finishAction")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function IntensiveCoolingDocumentClient(props: Props) {
  const tCooling = useTranslations("journalUi.intensiveCooling");
  const t = useTranslations("journalControls");
  const common = useTranslations("common");
  const lifecycleFeedback = useLifecycleFeedbackRef(useLocale(), (key) => t(key));
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [config, setConfig] = useState(() =>
    normalizeIntensiveCoolingConfig(props.config, props.users)
  );
  const [title, setTitle] = useState(props.title);
  const [dateFrom, setDateFrom] = useState(props.dateFrom);
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [rowDialogOpen, setRowDialogOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<IntensiveCoolingRow | null>(null);
  // Блюда всей организации (последние сверху) + подсказки документа.
  const dishSuggestions = useNameSuggestions("dish");

  const rows = useMemo(() => config.rows, [config.rows]);
  const isActive = props.status === "active";
  const { mobileView, switchMobileView } = useMobileView("intensive_cooling");
  const allSelected = rows.length > 0 && selectedRowIds.length === rows.length;

  async function persist(
    nextTitle: string,
    nextDateFrom: string,
    nextConfig: IntensiveCoolingConfig,
    nextStatus?: "active" | "closed"
  ) {
    const response = await fetch(`/api/journal-documents/${props.documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: nextTitle,
        dateFrom: nextDateFrom,
        dateTo: nextDateFrom,
        status: nextStatus,
        config: nextConfig,
      }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(result?.error || tCooling("saveFailed"));
      throw attachLifecycleErrorMetadata(error, result?.code, response.headers.get("Content-Language"));
    }
    setTitle(nextTitle);
    setDateFrom(nextDateFrom);
    setConfig(nextConfig);
    startTransition(() => router.refresh());
  }

  /**
   * ПОЧЕМУ: `config` — снимок, сделанный при загрузке страницы. PATCH шлёт
   * конфиг целиком, поэтому правка одной строки затирала строки, которые
   * за это время добавил другой человек с другого устройства. Перед каждой
   * записью подтягиваем свежий конфиг и применяем операцию по `row.id`
   * именно к нему. Тело запроса — только `config`: остальные поля
   * management-only, и рядовой сотрудник получал бы 403.
   */
  async function persistRows(
    mutate: (current: IntensiveCoolingConfig) => IntensiveCoolingConfig
  ) {
    const fresh = await fetch(`/api/journal-documents/${props.documentId}`, {
      cache: "no-store",
    });
    const freshResult = await fresh.json().catch(() => null);
    if (!fresh.ok) {
      throw new Error(freshResult?.error || tCooling("loadFailed"));
    }
    const nextConfig = mutate(
      normalizeIntensiveCoolingConfig(freshResult?.document?.config, props.users)
    );

    const response = await fetch(`/api/journal-documents/${props.documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: nextConfig }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(result?.error || tCooling("saveFailed"));
    }
    setConfig(nextConfig);
    startTransition(() => router.refresh());
  }

  /** Правка выделенных строк по очереди — тем же окном. */
  const seq = useSequentialEdit({
    open: (id) => {
      const row = rows.find((item) => item.id === id);
      if (!row || !isActive) return false;
      setEditingRow(row);
      setRowDialogOpen(true);
      return true;
    },
    close: () => {
      setRowDialogOpen(false);
      setEditingRow(null);
    },
  });

  async function handleSaveRow(row: IntensiveCoolingRow) {
    const editingId = editingRow?.id ?? null;
    await persistRows((current) => ({
      ...current,
      rows: current.rows.some((item) => item.id === editingId)
        ? current.rows.map((item) => (item.id === editingId ? row : item))
        : [...current.rows, row],
    }));
    void dishSuggestions.remember([row.dishName]);
    if (editingId) {
      // Очередь правок откроет следующую строку или закроет окно.
      seq.saved();
      return;
    }
    setEditingRow(null);
    setRowDialogOpen(false);
  }

  async function handleDeleteSelected() {
    if (selectedRowIds.length === 0) return;
    const doomed = rows.filter((row) => selectedRowIds.includes(row.id));
    const filledValues = doomed.reduce(
      (total, row) =>
        total +
        [
          row.dishName,
          row.startTemperature,
          row.endTemperature,
          row.correctiveAction,
          row.comment,
        ].filter((value) => value.trim() !== "").length,
      0
    );
    const confirmed = await confirmAsync({
      title: tCooling("deleteRowsTitle"),
      description: tCooling("deleteRowsDescription"),
      variant: "danger",
      confirmLabel: common("delete"),
      bullets: [
        { label: tCooling("rowsToDelete", { count: doomed.length }), tone: "warn" },
        { label: tCooling("valuesLost", { count: filledValues }), tone: "warn" },
        { label: tCooling("rowsRemain", { count: rows.length - doomed.length }), tone: "default" },
      ],
    });
    if (!confirmed) return;
    const removedIds = selectedRowIds;
    await persistRows((current) => ({
      ...current,
      rows: current.rows.filter((row) => !removedIds.includes(row.id)),
    }));
    setSelectedRowIds([]);
    toast.success(
      tCooling("deletedSummary", { rows: doomed.length, values: filledValues })
    );
  }

  async function handleSaveSettings(payload: { title: string; dateFrom: string }) {
    await persist(
      payload.title || INTENSIVE_COOLING_DEFAULT_DOCUMENT_NAME,
      payload.dateFrom,
      config
    );
  }

  async function handleFinish() {
    await persist(
      title || INTENSIVE_COOLING_DEFAULT_DOCUMENT_NAME,
      dateFrom,
      { ...config, finishedAt: new Date().toISOString() },
      "closed"
    );
    router.push(`/journals/${props.routeCode}?tab=closed`);
  }

  return (
    <div className="bg-white text-black">
      {selectedRowIds.length > 0 ? (
        <JournalSelectionBar
          count={selectedRowIds.length}
          onClear={() => setSelectedRowIds([])}
          onDelete={() => {
            handleDeleteSelected().catch((error) =>
              toast.error(humanizeFetchError(error, tCooling("genericError")))
            );
          }}
          hint={tCooling("deleteHint")}
        >
          <SelectionEditButton count={selectedRowIds.length} disabled={!isActive} onClick={() => seq.start(selectedRowIds)} />
        </JournalSelectionBar>
      ) : null}

      <FocusTodayScroller selector="[data-focus-today]" emptyTitle={tCooling("emptyTitle")} emptyBody={tCooling("emptyBody")} />
      <JournalDocumentShell
        title={title || INTENSIVE_COOLING_DEFAULT_DOCUMENT_NAME}
        documentId={props.documentId}
        backHref={`/journals/${props.routeCode}`}
        onSettings={isActive ? () => setSettingsOpen(true) : undefined}
        closed={!isActive}
        closedHint={tCooling("closedHint")}
        menuItems={
          isActive
            ? [
                {
                  key: "close-journal",
                  label: t("closeDocument.close"),
                  icon: <Archive className="size-4" />,
                  onSelect: () => setFinishOpen(true),
                },
              ]
            : []
        }
        mobileView={mobileView}
        onMobileView={switchMobileView}
        cards={
          <RecordCardsView
            items={rows.map((row, index) => ({
              id: row.id,
              title: `№${index + 1} · ${formatIntensiveCoolingDateTime(row)}`,
              subtitle: row.dishName || undefined,
              leading: isActive ? (
                <Checkbox
                  checked={selectedRowIds.includes(row.id)}
                  onCheckedChange={(checked) =>
                    setSelectedRowIds((current) =>
                      checked === true
                        ? [...current, row.id]
                        : current.filter((item) => item !== row.id)
                    )
                  }
                  className="size-5"
                />
              ) : null,
              fields: [
                { label: tCooling("tempStart"), value: formatTemperatureLabel(row.startTemperature), hideIfEmpty: true },
                { label: tCooling("tempOneHourShort"), value: formatTemperatureLabel(row.endTemperature), hideIfEmpty: true },
                { label: tCooling("correctiveActions"), value: row.correctiveAction, hideIfEmpty: true },
                { label: tCooling("comment"), value: row.comment, hideIfEmpty: true },
                { label: tCooling("controlledBy"), value: getResponsibleLabel(row, props.users), hideIfEmpty: true },
              ],
              onClick: isActive
                ? () => {
                    setEditingRow(row);
                    setRowDialogOpen(true);
                  }
                : undefined,
              actions: isActive ? (
                <button
                  type="button"
                  onClick={() => {
                    setEditingRow(row);
                    setRowDialogOpen(true);
                  }}
                  className="inline-flex h-10 items-center justify-center rounded-2xl bg-[#5863f8] px-4 text-[14px] font-medium text-white hover:bg-[#4752e6]"
                >
                  {common("edit")}
                </button>
              ) : null,
            }))}
            emptyLabel={tCooling("emptyCards")}
          />
        }
        paperHeader={
          <JournalDocumentHeader
            orgName={props.organizationName || ORG_NAME_FALLBACK}
            title={INTENSIVE_COOLING_DOCUMENT_TITLE.toUpperCase()}
            startedAt={dateFrom}
            /* Закрытый журнал: реальная дата закрытия, иначе конец периода.
               Раньше в шапке всегда было пусто. */
            finishedAt={
              isActive ? null : config.finishedAt || props.dateTo || dateFrom
            }
          />
        }
        sheetTitle={INTENSIVE_COOLING_DOCUMENT_TITLE.toUpperCase()}
        sheetMinWidth={1650}
        toolbar={
          isActive ? (
            <Button
              type="button"
              className="h-9 rounded-xl bg-[#5563ff] px-3.5 text-[13.5px] text-white hover:bg-[#4452ee]"
              onClick={() => {
                setEditingRow(null);
                setRowDialogOpen(true);
              }}
            >
              <Plus className="size-5" />
              {common("add")}
            </Button>
          ) : null
        }
      >
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className={`w-[44px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={(checked) =>
                    setSelectedRowIds(checked === true ? rows.map((row) => row.id) : [])
                  }
                  disabled={!isActive || rows.length === 0}
                />
              </th>
              <th className={`w-[170px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>
                {tCooling("productionDateTime")}
              </th>
              <th className={`w-[180px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>
                {tCooling("dishName")}
              </th>
              <th className={`w-[170px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>
                {tCooling("tableStartTemp")}
              </th>
              <th className={`w-[150px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>
                {tCooling("tableEndTemp")}
              </th>
              <th className={`w-[410px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>
                {tCooling("correctiveActions")}
              </th>
              <th className={`w-[170px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>
                {tCooling("comment")}
              </th>
              <th className={`w-[260px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>
                {tCooling("tableControlPerson")}
                <br />
                {tCooling("tablePositionName")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className={isActive ? "cursor-pointer hover:bg-[#fafbff]" : ""}
                onClick={() => {
                  if (!isActive) return;
                  setEditingRow(row);
                  setRowDialogOpen(true);
                }}
              >
                <td
                  className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}
                  onClick={(event) => event.stopPropagation()}
                >
                  <Checkbox
                    checked={selectedRowIds.includes(row.id)}
                    onCheckedChange={(checked) =>
                      setSelectedRowIds((current) =>
                        checked === true
                          ? [...current, row.id]
                          : current.filter((item) => item !== row.id)
                      )
                    }
                    disabled={!isActive}
                  />
                </td>
                <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight whitespace-pre-line`}>
                  {formatIntensiveCoolingDateTime(row)}
                  {row.history && row.history.length > 0 ? (
                    <span
                      title={tCooling("editedTimes", { count: row.history.length })}
                      className="mt-1 inline-flex items-center gap-1 rounded-full bg-[#eef1ff] px-2 py-0.5 text-[10px] font-medium text-[#3848c7]"
                    >
                      <History className="size-3" />
                      {row.history.length}
                    </span>
                  ) : null}
                </td>
                <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>
                  {row.dishName || "—"}
                </td>
                <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>
                  {formatTemperatureLabel(row.startTemperature)}
                </td>
                <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>
                  {formatTemperatureLabel(row.endTemperature)}
                </td>
                <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>
                  {row.correctiveAction || "—"}
                </td>
                <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>
                  {row.comment || "—"}
                </td>
                <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight whitespace-pre-line`}>
                  {getResponsibleLabel(row, props.users)}
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`} />
                <td className={`${GRID_CELL_CLASS} px-2 py-6 text-center text-[#8a8ea4]`} colSpan={7}>
                  {tCooling("noRows")}
                </td>
              </tr>
            ) : null}
            {/* Последняя строка — кликабельная «пустая»: то же окно,
                что и «Добавить» в toolbar над таблицей. leading=1
                (чекбокс), labelSpan=2 — подпись растянута на «Дата и время
                изготовления блюда» + «Наименование блюда»: вместе они
                опознают запись (когда и что готовили). Остальные 5 колонок
                (температура в начале, через 1 час, корректирующие
                действия, комментарий, ответственный) — данные, пустые в
                новой строке: trailing=5. Сумма 1+2+5=8 — тот же colSpan,
                что был раньше. */}
            {isActive ? (
              <JournalAddRow
                leading={1}
                labelSpan={2}
                trailing={5}
                label={common("add")}
                onClick={() => {
                  setEditingRow(null);
                  setRowDialogOpen(true);
                }}
              />
            ) : null}
          </tbody>
        </table>
      </JournalDocumentShell>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        title={title || INTENSIVE_COOLING_DEFAULT_DOCUMENT_NAME}
        dateFrom={dateFrom}
        onSave={handleSaveSettings}
        useV2={props.useV2}
      />

      <RowDialog
        open={rowDialogOpen}
        onOpenChange={(value) => {
          if (value) {
            setRowDialogOpen(true);
            return;
          }
          // Закрытие без сохранения прерывает очередь («Изменено k из N»).
          seq.cancelled();
        }}
        initialRow={editingRow}
        titleSuffix={seq.progress ?? undefined}
        config={config}
        users={props.users}
        dishOptions={dishSuggestions.options(config.dishSuggestions)}
        onSave={handleSaveRow}
      />

      <FinishDialog
        open={finishOpen}
        onOpenChange={setFinishOpen}
        title={title || INTENSIVE_COOLING_DEFAULT_DOCUMENT_NAME}
        onConfirm={handleFinish}
        feedbackRef={lifecycleFeedback}
      />
    </div>
  );
}
