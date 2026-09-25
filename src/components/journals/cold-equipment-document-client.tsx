"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { DocumentActionsBar } from "@/components/journals/document-actions-bar";
import { useJournalUndo } from "@/lib/journal-undo";
import {
  COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE,
  COLD_EQUIPMENT_PRESETS,
  collectColdEquipmentDeviations,
  isColdEquipmentValueOutOfRange,
  COLD_EQUIPMENT_READING_MODES,
  expandColdEquipmentReadingSlots,
  COLD_EQUIPMENT_STATUSES,
  COLD_EQUIPMENT_STATUS_SHORT,
  COLD_EQUIPMENT_STATUS_TITLE,
  formatColdEquipmentCell,
  parseColdEquipmentCellInput,
  setColdEquipmentSlotStatus,
  type ColdEquipmentReadingModeId,
  type ColdEquipmentStatus,
} from "@/lib/cold-equipment-document";
import {
  DOC_ADD_ROW_CLASS,
  DOC_AUTOFILL_STRIP_CLASS,
  DOC_CAPS_TITLE_CLASS,
  DOC_HEADING_CLASS,
  DOC_PAPER_CANVAS_CLASS,
  DOC_PAPER_HEADER_CLASS,
  JOURNAL_DIALOG_CONTENT_CLASS,
  JOURNAL_DIALOG_HEADER_CLASS,
  JOURNAL_DIALOG_TITLE_CLASS,
  DOC_AUTOFILL_LABEL_CLASS,
} from "@/components/journals/journal-responsive";
import { JournalCellInput } from "@/components/journals/journal-cell-input";
import { JournalSelectionBar } from "@/components/journals/journal-selection-bar";
import { JournalAddRow } from "@/components/journals/journal-add-row";
import { JournalSettingsModal } from "@/components/journals/v2/journal-settings-modal";
import {
  JournalDocumentHeader,
  JournalDocumentTitle,
} from "@/components/journals/journal-document-header";
import {
  Archive,
  ChevronDown,
  ChevronUp,
  Copy,
  Pencil,
  Plus,
  QrCode,
  UserPlus,
  Wrench,
} from "lucide-react";
import { QrFillPreview } from "@/components/qr/qr-fill-preview";
import {
  getMissingDirectoryEquipment,
  type EquipmentLinkedRow,
} from "@/lib/equipment-directory-link";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ResponsiveMenu } from "@/components/ui/responsive-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CONTROL_PERIODICITY_MAX_LENGTH } from "@/lib/control-periodicity";
import { Label } from "@/components/ui/label";
import { VoiceNumberInput } from "@/components/ui/voice-number-input";
import { NumberField, parseNumeric } from "@/components/journals/number-field";
import {
  BluetoothProbeButton,
  DisplayOcrButton,
} from "@/components/journals/probe-capture-buttons";
import { submitWithOfflineFallback } from "@/lib/use-offline-submit";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { getCleaningGridMonthLabel } from "@/lib/cleaning-document";
import { pluralRu } from "@/lib/plural-ru";
import { useCanManageJournalDocument } from "@/components/journals/journal-header-edit";
import {
  createColdEquipmentConfigItem,
  coldEquipmentSlotKeys,
  countColdEquipmentValues,
  createEmptyColdEquipmentEntryData,
  getColdEquipmentDateLabel,
  normalizeColdEquipmentDocumentConfig,
  type ColdEquipmentConfigItem,
  type ColdEquipmentDocumentConfig,
  type ColdEquipmentEntryData,
} from "@/lib/cold-equipment-document";
import {
  buildDateKeys,
  getDayNumber,
  getWeekdayShort,
  isWeekend,
  toDateKey,
} from "@/lib/hygiene-document";
import { useDocumentCloseAction } from "@/components/journals/document-close-button";
import { useCopyYesterdayAction } from "@/components/journals/copy-yesterday-button";
import { FocusTodayScroller } from "@/components/journals/focus-today-scroller";
import { JournalClosedBanner } from "@/components/journals/journal-closed-banner";
import { MobileViewAxisToggle } from "@/components/journals/mobile-view-axis-toggle";
import { DayFirstCards } from "@/components/journals/day-first-cards";
import { FillRunner } from "@/components/journals/fill-runner";
import { TodayProgressStrip } from "@/components/journals/today-progress-strip";
import { documentViewClasses, useMobileView } from "@/lib/use-mobile-view";

import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { confirmAsync } from "@/components/ui/confirm-async";
import {
  PositionSelectItems,
  usePositionEmployeeCascade,
} from "@/components/shared/position-select";
import {
  GRID_BORDER_CLASS,
  GRID_CELL_CLASS,
  GRID_HEAD_CELL_CLASS,
  GRID_SERVICE_LABEL_CLASS,
  GRID_VIEWPORT_CLASS,
} from "@/components/journals/journal-grid";

import { useTodayKey } from "@/lib/use-today-key";
import { NO_ROW_EMPLOYEE_MESSAGE, useRosterViewerId } from "@/components/journals/use-roster-viewer";
import {
  NOT_TODAY_MESSAGE,
  hasFullDocumentAccess,
} from "@/lib/journal-entry-scope";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";
/**
 * Screen ↔ print duality tokens (тот же приём, что в
 * `cleaning-document-client.tsx` / `hygiene-document-client.tsx`).
 */

type EmployeeItem = {
  id: string;
  name: string;
  role: string;
};

type EntryRow = {
  id: string;
  employeeId: string;
  date: string;
  data: ColdEquipmentEntryData;
};

type Props = {
  documentId: string;
  title: string;
  organizationName: string;
  /**
   * «Периодичность контроля» — вторая строка бумажной шапки документа
   * (`config.controlPeriodicity`, дефолт — из реестра шаблонов).
   * Пустая строка ⇒ строка в шапке не рендерится.
   */
  controlPeriodicity?: string;
  dateFrom: string;
  dateTo: string;
  responsibleTitle: string | null;
  responsibleUserId: string | null;
  status: string;
  autoFill?: boolean;
  employees: EmployeeItem[];
  config: ColdEquipmentDocumentConfig;
  initialEntries: EntryRow[];
  /**
   * Кто смотрит. Сервер (`checkEntryScope`) пускает рядового сотрудника
   * только в свою строку и только за сегодня; без этих данных сетка
   * предлагала править любой день, а сохранение падало.
   */
  viewer?: { id: string; role: string; isRoot: boolean };
  /** Design v2 toggle. Settings dialog → JournalSettingsModal style. */
  useV2?: boolean;
};

function formatRange(min: number | null, max: number | null) {
  if (min == null && max == null) return "Норма не задана";
  if (min != null && max != null) return `от ${min}°C до ${max}°C`;
  if (min != null) return `от ${min}°C`;
  return `до ${max}°C`;
}

function buildResponsibleCodes(
  employees: EmployeeItem[],
  rows: EntryRow[],
  defaultResponsibleUserId: string | null
) {
  const codeMap: Record<string, string> = {};
  const usedIds = new Set<string>();

  rows.forEach((row) => {
    if (row.employeeId) usedIds.add(row.employeeId);
  });

  if (defaultResponsibleUserId) usedIds.add(defaultResponsibleUserId);

  Array.from(usedIds).forEach((employeeId, index) => {
    codeMap[employeeId] = `С${index + 1}`;
  });

  return {
    codeMap,
    items: Array.from(usedIds)
      .map((employeeId) => {
        const employee = employees.find((item) => item.id === employeeId);
        if (!employee) return null;

        return {
          employeeId,
          code: codeMap[employeeId],
          label: `${codeMap[employeeId]} - ${employee.name}`,
        };
      })
      .filter(
        (
          item
        ): item is {
          employeeId: string;
          code: string;
          label: string;
        } => item !== null
      ),
  };
}

/** Единица справочника «Оборудование», пригодная для журнала холодильников. */
type DirectoryOption = {
  id: string;
  name: string;
  areaName: string | null;
  min: number | null;
  max: number | null;
};

/**
 * Что показать в блоке «Выбрать из справочника»: холодильное оборудование
 * организации, которого ещё нет в этом документе.
 *
 * Холодильным считаем по тому же правилу, что и при создании бланка:
 * тип refrigerator/freezer либо заданная температурная норма.
 */
function pickColdDirectoryOptions(
  raw: unknown,
  existingRows: readonly EquipmentLinkedRow[]
): DirectoryOption[] {
  if (!Array.isArray(raw)) return [];
  const cold = raw
    .filter((item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item)
    )
    .filter((item) => {
      const type = typeof item.type === "string" ? item.type.toLowerCase() : "";
      return (
        type === "refrigerator" ||
        type === "freezer" ||
        item.tempMin != null ||
        item.tempMax != null
      );
    })
    .map((item) => ({
      id: String(item.id ?? ""),
      name: typeof item.name === "string" ? item.name : "",
      areaName:
        item.area && typeof item.area === "object" && !Array.isArray(item.area)
          ? String((item.area as Record<string, unknown>).name ?? "") || null
          : null,
      min: typeof item.tempMin === "number" ? item.tempMin : null,
      max: typeof item.tempMax === "number" ? item.tempMax : null,
    }))
    .filter((item) => item.id !== "" && item.name.trim() !== "");

  // Отсев уже добавленных — и по ссылке, и по имени (строки старых
  // документов ссылки не имеют).
  const available = new Set(
    getMissingDirectoryEquipment(
      cold.map((item) => ({ id: item.id, name: item.name })),
      existingRows
    ).map((item) => item.id)
  );
  return cold.filter((item) => available.has(item.id));
}

