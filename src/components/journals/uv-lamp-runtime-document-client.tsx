"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Archive, Plus, Trash2 } from "lucide-react";
import { JournalDocumentHeader } from "@/components/journals/journal-document-header";
import { CELL_FOCUS_CLASS } from "@/components/journals/journal-grid";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
  buildUvRuntimeDocumentTitle,
  calculateEntryDurationMinutes,
  calculateMonthlyHours,
  appendUvRuntimeSession,
  listUvRuntimeSessionSlots,
  removeUvRuntimeSession,
  updateUvRuntimeSession,
  CONTROL_FREQUENCY_OPTIONS,
  formatControlFrequencyLabel,
  formatMonthLabel,
  formatRuDateDash,
  getDisinfectionConditionLabel,
  getDisinfectionObjectLabel,
  getRadiationModeLabel,
  getUvResponsibleTitleOptions,
  normalizeUvRuntimeDocumentConfig,
  normalizeUvRuntimeEntryData,
  toIsoDate,
  UV_AUTOFILL_DEFAULT_DURATION_MINUTES,
  UV_AUTOFILL_DEFAULT_START_TIME,
  UV_LAMP_RUNTIME_PAGE_TITLE,
  type UvRuntimeDocumentConfig,
  type UvRuntimeEntryData,
  type UvSpecification,
} from "@/lib/uv-lamp-runtime-document";
import { MENU_ITEM_MUTED_CLASS } from "@/components/ui/menu-styles";
import {
  EMPTY_SELECT_VALUE,
  PositionSelectItems,
  usePositionEmployeeCascade,
} from "@/components/shared/position-select";

/** Старые документы хранят плейсхолдер как значение должности — считаем его «не выбрано». */
const UV_LEGACY_EMPTY_TITLE = "- Выберите значение -";
import { DocumentActionsBar } from "@/components/journals/document-actions-bar";
import { useJournalUndo } from "@/lib/journal-undo";
import {
  DOC_ADD_ROW_CLASS,
  DOC_AUTOFILL_STRIP_CLASS,
  DOC_BODY_STACK_CLASS,
  DOC_CAPS_TITLE_CLASS,
  DOC_HEADING_CLASS,
  DOC_PAPER_CANVAS_CLASS,
  DOC_PAPER_HEADER_CARDS_HIDDEN_CLASS,
  DOC_PAPER_HEADER_CLASS,
  JOURNAL_DIALOG_CONTENT_CLASS,
  JOURNAL_DIALOG_HEADER_CLASS,
  JOURNAL_DIALOG_TITLE_CLASS,
  DOC_AUTOFILL_LABEL_CLASS,
} from "@/components/journals/journal-responsive";
import { JournalSelectionBar } from "@/components/journals/journal-selection-bar";
import { JournalAddRow } from "@/components/journals/journal-add-row";
import { FocusTodayScroller } from "@/components/journals/focus-today-scroller";
import { JournalClosedBanner } from "@/components/journals/journal-closed-banner";
import { useCanManageJournalDocument } from "@/components/journals/journal-header-edit";
import { toDateKey } from "@/lib/hygiene-document";
import { useMobileView } from "@/lib/use-mobile-view";
import {
  MobileViewToggle,
  MobileViewTableWrapper,
} from "@/components/journals/mobile-view-toggle";
import {
  CardEditSheet,
  type CardEditValues,
} from "@/components/journals/card-edit-sheet";
import {
  RecordCardsView,
  type RecordCardItem,
} from "@/components/journals/record-cards-view";

import { toast } from "sonner";
import { NO_ROW_EMPLOYEE_MESSAGE, useRosterViewerId } from "@/components/journals/use-roster-viewer";
import { confirmAsync } from "@/components/ui/confirm-async";
import { JournalSettingsModal } from "@/components/journals/v2/journal-settings-modal";
import { useTodayKey } from "@/lib/use-today-key";
import { TodayStripForJournal } from "@/components/journals/today-strip-for-journal";
type UserItem = {
  id: string;
  name: string;
  role: string;
};

type EntryItem = {
  id: string;
  employeeId: string;
  date: string;
  data: Record<string, unknown>;
};

type Props = {
  documentId: string;
  routeCode: string;
  title: string;
  organizationName: string;
  /**
   * «Периодичность контроля» — вторая строка бумажной шапки документа
   * (`config.controlPeriodicity`, дефолт — из реестра шаблонов).
   * Пустая строка ⇒ строка в шапке не рендерится.
   */
  controlPeriodicity?: string;
  status: string;
  dateFrom: string;
  dateTo: string;
  autoFill?: boolean;
  responsibleTitle?: string | null;
  responsibleUserId?: string | null;
  users: UserItem[];
  config: unknown;
  initialEntries: EntryItem[];
  /** Design v2 toggle. */
  useV2?: boolean;
};

type GridRow = {
  id: string;
  date: string;
  employeeId: string;
  data: UvRuntimeEntryData;
};

function isDateInRange(date: string, from: string, to: string) {
  return date >= from && date <= to;
}

function entryToRow(entry: EntryItem): GridRow {
  return {
    id: entry.id,
    date: entry.date,
    employeeId: entry.employeeId,
    data: normalizeUvRuntimeEntryData(entry.data),
  };
}

/**
 * U6: строки журнала — ТОЛЬКО реальные записи. Раньше мы разворачивали
 * весь период в виртуальные строки `virtual:<день>` с пустыми `--:--`,
 * и новый документ открывался «заполненным» 13 днями без данных.
 * Эталон показывает пустую таблицу: строки появляются либо вручную
 * («+ Добавить»), либо автозаполнением (оно создаёт настоящие записи,
 * см. `uv-lamp-runtime-autofill.ts`).
 */
