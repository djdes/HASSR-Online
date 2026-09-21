"use client";

import { cn } from "@/lib/utils";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  Download,
  ListPlus,
  Pencil,
  Plus,
  Trash2,
  Upload, Database, } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  TimeField,
  joinTimeValue,
  splitTimeValue,
} from "@/components/journals/time-field";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DocumentActionsBar } from "@/components/journals/document-actions-bar";
import { useJournalUndo } from "@/lib/journal-undo";
import {
  DOC_ADD_ROW_CLASS,
  DOC_BODY_STACK_CLASS,
  DOC_SECONDARY_BUTTON_CLASS,
  DOC_TITLE_ROW_NO_STRIP_CLASS,
  DOC_CAPS_TITLE_CLASS,
  DOC_EXTRA_BLOCK_CLASS,
  DOC_HEADING_CLASS,
  DOC_PAPER_CANVAS_CLASS,
  DOC_PAPER_HEADER_CLASS,
  JOURNAL_DIALOG_CONTENT_CLASS,
  JOURNAL_DIALOG_CONTENT_WIDE_CLASS,
  JOURNAL_DIALOG_HEADER_CLASS,
  JOURNAL_DIALOG_TITLE_CLASS,
} from "@/components/journals/journal-responsive";
import { JournalSelectionBar } from "@/components/journals/journal-selection-bar";
import { SelectionEditButton } from "@/components/journals/selection-edit-button";
import { useSequentialEdit } from "@/components/journals/use-sequential-edit";
import { JournalPaperHeaderRows } from "@/components/journals/journal-document-header";
import { JournalSettingsModal } from "@/components/journals/v2/journal-settings-modal";
import { useDocumentCloseAction } from "@/components/journals/document-close-button";
import { FocusTodayScroller } from "@/components/journals/focus-today-scroller";
import { useMobileView } from "@/lib/use-mobile-view";
import {
  MobileViewToggle,
  MobileViewTableWrapper,
} from "@/components/journals/mobile-view-toggle";
import {
  RecordCardsView,
  type RecordCardItem,
} from "@/components/journals/record-cards-view";
import {
  formatDateRu,
  formatTime,
  fryerOilDayKey,
  normalizeFryerOilEntryData,
  parseShiftTime,
  type FryerOilShift,
  formatQualityLabel,
  QUALITY_ASSESSMENT_TABLE,
  DEFAULT_QUALITY_PHRASES,
  QUALITY_LABELS,
  type FryerOilDocumentConfig,
  type FryerOilEntryData,
  type FryerOilSelectLists,
} from "@/lib/fryer-oil-document";

import { toast } from "sonner";
import { confirmAsync } from "@/components/ui/confirm-async";
import { localDayKey, localTimeParts } from "@/lib/entry-defaults";
import { JournalClosedBanner } from "@/components/journals/journal-closed-banner";
import {
  GRID_CELL_CLASS,
  GRID_HEAD_CELL_CLASS,
  GRID_VIEWPORT_CLASS,
} from "@/components/journals/journal-grid";
import { JournalAddRow } from "@/components/journals/journal-add-row";

import { useTodayKey } from "@/lib/use-today-key";
import { TodayStripForJournal } from "@/components/journals/today-strip-for-journal";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";
import { OrgDirectoryDialog } from "@/components/journals/org-directory-dialog";
import { mergeIntoList, type OrgDirectoryKind } from "@/lib/org-directory";
/**
 * ЭКРАН = WeSetup (мягкие серые рамки `#ececf4`, шапка `#f8f9fc`),
 * ПЕЧАТЬ (Ctrl+P) = «бумага» для инспектора РПН/СЭС (чёрные рамки,
 * белая шапка). Поэтому каждый токен несёт пару screen + `print:`.
 */
/** Скруглённый viewport вокруг таблицы; в печати — прозрачный wrapper. */

/** Общий вид триггера shadcn-селекта внутри форм журнала. */
const SELECT_TRIGGER_CLASS =
  "h-9 w-full rounded-xl border-[#dcdfed] bg-white px-3.5 text-[13.5px] text-[#0b1024] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15";
/**
 * `<SelectItem value="">` в Radix запрещён — пустая строка зарезервирована
 * под «ничего не выбрано». Пункт «— выберите —» несёт сентинел.
 */
const NONE_VALUE = "__none";
const fromNone = (value: string) => (value === NONE_VALUE ? "" : value);
const toNone = (value: string) => (value ? value : NONE_VALUE);
type UserItem = { id: string; name: string; role: string };
/**
 * A16 аудита: `data.startDate` заполняется формой, но у записей,
 * созданных автозаполнением/импортом, его нет — колонка «Дата, время
 * начала использования» показывала одно время без даты. `date` (день
 * записи в документе) есть всегда, поэтому он и есть фолбэк — ровно
 * так же считает серверный PDF (`document-pdf.ts`).
 */
type EntryItem = { id: string; date: string; data: FryerOilEntryData };
type Props = {
  documentId: string;
  /** Кто открыл журнал — он подставляется контролёром в новых строках. */
  currentUserId: string | null;
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
  /** Дата окончания документа — запасной вариант для шапки закрытого журнала. */
  dateTo?: string;
  config: FryerOilDocumentConfig;
  users: UserItem[];
  initialEntries: EntryItem[];
  routeCode: string;
  /** Design v2 toggle. */
  useV2?: boolean;
};

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));
const QUALITY_OPTIONS = [5, 4, 3, 2, 1] as const;

/** Ключ сортировки: незаполненное время идёт как 00:00, а не «null». */
function sortKey(data: FryerOilEntryData) {
  const hour = String(data.startHour ?? 0).padStart(2, "0");
  const minute = String(data.startMinute ?? 0).padStart(2, "0");
  return `${data.startDate}-${hour}-${minute}`;
}

function sortEntries(items: EntryItem[]) {
  return [...items]
    .map((item) => ({ ...item, data: normalizeFryerOilEntryData(item.data) }))
    .sort((a, b) =>
      sortKey(a.data).localeCompare(sortKey(b.data))
    );
}