function EquipmentDialog({
  open,
  onOpenChange,
  initialItem,
  existingRows,
  canDelete,
  onSave,
  onDelete,
  countLostOnModeChange,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  initialItem: ColdEquipmentConfigItem | null;
  /** Строки документа — чтобы не предлагать уже добавленное. */
  existingRows: EquipmentLinkedRow[];
  canDelete: boolean;
  /** Возвращает сохранённую строку — уже со ссылкой на справочник. */
  onSave: (item: ColdEquipmentConfigItem) => Promise<ColdEquipmentConfigItem>;
  /** `false` — удаление отменено в подтверждении, окно оставляем открытым. */
  onDelete: (itemId: string) => Promise<boolean | void>;
  /** Сколько уже внесённых замеров сотрёт переход на более редкий режим. */
  countLostOnModeChange: (
    item: ColdEquipmentConfigItem,
    nextMode: ColdEquipmentReadingModeId
  ) => number;
}) {
  const [name, setName] = useState(initialItem?.name || "");
  const [min, setMin] = useState(initialItem?.min?.toString() || "");
  const [max, setMax] = useState(initialItem?.max?.toString() || "");
  const [presetId, setPresetId] = useState<string>("fridge");
  const [readingMode, setReadingMode] = useState<ColdEquipmentReadingModeId>(
    initialItem?.readingMode ?? "once",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  /**
   * QR показываем по записи справочника. Несвязанная строка получает её
   * при сохранении — тогда окно не закрываем, а показываем свежий код.
   */
  const [linkedEquipmentId, setLinkedEquipmentId] = useState<string | null>(
    initialItem?.sourceEquipmentId ?? null,
  );
  /** Холодильное оборудование организации, которого ещё нет в журнале. */
  const [directoryOptions, setDirectoryOptions] = useState<DirectoryOption[]>([]);
  const [directoryLoading, setDirectoryLoading] = useState(false);

  // Справочник тянем только при добавлении новой строки: при правке
  // выбирать не из чего.
  useEffect(() => {
    if (!open || initialItem) {
      setDirectoryOptions([]);
      return;
    }
    let cancelled = false;
    setDirectoryLoading(true);
    fetch("/api/equipment")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (cancelled) return;
        setDirectoryOptions(
          pickColdDirectoryOptions(payload?.equipment, existingRows)
        );
      })
      .catch(() => {
        if (!cancelled) setDirectoryOptions([]);
      })
      .finally(() => {
        if (!cancelled) setDirectoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, initialItem, existingRows]);

  /** Выбор готовой единицы: подставляем её имя и норму, ссылку запоминаем. */
  function pickFromDirectory(option: DirectoryOption) {
    setLinkedEquipmentId(option.id);
    setName(option.name);
    setMin(option.min == null ? "" : String(option.min));
    setMax(option.max == null ? "" : String(option.max));
    const matched = COLD_EQUIPMENT_PRESETS.find(
      (preset) =>
        preset.id !== "custom" &&
        preset.min === (option.min ?? null) &&
        preset.max === (option.max ?? null),
    );
    setPresetId(matched?.id ?? "custom");
  }

  useEffect(() => {
    if (!open) return;
    setName(initialItem?.name || "");
    setMin(initialItem?.min?.toString() || "");
    setMax(initialItem?.max?.toString() || "");
    setReadingMode(initialItem?.readingMode ?? "once");
    setLinkedEquipmentId(initialItem?.sourceEquipmentId ?? null);
    // При правке подсвечиваем тот пресет, чьи нормы совпадают с
    // сохранёнными: человек должен видеть, что стоит «Морозильное», а
    // не гадать по двум числам.
    const matched = COLD_EQUIPMENT_PRESETS.find(
      (preset) =>
        preset.id !== "custom" &&
        preset.min === (initialItem?.min ?? null) &&
        preset.max === (initialItem?.max ?? null),
    );
    setPresetId(matched?.id ?? (initialItem ? "custom" : "fridge"));
    // Новая строка: пресет «Холодильное» подсвечен — подставляем и его
    // норму. Раньше клик по уже выбранной радиокнопке ничего не менял, и
    // строка уходила без нормы.
    if (!initialItem) {
      const fridge = COLD_EQUIPMENT_PRESETS.find((preset) => preset.id === "fridge");
      setMin(fridge?.min == null ? "" : String(fridge.min));
      setMax(fridge?.max == null ? "" : String(fridge.max));
    }
  }, [initialItem, open]);

  /** Выбор типа сразу подставляет норму — вспоминать цифры не нужно. */
  function applyPreset(id: string) {
    setPresetId(id);
    const preset = COLD_EQUIPMENT_PRESETS.find((item) => item.id === id);
    if (!preset || preset.id === "custom") return;
    setMin(preset.min === null ? "" : String(preset.min));
    setMax(preset.max === null ? "" : String(preset.max));
  }

  async function handleSave() {
    // Переход «3 раза в день» → «1 раз» убирает 2-й и 3-й замеры за весь
    // период — раньше это происходило молча при сохранении строки.
    if (initialItem && readingMode !== (initialItem.readingMode ?? "once")) {
      const lostValues = countLostOnModeChange(initialItem, readingMode);
      if (lostValues > 0) {
        const previousMode = initialItem.readingMode ?? "once";
        const confirmed = await confirmAsync({
          title: "Сократить число замеров в день?",
          description:
            "Лишние замеры будут удалены из журнала за весь период документа.",
          variant: "danger",
          confirmLabel: "Сократить и удалить замеры",
          bullets: [
            { label: `Будет удалено замеров: ${lostValues}`, tone: "warn" },
            {
              label: `Строка: ${initialItem.name || "без названия"}`,
              tone: "info",
            },
            {
              label: "Отмена оставит прежний режим замеров",
              tone: "default",
            },
          ],
        });
        if (!confirmed) {
          setReadingMode(previousMode);
          return;
        }
      }
    }

    const item = createColdEquipmentConfigItem({
      id: initialItem?.id,
      sourceEquipmentId: linkedEquipmentId || initialItem?.sourceEquipmentId || null,
      name,
      // Нормы тоже вводят с запятой («-18,5») — Number() дал бы NaN.
      min: parseNumeric(min),
      max: parseNumeric(max),
      readingMode,
    });

    setIsSubmitting(true);
    try {
      const saved = await onSave(item);
      const gotLinkedNow = !linkedEquipmentId && Boolean(saved.sourceEquipmentId);
      setLinkedEquipmentId(saved.sourceEquipmentId ?? null);
      if (gotLinkedNow && initialItem) {
        // Строка только что попала в справочник — покажем QR, не закрывая окно.
        toast.success("Сохранено. QR-код готов — его можно распечатать ниже.");
        return;
      }
      onOpenChange(false);
    } catch (error) {
      toast.error(humanizeFetchError(error, "Не удалось сохранить оборудование"));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!initialItem) return;
    setIsSubmitting(true);
    try {
      const removed = await onDelete(initialItem.id);
      if (removed === false) return;
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={JOURNAL_DIALOG_CONTENT_CLASS}>
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>
            {initialItem ? "Редактирование оборудования" : "Добавление оборудования"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-7 px-6 py-5">
          {/* Первым делом — уже заведённое оборудование организации.
              Раньше окно умело только СОЗДАТЬ новую единицу, и один и
              тот же холодильник заводился в справочнике по второму разу
              на каждый новый бланк. */}
          {!initialItem ? (
            <div className="space-y-3">
              <Label className="text-[13px] font-medium text-[#3c4053]">
                Выбрать из справочника
              </Label>
              {directoryLoading ? (
                <p className="text-[12.5px] text-[#6f7282]">Загружаем справочник…</p>
              ) : directoryOptions.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-4 py-3 text-[12.5px] leading-[1.5] text-[#6f7282]">
                  В справочнике «Оборудование» нет холодильников, которых ещё
                  нет в этом журнале. Заведите новую единицу ниже.
                </p>
              ) : (
                <div className="max-h-[220px] space-y-1.5 overflow-y-auto">
                  {directoryOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => pickFromDirectory(option)}
                      className={cn(
                        "flex w-full items-start gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors",
                        linkedEquipmentId === option.id
                          ? "border-[#5566f6] bg-[#f5f6ff]"
                          : "border-[#ececf4] bg-white hover:bg-[#fafbff]",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] text-[#0b1024]">
                          {option.name}
                        </span>
                        <span className="block text-[12px] text-[#6f7282]">
                          {option.areaName ? `${option.areaName} · ` : ""}
                          {formatRange(option.min, option.max) || "норма не задана"}
                        </span>
                      </span>
                      {linkedEquipmentId === option.id ? (
                        <span className="shrink-0 text-[12px] font-medium text-[#3848c7]">
                          Выбрано
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              )}
              <p className="text-[12px] leading-[1.5] text-[#6f7282]">
                Или заведите новую единицу — заполните поля ниже.
              </p>
            </div>
          ) : null}

          <div className="space-y-3">
            <Label htmlFor="equipment-name" className="text-[13px] font-medium text-[#3c4053]">
              Наименование
            </Label>
            <Input
              id="equipment-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Например: Холодильная камера"
              className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
            />
          </div>

          <div className="space-y-3">
            <Label className="text-[13px] font-medium text-[#3c4053]">
              Сколько раз снимаются показания
            </Label>
            <div className="flex flex-wrap gap-2">
              {COLD_EQUIPMENT_READING_MODES.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => setReadingMode(mode.id)}
                  className={cn(
                    "h-9 rounded-xl border px-3.5 text-[13.5px] transition-colors",
                    readingMode === mode.id
                      ? "border-[#5566f6] bg-[#f5f6ff] font-medium text-[#3848c7]"
                      : "border-[#dfe1ec] bg-white text-[#3c4053] hover:bg-[#fafbff]",
                  )}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>

          {/* Тип оборудования с нормой. Раньше нормы вводились двумя
              пустыми полями, и повар вписывал их наугад — цифры по
              СанПиН он наизусть не помнит. */}
          <div className="space-y-3">
            <Label className="text-[13px] font-medium text-[#3c4053]">
              Данное оборудование
            </Label>
            <div className="space-y-1.5">
              {COLD_EQUIPMENT_PRESETS.map((preset) => (
                <label
                  key={preset.id}
                  className={cn(
                    "flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2 transition-colors",
                    presetId === preset.id
                      ? "border-[#5566f6] bg-[#f5f6ff]"
                      : "border-[#ececf4] bg-white hover:bg-[#fafbff]",
                  )}
                >
                  <input
                    type="radio"
                    name="cold-equipment-preset"
                    checked={presetId === preset.id}
                    onChange={() => applyPreset(preset.id)}
                    className="mt-0.5 size-4 accent-[#5566f6]"
                  />
                  <span className="min-w-0">
                    <span className="block text-[13.5px] text-[#0b1024]">
                      {preset.label}
                    </span>
                    <span className="block text-[12px] text-[#6f7282]">
                      {preset.id === "custom"
                        ? preset.hint
                        : `температура должна быть ${preset.hint}`}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <Label htmlFor="equipment-min" className="text-[13px] font-medium text-[#3c4053]">
                Температура от
              </Label>
              <Input
                id="equipment-min"
                type="number"
                value={min}
                onChange={(event) => setMin(event.target.value)}
                className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
              />
            </div>
            <div className="space-y-3">
              <Label htmlFor="equipment-max" className="text-[13px] font-medium text-[#3c4053]">
                Температура до
              </Label>
              <Input
                id="equipment-max"
                type="number"
                value={max}
                onChange={(event) => setMax(event.target.value)}
                className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
              />
            </div>
          </div>

          {initialItem ? (
            <QrFillPreview
              kind="equipment"
              id={linkedEquipmentId}
              emptyHint="QR появится после сохранения: строка будет добавлена в справочник «Оборудование» и получит код, по которому сотрудник вносит температуру с телефона."
            />
          ) : (
            <p className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-4 py-3 text-[12.5px] leading-[1.5] text-[#6f7282]">
              После добавления строка попадёт в справочник «Оборудование» и получит
              QR-код для заполнения с телефона — откройте её по клику на название.
            </p>
          )}

          <div className="flex items-center justify-between pt-2">
            <div>
              {initialItem && canDelete ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleDelete}
                  disabled={isSubmitting}
                  className="h-9 rounded-xl border-[#ffd7d3] px-3.5 text-[13.5px] text-[#ff3b30] hover:bg-[#fff3f2]"
                >
                  Удалить строку
                </Button>
              ) : null}
            </div>

            <Button
              type="button"
              onClick={handleSave}
              disabled={isSubmitting || name.trim() === ""}
              className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] text-white hover:bg-[#4a5bf0]"
            >
              {isSubmitting ? "Сохранение..." : initialItem ? "Сохранить" : "Добавить"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function JournalSettingsDialog({
  open,
  onOpenChange,
  title,
  responsibleTitle,
  responsibleUserId,
  employees,
  config,
  onSave,
  controlPeriodicity,
  useV2 = false,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  title: string;
  responsibleTitle: string | null;
  responsibleUserId: string | null;
  employees: EmployeeItem[];
  config: ColdEquipmentDocumentConfig;
  /** Строка «Периодичность контроля» шапки (`config.controlPeriodicity`). */
  controlPeriodicity: string;
  onSave: (params: {
    title: string;
    responsibleTitle: string | null;
    responsibleUserId: string | null;
    controlPeriodicity: string;
    config: ColdEquipmentDocumentConfig;
  }) => Promise<void>;
  useV2?: boolean;
}) {

  const [name, setName] = useState(title);
  // Первого сотрудника из списка не подставляем: в настройках видно ровно
  // того ответственного, который назначен (или «не выбран»).
  const [position, setPosition] = useState(responsibleTitle || "");
  const [userId, setUserId] = useState(responsibleUserId || "");
  const [skipWeekends, setSkipWeekends] = useState(config.skipWeekends);
  const [periodicity, setPeriodicity] = useState(controlPeriodicity);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(title);
    setPosition(responsibleTitle || "");
    setUserId(responsibleUserId || "");
    setSkipWeekends(config.skipWeekends);
    setPeriodicity(controlPeriodicity);
  }, [config.skipWeekends, controlPeriodicity, open, responsibleTitle, responsibleUserId, title]);

  const cascade = usePositionEmployeeCascade({
    users: employees,
    positionTitle: position,
    userId,
    onChange: (next) => {
      setPosition(next.positionTitle);
      setUserId(next.userId);
    },
    autoPick: "first",
  });

  async function handleSave() {
    setIsSubmitting(true);
    try {
      await onSave({
        title: name.trim(),
        responsibleTitle: position || null,
        responsibleUserId: userId || null,
        controlPeriodicity: periodicity.trim(),
        config: normalizeColdEquipmentDocumentConfig({
          ...config,
          skipWeekends,
        }),
      });
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (useV2) {
    return (
      <JournalSettingsModal
        open={open}
        onOpenChange={onOpenChange}
        title="Настройки документа"
        description="Название документа, ответственный сотрудник и режим заполнения."
        size="md"
        isSaving={isSubmitting}
        onSave={handleSave}
        onCancel={() => onOpenChange(false)}
      >
        <div className="space-y-2">
          <Label
            htmlFor="cold-journal-title-v2"
            className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]"
          >
            Название документа
          </Label>
          <Input
            id="cold-journal-title-v2"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
          />
        </div>
        <div className="space-y-2">
          <Label
            htmlFor="cold-journal-periodicity-v2"
            className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]"
          >
            Периодичность контроля
          </Label>
          <Textarea
            id="cold-journal-periodicity-v2"
            value={periodicity}
            maxLength={CONTROL_PERIODICITY_MAX_LENGTH}
            onChange={(event) => setPeriodicity(event.target.value)}
            placeholder="Строка «Периодичность контроля» в шапке бланка"
            className="min-h-[72px] rounded-xl border-[#dcdfed] px-3.5 py-2 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
          />
          <p className="text-[12px] leading-[1.45] text-[#6f7282]">
            Печатается в шапке этого документа и в PDF. Пусто — строка не печатается.
          </p>
        </div>
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            Должность ответственного за снятие показателей
          </Label>
          <Select
            value={position}
            onValueChange={cascade.handlePositionChange}
          >
            <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-white text-[13.5px]">
              <SelectValue placeholder="— Выберите —" />
            </SelectTrigger>
            <SelectContent>
              <PositionSelectItems users={employees} />
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            Сотрудник
          </Label>
          <Select
            value={userId}
            onValueChange={cascade.handleEmployeeChange}
            open={cascade.employeeOpen}
            onOpenChange={cascade.setEmployeeOpen}
          >
            <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-white text-[13.5px]">
              <SelectValue placeholder="— Выберите —" />
            </SelectTrigger>
            <SelectContent>
              {(position ? cascade.candidates : employees).map((employee) => (
                <SelectItem key={employee.id} value={employee.id}>
                  {employee.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3 transition-colors hover:bg-[#f5f6ff]">
          <Checkbox
            id="cold-skip-weekends-v2"
            checked={skipWeekends}
            onCheckedChange={(checked) => setSkipWeekends(checked === true)}
          />
          <span className="text-[14px] text-[#0b1024]">Не заполнять в выходные дни</span>
        </label>
      </JournalSettingsModal>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={JOURNAL_DIALOG_CONTENT_CLASS}>
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>
            Настройки документа
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-8 px-6 py-5">
          <div className="space-y-3">
            <Label htmlFor="journal-title" className="text-[13px] font-medium text-[#3c4053]">
              Название документа
            </Label>
            <Input
              id="journal-title"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="h-22 rounded-[24px] border-[#dfe1ec] px-8 text-[24px]"
            />
          </div>

          <div className="space-y-3">
            <Label htmlFor="cold-journal-periodicity-v1" className="text-[13px] font-medium text-[#3c4053]">
              Периодичность контроля
            </Label>
            <Textarea
              id="cold-journal-periodicity-v1"
              value={periodicity}
              maxLength={CONTROL_PERIODICITY_MAX_LENGTH}
              onChange={(event) => setPeriodicity(event.target.value)}
              placeholder="Строка «Периодичность контроля» в шапке бланка"
              className="min-h-[96px] rounded-[24px] border-[#dfe1ec] px-8 py-4 text-[18px]"
            />
          </div>

          <div className="space-y-3">
            <Label className="text-[13px] font-medium text-[#3c4053]">
              Должность ответственного за снятие показателей
            </Label>
            <Select
              value={position}
              onValueChange={cascade.handlePositionChange}
            >
              <SelectTrigger className="h-22 rounded-[24px] border-[#dfe1ec] bg-[#fafbff] px-8 text-[15px]">
                <SelectValue placeholder="Выберите должность" />
              </SelectTrigger>
              <SelectContent>
                <PositionSelectItems users={employees} />
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3">
            <Label className="text-[13px] font-medium text-[#3c4053]">Сотрудник</Label>
            <Select
              value={userId}
              onValueChange={cascade.handleEmployeeChange}
              open={cascade.employeeOpen}
              onOpenChange={cascade.setEmployeeOpen}
            >
              <SelectTrigger className="h-22 rounded-[24px] border-[#dfe1ec] bg-[#fafbff] px-8 text-[15px]">
                <SelectValue placeholder="Выберите сотрудника" />
              </SelectTrigger>
              <SelectContent>
                {(position ? cascade.candidates : employees).map((employee) => (
                  <SelectItem key={employee.id} value={employee.id}>
                    {employee.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-4 rounded-[26px] border border-[#dfe1ec] px-6 py-5">
            <Checkbox
              id="skip-weekends"
              checked={skipWeekends}
              onCheckedChange={(checked) => setSkipWeekends(checked === true)}
            />
            <Label
              htmlFor="skip-weekends"
              className="cursor-pointer text-[15px] font-normal text-black"
            >
              Не заполнять в выходные дни
            </Label>
          </div>

          <div className="flex justify-end pt-2">
            <Button
              type="button"
              onClick={handleSave}
              disabled={isSubmitting}
              className="h-11 gap-2 rounded-lg bg-[#5566f6] px-5 text-[15px] font-semibold text-white transition-colors duration-150 hover:bg-[#4a5bf0]"
            >
              {isSubmitting ? "Сохранение..." : "Сохранить"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Ячейка температуры в карточном режиме.
 *
 * Своё состояние нужно, потому что `NumberField` управляемый, а значение
 * приходит из строки документа и обновляется асинхронно после PATCH'а.
 * Локальный черновик даёт печатать без дёрганья и коммитится на blur или
 * степпере — ровно как раньше делал `onBlur` у голого инпута.
 *
 * Норма холодильника подписывается прямо под полем и подсвечивает выход
 * за диапазон в момент ввода: раньше «2…6 °C» было только в подзаголовке
 * карточки, а промах становился виден лишь после сохранения.
 */
function ColdTemperatureCell({
  inputId,
  value,
  status = null,
  norm,
  onCommit,
}: {
  inputId: string;
  value: number | string;
  /** «обсл»/«рем» вместо температуры — ячейка показывает отметку. */
  status?: ColdEquipmentStatus | null;
  norm: { min: number | null; max: number | null };
  /** Число строкой, «обсл»/«рем» или пусто — разбирает `handleTemperatureBlur`. */
  onCommit: (next: string) => void;
}) {
  const stored = value === "" || value == null ? "" : String(value);
  const [draft, setDraft] = useState(stored);

  // Значение поменялось снаружи (автозаполнение, отмена, синк) — подхватываем.
  useEffect(() => {
    setDraft(stored);
  }, [stored]);

  if (status) {
    return (
      <div className="flex min-h-11 min-w-0 flex-1 items-center justify-between gap-2 rounded-2xl border border-[#d6dcff] bg-[#eef1ff] px-3 py-1.5" data-testid="cold-cell-status">
        <span className="min-w-0 truncate text-[15px] text-[#3848c7]">
          <b className="font-semibold">{COLD_EQUIPMENT_STATUS_SHORT[status]}</b>
          <span className="text-[13px]"> · {COLD_EQUIPMENT_STATUS_TITLE[status]}</span>
        </span>
        <button
          type="button"
          onClick={() => onCommit("")}
          className="shrink-0 rounded-full px-2.5 py-1 text-[13px] font-medium text-[#3848c7] underline underline-offset-2 transition-colors duration-150 hover:bg-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
        >
          Снять
        </button>
      </div>
    );
  }

  return (
    <div className="min-w-0 flex-1">
      <NumberField
        id={inputId}
        value={draft}
        onChange={setDraft}
        onCommit={onCommit}
        unit="°C"
        step={0.1}
        min={-40}
        max={30}
        norm={norm}
        trailing={
          <div className="flex items-center gap-1.5">
            {/* Быстрее всего — не набирать: щуп по Bluetooth и снимок
                дисплея. Кнопка щупа появляется только там, где Web
                Bluetooth реально есть. */}
            <BluetoothProbeButton
              onReading={(celsius) => {
                const text = String(celsius);
                setDraft(text);
                onCommit(text);
              }}
            />
            <DisplayOcrButton
              onReading={(value) => {
                const text = String(value);
                setDraft(text);
                onCommit(text);
              }}
            />
            <VoiceNumberInput
            // `VoiceNumberInput` ждёт число, а черновик — строка (в ней
            // может стоять русская запятая и незаконченный ввод).
            value={parseNumeric(draft) ?? ""}
            inputId={inputId}
            onChange={(n) => {
              if (n === null) return;
              setDraft(String(n));
              onCommit(String(n));
            }}
            />
            {/* Вместо температуры — «обсл» (обслуживание) или «рем» (ремонт). */}
            <ResponsiveMenu
              title="Вместо температуры"
              items={COLD_EQUIPMENT_STATUSES.map((option) => ({
                key: option,
                label: `${COLD_EQUIPMENT_STATUS_TITLE[option]} — «${COLD_EQUIPMENT_STATUS_SHORT[option]}»`,
                icon: <Wrench className="size-4 text-[#6f7282]" />,
                onSelect: () => onCommit(COLD_EQUIPMENT_STATUS_SHORT[option]),
              }))}
              trigger={
                <button
                  type="button"
                  aria-label="Обслуживание или ремонт вместо температуры"
                  title="Обслуживание («обсл») или ремонт («рем») вместо температуры"
                  className="flex size-9 shrink-0 items-center justify-center rounded-full text-[#6f7282] transition-colors duration-150 hover:bg-[#f5f6ff] hover:text-[#5566f6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                >
                  <Wrench className="size-4" />
                </button>
              }
            />
          </div>
        }
      />
    </div>
  );
}

export function ColdEquipmentDocumentClient({
  documentId,
  title,
  organizationName,
  controlPeriodicity = "",
  dateFrom,
  dateTo,
  responsibleTitle,
  responsibleUserId,
  status,
  autoFill = false,
  employees,
  config,
  initialEntries,
  viewer,
  useV2 = false,
}: Props) {
  const router = useRouter();
  const [documentTitle, setDocumentTitle] = useState(title);
  const viewerId = useRosterViewerId(employees);
  // «Сегодня» считаем после mount (см. useTodayKey): new Date() в
  // рендере давал hydration mismatch и подсветку не того дня.
  const todayKey = useTodayKey();
  /**
   * Те же правила, что на сервере (`journal-entry-scope`): руководство и
   * ответственный правят любой день, рядовой сотрудник — только сегодня
   * и только свою запись.
   */
  const viewerHasFullAccess = viewer
    ? hasFullDocumentAccess({ actor: viewer, responsibleUserId })
    : true;

  /** Причина, по которой день закрыт для зрителя, или null. */
  function dayLockReason(dateKey: string): string | null {
    if (viewerHasFullAccess || !viewer) return null;
    if (todayKey !== "" && dateKey !== todayKey) return NOT_TODAY_MESSAGE;
    return null;
  }
  const [rows, setRows] = useState<EntryRow[]>(initialEntries);
  const [selectedEquipmentIds, setSelectedEquipmentIds] = useState<string[]>([]);
  const [checkedAutoFill, setCheckedAutoFill] = useState(autoFill);
  /**
   * X3 аудита: у эталона выключенный тумблер = только полоса, панель
   * автозаполнения не раскрыта. Стартовое состояние берём от `autoFill`,
   * а рендер дополнительно гейтим по `checkedAutoFill` — выключая тумблер,
   * пользователь сразу видит свёрнутую полосу.
   */
  const [summaryOpen, setSummaryOpen] = useState(autoFill);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const copyYesterday = useCopyYesterdayAction(documentId);
  // История отмены (Ctrl+Z) — только правки этого человека в этой вкладке.
  const undoStack = useJournalUndo({ enabled: status === "active" });

  // Считаем из текущих строк: исправленная температура убирает запись
  // сразу, без перезагрузки страницы.
  const deviations = useMemo(
    () => collectColdEquipmentDeviations(config, rows),
    [config, rows],
  );

  /** Комментарий к отклонению. Кладём в ту же запись, что и температуры. */
  async function saveCorrection(
    dateKey: string,
    equipmentId: string,
    text: string,
  ) {
    const existingRow = rowByDate[dateKey];
    if (!existingRow) return;

    const nextData = {
      ...existingRow.data,
      corrections: { ...(existingRow.data.corrections ?? {}), [equipmentId]: text },
    };

    const response = await fetch(
      `/api/journal-documents/${documentId}/entries`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: existingRow.employeeId,
          date: dateKey,
          data: nextData,
        }),
      },
    ).catch(() => null);

    if (!response?.ok) {
      toast.error("Не удалось сохранить комментарий");
      return;
    }

    setRows((current) =>
      current.map((row) =>
        row.date === dateKey ? { ...row, data: nextData } : row,
      ),
    );
  }
  // Предупреждение при закрытии журнала: дни периода до сегодня
  // включительно, где НИ ОДНА единица оборудования не имеет замера —
  // день пропущен целиком, а не просто не до конца заполнен.
  // `useDocumentCloseAction` — файл вне зоны этой правки, поэтому
  // единственный доступный канал — его собственный проп `confirmMessage`
  // (текст заголовка confirm-диалога).
  const missingDaysBeforeClose = useMemo(() => {
    if (!todayKey) return 0;
    const periodDateKeys = buildDateKeys(dateFrom, dateTo).filter(
      (dateKey) =>
        dateKey <= todayKey && !(config.skipWeekends && isWeekend(dateKey))
    );
    return periodDateKeys.filter((dateKey) => {
      const row = rows.find((item) => item.date === dateKey);
      const hasAnyValue = row
        ? Object.values(row.data.temperatures ?? {}).some((value) => value != null) ||
          Object.keys(row.data.statuses ?? {}).length > 0
        : false;
      return !hasAnyValue;
    }).length;
  }, [config.skipWeekends, dateFrom, dateTo, rows, todayKey]);

  const closeAction = useDocumentCloseAction({
    documentId,
    title,
    confirmDescription:
      missingDaysBeforeClose > 0
        ? `Не заполнено дней: ${missingDaysBeforeClose}. После закрытия дописать их будет нельзя.`
        : undefined,
  });
  const [equipmentDialogOpen, setEquipmentDialogOpen] = useState(false);
  const [editingEquipment, setEditingEquipment] = useState<ColdEquipmentConfigItem | null>(null);
  // Что уже есть в документе — чтобы окно не предлагало добавить то же
  // самое второй раз. Мемоизируем: ссылка уходит в зависимости эффекта.
  const equipmentDialogExistingRows = useMemo(
    () =>
      config.equipment.map((item) => ({
        equipmentName: item.name,
        sourceEquipmentId: item.sourceEquipmentId,
      })),
    [config.equipment]
  );
  const [isSwitching, setIsSwitching] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isPreparingQr, setIsPreparingQr] = useState(false);
  // Mobile-only view preference. The 1900-px table behind horizontal
  // scroll is unusable on a 320-px phone, so by default we render a card
  // per equipment with a per-day temperature input accordion. See
  // hygiene-document-client.tsx for the original pattern. Общий хук,
  // ключ `journal-mobile-view:cold_equipment_control`.
  const {
    mobileView,
    switchMobileView,
    mobileAxis,
    switchMobileAxis,
    viewResolved,
  } = useMobileView("cold_equipment_control");
  const viewClasses = documentViewClasses(mobileView, viewResolved);
  // Конвейер «Заполнить подряд»: один холодильник — один экран.
  const [runnerOpen, setRunnerOpen] = useState(false);
  const [expandedEquipmentId, setExpandedEquipmentId] = useState<string | null>(
    null
  );
  // Миграция со старого ключа "cold-equipment-mobile-view" (до перехода на
  // общий useMobileView).
  useEffect(() => {
    try {
      if (window.localStorage.getItem("journal-mobile-view:cold_equipment_control")) return;
      const legacy = window.localStorage.getItem("cold-equipment-mobile-view");
      if (legacy === "table" || legacy === "cards") switchMobileView(legacy);
      window.localStorage.removeItem("cold-equipment-mobile-view");
    } catch {
      /* localStorage blocked — остаёмся на дефолте 'cards' */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dateKeys = useMemo(() => buildDateKeys(dateFrom, dateTo), [dateFrom, dateTo]);
  /**
   * Раньше ширина таблицы была прибита гвоздями (`min-w-[1900px]`), из-за
   * чего у месяца из 15 дней колонки растягивались вдвое против эталона.
   * Считаем от состава: 40 (чекбокс) + 300 (наименование) + 48 × дни.
   */
  const gridMinWidth = 340 + dateKeys.length * 48;
  // Одна строка сетки на дату. Если за день писали разные сотрудники
  // (утренний и вечерний замер по QR) — значения сливаются, иначе второй
  // сотрудник «затирал» бы первого на экране.
  const rowByDate = useMemo(() => {
    const map: Record<string, EntryRow> = {};
    [...rows]
      .sort((left, right) => left.date.localeCompare(right.date))
      .forEach((row) => {
        const current = map[row.date];
        if (!current) {
          map[row.date] = row;
          return;
        }
        const temperatures = { ...current.data.temperatures };
        Object.entries(row.data.temperatures).forEach(([key, value]) => {
          if (value != null) temperatures[key] = value;
        });
        map[row.date] = {
          ...current,
          data: {
            ...current.data,
            temperatures,
            corrections: { ...(current.data.corrections ?? {}), ...(row.data.corrections ?? {}) },
            statuses: { ...(current.data.statuses ?? {}), ...(row.data.statuses ?? {}) },
          },
        };
      });
    return map;
  }, [rows]);
  // Строки сетки: оборудование × замер за день (режим «2 раза в день» даёт две строки).
  const readingSlots = useMemo(() => expandColdEquipmentReadingSlots(config), [config]);
  const responsibleCodes = useMemo(
    () => buildResponsibleCodes(employees, rows, responsibleUserId),
    [employees, responsibleUserId, rows]
  );
  /** Право управлять журналами — то же, что проверяет PATCH документа. */
  const canManageDocument = useCanManageJournalDocument();
  const allSelected =
    config.equipment.length > 0 &&
    selectedEquipmentIds.length === config.equipment.length;

  // Полоса «сколько осталось заполнить сегодня»: единица счёта —
  // единица оборудования. Заполнена, если за сегодня есть значение
  // температуры (независимо от `readingMode` — сетка хранит одно
  // значение на оборудование в день, а не по времени замера).
  // Выходной при включённом «не заполнять в выходные» — заполнять нечего.
  const todayInPeriod =
    dateKeys.includes(todayKey) && !(config.skipWeekends && isWeekend(todayKey));
  const todayProgress = useMemo(() => {
    if (!todayInPeriod || config.equipment.length === 0) return { filled: 0, total: 0 };
    const todayRow = rowByDate[todayKey];
    const filled = readingSlots.reduce((count, slot) => {
      const value = todayRow?.data.temperatures?.[slot.slotKey];
      // «обсл»/«рем» — тоже заполнено: замера нет по уважительной причине.
      return count + (value != null || todayRow?.data.statuses?.[slot.slotKey] ? 1 : 0);
    }, 0);
    return { filled, total: readingSlots.length };
  }, [config.equipment, readingSlots, rowByDate, todayInPeriod, todayKey]);

  // Сколько сегодняшних замеров вышли за норму. Нужно, чтобы зелёная
  // плашка «Сегодня всё заполнено» не закрывала собой отклонения:
  // заполнить — ещё не значит, что всё в порядке.
  const todayOutOfNorm = useMemo(() => {
    if (!todayInPeriod) return 0;
    const todayRow = rowByDate[todayKey];
    if (!todayRow) return 0;
    return readingSlots.reduce((count, slot) => {
      const value = todayRow.data.temperatures?.[slot.slotKey];
      return count + (isColdEquipmentValueOutOfRange(value, slot) ? 1 : 0);
    }, 0);
  }, [readingSlots, rowByDate, todayInPeriod, todayKey]);

  /** «Что сделали?» в янтарной плашке — прокрутка к корректирующим действиям. */
  function scrollToCorrections() {
    document.getElementById("cold-corrections")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  /** «Перейти» в полосе прогресса — скролл к сегодняшней колонке дня. */
  function scrollToTodayColumn() {
    document.querySelector("[data-focus-today]")?.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "center",
    });
  }

  async function persistDocument(payload: Record<string, unknown>) {
    const response = await fetch(`/api/journal-documents/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const result = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(result?.error || "Не удалось сохранить документ");
    }

    return result;
  }

  async function syncEntries() {
    const response = await fetch(`/api/journal-documents/${documentId}/cold-equipment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sync_entries" }),
    });

    const result = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(result?.error || "Не удалось синхронизировать строки");
    }
  }

  async function handleSaveSettings(params: {
    title: string;
    responsibleTitle: string | null;
    responsibleUserId: string | null;
    controlPeriodicity: string;
    config: ColdEquipmentDocumentConfig;
  }) {
    await persistDocument(params);
    await syncEntries();
    setDocumentTitle(params.title);
    router.refresh();
  }

  /**
   * Смена ответственного прямо из панели («ФИО отв. лица»), без захода в
   * «Настройки журнала». Код С1/С2 под таблицей пересчитывается сам —
   * он выводится из `responsibleUserId` + `employeeId` строк.
   */
  async function handleResponsibleUserChange(nextUserId: string | null) {
    setIsSwitching(true);
    try {
      await persistDocument({ responsibleUserId: nextUserId });
      router.refresh();
    } catch (error) {
      toast.error(
        humanizeFetchError(error, "Не удалось сменить ответственного")
      );
    } finally {
      setIsSwitching(false);
    }
  }

  /**
   * Строка и запись справочника «Оборудование» — одно устройство: сервер
   * обновляет связанную запись или создаёт новую и пишет
   * `sourceEquipmentId` (иначе у строки нет QR, IoT и CAPA её не видят).
   */
  async function handleSaveEquipment(item: ColdEquipmentConfigItem) {
    const response = await fetch(`/api/journal-documents/${documentId}/cold-equipment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save_equipment", item }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.item) {
      throw new Error(result?.error || "Не удалось сохранить оборудование");
    }
    const saved = result.item as ColdEquipmentConfigItem;
    setEditingEquipment((current) => (current ? saved : current));
    router.refresh();
    return saved;
  }

  /**
   * «QR-коды» в полосе выделения: сначала связываем выбранные строки со
   * справочником (у добавленных в журнале записи ещё нет), потом — лист
   * наклеек только для них.
   */
  async function handlePrintSelectedQr() {
    if (selectedEquipmentIds.length === 0) return;
    setIsPreparingQr(true);
    try {
      const response = await fetch(`/api/journal-documents/${documentId}/cold-equipment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ensure_equipment", itemIds: selectedEquipmentIds }),
      });
      const result = await response.json().catch(() => null);
      const equipmentIds: string[] = Array.isArray(result?.equipmentIds) ? result.equipmentIds : [];
      if (!response.ok || equipmentIds.length === 0) {
        throw new Error(result?.error || "Не удалось подготовить QR-коды");
      }
      router.push(
        `/settings/qr-posters?kind=equipment&layout=sheet&ids=${encodeURIComponent(equipmentIds.join(","))}`
      );
    } catch (error) {
      toast.error(humanizeFetchError(error, "Не удалось подготовить QR-коды"));
    } finally {
      setIsPreparingQr(false);
    }
  }

  /**
   * Замеры, которые пропадут при уменьшении режима: слоты старого режима
   * минус слоты нового (напр. «3 раза» → «1 раз» уносит `id#2` и `id#3`).
   */
  function countLostOnModeChange(
    item: ColdEquipmentConfigItem,
    nextMode: ColdEquipmentReadingModeId
  ) {
    const keep = new Set(coldEquipmentSlotKeys(item.id, nextMode));
    const dropped = coldEquipmentSlotKeys(item.id, item.readingMode).filter(
      (key) => !keep.has(key)
    );
    return countColdEquipmentValues(rows, dropped);
  }

  async function handleDeleteEquipment(itemId: string) {
    const doomed = config.equipment.find((item) => item.id === itemId);
    const nextEquipment = config.equipment.filter((item) => item.id !== itemId);
    if (nextEquipment.length === 0) {
      toast.error("В журнале должна остаться хотя бы одна строка оборудования.");
      return false;
    }

    // Удаление строки вычищает её замеры за весь период — раньше молча.
    const lostValues = countColdEquipmentValues(
      rows,
      coldEquipmentSlotKeys(itemId, doomed?.readingMode)
    );
    const confirmed = await confirmAsync({
      title: `Удалить строку «${doomed?.name || "без названия"}»?`,
      description:
        "Оборудование исчезнет из журнала вместе со всеми замерами температуры за весь период.",
      variant: "danger",
      confirmLabel: "Удалить строку",
      bullets: [
        lostValues > 0
          ? { label: `Будет удалено замеров: ${lostValues}`, tone: "warn" as const }
          : { label: "Замеров по этой строке ещё нет", tone: "info" as const },
        { label: `Останется строк: ${nextEquipment.length}`, tone: "default" as const },
      ],
    });
    if (!confirmed) return false;

    setIsDeleting(true);
    try {
      await persistDocument({
        config: {
          ...config,
          equipment: nextEquipment,
        },
      });
      await syncEntries();
      setSelectedEquipmentIds((current) => current.filter((value) => value !== itemId));
      router.refresh();
      toast.success(
        lostValues > 0
          ? `Строка удалена. Удалено замеров: ${lostValues}`
          : "Строка удалена"
      );
      return true;
    } catch (error) {
      toast.error(
        humanizeFetchError(error, "Не удалось удалить строку")
      );
      return false;
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleDeleteSelectedEquipment() {
    if (selectedEquipmentIds.length === 0) return;

    const nextEquipment = config.equipment.filter(
      (item) => !selectedEquipmentIds.includes(item.id)
    );
    if (nextEquipment.length === 0) {
      toast.error("В журнале должна остаться хотя бы одна строка оборудования.");
      return;
    }

    const lostValues = countColdEquipmentValues(
      rows,
      config.equipment
        .filter((item) => selectedEquipmentIds.includes(item.id))
        .flatMap((item) => coldEquipmentSlotKeys(item.id, item.readingMode))
    );
    const confirmed = await confirmAsync({
      title: "Удалить выбранные строки?",
      description:
        "Оборудование исчезнет из журнала вместе со всеми замерами температуры за весь период.",
      variant: "danger",
      confirmLabel: "Удалить",
      bullets: [
        { label: `Строк будет удалено: ${selectedEquipmentIds.length}`, tone: "warn" },
        lostValues > 0
          ? { label: `Будет удалено замеров: ${lostValues}`, tone: "warn" as const }
          : { label: "Замеров по этим строкам ещё нет", tone: "info" as const },
        { label: `Останется строк: ${nextEquipment.length}`, tone: "default" },
      ],
    });
    if (!confirmed) return;

    setIsDeleting(true);
    try {
      await persistDocument({
        config: {
          ...config,
          equipment: nextEquipment,
        },
      });
      await syncEntries();
      setSelectedEquipmentIds([]);
      router.refresh();
      toast.success(
        `Удалено строк: ${selectedEquipmentIds.length}; замеров: ${lostValues}`
      );
    } catch (error) {
      toast.error(
        humanizeFetchError(error, "Не удалось удалить выбранные строки")
      );
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleAutoFillChange(value: boolean) {
    setCheckedAutoFill(value);
    // Включили автозаполнение — сразу показываем нормы и ответственного.
    if (value) setSummaryOpen(true);
    setIsSwitching(true);

    try {
      await persistDocument({ autoFill: value });

      if (value) {
        const response = await fetch(`/api/journal-documents/${documentId}/cold-equipment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "apply_auto_fill" }),
        });

        const result = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(result?.error || "Не удалось применить автозаполнение");
        }
      }

      router.refresh();
    } catch (error) {
      setCheckedAutoFill(!value);
      toast.error(
        humanizeFetchError(error, "Ошибка обновления автозаполнения")
      );
    } finally {
      setIsSwitching(false);
    }
  }

  /**
   * `silent` — откат/повтор из истории отмены: шаг в стек не кладём и
   * ошибку пробрасываем наружу, чтобы протухший шаг (сервер ответил
   * «прошлые дни закрыты») вылетел из истории.
   */
  async function handleTemperatureBlur(
    dateKey: string,
    equipmentId: string,
    rawValue: string,
    options?: { silent?: boolean }
  ) {
    const previousValue = rowByDate[dateKey]?.data.temperatures?.[equipmentId];
    const previousRaw = formatColdEquipmentCell(
      previousValue,
      rowByDate[dateKey]?.data.statuses?.[equipmentId]
    );
    // Строка дня записывается на того, кто уже в ней, на ответственного
    // документа или на вошедшего (если он в ростере) — не на «первого в
    // списке».
    // За день могли писать разные сотрудники (замеры по QR). Правим ту запись,
    // где значение уже лежит; иначе — первую запись дня. Сливать чужие значения
    // в одну запись нельзя: старое значение у второго сотрудника «воскресало» бы.
    const lockReason = dayLockReason(dateKey);
    if (lockReason) {
      toast.error(lockReason);
      return;
    }
    const dayRows = rows.filter((row) => row.date === dateKey);
    // Рядовой сотрудник пишет ТОЛЬКО в свою запись дня — сервер иначе
    // отвечает «Можно заполнять только свою строку».
    const scopedDayRows =
      viewerHasFullAccess || !viewer
        ? dayRows
        : dayRows.filter((row) => row.employeeId === viewer.id);
    const ownerRow =
      scopedDayRows.find(
        (row) =>
          row.data.temperatures?.[equipmentId] != null ||
          Boolean(row.data.statuses?.[equipmentId])
      ) ?? scopedDayRows[0];
    const employeeId =
      viewerHasFullAccess || !viewer
        ? ownerRow?.employeeId || responsibleUserId || viewerId
        : viewer.id;
    if (!employeeId) {
      toast.error(NO_ROW_EMPLOYEE_MESSAGE);
      return;
    }

    const existingRow = ownerRow;
    const baseData: ColdEquipmentEntryData = existingRow
      ? {
          ...createEmptyColdEquipmentEntryData(
            config,
            existingRow.data.responsibleTitle || responsibleTitle
          ),
          ...existingRow.data,
          temperatures: {
            ...createEmptyColdEquipmentEntryData(
              config,
              existingRow.data.responsibleTitle || responsibleTitle
            ).temperatures,
            ...existingRow.data.temperatures,
          },
        }
      : createEmptyColdEquipmentEntryData(config, responsibleTitle);

    // Ячейка принимает число (запятая или точка) или «обсл»/«рем» —
    // холодильник на обслуживании или в ремонте. Мусор — пустая ячейка.
    const parsedCell = parseColdEquipmentCellInput(rawValue);
    const nextData = setColdEquipmentSlotStatus(
      { ...baseData, temperatures: { ...baseData.temperatures } },
      equipmentId,
      parsedCell.status
    );
    nextData.temperatures[equipmentId] = parsedCell.temperature;

    const submit = await submitWithOfflineFallback({
      method: "PUT",
      url: `/api/journal-documents/${documentId}/entries`,
      body: { employeeId, date: dateKey, data: nextData },
      label: `Температура · ${dateKey}`,
      group: "cold_equipment_control",
    });

    if (submit.status === "queued") {
      toast.info(
        "Нет сети — запись сохранена локально, отправлю как только появится интернет."
      );
      // Optimistic: обновляем UI как будто успешно сохранили.
      setRows((currentRows) => {
        const nextRow: EntryRow = {
          id: `offline-${dateKey}`,
          employeeId,
          date: dateKey,
          data: nextData,
        };
        const withoutCurrent = currentRows.filter(
          (row) => !(row.date === dateKey && row.employeeId === employeeId)
        );
        return [...withoutCurrent, nextRow].sort((left, right) =>
          left.date.localeCompare(right.date)
        );
      });
      return;
    }

    const response = submit.response;
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.entry) {
      const message = result?.error || "Не удалось сохранить значение";
      if (options?.silent) throw new Error(message);
      toast.error(message);
      return;
    }

    setRows((currentRows) => {
      const nextRow: EntryRow = {
        id: result.entry.id,
        employeeId,
        date: dateKey,
        data: nextData,
      };

      const withoutCurrent = currentRows.filter(
          (row) => !(row.date === dateKey && row.employeeId === employeeId)
        );
      return [...withoutCurrent, nextRow].sort((left, right) =>
        left.date.localeCompare(right.date)
      );
    });

    if (!options?.silent && previousRaw !== rawValue) {
      undoStack.push({
        undo: () =>
          handleTemperatureBlur(dateKey, equipmentId, previousRaw, { silent: true }),
        redo: () =>
          handleTemperatureBlur(dateKey, equipmentId, rawValue, { silent: true }),
      });
    }
  }

  /**
   * «Добавить ХК» — ОБЫЧНАЯ инлайновая кнопка над таблицей (эталон
   * cold_equipment_control-grid.png). Раньше она жила в `sticky top-0`
   * панели и уезжала под шапку кабинета (у той свой `sticky top-0 h-14`),
   * то есть на странице её попросту не было видно.
   *
   * X2 аудита: у эталона это сплит «+ Добавить ⌄» с выпадающим списком,
   * а не одиночная кнопка. Второго ответственного модель не заводит —
   * коды С1/С2 ВЫВОДЯТСЯ из `employeeId` строк (`buildResponsibleCodes`),
   * а сам ответственный это одно поле документа. Поэтому второй пункт
   * ведёт в «Настройки журнала», где ответственный и назначается
   * (решение N8), а не создаёт новую сущность.
   */
  const equipmentAddBar =
    status === "active" ? (
      <div className={DOC_ADD_ROW_CLASS}>
        <div className="flex items-stretch overflow-hidden rounded-lg">
          <Button
            type="button"
            onClick={() => {
              setEditingEquipment(null);
              setEquipmentDialogOpen(true);
            }}
            title="Добавить единицу холодильного или морозильного оборудования"
            className="h-11 gap-2 rounded-none rounded-l-lg bg-[#5566f6] px-5 text-[15px] font-semibold text-white transition-colors duration-150 hover:bg-[#4a5bf0]"
          >
            <Plus className="size-5" strokeWidth={2.5} />
            Добавить
          </Button>
          <ResponsiveMenu
            title="Добавить"
            align="start"
            items={[
              {
                key: "add-equipment",
                label: "Добавить холодильник или камеру",
                icon: <Plus className="size-4 text-[#6f7282]" />,
                onSelect: () => {
                  setEditingEquipment(null);
                  setEquipmentDialogOpen(true);
                },
              },
              {
                key: "add-responsible",
                label: "Добавить ответственного",
                icon: <UserPlus className="size-4 text-[#6f7282]" />,
                onSelect: () => setSettingsOpen(true),
              },
            ]}
            trigger={
              <Button
                type="button"
                aria-label="Что добавить"
                className="h-11 w-11 rounded-none rounded-r-lg border-l border-white/25 bg-[#5566f6] px-0 text-white transition-colors duration-150 hover:bg-[#4a5bf0]"
              >
                <ChevronDown className="size-5" strokeWidth={2.5} />
              </Button>
            }
          />
        </div>
      </div>
    ) : null;

  const selectionBar =
    status === "active" ? (
      <JournalSelectionBar
        count={selectedEquipmentIds.length}
        onClear={() => setSelectedEquipmentIds([])}
        onDelete={handleDeleteSelectedEquipment}
        deleting={isDeleting}
        hint="Оборудование будет удалено вместе с замерами температуры"
      >
        <Button
          type="button"
          variant="outline"
          onClick={() => void handlePrintSelectedQr()}
          disabled={isPreparingQr || isDeleting}
          title="Распечатать наклейки с QR-кодом для выбранных строк — все на одном листе A4"
          className="h-10 gap-1.5 rounded-xl border-[#dcdfed] bg-white px-3.5 text-[14px] font-semibold text-[#0b1024] shadow-none transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
        >
          <QrCode className="size-4 text-[#5566f6]" />
          {isPreparingQr ? "Готовим…" : "QR-коды"}
        </Button>
      </JournalSelectionBar>
    ) : null;

  return (
    <div className="bg-white text-black">
      <FocusTodayScroller always />
      {/* Q3: верхнего padding'а нет — «крошки → H1» задаёт контейнер раздела. */}
      <div className="pb-8">
        <DocumentActionsBar
          backHref="/journals/cold_equipment_control"
          documentId={documentId}
          heading={<h1 className={DOC_HEADING_CLASS}>{documentTitle}</h1>}
          onSettings={status === "active" ? () => setSettingsOpen(true) : undefined}
          undo={{
            canUndo: undoStack.canUndo,
            canRedo: undoStack.canRedo,
            onUndo: () => void undoStack.undo(),
            onRedo: () => void undoStack.redo(),
            undoCount: undoStack.undoCount,
          }}
          menuItems={
            status === "active"
              ? [
                  {
                    key: "copy-yesterday",
                    label: "Скопировать вчерашнее",
                    icon: <Copy className="size-4" />,
                    title:
                      "Создать сегодняшние строки по вчерашним значениям — удобно, когда ничего не поменялось.",
                    onSelect: () => void copyYesterday.run(false),
                    disabled: copyYesterday.busy,
                  },
                  {
                    // Лист A4 с QR на каждый холодильник этого бланка.
                    key: "qr-posters",
                    label: "QR-плакаты",
                    icon: <QrCode className="size-4" />,
                    title: "Распечатать A4-плакаты с QR-кодом для холодильников этого журнала",
                    onSelect: () => router.push(`/settings/qr-posters?kind=equipment&doc=${documentId}`),
                  },
                  {
                    key: "close-journal",
                    label: "Закончить журнал",
                    icon: <Archive className="size-4" />,
                    onSelect: () => void closeAction.closeDocument(),
                    disabled: closeAction.isClosing,
                  },
                ]
              : []
          }
        >
          {copyYesterday.dialog}
        </DocumentActionsBar>
        {status !== "active" ? (
          <div className="mb-8">
            <JournalClosedBanner hint="Откройте журнал заново, чтобы редактировать показания." documentId={documentId} />
          </div>
        ) : null}

        {/* Q3: полоса — общий токен-лента 48px (был свой r32 + p-8 + фон
            #f5f6ff и НЕВАЛИДНЫЙ `h-10 w-18` на тумблере). Раскрывающаяся
            панель норм вынесена отдельным блоком ПОД полосой, чтобы сама
            полоса всегда держала эталонную высоту. */}
        {/* Автозаполнение — настройка документа, право руководителя.
            У сотрудника PATCH отвечал 403, а тумблер стоял на виду. */}
        {canManageDocument ? (
        <div
          className={cn(
            DOC_AUTOFILL_STRIP_CLASS,
            // Панель норм примыкает снизу — 40px до бумажной шапки
            // отдаёт она, иначе лента разрывалась бы пополам.
            // `cn` (tailwind-merge), а не конкатенация: в голой строке
            // `mb-0` не победил бы `mb-10` — исход решает порядок правил
            // в CSS, а не в атрибуте.
            checkedAutoFill && summaryOpen && "mb-0"
          )}
        >
          <Switch
            checked={checkedAutoFill}
            onCheckedChange={handleAutoFillChange}
            disabled={status !== "active" || isSwitching}
            className="data-[state=unchecked]:bg-[#d6d9ee]"
          />
          <span className={DOC_AUTOFILL_LABEL_CLASS}>
            Автоматически заполнять журнал
          </span>

          {checkedAutoFill ? (
            <button
              type="button"
              onClick={() => setSummaryOpen((value) => !value)}
              className="ml-auto flex size-8 items-center justify-center rounded-full text-[#5566f6] hover:bg-white/70"
            >
              {summaryOpen ? <ChevronUp className="size-5" /> : <ChevronDown className="size-5" />}
            </button>
          ) : null}
        </div>
        ) : null}

        {/* Панель норм — СТРОКИ (~52px), а не карточки по 120px.
            Карандаши убраны: по строке кликают целиком. Последняя
            строка — селект «ФИО отв. лица», как на эталоне. */}
        {checkedAutoFill && summaryOpen && canManageDocument ? (
          <div className="-mx-4 mb-10 bg-[#f3f4fe] px-4 pb-4 print:hidden md:-mx-8 md:px-8">
            <div className="space-y-1.5">
              {config.equipment.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={status !== "active"}
                  onClick={() => {
                    if (status !== "active") return;
                    setEditingEquipment(item);
                    setEquipmentDialogOpen(true);
                  }}
                  className="grid h-[52px] w-full grid-cols-[minmax(0,1fr)_96px_96px] items-center gap-3 rounded-[14px] bg-white/70 px-4 text-left transition-colors duration-150 hover:bg-white disabled:cursor-default disabled:hover:bg-white/70"
                >
                  <span className="truncate text-[14px] text-black">
                    {item.name}, Темп. (T)
                  </span>
                  <span className="rounded-[10px] border border-[#dcdfed] bg-white px-3 py-1.5 text-center text-[13.5px] tabular-nums">
                    От {item.min ?? "—"}
                  </span>
                  <span className="rounded-[10px] border border-[#dcdfed] bg-white px-3 py-1.5 text-center text-[13.5px] tabular-nums">
                    До {item.max ?? "—"}
                  </span>
                </button>
              ))}

              <div className="grid h-[52px] w-full grid-cols-[minmax(0,1fr)_minmax(0,200px)] items-center gap-3 rounded-[14px] bg-white/70 px-4">
                <span className="truncate text-[14px] text-black">
                  ФИО отв. лица
                  {responsibleTitle ? (
                    <span className="ml-1 text-[13px] text-[#6f7282]">
                      ({responsibleTitle})
                    </span>
                  ) : null}
                </span>
                <Select
                  value={responsibleUserId || "__empty__"}
                  disabled={status !== "active" || isSwitching}
                  onValueChange={(value) => {
                    void handleResponsibleUserChange(
                      value === "__empty__" ? null : value
                    );
                  }}
                >
                  <SelectTrigger className="h-9 w-full rounded-[10px] border-[#dcdfed] bg-white text-[13.5px]">
                    <SelectValue placeholder="Не назначен" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__empty__">Не назначен</SelectItem>
                    {employees.map((employee) => (
                      <SelectItem key={employee.id} value={employee.id}>
                        {employee.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1 text-[13px] text-[#3c4053]">
                <span className="rounded-full bg-white px-3 py-1.5">
                  Период: {getColdEquipmentDateLabel(dateFrom)} -{" "}
                  {getColdEquipmentDateLabel(dateTo)}
                </span>
                {config.skipWeekends ? (
                  <span className="rounded-full bg-white px-3 py-1.5">
                    Выходные пропускаются при автозаполнении
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {/* Обёртка с mb-4 — ТОЛЬКО когда полоса реально рисуется: сам
            компонент при total===0 возвращает null, а className на
            пустом <div> всё равно потянул бы за собой отступ. */}
        <div className={todayProgress.total > 0 ? "mb-4" : undefined}>
          <TodayProgressStrip
            filled={todayProgress.filled}
            total={todayProgress.total}
            label="единиц оборудования"
            onJumpToToday={scrollToTodayColumn}
            warning={
              todayOutOfNorm > 0
                ? `${todayOutOfNorm} ${pluralRu(todayOutOfNorm, "замер", "замера", "замеров")} вне нормы — опишите, что сделали`
                : null
            }
            warningActionLabel="Что сделали?"
            onWarningAction={
              deviations.length > 0 ? scrollToCorrections : undefined
            }
          />
        </div>

        {/* Кнопка «Добавить ХО» переехала под КАПС-заголовок, вплотную
            над таблицу — как на эталоне. В mobile-cards ветке она
            рендерится тем же узлом выше карточек. */}
        {mobileView === "cards" ? (
          <div className={viewClasses.cards}>{equipmentAddBar}</div>
        ) : null}

        {/* View toggle. Cards = accordion per equipment with per-day
            temperature inputs, vastly more usable on a phone than a
            1900-px grid; on desktop it is an opt-in alternative. */}
        {/* Один ряд вместо двух: таблица показывает весь период и
            ось игнорирует, так что состояний три, а не четыре. */}
        <MobileViewAxisToggle
          view={mobileView}
          axis={mobileAxis}
          axisAvailable={todayInPeriod}
          entityLabel="По оборудованию"
          onChange={(next) => {
            if (next.view === "table") {
              switchMobileView("table");
              return;
            }
            switchMobileView("cards");
            switchMobileAxis(next.axis);
          }}
        />

        {/* Mobile Cards view — accordion per equipment with per-day
            temperature inputs. `handleTemperatureBlur` is the same save
            path as the table, so the two views stay in lockstep. */}
        {/* Ось «Сегодня»: все холодильники за один день, по одному полю
            на строку. Раньше восемь единиц оборудования требовали восьми
            раскрытий аккордеона с пятнадцатью днями внутри каждого. */}
        {mobileView === "cards" && mobileAxis === "today" && todayInPeriod ? (
          <div className={`mb-4 ${viewClasses.cards}`}>
            <DayFirstCards
              items={readingSlots.map((item) => {
                const value = rowByDate[todayKey]?.data.temperatures[item.slotKey];
                const cellStatus = rowByDate[todayKey]?.data.statuses?.[item.slotKey] ?? null;
                return {
                  id: item.slotKey,
                  title: item.slotLabel ? `${item.name} · ${item.slotLabel}` : item.name,
                  // Норма без того подписана под полем ввода («норма 2…6 °C»).
                  // Вторая копия только отъедала место у названия.
                  subtitle: undefined,
                  disabledReason:
                    status === "active" ? undefined : "журнал закрыт",
                  // Карандаш — то же окно строки (название, норма, QR),
                  // что и клик по названию в таблице.
                  onEdit:
                    status === "active"
                      ? () => {
                          setEditingEquipment(item);
                          setEquipmentDialogOpen(true);
                        }
                      : undefined,
                  editLabel: `Изменить ${item.name}`,
                  trailing:
                    status === "active" ? (
                      // На телефоне управление стоит отдельной строкой (см. day-first-cards) —
                      // отдаём ему всю ширину, в 190px кнопки ± и камера не помещались.
                      <div className="w-[190px] max-sm:w-full">
                        <ColdTemperatureCell
                          inputId={`today-temp-${item.slotKey}`}
                          value={value ?? ""}
                          status={cellStatus}
                          norm={{ min: item.min, max: item.max }}
                          onCommit={(next) =>
                            handleTemperatureBlur(todayKey, item.slotKey, next)
                          }
                        />
                      </div>
                    ) : (
                      <span className="text-[14px] text-[#0b1024]">
                        {formatColdEquipmentCell(value, cellStatus) || "—"}
                      </span>
                    ),
                };
              })}
              emptyLabel="Добавьте единицу холодильного оборудования."
            />
            {status === "active" && config.equipment.length > 1 ? (
              <button
                type="button"
                onClick={() => setRunnerOpen(true)}
                className="mt-2 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] text-[15px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0]"
              >
                Заполнить подряд
              </button>
            ) : null}
          </div>
        ) : null}

        {mobileView === "cards" &&
        (mobileAxis === "entity" || !todayInPeriod) ? (
          <div className={`space-y-2 ${viewClasses.cards}`}>
            {config.equipment.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] p-5 text-center text-[13px] text-[#6f7282]">
                Добавьте единицу холодильного оборудования через кнопку
                «Добавить» сверху.
              </div>
            ) : null}
            {readingSlots.map((item) => {
              const expanded = expandedEquipmentId === item.slotKey;
              const filledCount = dateKeys.reduce((acc, dk) => {
                const val = rowByDate[dk]?.data.temperatures[item.slotKey];
                return acc + (val != null || rowByDate[dk]?.data.statuses?.[item.slotKey] ? 1 : 0);
              }, 0);
              const isSelected = selectedEquipmentIds.includes(item.id);
              return (
                <div
                  key={item.slotKey}
                  className="rounded-2xl border border-[#ececf4] bg-white"
                >
                  <div className="flex items-center gap-3 px-3 py-3">
                    <span
                      onClick={(event) => event.stopPropagation()}
                      className="shrink-0"
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={(checked) =>
                          setSelectedEquipmentIds((current) =>
                            checked === true
                              ? [...current, item.id]
                              : current.filter((value) => value !== item.id)
                          )
                        }
                        disabled={status !== "active"}
                        className="size-5"
                      />
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedEquipmentId(expanded ? null : item.slotKey)
                      }
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="line-clamp-3 break-words text-[14px] font-medium leading-snug text-[#0b1024]">
                          {item.name}
                          {item.slotLabel ? <span className="ml-1.5 text-[12px] font-semibold text-[#3848c7]">{item.slotLabel}</span> : null}
                        </div>
                        <div className="line-clamp-2 break-words text-[12px] text-[#6f7282]">
                          {formatRange(item.min, item.max)}
                        </div>
                      </div>
                      <span className="shrink-0 rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[11px] font-semibold text-[#5566f6]">
                        {filledCount}/{dateKeys.length}
                      </span>
                      <ChevronDown
                        className={`size-4 shrink-0 text-[#6f7282] transition-transform ${
                          expanded ? "rotate-180" : ""
                        }`}
                      />
                    </button>
                    {status === "active" ? (
                      // Тап по названию раскрывает дни; карандаш — окно
                      // строки с нормой и QR (как клик по названию в таблице).
                      <button
                        type="button"
                        onClick={() => {
                          setEditingEquipment(item);
                          setEquipmentDialogOpen(true);
                        }}
                        title="Изменить название и норму, показать QR-код"
                        aria-label={`Изменить ${item.name}`}
                        className="flex size-9 shrink-0 items-center justify-center rounded-full text-[#6f7282] transition-colors duration-150 hover:bg-[#f5f6ff] hover:text-[#5566f6]"
                      >
                        <Pencil className="size-4" />
                      </button>
                    ) : null}
                  </div>
                  {expanded ? (
                    <div className="space-y-1.5 border-t border-[#ececf4] p-3">
                      {dateKeys.map((dateKey) => {
                        const row = rowByDate[dateKey];
                        const value = row?.data.temperatures[item.slotKey];
                        const cellStatus = row?.data.statuses?.[item.slotKey] ?? null;
                        const weekend = isWeekend(dateKey);
                        return (
                          <div
                            key={`${item.slotKey}:${dateKey}`}
                            className={`flex items-center gap-2 rounded-xl px-1 py-1 ${
                              weekend ? "bg-[#fafbff]" : ""
                            }`}
                          >
                            <span className="w-14 shrink-0 text-center text-[13px] font-medium text-[#6f7282]">
                              {getDayNumber(dateKey)}{" "}
                              {getWeekdayShort(dateKey)}.
                            </span>
                            {status === "active" && !dayLockReason(dateKey) ? (
                              <ColdTemperatureCell
                                inputId={`temp-${item.slotKey}-${dateKey}`}
                                value={value ?? ""}
                                status={cellStatus}
                                norm={{ min: item.min, max: item.max }}
                                onCommit={(next) =>
                                  handleTemperatureBlur(dateKey, item.slotKey, next)
                                }
                              />
                            ) : (
                              <span
                                title={dayLockReason(dateKey) ?? undefined}
                                className="flex-1 rounded-lg bg-[#fafbff] px-3 py-2 text-[14px] text-[#0b1024]"
                              >
                                {formatColdEquipmentCell(value, cellStatus) || "—"}
                              </span>
                            )}
                            <span className="w-12 shrink-0 text-right text-[11px] text-[#9b9fb3]">
                              {responsibleCodes.codeMap[
                                row?.employeeId || responsibleUserId || ""
                              ] || ""}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}

        {/* Панель выделения — ОДНА на экран и вне табличного полотна:
            раньше она лежала внутри `viewClasses.table`, и в «Карточках»
            на телефоне чекбоксы выделяли строки, а кнопок «QR-коды» и
            «Удалить» не было видно вовсе. */}
        {selectionBar}

        {/* R1: бумажное полотно — во всю ширину контентной колонки.
            Сетка на 15 дней шире полотна и продолжает скроллиться внутри
            своего GRID_VIEWPORT_CLASS. */}
        <div className={`${DOC_PAPER_CANVAS_CLASS} ${viewClasses.table}`}>
        {/* A10 аудита: ОДИН scroll-viewport на весь бланк.
         *
         * Раньше ХАССП-шапка и сетка замеров жили в РАЗНЫХ
         * `overflow-x-auto`-контейнерах: шапка тянулась на всю ширину
         * полотна (до 1400px), сетка держалась на inline
         * `min-width: gridMinWidth` (~1175px) — и правая вертикаль
         * бланка расходилась на пару сотен пикселей. Плюс скроллбаров
         * было два, и они ездили независимо.
         *
         * Теперь всё внутри одного viewport'а и одной внутренней
         * колонки шириной `max(100%, gridMinWidth)`: на широком экране
         * бланк занимает полотно целиком, на узком — держит свою
         * минимальную ширину и скроллится.
         * Таблицы внутри — `w-full`, поэтому правая линия ровно одна.
         * На бумаге inline min-width снимает правило по
         * `[data-journal-blank-column]` из app-theme.css. */}
        <div className={GRID_VIEWPORT_CLASS}>
          <div
            style={
              {
                minWidth: `max(100%, ${gridMinWidth}px)`,
                // Число дней нужно CSS, чтобы посчитать компактную ширину
                // листа на узком экране без участия JS.
                "--jgrid-days": dateKeys.length,
              } as CSSProperties
            }
            // На экране уже ноутбука минимум снимается правилом
            // `[data-journal-grid-sheet]` из globals.css — иначе лист
            // держал бы бумажную ширину и уезжал вбок вместе с подписями.
            data-journal-grid-sheet
            // `w-max` — ширину колонки задаёт самая широкая таблица.
            // С `w-full` шапка вставала по ширине контейнера, а сетка
            // замеров распирала себя содержимым и была на ~70px шире:
            // правая вертикаль бланка расходилась с колонками.
            className="w-max"
            data-journal-blank-column
          >
          <div className={`${DOC_PAPER_HEADER_CLASS} print:mb-2`}>
          <JournalDocumentHeader
            orgName={organizationName}
            title="Журнал контроля температурного режима холодильного и морозильного оборудования"
            startedAt={dateFrom}
            finishedAt={status === "closed" ? dateTo : null}
            controlPeriodicity={controlPeriodicity}
          />
          </div>

        <div className={DOC_CAPS_TITLE_CLASS}>
          <JournalDocumentTitle>
            Журнал контроля температурного режима холодильного и морозильного
            оборудования
          </JournalDocumentTitle>
        </div>
        {/* Без JS-гейта по mobileView: внешний контейнер в cards-режиме
            спрятан классом (`viewClasses.table`), копия для карточек
            рендерится выше в своей обёртке — на экране всегда ровно один
            экземпляр кнопки «Добавить ХО». */}
        {equipmentAddBar}
          <table className="w-full border-collapse text-[13px]" data-journal-grid>
            {/* Ширины колонок на узком экране задаются здесь: у таблицы
                там `table-layout: fixed`, и без colgroup ширину диктовала
                бы самая длинная ячейка столбца — из-за строки
                «Ответственный за снятие показателей» колонка названия
                разъезжалась до 477px, а дни уезжали за экран. */}
            <colgroup>
              <col data-grid-col-check />
              <col data-grid-col-label />
              {dateKeys.map((dateKey) => (
                <col key={`col:${dateKey}`} data-grid-col-day />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className={`${GRID_HEAD_CELL_CLASS} w-[40px] px-1 py-1 text-center leading-tight print:hidden`} rowSpan={2} data-grid-check>
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={(checked) =>
                      setSelectedEquipmentIds(
                        checked === true ? config.equipment.map((item) => item.id) : []
                      )
                    }
                    disabled={status !== "active" || config.equipment.length === 0}
                  />
                </th>
                <th
                  className={`${GRID_HEAD_CELL_CLASS} min-w-[300px] px-2 py-1.5 text-center text-[13px] font-semibold leading-tight`}
                  rowSpan={2}
                  data-grid-label
                >
                  Наименование или номер ХК
                </th>
                <th
                  className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center text-[13px] font-semibold leading-tight`}
                  colSpan={dateKeys.length}
                >
                  {/* X6: `toLocaleDateString` даёт «август 2026 г.» со
                      строчной, эталон печатает «Месяц Август 2026 г.».
                      Общий хелпер сетки — тот же, что у журнала уборки. */}
                  Месяц {getCleaningGridMonthLabel(dateFrom, dateTo)}
                </th>
              </tr>
              <tr>
                {dateKeys.map((dateKey) => (
                  <th
                    key={dateKey}
                    data-grid-day
                    data-focus-today={dateKey === todayKey ? "" : undefined}
                    // X7: заливки выходных здесь нет — эталон
                    // cold_equipment_control-2-doc.png печатает сетку
                    // однотонной, а чередование фона читалось как «зебра».
                    // Сегодняшний столбец — исключение: без него в сетке на
                    // месяц не видно, куда вносить, и замеры уходят в соседний
                    // день. На печати заливку снимаем, бланк остаётся строгим.
                    className={`${GRID_HEAD_CELL_CLASS} w-[48px] px-1 py-1 text-center font-semibold leading-tight ${
                      dateKey === todayKey
                        ? "bg-[#eef1ff] text-[#3848c7] print:bg-transparent print:text-inherit"
                        : ""
                    }`}
                  >
                    <div className="text-[13px]">{getDayNumber(dateKey)}</div>
                    <div className="text-[11px] font-normal uppercase text-[#666]">
                      {getWeekdayShort(dateKey)}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {/* R5-2: у ячейки-заглушки под колонкой чекбоксов НЕ БЫЛО
                  `print:hidden`, хотя сам чекбокс-столбец в печати скрыт
                  и в шапке (`<th print:hidden>`), и в строках данных
                  (`<td print:hidden>`).

                  Из-за этого на бумаге строка несла на ОДНУ ячейку
                  больше, чем колонок в таблице: всё содержимое съезжало
                  вправо на столбец, «Температура °C» и служебная строка
                  ответственного заезжали в область дней, день 1
                  растягивался под чужую ячейку, а дни 2-15 сжимались в
                  нитки. Скрываем заглушку ровно там же, где скрыт
                  столбец — тогда colSpan (name + N дней) снова сходится. */}
              <tr>
                <td className={`${GRID_CELL_CLASS} px-2 py-1 leading-tight print:hidden`} data-grid-check />
                <td
                  className={`${GRID_CELL_CLASS} px-2 py-1 text-center text-[13px] font-semibold leading-tight`}
                  colSpan={dateKeys.length + 1}
                >
                  Температура °C
                </td>
              </tr>

              {readingSlots.map((item) => (
                <tr key={item.slotKey}>
                  <td
                    className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight print:hidden`}
                    data-grid-check
                  >
                    <Checkbox
                      checked={selectedEquipmentIds.includes(item.id)}
                      onCheckedChange={(checked) =>
                        setSelectedEquipmentIds((current) =>
                          checked === true
                            ? [...current, item.id]
                            : current.filter((value) => value !== item.id)
                        )
                      }
                      disabled={status !== "active"}
                    />
                  </td>

                  <td className={`${GRID_CELL_CLASS} p-0 align-middle leading-tight`} data-grid-label>
                    {/* Название — кнопка: открывает окно строки (название,
                        норма, QR-код). Раньше правка пряталась в панели
                        автозаполнения, и норму никто не находил. На бумаге
                        печатается как обычный текст. */}
                    <button
                      type="button"
                      disabled={status !== "active"}
                      onClick={() => {
                        if (status !== "active") return;
                        setEditingEquipment(item);
                        setEquipmentDialogOpen(true);
                      }}
                      title="Изменить название и норму, показать QR-код для заполнения с телефона"
                      className="group flex w-full items-center gap-2 px-2 py-1 text-left transition-colors duration-150 enabled:hover:bg-[#f5f6ff] disabled:cursor-default"
                    >
                      <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="text-[13px] font-medium group-enabled:group-hover:text-[#3848c7]">
                          {item.name}
                        </span>
                        <span className="text-[12px] text-[#6f7282]">
                          {formatRange(item.min, item.max)}
                        </span>
                        {item.slotLabel ? (
                          <span className="rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[11px] font-semibold text-[#3848c7] print:bg-transparent print:px-0 print:text-black">
                            {item.slotLabel}
                          </span>
                        ) : null}
                      </span>
                      {status === "active" ? (
                        <span className="flex shrink-0 items-center gap-1 text-[#9b9fb3] transition-colors duration-150 group-hover:text-[#5566f6] print:hidden">
                          {item.sourceEquipmentId ? <QrCode className="size-3.5" /> : null}
                          <Pencil className="size-3.5" />
                        </span>
                      ) : null}
                    </button>
                  </td>

                  {dateKeys.map((dateKey) => {
                    const row = rowByDate[dateKey];
                    const value = row?.data.temperatures[item.slotKey];
                    const cellStatus = row?.data.statuses?.[item.slotKey] ?? null;
                    const cellText = formatColdEquipmentCell(value, cellStatus);

                    return (
                      <td
                        key={`${item.slotKey}:${dateKey}`}
                        data-grid-day
                        className={`${GRID_CELL_CLASS} p-1 text-center leading-tight`}
                      >
                        {status === "active" && !dayLockReason(dateKey) ? (
                          // Текст, а не number: в ячейку можно вписать «обсл» или «рем».
                          <Input
                            key={cellText}
                            type="text"
                            defaultValue={cellText}
                            title="Температура или «обсл» / «рем»"
                            onBlur={(event) => {
                              if (event.target.value.trim() === cellText) return;
                              void handleTemperatureBlur(dateKey, item.slotKey, event.target.value);
                            }}
                            className={cn(
                              "h-7 min-w-[44px] border-0 px-1 text-center text-[13px] shadow-none focus-visible:ring-1",
                              isColdEquipmentValueOutOfRange(value, item) &&
                                "font-semibold text-[#d2453d]",
                              cellStatus && "font-medium text-[#3848c7]"
                            )}
                          />
                        ) : (
                          <span
                            title={dayLockReason(dateKey) ?? undefined}
                            className={cn(
                              "text-[13px]",
                              isColdEquipmentValueOutOfRange(value, item) &&
                                "font-semibold text-[#d2453d]",
                              cellStatus && "font-medium text-[#3848c7]"
                            )}
                          >
                            {cellText}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}

              {/* Кликабельная пустая строка — то же окно «Добавить оборудование»,
                  что и кнопка над таблицей. Стоит ПЕРЕД служебной строкой
                  «Ответственный за снятие показателей»: та строка — часть
                  бланка и должна оставаться самой нижней, как на бумаге.
                  Сетка: leading=1 (чекбокс), labelSpan=1 (широкая колонка
                  «Наименование или номер ХК» — единственный содержательный
                  столбец записи), trailing=dateKeys.length (пустые клетки
                  дней) — сумма 1+1+dateKeys.length та же, что и прежний
                  colSpan (dateKeys.length + 2). */}
              {status === "active" ? (
                <JournalAddRow
                  leading={1}
                  labelSpan={1}
                  trailing={dateKeys.length}
                  label="Добавить оборудование"
                  onClick={() => {
                    setEditingEquipment(null);
                    setEquipmentDialogOpen(true);
                  }}
                />
              ) : null}

              <tr>
                {/* R5-2: та же заглушка колонки чекбоксов — тоже print:hidden. */}
                <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight print:hidden`} data-grid-check />
                {/* Эталон делит эту строку на две ячейки: слева оранжевая
                    служебная метка, справа расшифровка кода «С1 - ФИО»,
                    который стоит в ячейках дней. */}
                <td className={`${GRID_CELL_CLASS} p-0 align-middle leading-tight`} data-grid-label>
                  <div className="flex items-stretch max-sm:flex-col">
                    <div
                      className="flex w-[150px] shrink-0 items-center justify-center px-2 py-1 text-center"
                      data-grid-service
                    >
                      <span className={GRID_SERVICE_LABEL_CLASS}>
                        Ответственный за снятие показателей
                      </span>
                    </div>
                    <div className={`flex-1 border-l ${GRID_BORDER_CLASS} px-3 py-1 text-[13px]`}>
                      {responsibleCodes.items.length > 0 ? (
                        responsibleCodes.items.map((item) => (
                          <div key={item.employeeId}>{item.label}</div>
                        ))
                      ) : (
                        <span className="text-[#9b9fb3]">Не назначен</span>
                      )}
                    </div>
                  </div>
                </td>

                {dateKeys.map((dateKey) => {
                  const row = rowByDate[dateKey];
                  /**
                   * X1 аудита: подпись «С1» ставится ТОЛЬКО в дни, где есть
                   * фактические замеры. Раньше код печатался во все 15
                   * ячеек (fallback на `responsibleUserId`), и пустой
                   * журнал выглядел подписанным задним числом.
                   */
                  const hasMeasurements = row
                    ? Object.values(row.data.temperatures).some(
                        (value) => value != null
                      ) || Object.keys(row.data.statuses ?? {}).length > 0
                    : false;
                  const employeeId = hasMeasurements
                    ? row?.employeeId || responsibleUserId || ""
                    : "";

                  return (
                    <td
                      key={`responsible:${dateKey}`}
                      className={`${GRID_CELL_CLASS} px-2 py-1 text-center text-[13px] font-medium leading-tight`}
                    >
                      {employeeId ? responsibleCodes.codeMap[employeeId] || "" : ""}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>

          {deviations.length > 0 ? (
            <section className="mt-6" id="cold-corrections">
              <div className={DOC_CAPS_TITLE_CLASS}>
                <JournalDocumentTitle>Корректирующие действия</JournalDocumentTitle>
              </div>
              <p className="mt-1 text-center text-[12px] leading-snug text-[#a13a32] print:text-[10px]">
                Температура вышла за норму — опишите, что сделали. Пустая
                графа при проверке читается как «нарушение заметили и
                проигнорировали».
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr>
                      <th className={`${GRID_CELL_CLASS} w-[110px] px-2 py-1.5 font-semibold text-[#3c4053]`}>
                        Дата
                      </th>
                      <th className={`${GRID_CELL_CLASS} w-[200px] px-2 py-1.5 font-semibold text-[#3c4053]`}>
                        Точка контроля
                      </th>
                      <th className={`${GRID_CELL_CLASS} w-[190px] px-2 py-1.5 font-semibold text-[#3c4053]`}>
                        Зафиксированный параметр
                      </th>
                      <th className={`${GRID_CELL_CLASS} px-2 py-1.5 font-semibold text-[#3c4053]`}>
                        Комментарий / действие
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {deviations.map((d) => (
                      <tr key={d.key} className="bg-[#fff4f2]">
                        <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center tabular-nums`}>
                          {d.date}
                        </td>
                        <td className={`${GRID_CELL_CLASS} px-2 py-1`}>
                          {d.equipmentName}
                        </td>
                        <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center font-medium text-[#d2453d]`}>
                          T, {d.value} °C
                          <span className="ml-1 text-[11px] font-normal text-[#a13a32]">
                            (норма {d.min ?? "—"}…{d.max ?? "—"})
                          </span>
                        </td>
                        <td className={`${GRID_CELL_CLASS} p-0`}>
                          <JournalCellInput
                            defaultValue={d.comment}
                            placeholder="Что сделали: переставили продукт, вызвали мастера…"
                            disabled={status !== "active"}
                            onBlur={(event) =>
                              void saveCorrection(
                                d.date,
                                d.equipmentId,
                                event.target.value
                              )
                            }
                            className="w-full px-2 text-[13px] focus-visible:ring-1"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
          </div>
        </div>
        </div>
      </div>

      <JournalSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        title={documentTitle}
        responsibleTitle={responsibleTitle}
        responsibleUserId={responsibleUserId}
        employees={employees}
        config={config}
        controlPeriodicity={controlPeriodicity}
        onSave={handleSaveSettings}
        useV2={useV2}
      />

      <EquipmentDialog
        open={equipmentDialogOpen}
        onOpenChange={setEquipmentDialogOpen}
        initialItem={editingEquipment}
        existingRows={equipmentDialogExistingRows}
        canDelete={config.equipment.length > 1}
        onSave={handleSaveEquipment}
        onDelete={handleDeleteEquipment}
        countLostOnModeChange={countLostOnModeChange}
      />

      {/* Конвейер: один холодильник — один экран, крупное поле,
          автопереход к следующему незаполненному. */}
      <FillRunner
        open={runnerOpen}
        title={`Замеры за ${getDayNumber(todayKey)} ${getWeekdayShort(todayKey)}.`}
        onClose={() => setRunnerOpen(false)}
        steps={readingSlots.map((item) => {
          const value = rowByDate[todayKey]?.data.temperatures[item.slotKey];
          const cellStatus = rowByDate[todayKey]?.data.statuses?.[item.slotKey] ?? null;
          return {
            id: item.slotKey,
            title: item.slotLabel ? `${item.name} · ${item.slotLabel}` : item.name,
            subtitle: formatRange(item.min, item.max),
            done: value != null || cellStatus !== null,
            render: () => (
              <ColdTemperatureCell
                inputId={`runner-temp-${item.slotKey}`}
                value={value ?? ""}
                status={cellStatus}
                norm={{ min: item.min, max: item.max }}
                onCommit={(next) =>
                  handleTemperatureBlur(todayKey, item.slotKey, next)
                }
              />
            ),
          };
        })}
      />
    </div>
  );
}