function buildRows(params: {
  dateFrom: string;
  dateTo: string;
  status: string;
  initialEntries: EntryItem[];
}) {
  const today = toIsoDate(new Date());
  const effectiveTo = params.status === "closed" ? params.dateTo : today;

  return params.initialEntries
    .filter((entry) => isDateInRange(entry.date, params.dateFrom, effectiveTo))
    .map(entryToRow)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/* ─── Specification Edit Dialog ─── */

function UvSpecEditDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spec: UvSpecification;
  /** U4: дата начала документа — дефолт для «Дата ввода в эксплуатацию». */
  defaultCommissioningDate: string;
  onSave: (spec: UvSpecification) => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [air, setAir] = useState(props.spec.disinfectionAir);
  const [surface, setSurface] = useState(props.spec.disinfectionSurface);
  const [microorganism, setMicroorganism] = useState(props.spec.microorganismType);
  const [radiationMode, setRadiationMode] = useState(props.spec.radiationMode);
  const [condition, setCondition] = useState(props.spec.disinfectionCondition);
  const [lampHours, setLampHours] = useState(String(props.spec.lampLifetimeHours));
  const [commDate, setCommDate] = useState(
    props.spec.commissioningDate || props.defaultCommissioningDate
  );
  const [minInterval, setMinInterval] = useState(props.spec.minIntervalBetweenSessions);
  const [frequency, setFrequency] = useState(props.spec.controlFrequency);
  const [autoStart, setAutoStart] = useState(props.spec.autoFillStartTime);
  const [autoDuration, setAutoDuration] = useState(
    String(props.spec.autoFillDurationMinutes)
  );

  useEffect(() => {
    if (!props.open) return;
    setAir(props.spec.disinfectionAir);
    setSurface(props.spec.disinfectionSurface);
    setMicroorganism(props.spec.microorganismType);
    setRadiationMode(props.spec.radiationMode);
    setCondition(props.spec.disinfectionCondition);
    setLampHours(String(props.spec.lampLifetimeHours));
    setCommDate(props.spec.commissioningDate || props.defaultCommissioningDate);
    setMinInterval(props.spec.minIntervalBetweenSessions);
    setFrequency(props.spec.controlFrequency);
    setAutoStart(props.spec.autoFillStartTime);
    setAutoDuration(String(props.spec.autoFillDurationMinutes));
  }, [props.open, props.spec, props.defaultCommissioningDate]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className={JOURNAL_DIALOG_CONTENT_CLASS}>
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>
            Редактирование
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 px-7 py-6">
          <div>
            <div className="mb-3 text-[16px] font-medium text-black">Объект обеззараживания</div>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 text-[15px]">
                <Switch checked={air} onCheckedChange={setAir} />
                Воздух
              </label>
              <label className="flex items-center gap-2 text-[15px]">
                <Switch checked={surface} onCheckedChange={setSurface} />
                Поверхность
              </label>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-[13px] font-medium text-[#3c4053]">Вид микроорганизма</Label>
            <Input
              value={microorganism}
              onChange={(e) => setMicroorganism(e.target.value)}
              className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[16px]"
            />
          </div>

          <div>
            <div className="mb-3 text-[16px] font-medium text-black">Режим облучения</div>
            <div className="flex flex-wrap gap-6">
              <label className="flex items-center gap-2 text-[15px]">
                <input
                  type="radio"
                  name="radiationMode"
                  checked={radiationMode === "continuous"}
                  onChange={() => setRadiationMode("continuous")}
                  className="size-4 accent-[#5566f6]"
                />
                Непрерывный
              </label>
              <label className="flex items-center gap-2 text-[15px]">
                <input
                  type="radio"
                  name="radiationMode"
                  checked={radiationMode === "intermittent"}
                  onChange={() => setRadiationMode("intermittent")}
                  className="size-4 accent-[#5566f6]"
                />
                Повторно-кратковременный
              </label>
            </div>
          </div>

          <div>
            <div className="mb-3 text-[16px] font-medium text-black">Условия обеззараживания</div>
            <div className="flex flex-wrap gap-6">
              <label className="flex items-center gap-2 text-[15px]">
                <input
                  type="radio"
                  name="condition"
                  checked={condition === "with_people"}
                  onChange={() => setCondition("with_people")}
                  className="size-4 accent-[#5566f6]"
                />
                В присутствии людей
              </label>
              <label className="flex items-center gap-2 text-[15px]">
                <input
                  type="radio"
                  name="condition"
                  checked={condition === "without_people"}
                  onChange={() => setCondition("without_people")}
                  className="size-4 accent-[#5566f6]"
                />
                В отсутствии людей
              </label>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-[13px] font-medium text-[#3c4053]">Ресурс рабочего времени лампы, часов</Label>
            <Input
              type="number"
              inputMode="decimal"
              value={lampHours}
              onChange={(e) => setLampHours(e.target.value)}
              className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[16px]"
            />
            <div className="text-[13px] text-[#999]">*срок замены отработавших ламп</div>
          </div>

          <div className="space-y-1">
            <Label className="text-[13px] font-medium text-[#3c4053]">Дата ввода установки в эксплуатацию</Label>
            <Input
              type="date"
              value={commDate}
              onChange={(e) => setCommDate(e.target.value)}
              className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[16px]"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-[13px] font-medium text-[#3c4053]">Введите минимальный интервал между сеансами</Label>
            <Input
              value={minInterval}
              onChange={(e) => setMinInterval(e.target.value)}
              className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[16px]"
            />
            <div className="text-[13px] text-[#999]">*для повторно-кратковременного облучения</div>
          </div>

          <div className="space-y-1">
            <Label className="text-[13px] font-medium text-[#3c4053]">Частота контроля работы установки</Label>
            <Select value={frequency} onValueChange={setFrequency}>
              <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-[#fafbff] px-3.5 text-[16px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONTROL_FREQUENCY_OPTIONS.map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {formatControlFrequencyLabel(opt)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="text-[13px] text-[#999]">*частота включений</div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-[13px] font-medium text-[#3c4053]">Типовое время включения</Label>
              <Input
                type="time"
                value={autoStart}
                onChange={(e) => setAutoStart(e.target.value)}
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[16px]"
              />
              <div className="text-[13px] text-[#999]">*используется при автозаполнении</div>
            </div>

            <div className="space-y-1">
              <Label className="text-[13px] font-medium text-[#3c4053]">Типовая длительность сеанса, минут</Label>
              <Input
                type="number"
                inputMode="decimal"
                min={1}
                max={1440}
                value={autoDuration}
                onChange={(e) => setAutoDuration(e.target.value)}
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[16px]"
              />
              <div className="text-[13px] text-[#999]">*используется при автозаполнении</div>
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <Button
              type="button"
              disabled={submitting}
              onClick={async () => {
                setSubmitting(true);
                try {
                  await props.onSave({
                    disinfectionAir: air,
                    disinfectionSurface: surface,
                    microorganismType: microorganism.trim() || "санитарно-показательный",
                    radiationMode,
                    disinfectionCondition: condition,
                    lampLifetimeHours: Math.max(1, parseInt(lampHours, 10) || 10000),
                    commissioningDate: commDate,
                    minIntervalBetweenSessions: minInterval.trim(),
                    controlFrequency: frequency,
                    autoFillStartTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(autoStart)
                      ? autoStart
                      : UV_AUTOFILL_DEFAULT_START_TIME,
                    autoFillDurationMinutes: Math.min(
                      1440,
                      Math.max(1, parseInt(autoDuration, 10) || UV_AUTOFILL_DEFAULT_DURATION_MINUTES)
                    ),
                  });
                  props.onOpenChange(false);
                } finally {
                  setSubmitting(false);
                }
              }}
              className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] font-medium text-white hover:bg-[#4a5bf0]"
            >
              {submitting ? "Сохранение..." : "Сохранить"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Settings Dialog ─── */

function UvRuntimeSettingsDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  users: UserItem[];
  initialConfig: UvRuntimeDocumentConfig;
  initialDateFrom: string;
  initialResponsibleTitle: string;
  initialResponsibleUserId: string;
  onSave: (data: {
    config: UvRuntimeDocumentConfig;
    dateFrom: string;
    responsibleTitle: string;
    responsibleUserId: string;
  }) => Promise<void>;
  useV2?: boolean;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [lampNumber, setLampNumber] = useState(props.initialConfig.lampNumber);
  const [areaName, setAreaName] = useState(props.initialConfig.areaName);
  const [dateFrom, setDateFrom] = useState(props.initialDateFrom);
  const [responsibleTitle, setResponsibleTitle] = useState(props.initialResponsibleTitle);
  const [responsibleUserId, setResponsibleUserId] = useState(props.initialResponsibleUserId);
  // Один каскад на обе раскладки (v2 / legacy): рендерится только одна из них.
  const settingsCascade = usePositionEmployeeCascade({
    users: props.users,
    positionTitle: responsibleTitle,
    userId: responsibleUserId,
    onChange: (n) => {
      setResponsibleTitle(n.positionTitle);
      setResponsibleUserId(n.userId);
    },
    autoPick: "first",
  });

  const options = useMemo(() => getUvResponsibleTitleOptions(props.users), [props.users]);

  useEffect(() => {
    if (!props.open) return;
    setLampNumber(props.initialConfig.lampNumber);
    setAreaName(props.initialConfig.areaName);
    setDateFrom(props.initialDateFrom);
    setResponsibleTitle(props.initialResponsibleTitle);
    setResponsibleUserId(props.initialResponsibleUserId);
  }, [
    props.open,
    props.initialConfig,
    props.initialDateFrom,
    props.initialResponsibleTitle,
    props.initialResponsibleUserId,
  ]);

  const handleSave = async () => {
    setSubmitting(true);
    try {
      await props.onSave({
        config: {
          ...props.initialConfig,
          lampNumber: lampNumber.trim() || "1",
          // U1: пусто ⇒ пустая линия в бланке, никаких подстановок.
          areaName: areaName.trim(),
        },
        dateFrom,
        responsibleTitle,
        responsibleUserId,
      });
      props.onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (props.useV2) {
    return (
      <JournalSettingsModal
        open={props.open}
        onOpenChange={props.onOpenChange}
        title="Настройки журнала"
        description="Учёт работы бактерицидной установки"
        size="md"
        isSaving={submitting}
        onSave={handleSave}
        onCancel={() => props.onOpenChange(false)}
      >
        <div className="space-y-5">
          <div className="space-y-2">
            <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">Бактерицидная установка №</Label>
            <Input
              value={lampNumber}
              onChange={(event) => setLampNumber(event.target.value)}
              className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">Наименование цеха/участка применения</Label>
            <Input
              value={areaName}
              onChange={(event) => setAreaName(event.target.value)}
              className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">Дата начала</Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">Должность ответственного</Label>
            <Select
              value={
                responsibleTitle && responsibleTitle !== UV_LEGACY_EMPTY_TITLE
                  ? responsibleTitle
                  : EMPTY_SELECT_VALUE
              }
              onValueChange={settingsCascade.handlePositionChange}
            >
              <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-white px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15">
                <SelectValue placeholder="— Выберите значение —" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={EMPTY_SELECT_VALUE} className={MENU_ITEM_MUTED_CLASS}>— Выберите значение —</SelectItem>
                <PositionSelectItems users={props.users} groups={options} />
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">Сотрудник</Label>
            <Select
              value={responsibleUserId}
              onValueChange={settingsCascade.handleEmployeeChange}
              open={settingsCascade.employeeOpen}
              onOpenChange={settingsCascade.setEmployeeOpen}
            >
              <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-white px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15">
                <SelectValue placeholder="— Выберите значение —" />
              </SelectTrigger>
              <SelectContent>
                {(responsibleTitle && responsibleTitle !== UV_LEGACY_EMPTY_TITLE
                  ? settingsCascade.candidates
                  : props.users
                ).map((user) => (
                  <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </JournalSettingsModal>
    );
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className={JOURNAL_DIALOG_CONTENT_CLASS}>
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>
            Настройки журнала
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 px-7 py-6">
          <div className="space-y-1">
            <Label className="text-[13px] font-medium text-[#3c4053]">Бактерицидная установка №</Label>
            <Input
              value={lampNumber}
              onChange={(event) => setLampNumber(event.target.value)}
              className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[24px] leading-none"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[13px] font-medium text-[#3c4053]">Наименование цеха/участка применения</Label>
            <Input
              value={areaName}
              onChange={(event) => setAreaName(event.target.value)}
              className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[13px] font-medium text-[#3c4053]">Дата начала</Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[13px] font-medium text-[#3c4053]">Должность ответственного</Label>
            <Select
              value={
                responsibleTitle && responsibleTitle !== UV_LEGACY_EMPTY_TITLE
                  ? responsibleTitle
                  : EMPTY_SELECT_VALUE
              }
              onValueChange={settingsCascade.handlePositionChange}
            >
              <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-[#fafbff] px-3.5 text-[13.5px]">
                <SelectValue placeholder="- Выберите значение -" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={EMPTY_SELECT_VALUE} className={MENU_ITEM_MUTED_CLASS}>- Выберите значение -</SelectItem>
                <PositionSelectItems users={props.users} groups={options} />
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[13px] font-medium text-[#3c4053]">Сотрудник</Label>
            <Select
              value={responsibleUserId}
              onValueChange={settingsCascade.handleEmployeeChange}
              open={settingsCascade.employeeOpen}
              onOpenChange={settingsCascade.setEmployeeOpen}
            >
              <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-[#fafbff] px-3.5 text-[13.5px]">
                <SelectValue placeholder="- Выберите значение -" />
              </SelectTrigger>
              <SelectContent>
                {(responsibleTitle && responsibleTitle !== UV_LEGACY_EMPTY_TITLE
                  ? settingsCascade.candidates
                  : props.users
                ).map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end pt-1">
            <Button
              type="button"
              disabled={submitting}
              onClick={handleSave}
              className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] font-medium text-white hover:bg-[#4a5bf0]"
            >
              {submitting ? "Сохранение..." : "Сохранить"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Add Row Dialog ─── */

function AddRowDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  users: UserItem[];
  defaultEmployeeId: string;
  defaultResponsibleTitle: string;
  onAdd: (data: {
    date: string;
    startTime: string;
    endTime: string;
    employeeId: string;
    responsibleTitle: string;
  }) => void;
}) {
  const [date, setDate] = useState(toIsoDate(new Date()));
  const [startHour, setStartHour] = useState("10");
  const [startMin, setStartMin] = useState("00");
  const [endHour, setEndHour] = useState("18");
  const [endMin, setEndMin] = useState("00");
  const [responsibleTitle, setResponsibleTitle] = useState(props.defaultResponsibleTitle);
  const [employeeId, setEmployeeId] = useState(props.defaultEmployeeId);
  const addRowCascade = usePositionEmployeeCascade({
    users: props.users,
    positionTitle: responsibleTitle,
    userId: employeeId,
    onChange: (n) => {
      setResponsibleTitle(n.positionTitle);
      setEmployeeId(n.userId);
    },
    autoPick: "first",
  });

  const options = useMemo(() => getUvResponsibleTitleOptions(props.users), [props.users]);

  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
  const minutes = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className={JOURNAL_DIALOG_CONTENT_CLASS}>
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>
            Добавление новой строки
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 px-7 py-6">
          <div className="space-y-1">
            <Label className="text-[13px] font-medium text-[#3c4053]">Дата</Label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
            />
          </div>

          <div>
            <div className="mb-2 text-[16px] font-medium text-black">Время включения</div>
            <div className="flex gap-3">
              <div className="flex-1 space-y-1">
                <Label className="text-[13px] font-medium text-[#3c4053]">Часы</Label>
                <Select value={startHour} onValueChange={setStartHour}>
                  <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-[#fafbff] px-3.5 text-[13.5px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-[200px]">
                    {hours.map((h) => (
                      <SelectItem key={h} value={h}>{h}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 space-y-1">
                <Label className="text-[13px] font-medium text-[#3c4053]">Минуты</Label>
                <Select value={startMin} onValueChange={setStartMin}>
                  <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-[#fafbff] px-3.5 text-[13.5px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-[200px]">
                    {minutes.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div>
            <div className="mb-2 text-[16px] font-medium text-black">Время выключения</div>
            <div className="flex gap-3">
              <div className="flex-1 space-y-1">
                <Label className="text-[13px] font-medium text-[#3c4053]">Часы</Label>
                <Select value={endHour} onValueChange={setEndHour}>
                  <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-[#fafbff] px-3.5 text-[13.5px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-[200px]">
                    {hours.map((h) => (
                      <SelectItem key={h} value={h}>{h}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 space-y-1">
                <Label className="text-[13px] font-medium text-[#3c4053]">Минуты</Label>
                <Select value={endMin} onValueChange={setEndMin}>
                  <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-[#fafbff] px-3.5 text-[13.5px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-[200px]">
                    {minutes.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-[13px] font-medium text-[#3c4053]">Должность ответственного</Label>
            <Select
              value={responsibleTitle || EMPTY_SELECT_VALUE}
              onValueChange={addRowCascade.handlePositionChange}
            >
              <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-[#fafbff] px-3.5 text-[13.5px]">
                <SelectValue placeholder="- Выберите значение -" />
              </SelectTrigger>
              <SelectContent>
                <PositionSelectItems users={props.users} groups={options} />
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-[13px] font-medium text-[#3c4053]">Сотрудник</Label>
            <Select
              value={employeeId}
              onValueChange={addRowCascade.handleEmployeeChange}
              open={addRowCascade.employeeOpen}
              onOpenChange={addRowCascade.setEmployeeOpen}
            >
              <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-[#fafbff] px-3.5 text-[13.5px]">
                <SelectValue placeholder="- Выберите значение -" />
              </SelectTrigger>
              <SelectContent>
                {(responsibleTitle ? addRowCascade.candidates : props.users).map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end pt-1">
            <Button
              type="button"
              onClick={() => {
                props.onAdd({
                  date,
                  startTime: `${startHour}:${startMin}`,
                  endTime: `${endHour}:${endMin}`,
                  employeeId,
                  responsibleTitle,
                });
                props.onOpenChange(false);
              }}
              className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] font-medium text-white hover:bg-[#4a5bf0]"
            >
              Добавить
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Specification Display Table ─── */

/**
 * Незаполненная обязательная ячейка спецификации.
 *
 * Эталон (uv_lamp_runtime-grid.png) подсвечивает пустые обязательные поля
 * розовым — инспектор сразу видит, что бланк недооформлен. Клик по ячейке
 * открывает диалог спецификации, поэтому «дозаполнить» можно прямо
 * отсюда, не идя в настройки. В печати заливки нет — бумага белая.
 */
const UV_SPEC_EMPTY_CELL_CLASS =
  "bg-[#fdf0f0] shadow-[inset_0_0_0_1px_#f8d7da] print:bg-white print:shadow-none";

function SpecValueCell({
  value,
  onEdit,
  editable,
  nowrap = false,
}: {
  /** Готовая к показу строка; пустая ⇒ ячейка считается незаполненной. */
  value: string;
  onEdit: () => void;
  editable: boolean;
  /** Короткие значения вроде «1 раз в смену» не переносим (U7). */
  nowrap?: boolean;
}) {
  const filled = value.trim() !== "" && value.trim() !== "—";

  return (
    <td
      className={`border border-[#ccc] p-0 text-center leading-tight ${
        filled ? "" : UV_SPEC_EMPTY_CELL_CLASS
      }`}
    >
      {editable ? (
        <button
          type="button"
          onClick={onEdit}
          title={filled ? "Изменить значение спецификации" : "Заполнить обязательное поле спецификации"}
          className={`${CELL_FOCUS_CLASS} h-full w-full px-3 py-1 text-center transition-colors duration-150 hover:bg-[#eef0ff] ${
            nowrap ? "whitespace-nowrap" : ""
          }`}
        >
          {/* U5: пустая обязательная ячейка — только розовая заливка,
              без слова «Заполнить» (как на эталоне). Подсказка остаётся
              в `title`, клик по-прежнему открывает диалог. */}
          {filled ? value : " "}
        </button>
      ) : (
        <span className={`block px-3 py-1 ${nowrap ? "whitespace-nowrap" : ""}`}>
          {filled ? value : " "}
        </span>
      )}
    </td>
  );
}

function SpecificationTable({
  config,
  onEdit,
  editable,
}: {
  config: UvRuntimeDocumentConfig;
  onEdit: () => void;
  editable: boolean;
}) {
  const spec = config.spec;

  return (
    <div className="uv-spec-section">
      {/* `overflow-auto`, а не `overflow-x-auto`: глобальное мобильное
          правило `div.overflow-x-auto:has(table)` гасит скролл и поля,
          и справочная таблица уезжала за правый край. */}
      <div className="-mx-4 overflow-auto px-4 sm:mx-0 lg:overflow-visible sm:px-0">
      <table className="w-full min-w-[640px] table-fixed border-collapse text-[13px] text-[12px] sm:min-w-0">
        {/* U7: четыре примерно равные колонки — раньше подписи занимали
            445/480px и душили значения. */}
        <colgroup>
          {/* P8: 25/25/25/25 — на эталоне все четыре колонки спецификации
              равные (у нас 27/23 давало 310/264 и «ступеньку» посередине). */}
          <col className="w-[25%]" />
          <col className="w-[25%]" />
          <col className="w-[25%]" />
          <col className="w-[25%]" />
        </colgroup>
        <tbody>
          {/* Заголовок — строка внутри таблицы (как на эталоне), а не
              отдельная подпись сверху: так он печатается вместе с бланком. */}
          <tr>
            <td
              colSpan={4}
              className="border border-[#ccc] bg-[#f0f0f0] px-3 py-1.5 text-center text-[13px] font-bold leading-tight print:bg-white"
            >
              Спецификация ультрафиолетовой бактерицидной установки
            </td>
          </tr>
          <tr>
            <td className="border border-[#ccc] bg-[#f9f9f9] px-3 py-1 font-medium leading-tight">
              Объект обеззараживания (воздух или поверхность, или то и другое)
            </td>
            <SpecValueCell value={getDisinfectionObjectLabel(spec)} onEdit={onEdit} editable={editable} />
            <td className="border border-[#ccc] bg-[#f9f9f9] px-3 py-1 font-medium leading-tight">
              Ресурс рабочего времени (срок замены отработавших ламп), часов
            </td>
            <SpecValueCell
              value={spec.lampLifetimeHours ? String(spec.lampLifetimeHours) : ""}
              onEdit={onEdit}
              editable={editable}
            />
          </tr>
          <tr>
            <td className="border border-[#ccc] bg-[#f9f9f9] px-3 py-1 font-medium leading-tight">
              Вид микроорганизма (санитарно-показательный или иной)
            </td>
            <SpecValueCell value={spec.microorganismType} onEdit={onEdit} editable={editable} />
            <td className="border border-[#ccc] bg-[#f9f9f9] px-3 py-1 font-medium leading-tight">
              Дата ввода установки в эксплуатацию
            </td>
            <SpecValueCell
              value={spec.commissioningDate ? formatRuDateDash(spec.commissioningDate) : ""}
              onEdit={onEdit}
              editable={editable}
            />
          </tr>
          <tr>
            <td className="border border-[#ccc] bg-[#f9f9f9] px-3 py-1 font-medium leading-tight">
              Режим облучения (непрерывный или повторно-кратковременный)
            </td>
            <SpecValueCell value={getRadiationModeLabel(spec.radiationMode)} onEdit={onEdit} editable={editable} />
            <td className="border border-[#ccc] bg-[#f9f9f9] px-3 py-1 font-medium leading-tight">
              Минимальный интервал между сеансами (для повторно-кратковременной)
            </td>
            <SpecValueCell value={spec.minIntervalBetweenSessions} onEdit={onEdit} editable={editable} />
          </tr>
          <tr>
            <td className="border border-[#ccc] bg-[#f9f9f9] px-3 py-1 font-medium leading-tight">
              Условия обеззараживания (в присутствии или отсутствии людей)
            </td>
            <SpecValueCell
              value={getDisinfectionConditionLabel(spec.disinfectionCondition)}
              onEdit={onEdit}
              editable={editable}
            />
            <td className="border border-[#ccc] bg-[#f9f9f9] px-3 py-1 font-medium leading-tight">
              Частота контроля работы установки (частота включений)
            </td>
            <SpecValueCell
              value={formatControlFrequencyLabel(spec.controlFrequency)}
              onEdit={onEdit}
              editable={editable}
              nowrap
            />
          </tr>
        </tbody>
      </table>
      </div>
      <div className={`mt-2 flex justify-end print:hidden ${editable ? "" : "hidden"}`}>
        <button
          type="button"
          onClick={onEdit}
          className="text-[13px] text-[#5566f6] underline hover:no-underline"
        >
          Настроить спецификацию
        </button>
      </div>
    </div>
  );
}

/* ─── Monthly Summary Table ─── */

/**
 * Эталон печатает бланк наработки по месяцам ВСЕГДА — с шестью пустыми
 * строками, которые заполняются от руки, если данных ещё нет. Раньше мы
 * прятали таблицу при `monthlyData.length === 0`, и в новом журнале блок
 * просто отсутствовал.
 */
const UV_MONTHLY_MIN_ROWS = 6;

function MonthlySummaryTable({ monthlyData }: { monthlyData: { month: string; hours: number; remaining: number }[] }) {
  const half = Math.max(
    UV_MONTHLY_MIN_ROWS,
    Math.ceil(monthlyData.length / 2)
  );
  const leftCol = monthlyData.slice(0, half);
  const rightCol = monthlyData.slice(half);
  const rowIndexes = Array.from({ length: half }, (_, index) => index);

  return (
    <div className="uv-monthly-section">
      {/* См. комментарий в SpecificationTable — тот же обход глобального
          правила для телефона. */}
      <div className="-mx-4 overflow-auto px-4 sm:mx-0 lg:overflow-visible sm:px-0">
      <table className="w-full min-w-[720px] border-collapse text-[13px] text-[12px] sm:min-w-0">
        <thead>
          <tr>
            <th
              colSpan={6}
              className="border border-[#ccc] bg-[#f0f0f0] px-3 py-1.5 text-center text-[13px] font-bold leading-tight print:bg-white"
            >
              Суммарное количество отработанных часов бактерицидной установкой по месяцам
            </th>
          </tr>
          <tr className="bg-[#f0f0f0]">
            <th className="border border-[#ccc] px-3 py-1 text-left font-semibold leading-tight">Месяц, год</th>
            <th className="border border-[#ccc] px-3 py-1 text-center font-semibold leading-tight">Количество часов</th>
            <th className="border border-[#ccc] px-3 py-1 text-center font-semibold leading-tight">Остаточное количество часов</th>
            <th className="border border-[#ccc] px-3 py-1 text-left font-semibold leading-tight">Месяц, год</th>
            <th className="border border-[#ccc] px-3 py-1 text-center font-semibold leading-tight">Количество часов</th>
            <th className="border border-[#ccc] px-3 py-1 text-center font-semibold leading-tight">Остаточное количество часов</th>
          </tr>
        </thead>
        <tbody>
          {rowIndexes.map((index) => {
            const left = leftCol[index];
            const right = rightCol[index];
            /* h-[28px] + неразрывный пробел в пустой ячейке: без них
               шесть пустых строк бланка схлопывались в нити 3-5px
               (у `leading-tight` пустой td нулевой высоты). */
            const cell = "h-[28px] border border-[#ccc] px-3 py-1 leading-tight";
            const num = `${cell} text-center`;
            const blank = " ";
            return (
              <tr key={left?.month || `empty-${index}`}>
                <td className={cell}>{left ? formatMonthLabel(left.month) : blank}</td>
                <td className={num}>{left ? left.hours.toFixed(2).replace(".", ",") : blank}</td>
                <td className={num}>{left ? left.remaining.toFixed(2).replace(".", ",") : blank}</td>
                <td className={cell}>{right ? formatMonthLabel(right.month) : blank}</td>
                <td className={num}>{right ? right.hours.toFixed(2).replace(".", ",") : blank}</td>
                <td className={num}>{right ? right.remaining.toFixed(2).replace(".", ",") : blank}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}

/* ─── Main Document Client ─── */

function rowSaveErrorMessage(error: unknown): string {
  return error instanceof Error && error.message === NO_ROW_EMPLOYEE_MESSAGE
    ? NO_ROW_EMPLOYEE_MESSAGE
    : "Не удалось сохранить строку";
}

export function UvLampRuntimeDocumentClient(props: Props) {
  const router = useRouter();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [specEditOpen, setSpecEditOpen] = useState(false);
  const [addRowOpen, setAddRowOpen] = useState(false);
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  // Сеанс, который правим из карточки (день + номер сеанса): за день их
  // может быть 2-3, и лист правки должен знать, какой именно открыт.
  const [editingSession, setEditingSession] = useState<
    { rowId: string; sessionIndex: number } | null
  >(null);
  const [autoFill, setAutoFill] = useState(props.autoFill === true);
  /** Право управлять журналами — то же, что проверяет PATCH документа. */
  const canManageDocument = useCanManageJournalDocument();

  const [config, setConfig] = useState(() => normalizeUvRuntimeDocumentConfig(props.config));
  // На кого записывать строку без выбранного сотрудника: ответственный
  // документа, иначе вошедший (если он в ростере). «Первого в списке» не
  // берём — запись уходила от случайного человека.
  const viewerId = useRosterViewerId(props.users);
  const fallbackEmployeeId = props.responsibleUserId || viewerId || "";
  const [rows, setRows] = useState(() =>
    buildRows({
      dateFrom: props.dateFrom,
      dateTo: props.dateTo,
      status: props.status,
      initialEntries: props.initialEntries,
    })
  );

  // Снимок того, что реально лежит на сервере: инпуты пишут в `rows` на
  // каждый символ, поэтому «прежнее значение» для отмены брать оттуда
  // нельзя. Заполняем на первом рендере — тогда и самая первая правка
  // строки отменяется, а не только вторая.
  const savedRowsRef = useRef<Map<string, GridRow> | null>(null);
  if (savedRowsRef.current === null) {
    savedRowsRef.current = new Map(rows.map((row) => [row.date, row]));
  }
  const savedRows = savedRowsRef.current;
  // История отмены: только правки этого человека в этой вкладке.
  const undoStack = useJournalUndo({ enabled: props.status === "active" });

  const userMap = useMemo(() => Object.fromEntries(props.users.map((user) => [user.id, user.name])), [props.users]);

  // U6: в таблице теперь только реальные записи, поэтому удалить можно
  // любую строку. Проверку на `virtual:*` оставляем как страховку —
  // строка, добавленная через «+ Добавить», до ответа сервера живёт
  // с временным id.
  const deletableRowIds = useMemo(
    () => rows.filter((row) => !row.id.startsWith("virtual:")).map((row) => row.id),
    [rows],
  );
  const allSelected =
    deletableRowIds.length > 0 &&
    deletableRowIds.every((id) => selectedRowIds.includes(id));
  const selectedDeletableCount = selectedRowIds.filter(
    (id) => !id.startsWith("virtual:"),
  ).length;
  const { mobileView, switchMobileView } = useMobileView("uv_lamp_runtime");

  const monthlyData = useMemo(() => {
    const entriesWithData = rows.map((row) => ({ date: row.date, data: row.data }));
    return calculateMonthlyHours(entriesWithData, config.spec.lampLifetimeHours);
  }, [rows, config.spec.lampLifetimeHours]);

  /**
   * Запись строки. Отмена (Ctrl+Z) — это повторная запись прежних
   * значений тем же PUT, а не правка состояния на клиенте: серверные
   * запреты (закрытый день, права) обязаны сработать и на откате.
   *
   * Прежнее значение берём из `savedRowsRef` — в `rows` к моменту blur
   * уже лежит НОВОЕ значение (инпут пишет в state на каждый символ).
   *
   * `silent` — вызов из истории: нового шага не кладём.
   */
  const saveRow = useCallback(async (
    row: GridRow,
    previous?: { id: string; employeeId: string },
    options?: { silent?: boolean }
  ) => {
    const previousSaved = savedRows.get(row.date);
    if (!(row.employeeId || fallbackEmployeeId)) {
      throw new Error(NO_ROW_EMPLOYEE_MESSAGE);
    }
    const response = await fetch(`/api/journal-documents/${props.documentId}/entries`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeId: row.employeeId || fallbackEmployeeId,
        date: row.date,
        data: row.data,
      }),
    });

    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.entry) {
      throw new Error("save_row_failed");
    }

    if (
      previous &&
      !previous.id.startsWith("virtual:") &&
      previous.employeeId &&
      previous.employeeId !== (row.employeeId || fallbackEmployeeId)
    ) {
      await fetch(`/api/journal-documents/${props.documentId}/entries`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [previous.id] }),
      });
    }

    const saved: GridRow = {
      id: result.entry.id,
      employeeId: row.employeeId || fallbackEmployeeId,
      date: row.date,
      data: row.data,
    };
    // Из ответа забираем ТОЛЬКО id: пока запрос летел, человек мог уже
    // править времена, и подстановка отправленного снимка их стирала.
    setRows((current) =>
      current.map((item) => (item.date === saved.date ? { ...item, id: saved.id } : item))
    );
    savedRows.set(saved.date, saved);

    if (!options?.silent && previousSaved) {
      const restored: GridRow = { ...saved, data: previousSaved.data, employeeId: previousSaved.employeeId };
      const applied: GridRow = { ...saved };
      undoStack.push({
        undo: async () => {
          await saveRow(restored, undefined, { silent: true });
          setRows((current) =>
            current.map((item) => (item.date === restored.date ? { ...item, data: restored.data } : item))
          );
        },
        redo: async () => {
          await saveRow(applied, undefined, { silent: true });
          setRows((current) =>
            current.map((item) => (item.date === applied.date ? { ...item, data: applied.data } : item))
          );
        },
      });
    }
  }, [props.documentId, fallbackEmployeeId, savedRows, undoStack]);

  async function deleteSelectedRows() {
    const deletable = rows.filter((row) => selectedRowIds.includes(row.id) && !row.id.startsWith("virtual:"));
    if (deletable.length === 0) return;
    const count = deletable.length;
    if (!(await confirmAsync({ title: "Удалить выбранные строки?", description: `Будет удалено строк: ${count}. Восстановить нельзя.`, variant: "danger", confirmLabel: "Удалить" }))) return;

    try {
      const response = await fetch(`/api/journal-documents/${props.documentId}/entries`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: deletable.map((row) => row.id) }),
      });

      if (!response.ok) {
        throw new Error("Не удалось удалить выбранные строки");
      }

      // U6: удалённая запись пропадает из таблицы целиком — пустых
      // строк-заготовок в бланке больше нет.
      setRows((current) => current.filter((row) => !selectedRowIds.includes(row.id)));
      setSelectedRowIds([]);
      toast.success(`Удалено строк: ${count}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось удалить выбранные строки");
    }
  }

  async function handleCloseJournal() {
    const confirmed = await confirmAsync({
      title: "Закончить журнал?",
      description: "Документ станет доступен только для чтения.",
      variant: "warn",
      confirmLabel: "Закончить",
    });
    if (!confirmed) return;

    const response = await fetch(`/api/journal-documents/${props.documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "closed" }),
    });

    if (!response.ok) {
      toast.error("Не удалось закрыть журнал");
      return;
    }

    router.refresh();
  }

  async function handleAddRow(data: {
    date: string;
    startTime: string;
    endTime: string;
    employeeId: string;
  }) {
    const existing = rows.find((r) => r.date === data.date);
    // Регламент допускает 2-3 сеанса в смену: вторая запись за ту же дату
    // раньше молча затирала первую. Теперь она ДОПИСЫВАЕТСЯ сеансом.
    const newRow: GridRow = existing
      ? {
          ...existing,
          employeeId: data.employeeId,
          data: {
            ...existing.data,
            extraSessions: [
              ...(existing.data.extraSessions ?? []),
              { startTime: data.startTime, endTime: data.endTime },
            ],
          },
        }
      : {
          id: `virtual:${data.date}:new`,
          date: data.date,
          employeeId: data.employeeId,
          data: { startTime: data.startTime, endTime: data.endTime },
        };

    setRows((current) => {
      if (existing) {
        return current.map((r) => (r.date === data.date ? newRow : r));
      }
      const updated = [...current, newRow];
      updated.sort((a, b) => a.date.localeCompare(b.date));
      return updated;
    });

    try {
      await saveRow(newRow);
      if (existing) toast.success("Добавлен ещё один сеанс за эту дату");
    } catch (error) {
      toast.error(rowSaveErrorMessage(error));
    }
  }

  /**
   * Правка дня в state. Новый объект строки возвращаем сразу — updater
   * `setRows` выполняется отложенно, и ждать из него значение нельзя.
   */
  function patchRowData(
    rowId: string,
    next: (data: UvRuntimeEntryData) => UvRuntimeEntryData
  ): GridRow | null {
    const row = rows.find((item) => item.id === rowId);
    if (!row) return null;
    const updated: GridRow = { ...row, data: next(row.data) };
    setRows((current) => current.map((item) => (item.id === rowId ? updated : item)));
    return updated;
  }

  /** Правка времени одного сеанса (без записи на сервер — она на blur). */
  function editSessionTime(
    rowId: string,
    sessionIndex: number,
    patch: { startTime?: string; endTime?: string }
  ) {
    patchRowData(rowId, (data) => updateUvRuntimeSession(data, sessionIndex, patch));
  }

  /** Удаление одного сеанса дня; последний сеанс удаляется вместе со строкой. */
  async function deleteSession(rowId: string, sessionIndex: number) {
    const row = rows.find((item) => item.id === rowId);
    if (!row) return;
    const confirmed = await confirmAsync({
      title: "Удалить сеанс?",
      description: `Сеанс №${sessionIndex + 1} за ${formatRuDateDash(row.date)} будет удалён из записи.`,
      variant: "danger",
      confirmLabel: "Удалить",
    });
    if (!confirmed) return;

    const updated = patchRowData(rowId, (data) => removeUvRuntimeSession(data, sessionIndex));
    if (!updated) return;
    try {
      await saveRow(updated);
      toast.success("Сеанс удалён");
    } catch (error) {
      toast.error(rowSaveErrorMessage(error));
    }
  }

  /** «Ещё сеанс» — пустой слот, который тут же заполняют. */
  async function addSession(rowId: string) {
    const updated = patchRowData(rowId, (data) =>
      appendUvRuntimeSession(data, {
        startTime: config.spec.autoFillStartTime,
        endTime: "",
      })
    );
    if (!updated) return;
    try {
      await saveRow(updated);
    } catch (error) {
      toast.error(rowSaveErrorMessage(error));
    }
  }

  /** Сохранение времени ВКЛ/ВЫКЛ из карточного листа правки. */
  async function saveRowFromSheet(
    rowId: string,
    sessionIndex: number,
    values: CardEditValues
  ) {
    const startTime = String(values.startTime ?? "");
    const endTime = String(values.endTime ?? "");
    const updated = patchRowData(rowId, (data) =>
      updateUvRuntimeSession(data, sessionIndex, { startTime, endTime })
    );

    setEditingSession(null);
    if (!updated) return;

    try {
      await saveRow(updated);
    } catch (error) {
      toast.error(rowSaveErrorMessage(error));
    }
  }

  async function handleSaveSettings(data: {
    config: UvRuntimeDocumentConfig;
    dateFrom: string;
    responsibleTitle: string;
    responsibleUserId: string;
  }) {
    const response = await fetch(`/api/journal-documents/${props.documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: buildUvRuntimeDocumentTitle(data.config),
        config: data.config,
        dateFrom: data.dateFrom,
        responsibleTitle: data.responsibleTitle || null,
        responsibleUserId: data.responsibleUserId || null,
      }),
    });

    if (!response.ok) {
      toast.error("Не удалось сохранить настройки");
      return;
    }

    setConfig(data.config);
    router.refresh();
  }

  async function handleSaveSpec(spec: UvSpecification) {
    const nextConfig = { ...config, spec };
    const response = await fetch(`/api/journal-documents/${props.documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: nextConfig }),
    });

    if (!response.ok) {
      toast.error("Не удалось сохранить спецификацию");
      return;
    }

    setConfig(nextConfig);
  }

  async function handleAutoFillChange(value: boolean) {
    setAutoFill(value);

    const response = await fetch(`/api/journal-documents/${props.documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autoFill: value }),
    });

    if (!response.ok) {
      setAutoFill(!value);
      toast.error("Не удалось сохранить настройку автозаполнения");
      return;
    }

    if (value) {
      // Сразу проставляем типовой сеанс работы установки в пустые дни —
      // дальше это же делает ежедневный cron /api/cron/auto-fill-journals.
      const autoFillResponse = await fetch(
        `/api/journal-documents/${props.documentId}/uv-runtime`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "apply_auto_fill" }),
        }
      );

      if (!autoFillResponse.ok) {
        const result = await autoFillResponse.json().catch(() => null);
        toast.error(result?.error || "Не удалось применить автозаполнение");
      }
    }

    router.refresh();
  }

  // «Сегодня» — после mount (useTodayKey): new Date() в рендере
  // расходился между сервером (UTC) и браузером и врал подсветкой.
  const todayKey = useTodayKey();
  const todayFocusRowIndex = rows.findIndex((row) => row.date === todayKey);

  return (
    <div className={DOC_BODY_STACK_CLASS}>
      <FocusTodayScroller
        onCreate={
          props.status === "active" ? () => setAddRowOpen(true) : undefined
        }
      />
      <DocumentActionsBar
        backHref={`/journals/${props.routeCode}`}
        documentId={props.documentId}
        undo={{
          canUndo: undoStack.canUndo,
          canRedo: undoStack.canRedo,
          onUndo: () => void undoStack.undo(),
          onRedo: () => void undoStack.redo(),
          undoCount: undoStack.undoCount,
        }}
        heading={
          <h1 className={DOC_HEADING_CLASS}>
            Журнал учета работы УФ бактерицидной установки
          </h1>
        }
        onSettings={props.status === "active" ? () => setSettingsOpen(true) : undefined}
        menuItems={
          props.status === "active"
            ? [
                {
                  key: "close-journal",
                  label: "Закончить журнал",
                  icon: <Archive className="size-4" />,
                  onSelect: () => void handleCloseJournal(),
                },
              ]
            : []
        }
      />

      {props.status !== "active" ? (
        <div className="mb-5">
          <JournalClosedBanner hint="Откройте журнал заново, чтобы редактировать отметки времени." />
        </div>
      ) : (
        <div className="mb-4 print:hidden">
          <TodayStripForJournal
            journalCode="uv_lamp_runtime"
            todayCount={
              rows.filter(
                (row) =>
                  row.date === todayKey &&
                  Boolean(row.data.startTime && row.data.endTime)
              ).length
            }
            label="отметка о работе установки за сегодня"
          />
        </div>
      )}

      {/* Полоса автозаполнения — сразу под строкой заголовка (эталон). */}
      {/* Настройка документа — право руководителя (сервер отвечал 403). */}
      {props.status === "active" && canManageDocument && (
        <div className={DOC_AUTOFILL_STRIP_CLASS}>
          <Switch checked={autoFill} onCheckedChange={(checked) => void handleAutoFillChange(checked)} />
          <span className={DOC_AUTOFILL_LABEL_CLASS}>Автоматически заполнять журнал</span>
        </div>
      )}

      {/* Toolbar row */}
      <div className="flex flex-wrap items-center gap-3 print:hidden">
      </div>

      <JournalSelectionBar
        count={selectedRowIds.length}
        onClear={() => setSelectedRowIds([])}
        onDelete={
          selectedDeletableCount > 0
            ? () => {
                deleteSelectedRows().catch(() => toast.error("Ошибка удаления"));
              }
            : undefined
        }
        hint={
          selectedDeletableCount > 0
            ? "Записи наработки будут удалены без возможности отмены"
            : "Автоматические строки удалить нельзя — в них ещё нет записи"
        }
      />

      {/* A7 аудита: печатный колонтитул удалён целиком.

          Он дублировал то, что и так печатается ниже: организацию и
          название журнала — в ХАССП-шапке (`JournalDocumentHeader`), а
          «БАКТЕРИЦИДНАЯ УСТАНОВКА №N» и линию «(наименование цеха /
          участка применения)» — в титульном блоке бланка. На листе
          выходило ДВЕ шапки подряд.

          Заодно ушла строка «Стр.: 1 из 1» — она была захардкожена и
          врала на любом журнале длиннее листа (наработка УФ — 31 строка
          в месяц, регулярно 2+ страницы). Нумерацию страниц печати
          браузер ставит сам. */}

      {/* R1: бумажное полотно — во всю ширину контентной колонки. */}
        <div className="mb-4 sm:hidden print:hidden">
          <MobileViewToggle mobileView={mobileView} onChange={switchMobileView} />
        </div>

      <div className={DOC_PAPER_CANVAS_CLASS}>
      {/* Официальный ХАССП-header — для печати в РПН/СЭС-проверки.
          По эталону (uv_lamp_runtime-grid.png) он стоит НАД справочными
          таблицами спецификации и наработки, а не под ними. */}
      <div
        className={`${DOC_PAPER_HEADER_CLASS} print:mb-2 ${
          mobileView === "cards" ? DOC_PAPER_HEADER_CARDS_HIDDEN_CLASS : ""
        }`}
      >
        <JournalDocumentHeader
          orgName={props.organizationName}
          title="Журнал учета работы ультрафиолетовой бактерицидной установки"
          startedAt={props.dateFrom}
          finishedAt={props.status === "closed" ? props.dateTo : null}
          controlPeriodicity={props.controlPeriodicity}
        />
      </div>
      {/* Шапка бланка по эталону: номер установки, название журнала и
          линия «наименование цеха / участка применения». Раньше здесь
          стоял только КАПС-заголовок, а номер установки и участок
          применения жили лишь в print-only блоке. */}
      <div className={`${DOC_CAPS_TITLE_CLASS} text-center`}>
        <div className="text-[15px] font-bold uppercase leading-tight text-black">
          Бактерицидная установка №{config.lampNumber}
        </div>
        <div className="mt-4 text-[14px] font-bold leading-tight text-black">
          {UV_LAMP_RUNTIME_PAGE_TITLE}
        </div>
        <div className="mx-auto mt-1 w-fit min-w-[280px] max-w-full border-b border-[#333] px-4 pb-0.5 text-[13px] leading-tight text-black print:border-black">
          {config.areaName || " "}
        </div>
        <div className="mt-1 text-[11px] leading-tight text-[#e07b00] print:text-black">
          (наименование цеха / участка применения)
        </div>
      </div>

      {/* Specification table */}
      <div className="mb-5">
        <SpecificationTable
          config={config}
          onEdit={() => setSpecEditOpen(true)}
          editable={props.status === "active"}
        />
      </div>

      {/* Monthly summary */}
      <div className="mb-5">
        <MonthlySummaryTable monthlyData={monthlyData} />
      </div>


      {mobileView === "cards" ? (
        <RecordCardsView
          items={rows.map((row, index) => {
            const duration = calculateEntryDurationMinutes(row.data);
            // С телефона тоже нужен КАЖДЫЙ сеанс дня: раньше карточка
            // показывала времена одной строкой и правила только первый.
            const sessions = listUvRuntimeSessionSlots(row.data);
            return {
              id: row.id,
              title: `№${index + 1} · ${formatRuDateDash(row.date)}`,
              subtitle: userMap[row.employeeId || fallbackEmployeeId] || undefined,
              badge: duration !== null ? (
                <span className="rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[11px] font-semibold text-[#5566f6]">
                  {duration} мин
                </span>
              ) : undefined,
              leading: props.status === "active" ? (
                <Checkbox
                  checked={selectedRowIds.includes(row.id)}
                  onCheckedChange={(checked) =>
                    setSelectedRowIds((current) =>
                      checked === true
                        ? [...new Set([...current, row.id])]
                        : current.filter((id) => id !== row.id)
                    )
                  }
                  className="size-5"
                />
              ) : null,
              actions:
                props.status === "active" ? (
                  <button
                    type="button"
                    onClick={() => void addSession(row.id)}
                    className="w-full rounded-xl border border-[#dcdfed] bg-[#f5f6ff] px-3 py-2 text-[13px] font-semibold text-[#5566f6] transition-colors duration-150 hover:bg-[#eef1ff]"
                  >
                    + Ещё сеанс
                  </button>
                ) : undefined,
              fields: [
                ...sessions.map((session, sessionIndex) => ({
                  label: `Сеанс №${sessionIndex + 1}`,
                  value: (
                    <span className="flex flex-wrap items-center gap-2">
                      <span>
                        {session.startTime || "—"} — {session.endTime || "—"}
                      </span>
                      {props.status === "active" ? (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              setEditingSession({ rowId: row.id, sessionIndex })
                            }
                            className="rounded-full bg-[#f5f6ff] px-3 py-1 text-[12px] font-semibold text-[#5566f6] transition-colors duration-150 hover:bg-[#eef1ff]"
                          >
                            изменить
                          </button>
                          {sessions.length > 1 ? (
                            <button
                              type="button"
                              onClick={() => void deleteSession(row.id, sessionIndex)}
                              className="rounded-full bg-[#fdf0f0] px-3 py-1 text-[12px] font-semibold text-[#e05a5a] transition-colors duration-150 hover:bg-[#fbe3e3]"
                            >
                              удалить
                            </button>
                          ) : null}
                        </>
                      ) : null}
                    </span>
                  ),
                })),
                {
                  label: "Продолжительность",
                  value: duration !== null ? `${duration} минут` : "",
                  hideIfEmpty: true,
                },
                {
                  label: "Ответственный",
                  value: userMap[row.employeeId || fallbackEmployeeId] || "",
                  hideIfEmpty: true,
                },
              ],
            };
          })}
          emptyLabel="Записей не найдено."
        />
      ) : null}

      {/* «Добавить» — слева непосредственно над таблицей (эталон).
          Раньше кнопка стояла выше mobile-переключателя и карточек. */}
      {props.status === "active" && (
        <div className={DOC_ADD_ROW_CLASS}>
          <Button
            type="button"
            onClick={() => setAddRowOpen(true)}
            className="h-11 gap-2 rounded-lg bg-[#5566f6] px-5 text-[15px] font-semibold text-white hover:bg-[#4a5bf0]"
          >
            <Plus className="size-5" strokeWidth={2.5} />
            Добавить
          </Button>
        </div>
      )}

      {/* Data table */}
      <MobileViewTableWrapper mobileView={mobileView} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0 rounded-[12px] border border-[#eceef5] bg-white print:rounded-none print:border-[#ccc]">
        {/* R5-7: `data-print-keep-size` — таблица из 5 колонок влезает в
            альбомный A4 целиком, сжимать её до 9.5px незачем (см.
            app-theme.css). Без атрибута шапка печаталась ~7pt против
            10.5pt у данных. */}
        <table
          data-print-keep-size
          className="w-full min-w-[720px] table-fixed border-collapse text-[13px] sm:min-w-[900px]"
        >
          {/* U9: «Итого продолжительность» — узкая колонка (заголовок в две
              строки), «ФИО ответственного лица» — широкая. Раньше было
              наоборот: 410px под минуты и сжатое ФИО. */}
          <colgroup>
            {/* Q2-6: `<th>`/`<td>` выделения печатались скрытыми, а
                `<col>` — нет, и при table-fixed колонка «Дата»
                получала 40px («01-/08-/202»). */}
            {props.status === "active" && <col className="w-[40px] print:hidden" />}
            {/* A12 аудита: ширины пересчитаны как ДОЛИ (table-fixed +
                w-full раздаёт свободное место пропорционально, поэтому
                важна не абсолютная величина, а отношение).
                Было 150/130/130/180/420 — доля ФИО 40%, и на полотне
                1400px колонка раздувалась до ~540px под селект в 148px,
                а «Итого продолжительность работы, минут» ютилось в 180px
                и ломалось на две строки. Стало ~25% под ФИО (≈340px) и
                вдвое шире «Итого». */}
            <col className="w-[210px]" />
            <col className="w-[210px]" />
            <col className="w-[210px]" />
            <col className="w-[300px]" />
            <col className="w-[320px]" />
          </colgroup>
          <thead>
            <tr className="bg-[#f6f7fb] print:bg-[#f0f0f0]">
              {props.status === "active" && (
                <th className="w-[40px] border border-[#eceef5] px-2 py-1 print:hidden leading-tight">
                  <Checkbox
                    checked={allSelected}
                    disabled={deletableRowIds.length === 0}
                    aria-label="Выбрать все строки"
                    onCheckedChange={(checked) =>
                      setSelectedRowIds(checked === true ? [...deletableRowIds] : [])
                    }
                  />
                </th>
              )}
              <th className="border border-[#eceef5] px-3 py-1 text-left font-semibold text-[#5b6075] print:border-[#ccc] leading-tight">Дата</th>
              <th className="border border-[#eceef5] px-3 py-1 text-center font-semibold text-[#5b6075] print:border-[#ccc] leading-tight">Время ВКЛ</th>
              <th className="border border-[#eceef5] px-3 py-1 text-center font-semibold text-[#5b6075] print:border-[#ccc] leading-tight">Время ВЫКЛ</th>
              <th className="border border-[#eceef5] px-3 py-1 text-center font-semibold text-[#5b6075] print:border-[#ccc] leading-tight">
                Итого продолжительность работы, минут
              </th>
              <th className="border border-[#eceef5] px-3 py-1 text-left font-semibold text-[#5b6075] print:border-[#ccc] leading-tight">
                ФИО ответственного лица
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => {
              const duration = calculateEntryDurationMinutes(row.data);
              // Строка на КАЖДЫЙ сеанс дня: второй и третий раньше были
              // текстом под первым — их нельзя было ни изменить, ни удалить.
              const sessions = listUvRuntimeSessionSlots(row.data);
              return (
                <Fragment key={row.id}>
                  {sessions.map((session, sessionIndex) => (
                    <tr
                      key={`${row.id}-${sessionIndex}`}
                      data-focus-today={
                        sessionIndex === 0 && rowIndex === todayFocusRowIndex ? "" : undefined
                      }
                      className="hover:bg-[#fafbff] print:hover:bg-transparent"
                    >
                      {sessionIndex === 0 && props.status === "active" && (
                        <td
                          rowSpan={sessions.length}
                          className="border border-[#eceef5] px-2 py-1 text-center align-middle print:hidden leading-tight"
                        >
                          <Checkbox
                            checked={selectedRowIds.includes(row.id)}
                            onCheckedChange={(checked) =>
                              setSelectedRowIds((current) =>
                                checked === true ? [...new Set([...current, row.id])] : current.filter((id) => id !== row.id)
                              )
                            }
                          />
                        </td>
                      )}
                      {sessionIndex === 0 && (
                        <td
                          rowSpan={sessions.length}
                          className="border border-[#eceef5] px-2 py-1 align-middle print:border-[#ccc] leading-tight"
                        >
                          <div className="px-2 py-1 text-[14px] text-black">{formatRuDateDash(row.date)}</div>
                          {sessions.length > 1 && (
                            <div className="px-2 text-[11px] text-[#8b90a6] print:text-black">
                              сеансов: {sessions.length}
                            </div>
                          )}
                        </td>
                      )}
                      <td className="border border-[#eceef5] px-2 py-1 text-center print:border-[#ccc] leading-tight">
                        {props.status === "active" ? (
                          <Input
                            type="time"
                            // Q2-2: пустой time-инпут печатает браузерную «рыбу»
                            // `--:--`. Флаг ловится в @media print (app-theme.css).
                            data-empty={session.startTime ? undefined : "true"}
                            value={session.startTime}
                            aria-label={`Время включения, сеанс №${sessionIndex + 1}`}
                            onChange={(event) =>
                              editSessionTime(row.id, sessionIndex, { startTime: event.target.value })
                            }
                            onBlur={() => {
                              saveRow(row).catch((error) => toast.error(rowSaveErrorMessage(error)));
                            }}
                            className="mx-auto h-9 w-[110px] rounded-md border-[#dcdfed] text-center text-[13px]"
                          />
                        ) : (
                          <span className="text-[14px] text-black">{session.startTime || "—"}</span>
                        )}
                      </td>
                      <td className="border border-[#eceef5] px-2 py-1 text-center print:border-[#ccc] leading-tight">
                        <div className="flex items-center justify-center gap-1">
                          {props.status === "active" ? (
                            <Input
                              type="time"
                              data-empty={session.endTime ? undefined : "true"}
                              value={session.endTime}
                              aria-label={`Время выключения, сеанс №${sessionIndex + 1}`}
                              onChange={(event) =>
                                editSessionTime(row.id, sessionIndex, { endTime: event.target.value })
                              }
                              onBlur={() => {
                                saveRow(row).catch((error) => toast.error(rowSaveErrorMessage(error)));
                              }}
                              className="h-9 w-[110px] rounded-md border-[#dcdfed] text-center text-[13px]"
                            />
                          ) : (
                            <span className="text-[14px] text-black">{session.endTime || "—"}</span>
                          )}
                          {props.status === "active" && sessions.length > 1 && (
                            <button
                              type="button"
                              title="Удалить сеанс"
                              aria-label={`Удалить сеанс №${sessionIndex + 1}`}
                              onClick={() => void deleteSession(row.id, sessionIndex)}
                              className="rounded-lg p-1.5 text-[#b0b4c8] transition-colors duration-150 hover:bg-[#fdf0f0] hover:text-[#e05a5a] print:hidden"
                            >
                              <Trash2 className="size-4" />
                            </button>
                          )}
                        </div>
                      </td>
                      {sessionIndex === 0 && (
                        <td
                          rowSpan={sessions.length}
                          className="border border-[#eceef5] px-2 py-1 text-center align-middle print:border-[#ccc] leading-tight"
                        >
                          <span className="text-[14px] text-black">{duration !== null ? duration : "—"}</span>
                          {props.status === "active" && (
                            <button
                              type="button"
                              onClick={() => void addSession(row.id)}
                              className="mt-1 block w-full text-[12px] text-[#5566f6] underline transition-colors duration-150 hover:no-underline print:hidden"
                            >
                              + Ещё сеанс
                            </button>
                          )}
                        </td>
                      )}
                      {sessionIndex === 0 && (
                        <td
                          rowSpan={sessions.length}
                          className="border border-[#eceef5] px-2 py-1 align-middle print:border-[#ccc] leading-tight"
                        >
                          {props.status === "active" ? (
                            <Select
                              value={row.employeeId || fallbackEmployeeId}
                              onValueChange={(value) => {
                                setRows((current) =>
                                  current.map((item) => (item.id === row.id ? { ...item, employeeId: value } : item))
                                );
                                const updated = { ...row, employeeId: value };
                                saveRow(updated, { id: row.id, employeeId: row.employeeId }).catch((error) =>
                                  toast.error(rowSaveErrorMessage(error))
                                );
                                return;
                              }}
                            >
                              <SelectTrigger className="h-9 rounded-md border-[#dcdfed] text-[13px]">
                                <SelectValue placeholder="Выберите сотрудника" />
                              </SelectTrigger>
                              <SelectContent>
                                {props.users.map((user) => (
                                  <SelectItem key={user.id} value={user.id}>
                                    {user.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <span className="text-[14px] text-black">{userMap[row.employeeId] || "—"}</span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </Fragment>
              );
            })}

            {/* Кликабельная пустая строка — открывает то же окно «Добавить
                строку», что и кнопка над таблицей. Чекбокс рендерится по
                тому же условию, что и сам JournalAddRow (props.status ===
                "active"), поэтому считаем его существующим: leading=1.
                labelSpan=1 — подпись встаёт под «Дата»: это единственная
                колонка-идентификатор строки, а Время ВКЛ/ВЫКЛ, Итого и
                ФИО — данные, которые появятся только после заполнения.
                trailing=4 (Время ВКЛ, Время ВЫКЛ, Итого, ФИО). Сумма
                1+1+4=6 — тот же colSpan, что был раньше. */}
            {props.status === "active" ? (
              <JournalAddRow
                leading={1}
                labelSpan={1}
                trailing={4}
                label="Добавить строку"
                onClick={() => setAddRowOpen(true)}
              />
            ) : null}
          </tbody>
        </table>
      </MobileViewTableWrapper>
      </div>

      {/* Dialogs */}
      <UvRuntimeSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        users={props.users}
        initialConfig={config}
        initialDateFrom={props.dateFrom}
        initialResponsibleTitle={props.responsibleTitle || ""}
        initialResponsibleUserId={props.responsibleUserId || fallbackEmployeeId}
        onSave={handleSaveSettings}
        useV2={props.useV2}
      />

      <UvSpecEditDialog
        open={specEditOpen}
        onOpenChange={setSpecEditOpen}
        spec={config.spec}
        defaultCommissioningDate={props.dateFrom}
        onSave={handleSaveSpec}
      />

      {addRowOpen && (
        <AddRowDialog
          key={`uv-row-${fallbackEmployeeId}-${props.responsibleTitle || "default"}`}
          open={addRowOpen}
          onOpenChange={setAddRowOpen}
          users={props.users}
          defaultEmployeeId={fallbackEmployeeId}
          defaultResponsibleTitle={props.responsibleTitle || "Управляющий"}
          onAdd={(data) => {
            handleAddRow(data).catch(() => toast.error("Ошибка добавления строки"));
          }}
        />
      )}

      {/* Правка строки из карточки — только время ВКЛ/ВЫКЛ, остальное
          в этом журнале считается (продолжительность) или живёт в
          спецификации установки. */}
      {editingSession ? (
        (() => {
          const row = rows.find((item) => item.id === editingSession.rowId);
          const session = row
            ? listUvRuntimeSessionSlots(row.data)[editingSession.sessionIndex]
            : undefined;
          return (
            <CardEditSheet
              open
              title={`Сеанс №${editingSession.sessionIndex + 1}`}
              subtitle={row ? formatRuDateDash(row.date) : undefined}
              fields={[
                { type: "time", key: "startTime", label: "Время включения" },
                { type: "time", key: "endTime", label: "Время выключения" },
              ]}
              values={{
                startTime: session?.startTime ?? "",
                endTime: session?.endTime ?? "",
              }}
              onClose={() => setEditingSession(null)}
              onSubmit={(values) => {
                void saveRowFromSheet(
                  editingSession.rowId,
                  editingSession.sessionIndex,
                  values
                );
              }}
            />
          );
        })()
      ) : null}
    </div>
  );
}