/** Разбор графы продукции: в ячейке они лежат через запятую. */
function splitProducts(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

type DayTab = {
  /** React-ключ. У сохранённых строк — их id, у новых — свой счётчик. */
  key: string;
  /** Есть — строка уже в базе; нет — будет создана при сохранении. */
  id?: string;
  data: FryerOilEntryData;
};

/**
 * Диалог ДНЯ, а не строки.
 *
 * В заведении может стоять хоть сто фритюрниц, и каждая за день даёт
 * свою строку бланка: свой жир, своё время, своя оценка. Поэтому диалог
 * открывается сразу на весь день и показывает его вкладками — по клику
 * на любую строку видно все фритюрницы этого дня, а не одну.
 *
 * Раньше вкладки были только при создании новой строки. Но журнал
 * заводит строки-заготовки на каждый день заранее, так что обычное
 * действие — клик по существующей строке, и там добавить вторую
 * фритюрницу было нечем.
 */
function EntryDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lists: FryerOilSelectLists;
  users: UserItem[];
  /** Кто сейчас заполняет — он и подставляется контролёром. */
  currentUserId: string | null;
  /** Часы смены — из них берутся время начала и окончания по умолчанию. */
  shift: FryerOilShift;
  /** Все строки этого дня. Пусто — заводим день с нуля. */
  dayEntries: EntryItem[];
  /** По какой строке кликнули: её вкладка открывается активной. */
  focusEntryId: string | null;
  /** «(k из N)» при правке выделенных строк по очереди. */
  titleSuffix?: string;
  onSave: (payload: {
    updates: Array<{ id: string; data: FryerOilEntryData }>;
    creates: FryerOilEntryData[];
    removedIds: string[];
  }) => Promise<void>;
}) {
  /**
   * Кто заполняет. Раньше подставлялся первый сотрудник по алфавиту —
   * в журнале оказывался не тот, кто реально менял жир.
   */
  const defaultControllerName =
    props.users.find((user) => user.id === props.currentUserId)?.name || "";

  /**
   * Значения по умолчанию: дата, время и контролёр.
   *
   * Это «когда и кто», а не показатели — их система знает. Оценки жира,
   * килограммы и вид продукции не трогаем никогда: журнал показывают
   * Роспотребнадзору, и значение за непроведённый контроль хуже пустой
   * графы. Уже заполненное не перетираем — `??` и `||` пропускают его.
   */
  function withDefaults(data: FryerOilEntryData, dayKey?: string): FryerOilEntryData {
    const now = new Date();
    // Часы смены, а не «сейчас»: повар открывает журнал когда придётся,
    // а жарка идёт с начала смены. Смена настраивается в «Настройках
    // журнала»; если там мусор — падаем на текущее время.
    const start = parseShiftTime(props.shift.startTime) ?? localTimeParts(now);
    const end = parseShiftTime(props.shift.endTime) ?? localTimeParts(now);
    return {
      ...data,
      startDate: data.startDate || dayKey || localDayKey(now),
      startHour: data.startHour ?? start.hour,
      startMinute: data.startMinute ?? start.minute,
      endHour: data.endHour ?? end.hour,
      endMinute: data.endMinute ?? end.minute,
      controllerName: data.controllerName || defaultControllerName,
    };
  }

  /** Заготовка строки: справочные поля из списков плюс `withDefaults`. */
  function blankEntry(equipmentType: string, base?: FryerOilEntryData): FryerOilEntryData {
    return withDefaults(
      {
        ...normalizeFryerOilEntryData({}),
        startDate: base?.startDate ?? "",
        controllerName: base?.controllerName ?? "",
        fatType: props.lists.fatTypes[0] ?? "",
        equipmentType,
        productType: "",
      }
    );
  }

  const keySeq = useRef(0);
  function nextKey() {
    keySeq.current += 1;
    return `new-${keySeq.current}`;
  }

  const [tabs, setTabs] = useState<DayTab[]>(() =>
    props.dayEntries.length > 0
      ? // Строки-заготовки приходят пустыми: дату, время и контролёра
        // подставляем и в них, иначе человек набивает это руками на
        // каждой записи. Дата берётся из дня самой строки, а не
        // сегодняшнего — иначе открытый прошлый день переехал бы.
        props.dayEntries.map((entry) => ({
          key: entry.id,
          id: entry.id,
          data: withDefaults(
            normalizeFryerOilEntryData(entry.data),
            fryerOilDayKey(entry)
          ),
        }))
      : [
          {
            key: "new-0",
            data: {
              ...blankEntry(props.lists.equipmentTypes[0] ?? ""),
              productType: props.lists.productTypes[0] ?? "",
            },
          },
        ]
  );
  // Строки, убранные крестиком: удаляются в базе при «Сохранить», а не
  // сразу — до нажатия человек может передумать и закрыть диалог.
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [activeIndex, setActiveIndex] = useState(() => {
    const index = props.dayEntries.findIndex((entry) => entry.id === props.focusEntryId);
    return index >= 0 ? index : 0;
  });

  const data = tabs[activeIndex]?.data ?? tabs[0]?.data ?? blankEntry("");

  /** Правит активную вкладку. Сигнатура прежняя — форма ниже не менялась. */
  function setData(
    updater: FryerOilEntryData | ((current: FryerOilEntryData) => FryerOilEntryData)
  ) {
    setTabs((current) =>
      current.map((tab, index) =>
        index === activeIndex
          ? {
              ...tab,
              data:
                typeof updater === "function"
                  ? (updater as (c: FryerOilEntryData) => FryerOilEntryData)(tab.data)
                  : updater,
            }
          : tab
      )
    );
  }

  /** Названия фритюрниц, уже занятые в этом дне. */
  const usedEquipment = new Set(
    tabs.map((tab) => tab.data.equipmentType).filter(Boolean)
  );
  /** Позиции справочника, которых в этом дне ещё нет. */
  const freeEquipment = props.lists.equipmentTypes.filter(
    (name) => !usedEquipment.has(name)
  );

  function addEntry() {
    setTabs((current) => [
      ...current,
      { key: nextKey(), data: blankEntry(freeEquipment[0] ?? "", data) },
    ]);
    setActiveIndex(tabs.length);
  }

  /**
   * Все фритюрницы из справочника разом.
   *
   * На сотне единиц нажимать «Ещё фритюрница» сто раз — не работа.
   * Справочник заполняется один раз в «Редактировать списки» (там же
   * импорт из Excel), а здесь разворачивается в строки одним кликом.
   */
  function addAllFromList() {
    if (freeEquipment.length === 0) return;
    setTabs((current) => [
      ...current,
      ...freeEquipment.map((name) => ({
        key: nextKey(),
        data: blankEntry(name, data),
      })),
    ]);
    setActiveIndex(tabs.length);
  }

  async function removeEntry(index: number) {
    const tab = tabs[index];
    if (!tab) return;
    if (tab.id) {
      const confirmed = await confirmAsync({
        title: "Убрать фритюрницу из этого дня?",
        description: "Строка журнала будет удалена, когда вы нажмёте «Сохранить».",
        variant: "danger",
        confirmLabel: "Убрать",
        bullets: [
          {
            label: tab.data.equipmentType
              ? `Оборудование: ${tab.data.equipmentType}`
              : "Оборудование не указано",
            tone: "info",
          },
          { label: "Закрыть диалог без сохранения — строка останется", tone: "default" },
        ],
      });
      if (!confirmed) return;
      setRemovedIds((current) => [...current, tab.id as string]);
    }
    const next = tabs.filter((_, i) => i !== index);
    setTabs(next);
    // Курсор остаётся на той же фритюрнице: сдвигаем, только если убрали
    // вкладку левее. Раньше уходили на шаг назад всегда — удалив третью,
    // человек оказывался на первой.
    setActiveIndex(
      Math.min(activeIndex > index ? activeIndex - 1 : activeIndex, next.length - 1)
    );
  }

  /**
   * Дата у всех вкладок одна: один заход в диалог = один день журнала.
   * Иначе, поправив дату на первой вкладке, человек молча получал бы
   * строки за разные дни. Время начала и окончания у каждой фритюрницы
   * своё — оно строки и различает.
   */
  function setStartDateForAll(value: string) {
    setTabs((current) =>
      current.map((tab) => ({ ...tab, data: { ...tab.data, startDate: value } }))
    );
  }

  const selectedProducts = splitProducts(data.productType);

  /** Клик по позиции добавляет её в ячейку или убирает оттуда. */
  function toggleProduct(value: string) {
    setData((current) => {
      const chosen = splitProducts(current.productType);
      const next = chosen.includes(value)
        ? chosen.filter((item) => item !== value)
        : [...chosen, value];
      return { ...current, productType: next.join(", ") };
    });
  }
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await props.onSave({
        updates: tabs
          .filter((tab) => tab.id)
          .map((tab) => ({ id: tab.id as string, data: tab.data })),
        creates: tabs.filter((tab) => !tab.id).map((tab) => tab.data),
        removedIds,
      });
      // Окно закрывает родитель (saveDay): очередь правок может открыть
      // следующий день.
    } catch (error) {
      // Диалог не закрываем: заполненные вкладки должны остаться перед
      // глазами, чтобы человек мог дожать сохранение, а не набирать заново.
      toast.error(
        humanizeFetchError(error, "Не удалось сохранить записи")
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className={JOURNAL_DIALOG_CONTENT_WIDE_CLASS}>
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>
            Записи за {formatDateRu(data.startDate) || "новый день"}
            {tabs.length > 1 ? ` · фритюрниц: ${tabs.length}` : ""}
            {props.titleSuffix ? ` ${props.titleSuffix}` : ""}
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[calc(92vh-160px)] space-y-5 overflow-y-auto px-6 py-5">
          {/* Вкладки фритюрниц — всегда, а не только при создании.
              В заведении их бывает хоть сто, у каждой свой жир, время и
              оценка, а день один: каждая вкладка станет отдельной строкой
              бланка с этой же датой. */}
          <div className="border-b border-[#eef0f6] pb-3">
            <div className="flex max-h-[104px] flex-wrap items-center gap-2 overflow-y-auto">
              {tabs.map((tab, index) => (
                <span key={tab.key} className="inline-flex items-center">
                  <button
                    type="button"
                    onClick={() => setActiveIndex(index)}
                    className={cn(
                      "h-9 max-w-[220px] truncate rounded-xl px-3 text-[13.5px] transition-colors",
                      index === activeIndex
                        ? "bg-[#eef1ff] font-medium text-[#3848c7]"
                        : "text-[#6f7282] hover:bg-[#f5f6ff]"
                    )}
                  >
                    №{index + 1}
                    {tab.data.equipmentType ? ` · ${tab.data.equipmentType}` : ""}
                  </button>
                  {tabs.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => void removeEntry(index)}
                      aria-label="Убрать эту фритюрницу"
                      className="ml-0.5 rounded-lg p-1 text-[#9b9fb3] transition-colors hover:text-[#a13a32]"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  ) : null}
                </span>
              ))}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={addEntry}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-dashed border-[#dcdfed] px-3 text-[13px] font-medium text-[#5566f6] transition-colors hover:bg-[#f5f6ff]"
              >
                <Plus className="size-4" />
                Ещё фритюрница
              </button>
              {freeEquipment.length > 0 ? (
                <button
                  type="button"
                  onClick={addAllFromList}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-dashed border-[#dcdfed] px-3 text-[13px] font-medium text-[#5566f6] transition-colors hover:bg-[#f5f6ff]"
                >
                  <ListPlus className="size-4" />
                  Все из списка ({freeEquipment.length})
                </button>
              ) : null}
              {removedIds.length > 0 ? (
                <span className="text-[12px] text-[#a13a32]">
                  будет удалено строк: {removedIds.length}
                </span>
              ) : null}
            </div>

            <p className="mt-2 text-[12px] leading-snug text-[#6f7282]">
              Каждая вкладка — отдельная строка журнала за этот день.
              Список фритюрниц пополняется в «Редактировать списки».
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">
              Дата и время начала
              {tabs.length > 1 ? (
                <span className="ml-2 font-normal text-[#6f7282]">
                  дата общая для всех фритюрниц
                </span>
              ) : null}
            </Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.4fr_1.6fr]">
              <Input type="date" value={data.startDate} onChange={(e) => setStartDateForAll(e.target.value)} className="h-10 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]" />
              <TimeField
                value={joinTimeValue(data.startHour, data.startMinute)}
                onChange={(next) => {
                  const { hour, minute } = splitTimeValue(next);
                  setData((d) => ({
                    ...d,
                    startHour: hour === "" ? null : Number(hour),
                    startMinute: minute === "" ? null : Number(minute),
                  }));
                }}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">Вид фритюрного жира</Label>
            <Select value={toNone(data.fatType)} onValueChange={(value) => setData((d) => ({ ...d, fatType: fromNone(value) }))}>
              <SelectTrigger className={SELECT_TRIGGER_CLASS}><SelectValue placeholder="— выберите —" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>— выберите —</SelectItem>
                {props.lists.fatTypes.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">Качество на начало</Label>
            <Select value={data.qualityStart === null ? "" : String(data.qualityStart)} onValueChange={(value) => setData((d) => ({ ...d, qualityStart: Number(value) }))}>
              <SelectTrigger className={SELECT_TRIGGER_CLASS}><SelectValue placeholder="— выберите —" /></SelectTrigger>
              <SelectContent>
                {QUALITY_OPTIONS.map((v) => <SelectItem key={v} value={String(v)}>{v} - {QUALITY_LABELS[v]}</SelectItem>)}
              </SelectContent>
            </Select>
            {/* Оценка словами. Балл 1–5 остаётся — он нужен методике из
                приложения к журналу, — но в графу бланка идёт именно
                формулировка: её и читает проверяющий. Фразы готовые,
                чтобы повар не сочинял их сам. */}
            <div className="flex flex-wrap gap-1.5">
              {DEFAULT_QUALITY_PHRASES.map((phrase) => (
                <button
                  key={phrase}
                  type="button"
                  onClick={() =>
                    setData((d) => ({ ...d, qualityStartNote: phrase }))
                  }
                  className={cn(
                    "h-8 rounded-full border px-3 text-[12.5px] transition-colors",
                    data.qualityStartNote === phrase
                      ? "border-[#5566f6] bg-[#5566f6] text-white"
                      : "border-[#dcdfed] bg-white text-[#3c4053] hover:bg-[#f5f6ff]"
                  )}
                >
                  {phrase}
                </button>
              ))}
            </div>
            <Input
              value={data.qualityStartNote ?? ""}
              onChange={(event) =>
                setData((d) => ({ ...d, qualityStartNote: event.target.value }))
              }
              placeholder="Или своя формулировка"
              className="h-10 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">Тип жарочного оборудования</Label>
              <Select value={toNone(data.equipmentType)} onValueChange={(value) => setData((d) => ({ ...d, equipmentType: fromNone(value) }))}>
                <SelectTrigger className={SELECT_TRIGGER_CLASS}><SelectValue placeholder="— выберите —" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>— выберите —</SelectItem>
                  {props.lists.equipmentTypes.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">
                Вид продукции
              </Label>
              {/* Отмечаем несколько позиций — они склеиваются через запятую
                  в ОДНУ ячейку. Одна строка журнала = один день работы
                  фритюра, а оценка ставится маслу в целом, сколько бы
                  разных продуктов в нём ни жарили: заводить строку на
                  каждое блюдо неправильно и по смыслу, и по бланку. */}
              <div className="flex flex-wrap gap-1.5">
                {props.lists.productTypes.map((value) => {
                  const chosen = selectedProducts.includes(value);
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => toggleProduct(value)}
                      className={cn(
                        "h-8 rounded-full border px-3 text-[13px] transition-colors",
                        chosen
                          ? "border-[#5566f6] bg-[#5566f6] text-white"
                          : "border-[#dcdfed] bg-white text-[#3c4053] hover:bg-[#f5f6ff]"
                      )}
                    >
                      {value}
                    </button>
                  );
                })}
              </div>
              <Input
                value={data.productType}
                onChange={(event) =>
                  setData((d) => ({ ...d, productType: event.target.value }))
                }
                placeholder="Или впишите своё — через запятую"
                className="h-10 rounded-xl text-[13.5px]"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">Время окончания</Label>
            <div className="grid grid-cols-2 gap-2">
              <TimeField
                value={joinTimeValue(data.endHour, data.endMinute)}
                onChange={(next) => {
                  const { hour, minute } = splitTimeValue(next);
                  setData((d) => ({
                    ...d,
                    endHour: hour === "" ? null : Number(hour),
                    endMinute: minute === "" ? null : Number(minute),
                  }));
                }}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">Качество на конец</Label>
            <Select value={data.qualityEnd === null ? "" : String(data.qualityEnd)} onValueChange={(value) => setData((d) => ({ ...d, qualityEnd: Number(value) }))}>
              <SelectTrigger className={SELECT_TRIGGER_CLASS}><SelectValue placeholder="— выберите —" /></SelectTrigger>
              <SelectContent>
                {QUALITY_OPTIONS.map((v) => <SelectItem key={v} value={String(v)}>{v} - {QUALITY_LABELS[v]}</SelectItem>)}
              </SelectContent>
            </Select>
            {/* Оценка словами. Балл 1–5 остаётся — он нужен методике из
                приложения к журналу, — но в графу бланка идёт именно
                формулировка: её и читает проверяющий. Фразы готовые,
                чтобы повар не сочинял их сам. */}
            <div className="flex flex-wrap gap-1.5">
              {DEFAULT_QUALITY_PHRASES.map((phrase) => (
                <button
                  key={phrase}
                  type="button"
                  onClick={() =>
                    setData((d) => ({ ...d, qualityEndNote: phrase }))
                  }
                  className={cn(
                    "h-8 rounded-full border px-3 text-[12.5px] transition-colors",
                    data.qualityEndNote === phrase
                      ? "border-[#5566f6] bg-[#5566f6] text-white"
                      : "border-[#dcdfed] bg-white text-[#3c4053] hover:bg-[#f5f6ff]"
                  )}
                >
                  {phrase}
                </button>
              ))}
            </div>
            <Input
              value={data.qualityEndNote ?? ""}
              onChange={(event) =>
                setData((d) => ({ ...d, qualityEndNote: event.target.value }))
              }
              placeholder="Или своя формулировка"
              className="h-10 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">Переходящий остаток, кг</Label>
              <Input type="number" min="0" step="0.01" value={String(data.carryoverKg)} onChange={(e) => setData((d) => ({ ...d, carryoverKg: Number(e.target.value) || 0 }))} className="h-10 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]" />
            </div>
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">Утилизированный, кг</Label>
              <Input type="number" min="0" step="0.01" value={String(data.disposedKg)} onChange={(e) => setData((d) => ({ ...d, disposedKg: Number(e.target.value) || 0 }))} className="h-10 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]" />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-[#3c4053]">Должность, ФИО контролера</Label>
            <Input value={data.controllerName} onChange={(e) => setData((d) => ({ ...d, controllerName: e.target.value }))} className="h-10 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]" />
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t bg-white px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-[12.5px] text-[#6f7282]">
            {tabs.length > 1 ? `Строк за день: ${tabs.length}` : null}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="h-9 w-full rounded-xl border-[#dcdfed] px-5 text-[14px] font-medium text-[#0b1024] shadow-none hover:bg-[#fafbff] sm:w-auto"
              onClick={() => props.onOpenChange(false)}
            >
              Отмена
            </Button>
            <Button
              type="button"
              disabled={busy}
              className="h-10 w-full rounded-xl bg-[#5566f6] px-5 text-[14px] font-medium text-white hover:bg-[#4a5bf0] sm:w-auto"
              onClick={() => { void save(); }}
            >
              {busy ? "Сохранение..." : "Сохранить"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ListsDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; lists: FryerOilSelectLists; onSave: (lists: FryerOilSelectLists) => Promise<void> }) {
  const [lists, setLists] = useState(props.lists);
  const [isSaving, setIsSaving] = useState(false);
  // «Из справочника организации»: жиры — это продукты со склада, виды
  // продукции — наименования из журналов. Оборудование своего справочника
  // не имеет, поэтому кнопки там нет.
  const [directoryKey, setDirectoryKey] = useState<keyof FryerOilSelectLists | null>(null);
  const DIRECTORY_KIND: Partial<Record<keyof FryerOilSelectLists, OrgDirectoryKind>> = {
    fatTypes: "product",
    productTypes: "dish",
  };
  const tabs: Array<[keyof FryerOilSelectLists, string]> = [["fatTypes", "Вид жира"], ["equipmentTypes", "Оборудование"], ["productTypes", "Вид продукции"]];

  /**
   * Читаем первый столбец первого листа. Формат намеренно самый простой:
   * заведение выгружает список из своей учётной системы, а не подгоняет
   * его под нашу структуру.
   */
  async function importList(key: keyof FryerOilSelectLists, file: File) {
    try {
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const book = XLSX.read(buffer, { type: "array" });
      const sheet = book.Sheets[book.SheetNames[0]];
      if (!sheet) throw new Error("В файле нет ни одного листа");

      const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
      const values = rows
        .map((row) => String(row?.[0] ?? "").trim())
        .filter(Boolean);

      if (values.length === 0) {
        toast.error("В первом столбце файла ничего не нашлось");
        return;
      }

      // Дубликаты убираем: список выгружают повторно, и без этого он
      // после второго импорта удваивается.
      setLists((current) => ({
        ...current,
        [key]: Array.from(
          new Set([...current[key].filter(Boolean), ...values]),
        ),
      }));
      toast.success(`Добавлено позиций: ${values.length}`);
    } catch (error) {
      toast.error(
        humanizeFetchError(error, "Не удалось прочитать файл"),
      );
    }
  }

  /** Пример файла — ровно того формата, который ждёт импорт. */
  async function downloadExample(key: keyof FryerOilSelectLists) {
    const XLSX = await import("xlsx");
    const sample = lists[key].filter(Boolean).slice(0, 5);
    const rows = (sample.length > 0
      ? sample
      : ["Первая позиция", "Вторая позиция", "Третья позиция"]
    ).map((value) => [value]);

    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "Список");
    XLSX.writeFile(book, "wesetup-пример-списка.xlsx");
  }
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className={JOURNAL_DIALOG_CONTENT_CLASS}>
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>Редактировать списки</DialogTitle>
        </DialogHeader>
        <OrgDirectoryDialog
          open={directoryKey !== null}
          onClose={() => setDirectoryKey(null)}
          kind={directoryKey ? DIRECTORY_KIND[directoryKey] ?? "product" : "product"}
          existing={directoryKey ? lists[directoryKey] : []}
          onAdd={(items) => {
            const key = directoryKey;
            if (!key) return;
            setLists((value) => ({ ...value, [key]: mergeIntoList(value[key], items) }));
          }}
        />

        <div className="px-7 py-6">
          <Tabs defaultValue="fatTypes">
            <TabsList className="mb-5 w-full">{tabs.map(([key, label]) => <TabsTrigger key={key} value={key} className="flex-1">{label}</TabsTrigger>)}</TabsList>
            {tabs.map(([key]) => (
              <TabsContent key={key} value={key} className="space-y-2">
                {lists[key].map((item, index) => (
                  <div key={`${key}:${index}`} className="flex items-center gap-2">
                    <Input value={item} onChange={(e) => setLists((v) => ({ ...v, [key]: v[key].map((x, i) => i === index ? e.target.value : x) }))} className="h-10 rounded-xl" />
                    <Button type="button" variant="outline" className="h-10 rounded-xl border-[#ffd7d3] text-[#ff3b30]" onClick={() => setLists((v) => ({ ...v, [key]: v[key].filter((_, i) => i !== index) }))}><Trash2 className="size-4" /></Button>
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" className="h-10 rounded-xl" onClick={() => setLists((v) => ({ ...v, [key]: [...v[key], ""] }))}><Plus className="size-4" />Добавить</Button>
                  {DIRECTORY_KIND[key] ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 rounded-xl"
                      onClick={() => setDirectoryKey(key)}
                      title="Добавить позиции из общего справочника организации"
                    >
                      <Database className="size-4" />
                      Из справочника организации
                    </Button>
                  ) : null}
                </div>

                {/* Импорт списком. Пример файла даём ВСЕГДА: без него
                    человек не угадает, что нужен один столбец без
                    заголовка, и получит список из мусора. */}
                <div className="mt-4 rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] p-4">
                  <div className="text-[13px] font-medium text-[#0b1024]">
                    Загрузить списком
                  </div>
                  <p className="mt-1 text-[12.5px] leading-snug text-[#6f7282]">
                    Файл Excel или CSV: один столбец, по строке на позицию,
                    без заголовка. Загруженное добавится к текущему списку.
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]">
                      <Upload className="size-4 text-[#5566f6]" />
                      Выбрать файл
                      <input
                        type="file"
                        accept=".xlsx,.xls,.csv"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void importList(key, file);
                          event.target.value = "";
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => downloadExample(key)}
                      className="inline-flex h-9 items-center gap-2 rounded-xl px-3 text-[13px] font-medium text-[#5566f6] transition-colors hover:bg-[#f5f6ff]"
                    >
                      <Download className="size-4" />
                      Скачать пример
                    </button>
                  </div>
                </div>
              </TabsContent>
            ))}
          </Tabs>
          {/* Раньше окно закрывалось сразу, не дожидаясь ответа сервера, —
              при отказе пользователь видел «сохранено», а списки терялись. */}
          <div className="mt-6 flex justify-end"><Button type="button" disabled={isSaving} className="h-11 gap-2 rounded-lg bg-[#5566f6] px-5 text-[15px] font-semibold text-white transition-colors duration-150 hover:bg-[#4a5bf0]" onClick={async () => {
            setIsSaving(true);
            try {
              await props.onSave(lists);
              props.onOpenChange(false);
            } catch (error) {
              toast.error(humanizeFetchError(error, "Не удалось сохранить списки"));
            } finally {
              setIsSaving(false);
            }
          }}>{isSaving ? "Сохранение..." : "Сохранить"}</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SettingsDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; title: string; dateFrom: string; status: "active" | "closed"; shift: FryerOilShift; onSave: (v: { title: string; dateFrom: string; status: "active" | "closed"; shift: FryerOilShift }) => Promise<void>; useV2?: boolean }) {
  const [title, setTitle] = useState(props.title);
  const [dateFrom, setDateFrom] = useState(props.dateFrom);
  const [status, setStatus] = useState<"active" | "closed">(props.status);
  const [shift, setShift] = useState<FryerOilShift>(props.shift);
  const [isSaving, setIsSaving] = useState(false);

  // Окно закрывалось, не дожидаясь ответа сервера: при отказе на экране
  // было «сохранено», а настройки не применялись.
  async function submit() {
    setIsSaving(true);
    try {
      await props.onSave({ title, dateFrom, status, shift });
      props.onOpenChange(false);
    } catch (error) {
      toast.error(
        humanizeFetchError(error, "Не удалось сохранить настройки")
      );
    } finally {
      setIsSaving(false);
    }
  }

  if (props.useV2) {
    return (
      <JournalSettingsModal
        open={props.open}
        onOpenChange={props.onOpenChange}
        title="Настройки документа"
        description="Название документа, дата начала и статус."
        size="md"
        isSaving={isSaving}
        onSave={submit}
        onCancel={() => props.onOpenChange(false)}
      >
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            Название документа
          </Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
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
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            Статус документа
          </Label>
          <Select value={status} onValueChange={(v: "active" | "closed") => setStatus(v)}>
            <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-white text-[13.5px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Активный</SelectItem>
              <SelectItem value="closed">Закрытый</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {/* Часы смены. Из них форма берёт время начала и окончания по
            умолчанию — повар не набивает их на каждой строке. Значения
            остаются в полях и правятся, если день выдался другой. */}
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            Часы смены
          </Label>
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="time"
              value={shift.startTime}
              onChange={(e) => setShift((v) => ({ ...v, startTime: e.target.value }))}
              className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
            />
            <Input
              type="time"
              value={shift.endTime}
              onChange={(e) => setShift((v) => ({ ...v, endTime: e.target.value }))}
              className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
            />
          </div>
          <p className="text-[12px] leading-snug text-[#6f7282]">
            Подставляются в новую строку как время начала и окончания жарки.
          </p>
        </div>
      </JournalSettingsModal>
    );
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className={JOURNAL_DIALOG_CONTENT_CLASS}>
        <DialogHeader className={JOURNAL_DIALOG_HEADER_CLASS}>
          <DialogTitle className={JOURNAL_DIALOG_TITLE_CLASS}>Настройки документа</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 px-7 py-6">
          <div className="space-y-1"><Label>Название документа</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-10 rounded-xl" /></div>
          <div className="space-y-1"><Label>Дата начала</Label><Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-10 rounded-xl" /></div>
          <div className="space-y-1"><Label>Статус документа</Label><Select value={status} onValueChange={(v: "active" | "closed") => setStatus(v)}><SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Активный</SelectItem><SelectItem value="closed">Закрытый</SelectItem></SelectContent></Select></div>
          <div className="space-y-1"><Label>Часы смены</Label><div className="grid grid-cols-2 gap-2"><Input type="time" value={shift.startTime} onChange={(e) => setShift((v) => ({ ...v, startTime: e.target.value }))} className="h-10 rounded-xl" /><Input type="time" value={shift.endTime} onChange={(e) => setShift((v) => ({ ...v, endTime: e.target.value }))} className="h-10 rounded-xl" /></div><p className="text-[12px] text-[#6f7282]">Подставляются в новую строку как время начала и окончания жарки.</p></div>
          <div className="flex justify-end"><Button type="button" disabled={isSaving} className="h-11 gap-2 rounded-lg bg-[#5566f6] px-5 text-[15px] font-semibold text-white transition-colors duration-150 hover:bg-[#4a5bf0]" onClick={() => void submit()}>{isSaving ? "Сохранение..." : "Сохранить"}</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Y4: эталон (fryer_oil-2-doc.png) красит подписи ЛЕВОЙ колонки приложения
 * и блок «Пример расчета среднего балла» в тёмно-бордовый. На бумаге
 * инспектору цвет не нужен — `print:text-black` сохраняет прежний бланк.
 */
const APPENDIX_LABEL_CLASS = "text-[#7b2d26] print:text-black";

function Appendix() {
  return (
    <div className="space-y-5 pt-8">
      {/*
        Y4: заголовок приложения — ПОЛУЖИРНЫЙ и выровнен по левому краю
        таблиц приложения (обе таблицы `w-full` внутри того же блока, так
        что выравнивание даёт сам поток; отдельных отступов не добавляем).
      */}
      <div className="text-[13.5px] font-bold">Приложение. Методика определения качества фритюрного жира.</div>
      {/*
        Эталон (fryer_oil-grid.png): над четырьмя колонками оценок стоит одна
        объединяющая ячейка «Оценка», подписи оценок — строчными буквами,
        всё содержимое таблицы центрировано, первый столбец несёт полные
        формулировки показателей с условиями замера.
      */}
      {/* Приложение с оценками качества — пять колонок на 390px
          налезали друг на друга («удовлетворительно» поверх
          «неудовлетворительно»). Даём таблице свою минимальную
          ширину и скроллер, как у самого бланка. */}
      <div className={GRID_VIEWPORT_CLASS}>
      <table className="w-full min-w-[560px] table-fixed border-collapse text-[13px]"><colgroup><col className="w-[18%]" /><col className="w-[16%]" /><col className="w-[22%]" /><col className="w-[22%]" /><col className="w-[22%]" /></colgroup><thead><tr><th rowSpan={2} className={`${GRID_HEAD_CELL_CLASS} ${APPENDIX_LABEL_CLASS} px-3 py-1.5 text-center align-middle leading-tight`}>Показатели качества</th><th colSpan={4} className={`${GRID_HEAD_CELL_CLASS} px-3 py-1.5 text-center leading-tight`}>Оценка</th></tr><tr><th className={`${GRID_HEAD_CELL_CLASS} px-3 py-1.5 text-center font-normal leading-tight`}>отлично</th><th className={`${GRID_HEAD_CELL_CLASS} px-3 py-1.5 text-center font-normal leading-tight`}>хорошо</th><th className={`${GRID_HEAD_CELL_CLASS} px-3 py-1.5 text-center font-normal leading-tight`}>удовлетворительно</th><th className={`${GRID_HEAD_CELL_CLASS} px-3 py-1.5 text-center font-normal leading-tight`}>неудовлетворительно</th></tr></thead><tbody>{QUALITY_ASSESSMENT_TABLE.indicators.map((x) => <tr key={x.name}><td className={`${GRID_CELL_CLASS} ${APPENDIX_LABEL_CLASS} px-3 py-1 text-center align-middle leading-tight`}>{x.name}</td><td className={`${GRID_CELL_CLASS} px-3 py-1 text-center align-middle leading-tight`}>{x.scores[5]}</td><td className={`${GRID_CELL_CLASS} px-3 py-1 text-center align-middle leading-tight`}>{x.scores[4]}</td><td className={`${GRID_CELL_CLASS} px-3 py-1 text-center align-middle leading-tight`}>{x.scores[3]}</td><td className={`${GRID_CELL_CLASS} px-3 py-1 text-center align-middle leading-tight`}>{x.scores[2]}</td></tr>)}</tbody></table>
      </div>
      <table className="w-full table-fixed border-collapse text-[13px]"><colgroup><col className="w-1/2" /><col className="w-1/2" /></colgroup><thead><tr><th className={`${GRID_HEAD_CELL_CLASS} px-3 py-1.5 leading-tight`}>Качество фритюра</th><th className={`${GRID_HEAD_CELL_CLASS} px-3 py-1.5 leading-tight`}>Бальная оценка</th></tr></thead><tbody>{QUALITY_ASSESSMENT_TABLE.gradingTable.map((x) => <tr key={`${x.label}-${x.score}`}><td className={`${GRID_CELL_CLASS} px-3 py-1 text-center leading-tight`}>{x.label}</td><td className={`${GRID_CELL_CLASS} px-3 py-1 text-center leading-tight`}>{x.score}</td></tr>)}</tbody></table>
      {/*
        Y3: эталон печатает пример расчёта МНОГОСТРОЧНО — сама формула
        отдельной строкой, затем расшифровка числителя и знаменателя.
        Раньше всё схлопывалось в одну строку и терялась расшифровка.
      */}
      <div className={`${APPENDIX_LABEL_CLASS} text-[13px] leading-[1.55]`}>
        <div>Пример расчета среднего балла:</div>
        <div>{QUALITY_ASSESSMENT_TABLE.formulaExample}</div>
        {QUALITY_ASSESSMENT_TABLE.formulaExplanation.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>
    </div>
  );
}

export function FryerOilDocumentClient(props: Props) {
  const router = useRouter();
  const [entries, setEntries] = useState<EntryItem[]>(() => sortEntries(props.initialEntries));
  const [config, setConfig] = useState(props.config);
  const [title, setTitle] = useState(props.title);
  const [dateFrom, setDateFrom] = useState(props.dateFrom);
  const [status, setStatus] = useState<"active" | "closed">(props.status === "closed" ? "closed" : "active");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [entryOpen, setEntryOpen] = useState(false);
  // Диалог открывается на весь день: строки этого дня и та, по которой
  // кликнули. `dialogSeq` — ключ, чтобы состояние вкладок сбрасывалось
  // при переходе между днями.
  const [dayEntries, setDayEntries] = useState<EntryItem[]>([]);
  const [focusEntryId, setFocusEntryId] = useState<string | null>(null);
  const [dialogSeq, setDialogSeq] = useState(0);
  const [listsOpen, setListsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const isActive = status === "active";
  // История отмены: только правки этого человека в этой вкладке.
  const undoStack = useJournalUndo({ enabled: status === "active" });
  const closeAction = useDocumentCloseAction({ documentId: props.documentId, title });
  const { mobileView, switchMobileView } = useMobileView("fryer_oil");

  const cardItems: RecordCardItem[] = entries.map((entry, index) => ({
    id: entry.id,
    title: `№${index + 1} · ${formatDateRu(entry.data.startDate || entry.date)} ${formatTime(
      entry.data.startHour,
      entry.data.startMinute
    )}`,
    subtitle: entry.data.fatType || undefined,
    leading: isActive ? (
      <Checkbox
        checked={selectedIds.includes(entry.id)}
        onCheckedChange={() =>
          setSelectedIds((v) =>
            v.includes(entry.id) ? v.filter((x) => x !== entry.id) : [...v, entry.id]
          )
        }
        className="size-5"
      />
    ) : null,
    fields: [
      {
        label: "Оценка на начало",
        value: formatQualityLabel(entry.data.qualityStart),
        hideIfEmpty: true,
      },
      { label: "Оборудование", value: entry.data.equipmentType, hideIfEmpty: true },
      { label: "Продукция", value: entry.data.productType, hideIfEmpty: true },
      {
        label: "Окончание жарки",
        value: formatTime(entry.data.endHour, entry.data.endMinute),
      },
      {
        label: "Оценка по окончании",
        value: formatQualityLabel(entry.data.qualityEnd),
        hideIfEmpty: true,
      },
      {
        label: "Переходящий остаток",
        value: entry.data.carryoverKg > 0 ? `${entry.data.carryoverKg} кг` : "",
        hideIfEmpty: true,
      },
      {
        label: "Утилизировано",
        value: entry.data.disposedKg > 0 ? `${entry.data.disposedKg} кг` : "",
        hideIfEmpty: true,
      },
      { label: "Контролер", value: entry.data.controllerName, hideIfEmpty: true },
    ],
    onClick: isActive
      ? () => {
          openDay(entry);
        }
      : undefined,
    actions: isActive ? (
      <button
        type="button"
        onClick={() => {
          openDay(entry);
        }}
        className="inline-flex h-10 items-center justify-center rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white hover:bg-[#4a5bf0]"
      >
        Редактировать
      </button>
    ) : null,
  }));

  /** Правка выделенных записей по очереди — окном дня каждой из них. */
  const seq = useSequentialEdit({
    open: (id) => {
      const entry = entries.find((item) => item.id === id);
      if (!entry || !isActive) return false;
      openDay(entry);
      return true;
    },
    close: () => {
      setEntryOpen(false);
      setDayEntries([]);
      setFocusEntryId(null);
    },
  });

  /**
   * Открыть день. Кликнули по строке — показываем все строки её дня;
   * нажали «Добавить» — заводим день с нуля.
   */
  function openDay(entry: EntryItem | null) {
    if (entry) {
      const key = fryerOilDayKey(entry);
      setDayEntries(entries.filter((item) => fryerOilDayKey(item) === key));
      setFocusEntryId(entry.id);
    } else {
      setDayEntries([]);
      setFocusEntryId(null);
    }
    setDialogSeq((value) => value + 1);
    setEntryOpen(true);
  }

  /**
   * Сохранение дня целиком: правки существующих строк, новые фритюрницы
   * одной пачкой и удаление убранных. Удаляем последними — если создание
   * упадёт, человек не останется с потерянными строками.
   */
  async function saveDay(payload: {
    updates: Array<{ id: string; data: FryerOilEntryData }>;
    creates: FryerOilEntryData[];
    removedIds: string[];
  }) {
    for (const update of payload.updates) {
      await saveEntry(update);
    }
    if (payload.creates.length > 0) {
      await createEntries(payload.creates);
    }
    if (payload.removedIds.length > 0) {
      await deleteEntries(payload.removedIds);
    }
    // Очередь правок откроет следующую запись или закроет окно.
    seq.saved();
  }

  /**
   * Создание нескольких строк одним запросом. Сотня фритюрниц сотней
   * round-trip'ов — это десятки секунд ожидания и полусохранённый день
   * при первом же обрыве связи.
   */
  async function createEntries(items: FryerOilEntryData[]) {
    const response = await fetch(`/api/journal-documents/${props.documentId}/fryer-oil`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) });
    const result = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(result?.entries)) {
      throw new Error(result?.error || "Не удалось сохранить записи");
    }
    const created: EntryItem[] = result.entries.map(
      (entry: { id: string; date: string; data: unknown }) => ({
        id: entry.id,
        date: entry.date,
        data: normalizeFryerOilEntryData(entry.data),
      })
    );
    const createdIds = new Set(created.map((entry) => entry.id));
    setEntries((value) =>
      sortEntries([...value.filter((item) => !createdIds.has(item.id)), ...created])
    );
  }

  /**
   * Запись строки. Отмена (Ctrl+Z) — это повторная запись прежних
   * значений тем же PATCH; создание новой строки в историю не попадает
   * (undo для него означал бы удаление — другое действие).
   *
   * `silent` — вызов из истории: нового шага не кладём.
   */
  async function saveEntry(
    payload: { id?: string; data: FryerOilEntryData },
    options?: { silent?: boolean }
  ) {
    const previousEntry = payload.id
      ? entries.find((item) => item.id === payload.id)
      : undefined;
    const response = await fetch(`/api/journal-documents/${props.documentId}/fryer-oil`, { method: payload.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.entry) throw new Error(result?.error || "Не удалось сохранить запись");
    const next = { id: result.entry.id, date: result.entry.date, data: normalizeFryerOilEntryData(result.entry.data) };
    setEntries((v) => sortEntries([...v.filter((x) => x.id !== next.id), next]));
    if (!options?.silent && previousEntry) {
      undoStack.push({
        undo: () => saveEntry({ id: next.id, data: previousEntry.data }, { silent: true }),
        redo: () => saveEntry({ id: next.id, data: next.data }, { silent: true }),
      });
    }
  }

  async function deleteEntries(ids: string[]) {
    if (ids.length === 0) return;
    const response = await fetch(`/api/journal-documents/${props.documentId}/fryer-oil`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error || "Не удалось удалить записи");
    setEntries((v) => v.filter((x) => !ids.includes(x.id)));
    setSelectedIds((v) => v.filter((x) => !ids.includes(x)));
  }

  /** Удаление выбранных строк — confirm со счётчиком последствий. */
  async function confirmDeleteEntries() {
    if (selectedIds.length === 0) return;
    const fatTypes = Array.from(
      new Set(
        entries
          .filter((entry) => selectedIds.includes(entry.id))
          .map((entry) => entry.data.fatType)
          .filter(Boolean),
      ),
    );
    const confirmed = await confirmAsync({
      title: "Удалить выбранные строки?",
      description: "Записи об использовании фритюрных жиров будут удалены безвозвратно.",
      variant: "danger",
      confirmLabel: "Удалить",
      bullets: [
        { label: `Записей будет удалено: ${selectedIds.length}`, tone: "warn" },
        fatTypes.length > 0
          ? { label: `Виды жира: ${fatTypes.slice(0, 4).join(", ")}`, tone: "info" as const }
          : { label: "У выбранных записей не указан вид жира", tone: "info" as const },
        {
          label: `Останется записей: ${entries.length - selectedIds.length}`,
          tone: "default",
        },
      ],
    });
    if (!confirmed) return;
    await deleteEntries(selectedIds).catch((error) =>
      toast.error(humanizeFetchError(error, "Не удалось удалить записи")),
    );
  }

  // «Сегодня» — после mount (useTodayKey): new Date() в рендере
  // расходился между сервером (UTC) и браузером и врал подсветкой.
  const todayKey = useTodayKey();
  const todayFocusEntryId = entries.find((entry) => entry.data.startDate === todayKey)?.id;

  return (
    <div className="bg-white text-black">
      <FocusTodayScroller
        onCreate={
          isActive
            ? () => {
                openDay(null);
              }
            : undefined
        }
      />
      {/* Q3: верхнего padding'а нет — «крошки → H1» задаёт контейнер раздела. */}
      <div className={`${DOC_BODY_STACK_CLASS} pb-8`}>
        <DocumentActionsBar
          className={DOC_TITLE_ROW_NO_STRIP_CLASS}
          backHref={`/journals/${props.routeCode}`}
          documentId={props.documentId}
          undo={{
            canUndo: undoStack.canUndo,
            canRedo: undoStack.canRedo,
            onUndo: () => void undoStack.undo(),
            onRedo: () => void undoStack.redo(),
            undoCount: undoStack.undoCount,
          }}
          heading={<h1 className={DOC_HEADING_CLASS}>{title}</h1>}
          onSettings={() => setSettingsOpen(true)}
          menuItems={
            isActive
              ? [
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
        />
        {!isActive ? (
          <div className="mb-5">
            <JournalClosedBanner hint="Верните журнал в активные, чтобы снова вносить записи об использовании фритюрных жиров." documentId={props.documentId} />
          </div>
        ) : (
          <div className="mb-4 print:hidden">
            <TodayStripForJournal
              journalCode="fryer_oil"
              todayCount={
                entries.filter((entry) => entry.data.startDate === todayKey)
                  .length
              }
              label="запись о фритюре за сегодня"
            />
          </div>
        )}

        {/* R1: бумажное полотно — во всю ширину контентной колонки. */}

        <div className="mb-4 sm:hidden print:hidden">
          <MobileViewToggle mobileView={mobileView} onChange={switchMobileView} />
        </div>

        <div className={DOC_PAPER_CANVAS_CLASS}>
          <div>
            {isActive ? <div className={DOC_ADD_ROW_CLASS}><Button type="button" className="h-11 gap-2 rounded-lg bg-[#5566f6] px-5 text-[15px] font-semibold text-white hover:bg-[#4a5bf0]" onClick={() => openDay(null)} disabled={props.users.length === 0}><Plus className="size-5" strokeWidth={2.5} />Добавить</Button><Button type="button" variant="outline" className={DOC_SECONDARY_BUTTON_CLASS} onClick={() => setListsOpen(true)}>Редактировать списки</Button></div> : null}
            {isActive ? (
              <JournalSelectionBar
                count={selectedIds.length}
                onClear={() => setSelectedIds([])}
                onDelete={() => void confirmDeleteEntries()}
                hint="Записи о фритюрном жире будут удалены без возможности отмены"
              >
                <SelectionEditButton count={selectedIds.length} disabled={!isActive} onClick={() => seq.start(selectedIds)} />
              </JournalSelectionBar>
            ) : null}
            {mobileView === "cards" ? <RecordCardsView items={cardItems} emptyLabel="Записей нет. Нажмите «Добавить»." /> : null}
            {/* Горизонтальный скролл — ТОЛЬКО у журнальной таблицы.
                Раньше в 1400-px контейнер были завёрнуты и шапка, и
                кнопки, и приложение: чтобы нажать «Добавить», приходилось
                скроллить страницу вбок. `table-fixed` + `colgroup`
                держат 11 колонок в ~1250px (паттерн finished_product). */}
            <MobileViewTableWrapper mobileView={mobileView} className={GRID_VIEWPORT_CLASS}>
            {/* Шапка бланка и таблица — ОДИН лист в одном скроллере и
                одной ширины. Раньше шапка стояла снаружи скроллера с
                фиксированными 240+280px: на телефоне ячейки налезали
                друг на друга («СИСТЕМА ХАССП» поверх «Начат»), а правая
                вертикаль бланка не совпадала с колонками таблицы.
                «Добавить» осталась выше скроллера — до неё по-прежнему
                не нужно листать вбок. */}
            <table className={`${DOC_PAPER_HEADER_CLASS} w-full min-w-[1158px] table-fixed border-collapse text-[13px]`}>
              <tbody>
                <JournalPaperHeaderRows
                  orgName={props.organizationName}
                  title="Журнал учета использования фритюрных жиров"
                  startedAt={dateFrom}
                  // Реальная дата закрытия, иначе конец периода: раньше в
                  // «Окончен» стояла дата НАЧАЛА журнала.
                  finishedAt={
                    isActive ? null : config.finishedAt || props.dateTo || dateFrom
                  }
                  controlPeriodicity={props.controlPeriodicity}
                  orgCellClass="w-[240px]"
                  sideCellClass="w-[280px]"
                />
              </tbody>
            </table>
            <div className={`${DOC_CAPS_TITLE_CLASS} text-center text-[15px] font-bold uppercase`}>Журнал учета использования фритюрных жиров</div>
            {/*
              Подколонки «Переходящий остаток, кг» / «Утилизированный, кг»
              были по 90px: слово «Утилизированный» (≈100px) в 74px контента
              не влезало и вылезало на соседнюю ячейку — в шапке читалось
              «ПереходящийУтилизированный». Колонки расширены до 110px, а
              заголовкам добавлен перенос длинных слов (`break-words`), чтобы
              то же самое не повторилось на «Должность, ФИО контролера».

              Y1: прежняя сумма 1300px не влезала в полотно (~1150px эталона)
              и последняя колонка «Должность, ФИО контролера» обрезалась.
              Ширины пересняты с эталона (fryer_oil-2-doc.png, таблица
              1150px): 28+118+100+178+118+88+96+140+78+78+100 = 1122.
              Скролл при этом остаётся — таблица лежит в GRID_VIEWPORT_CLASS
              (`overflow-x-auto`), он спасает узкие экраны.
            */}
            <table className="w-full min-w-[1158px] table-fixed border-collapse text-[13px]">
              <colgroup>
                {/* Q2-7: `<th>`/`<td>` колонки выделения уже были
                    `print:hidden`, а её `<col>` — нет. При table-fixed
                    ширины сдвигались на одну: первая содержательная
                    колонка печаталась в 28px («Дата, время» по букве в
                    строку), а справа оставалась пустая 100px-полоса. */}
                {isActive ? <col className="w-[28px] print:hidden" /> : null}
                <col className="w-[118px]" />
                <col className="w-[100px]" />
                <col className="w-[178px]" />
                <col className="w-[118px]" />
                <col className="w-[88px]" />
                <col className="w-[96px]" />
                <col className="w-[140px]" />
                {/* R5-11: подколонки группы «Использование оставшегося
                    жира» были по 78px — за вычетом px-2 остаётся 62px
                    контента, а «Переходящий» в шапке занимает ~79px.
                    `break-words` резал его ПОСРЕДИ СЛОВА
                    («Переходящ|ий остаток, кг»). 96px вмещают самое
                    длинное слово подколонки целиком, перенос остаётся
                    только между словами. Итоговая ширина таблицы
                    1122 → 1158, скролл по-прежнему в GRID_VIEWPORT_CLASS. */}
                <col className="w-[96px]" />
                <col className="w-[96px]" />
                <col className="w-[100px]" />
              </colgroup>
              <thead><tr>{isActive ? <th rowSpan={2} className={`${GRID_HEAD_CELL_CLASS} px-0 py-1.5 print:hidden leading-tight`}><Checkbox checked={entries.length > 0 && selectedIds.length === entries.length} onCheckedChange={(checked) => setSelectedIds(checked === true ? entries.map((x) => x.id) : [])} disabled={entries.length === 0} /></th> : null}<th rowSpan={2} className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 leading-tight break-words`}>Дата, время начала использования фритюрного жира</th><th rowSpan={2} className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 leading-tight break-words`}>Вид фритюрного жира</th><th rowSpan={2} className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 leading-tight break-words`}>Органолептическая оценка качества жира на начало жарки</th><th rowSpan={2} className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 leading-tight break-words`}>Тип жарочного оборудования</th><th rowSpan={2} className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 leading-tight break-words`}>Вид продукции</th><th rowSpan={2} className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 leading-tight break-words`}>Время окончания фритюрной жарки</th><th rowSpan={2} className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 leading-tight break-words`}>Органолептическая оценка качества жира по окончании жарки</th><th colSpan={2} className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 leading-tight break-words`}>Использование оставшегося жира</th><th rowSpan={2} className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 leading-tight break-words`}>Должность, ФИО контролера</th></tr><tr><th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 leading-tight break-words`}>Переходящий остаток, кг</th><th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 leading-tight break-words`}>Утилизированный, кг</th></tr></thead>
              <tbody>{entries.length === 0 ? <tr><td colSpan={isActive ? 11 : 10} className={`${GRID_CELL_CLASS} px-6 py-10 text-center text-[#6f7282] leading-tight`}>Нет записей. Нажмите «Добавить», чтобы создать первую запись.</td></tr> : entries.map((entry) => <tr key={entry.id} data-focus-today={entry.id === todayFocusEntryId ? "" : undefined} className={`${selectedIds.includes(entry.id) ? "bg-[#f3f5ff]" : ""} ${isActive ? "cursor-pointer hover:bg-[#f5f6ff]" : ""}`} onClick={() => { if (!isActive) return; openDay(entry); }}>{isActive ? <td className={`${GRID_CELL_CLASS} px-0 py-1 text-center print:hidden leading-tight`} onClick={(e) => e.stopPropagation()}><Checkbox checked={selectedIds.includes(entry.id)} onCheckedChange={() => setSelectedIds((v) => v.includes(entry.id) ? v.filter((x) => x !== entry.id) : [...v, entry.id])} /></td> : null}<td className={`${GRID_CELL_CLASS} px-2 py-1 leading-tight`}><button type="button" className={`flex w-full items-start justify-between gap-3 text-left ${isActive ? "hover:text-[#3848c7]" : ""}`} onClick={(e) => { e.stopPropagation(); if (isActive) openDay(entry) }} disabled={!isActive}>{formatDateRu(entry.data.startDate || entry.date)} {formatTime(entry.data.startHour, entry.data.startMinute)}{isActive ? <Pencil className="mt-0.5 size-4 shrink-0 print:hidden" /> : null}</button></td><td className={`${GRID_CELL_CLASS} px-2 py-1 leading-tight`}>{entry.data.fatType || "-"}</td><td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{entry.data.qualityStartNote || formatQualityLabel(entry.data.qualityStart) || "-"}</td><td className={`${GRID_CELL_CLASS} px-2 py-1 leading-tight`}>{entry.data.equipmentType || "-"}</td><td className={`${GRID_CELL_CLASS} px-2 py-1 leading-tight`}>{entry.data.productType || "-"}</td><td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{formatTime(entry.data.endHour, entry.data.endMinute) || "-"}</td><td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{entry.data.qualityEndNote || formatQualityLabel(entry.data.qualityEnd) || "-"}</td><td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{entry.data.carryoverKg > 0 ? entry.data.carryoverKg : ""}</td><td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{entry.data.disposedKg > 0 ? entry.data.disposedKg : ""}</td><td className={`${GRID_CELL_CLASS} px-2 py-1 leading-tight`}>{entry.data.controllerName || "-"}</td></tr>)}{/* Кликабельная «пустая» строка — то же окно, что и «Добавить» над таблицей. Чекбокс рендерится по тому же условию isActive, что и сам JournalAddRow — считаем его существующим: leading=1. labelSpan=2 — подпись растянута на «Дата, время начала использования» + «Вид фритюрного жира»: вместе они опознают запись (когда и какой жир). Остальные 8 колонок (органолептика на начало/конец, оборудование, продукция, время окончания, переходящий остаток, утилизированный, контролёр) — данные, пустые в новой строке: trailing=8. Сумма 1+2+8=11 — тот же colSpan, что был раньше. */}{isActive ? <JournalAddRow leading={1} labelSpan={2} trailing={8} label="Добавить" onClick={() => openDay(null)} disabled={props.users.length === 0} /> : null}</tbody>
            </table>
            </MobileViewTableWrapper>
            <div className={DOC_EXTRA_BLOCK_CLASS}>
              <Appendix />
            </div>
          </div>
        </div>
      </div>

      <EntryDialog key={dialogSeq} open={entryOpen} onOpenChange={(open) => { if (open) setEntryOpen(true); else seq.cancelled(); }} lists={config.lists} users={props.users} currentUserId={props.currentUserId} shift={config.shift} dayEntries={dayEntries} focusEntryId={focusEntryId} titleSuffix={seq.progress ?? undefined} onSave={saveDay} />
      <ListsDialog key={JSON.stringify(config.lists)} open={listsOpen} onOpenChange={setListsOpen} lists={config.lists} onSave={async (lists) => { const nextConfig = { ...config, lists }; const response = await fetch(`/api/journal-documents/${props.documentId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: nextConfig }) }); const result = await response.json().catch(() => null); if (!response.ok) throw new Error(result?.error || "Не удалось сохранить списки"); setConfig(nextConfig); router.refresh(); }} />
      <SettingsDialog key={`${title}-${dateFrom}-${status}`} open={settingsOpen} onOpenChange={setSettingsOpen} title={title} dateFrom={dateFrom} status={status} shift={config.shift} useV2={props.useV2} onSave={async (v) => { const nextConfig = { ...config, shift: v.shift, finishedAt: v.status === "closed" ? config.finishedAt || new Date().toISOString() : null }; const response = await fetch(`/api/journal-documents/${props.documentId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: v.title, dateFrom: v.dateFrom, status: v.status, config: nextConfig }) }); const result = await response.json().catch(() => null); if (!response.ok) throw new Error(result?.error || "Не удалось сохранить настройки"); setTitle(v.title); setDateFrom(v.dateFrom); setStatus(v.status); setConfig(nextConfig); router.refresh(); }} />
    </div>
  );
}
