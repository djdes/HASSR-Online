"use client";

import { getJournalDocumentPeriodLabel } from "@/lib/journal-document-helpers";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Lock } from "lucide-react";
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
  AddEmployeeDialog,
  StaffJournalAddButton,
  StaffJournalToolbar,
} from "@/components/journals/staff-journal-toolbar";
import {
  DOC_ADD_ROW_CLASS,
  DOC_CAPS_TITLE_CLASS,
  DOC_EXTRA_BLOCK_CLASS,
  DOC_NOTE_TEXT_CLASS,
  DOC_PAPER_CANVAS_CLASS,
  DOC_PAPER_HEADER_CLASS,
} from "@/components/journals/journal-responsive";
import { JournalSelectionBar } from "@/components/journals/journal-selection-bar";
import { JournalClosedBanner } from "@/components/journals/journal-closed-banner";
import { MobileViewToggle } from "@/components/journals/mobile-view-toggle";
import { useMobileView } from "@/lib/use-mobile-view";
import {
  HEALTH_REGISTER_NOTES,
  HEALTH_REGISTER_REMINDER,
  buildDateKeys,
  buildHygieneExampleEmployees,
  formatMonthLabel,
  getDayNumber,
  getHygienePositionLabel,
  getWeekdayShort,
  normalizeHealthEntryData,
  type HealthEntryData,
} from "@/lib/hygiene-document";
import { FocusTodayScroller } from "@/components/journals/focus-today-scroller";
import { TodayProgressStrip } from "@/components/journals/today-progress-strip";

import {
  JournalDocumentTitle,
  JournalPaperHeaderRows,
} from "@/components/journals/journal-document-header";
import { toast } from "sonner";
import {
  GRID_CELL_CLASS,
  GRID_HEAD_CELL_CLASS,
  // Обычный прокручиваемый viewport, а не WIDE: с колонками «Должность» и
  // «Принятые меры» месяц из 30 дней шире экрана 1440px, и при
  // `lg:overflow-visible` правая колонка просто обрезалась краем страницы.
  GRID_VIEWPORT_CLASS,
  getDayColumnBgClass,
  getDayColumnPrintKeepBg,
} from "@/components/journals/journal-grid";
import { JournalAddRow } from "@/components/journals/journal-add-row";
import {
  TableContextMenu,
  type TableContextMenuItem,
} from "@/components/journals/table-context-menu";
import { confirmAsync } from "@/components/ui/confirm-async";
import { promptAsync } from "@/components/ui/prompt-async";
import { PAST_DAY_LOCKED_MESSAGE } from "@/lib/closed-day";
import {
  FOREIGN_ROW_MESSAGE,
  FUTURE_DAY_LOCKED_MESSAGE,
  NOT_TODAY_MESSAGE,
  hasFullDocumentAccess,
} from "@/lib/journal-entry-scope";
import { ORG_NAME_FALLBACK } from "@/lib/journal-constants";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";

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
  responsibleUserId?: string | null;
  status: string;
  autoFill?: boolean;
  employees: { id: string; name: string; role: string }[];
  /**
   * Уволенные / архивные сотрудники, на которых ссылаются записи.
   * ТОЛЬКО для отображения строки в бланке.
   */
  inactiveEmployees?: { id: string; name: string; role: string }[];
  initialEntries: { employeeId: string; date: string; data: HealthEntryData }[];
  printEmptyRows?: number;
  /** Design v2 flag — пробрасывается в StaffJournalToolbar для v2-модалки. */
  useV2?: boolean;
  /**
   * Сегодняшний день (YYYY-MM-DD) с сервера, в зоне организации. Часы
   * планшета на кухне врут чаще, чем сервер.
   */
  todayKey?: string;
  /** Документ ведёт автоматика: прошлые дни закрыты на редактирование. */
  pastDaysLocked?: boolean;
  /**
   * Кто смотрит. Нужен, чтобы гасить чужие строки и не-сегодняшние дни
   * прямо в сетке — теми же правилами, что и сервер.
   */
  viewer?: { id: string; role: string; isRoot: boolean };
};

/**
 * Screen ↔ print duality tokens (тот же приём, что в
 * `cleaning-document-client.tsx` / `hygiene-document-client.tsx`).
 */

const EMPTY_ROWS_OPTIONS = [0, 1, 2, 3, 4, 5, 10, 15, 20];

function HealthCheckbox(props: {
  checked?: boolean;
  disabled?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}) {
  return (
    <Checkbox
      checked={props.checked}
      disabled={props.disabled}
      onCheckedChange={(value) => props.onCheckedChange?.(value === true)}
      className="mx-auto size-4 rounded-[4px] border-[#c8ccda] data-[state=checked]:border-[#5566f6] data-[state=checked]:bg-[#5566f6]"
    />
  );
}

function HealthHeader({
  organizationLabel,
  pageLabel,
  startedAt,
  finishedAt,
  controlPeriodicity,
}: {
  organizationLabel: string;
  pageLabel: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  controlPeriodicity?: string;
}) {
  return (
    <table className="health-header w-full border-collapse text-[13px]">
      <tbody>
        <JournalPaperHeaderRows
          orgName={organizationLabel}
          title="ЖУРНАЛ ЗДОРОВЬЯ"
          pageInfo={pageLabel}
          startedAt={startedAt}
          finishedAt={finishedAt}
          controlPeriodicity={controlPeriodicity}
          orgCellClass="w-[270px]"
          sideCellClass="w-[190px]"
        />
      </tbody>
    </table>
  );
}

function makeCellKey(employeeId: string, dateKey: string) {
  return `${employeeId}:${dateKey}`;
}

function buildEntryMap(entries: Props["initialEntries"]) {
  const result: Record<string, HealthEntryData> = {};
  entries.forEach((entry) => {
    result[makeCellKey(entry.employeeId, entry.date)] = normalizeHealthEntryData(
      entry.data
    );
  });
  return result;
}

/**
 * Меню ячейки дня — тот же приём, что в гигиеническом журнале: одно меню
 * на документ (в сетке 31 день × N сотрудников это тысячи ячеек), правая
 * кнопка на ПК и обычный тап в карточках/на телефоне.
 */
type HealthCellMenu = {
  x: number;
  y: number;
  employeeId: string;
  dateKey: string;
};

async function requestJson(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      (result && typeof result.error === "string" && result.error) ||
        "Операция не выполнена"
    );
  }
  return result;
}

function getHealthMeasures(
  employeeId: string,
  dateKeys: string[],
  entryMap: Record<string, HealthEntryData>
) {
  return dateKeys.flatMap((dateKey) => {
    const measures = entryMap[makeCellKey(employeeId, dateKey)]?.measures?.trim();
    if (!measures) return [];

    return [`${getDayNumber(dateKey)} ${getWeekdayShort(dateKey)}. - ${measures}`];
  });
}

export function HealthDocumentClient(props: Props) {
  const router = useRouter();
  const {
    documentId,
    title,
    organizationName,
    controlPeriodicity = "",
    dateFrom,
    dateTo,
    status,
    autoFill = false,
    employees,
    inactiveEmployees = [],
    initialEntries,
    printEmptyRows = 0,
    useV2 = false,
    // «Сегодня» приходит с сервера в зоне организации: браузер в рендере
    // считать дату не вправе (react-hooks/purity), да и часы планшета на
    // кухне врут чаще сервера.
    todayKey = "",
    pastDaysLocked = false,
    viewer,
  } = props;
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const [emptyRows, setEmptyRows] = useState(String(printEmptyRows));
  const [isDeleting, setIsDeleting] = useState(false);
  const [savingCellKey, setSavingCellKey] = useState<string | null>(null);
  const [cellMenu, setCellMenu] = useState<HealthCellMenu | null>(null);
  const [entryMap, setEntryMap] = useState<Record<string, HealthEntryData>>(() =>
    buildEntryMap(initialEntries)
  );

  useEffect(() => {
    setEntryMap(buildEntryMap(initialEntries));
  }, [initialEntries]);

  const closeCellMenu = useCallback(() => setCellMenu(null), []);
  // Mobile-only view preference: общий хук useMobileView, ключ
  // `journal-mobile-view:health_check`. Desktop и печать всегда рендерят
  // таблицу.
  const { mobileView, switchMobileView } = useMobileView("health_check");
  const [expandedEmployeeId, setExpandedEmployeeId] = useState<string | null>(
    null
  );

  // Миграция со старого ключа "health-mobile-view" (до перехода на общий
  // useMobileView). Читаем один раз: если нового ключа ещё нет, а старый
  // лежит — переносим выбор пользователя и чистим легаси.
  useEffect(() => {
    try {
      if (window.localStorage.getItem("journal-mobile-view:health_check")) return;
      const legacy = window.localStorage.getItem("health-mobile-view");
      if (legacy === "table" || legacy === "cards") switchMobileView(legacy);
      window.localStorage.removeItem("health-mobile-view");
    } catch {
      /* localStorage blocked — остаёмся на дефолте 'cards' */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dateKeys = buildDateKeys(dateFrom, dateTo);
  const includedEmployeeIds = [...new Set(initialEntries.map((entry) => entry.employeeId))];
  // Уволенных ищем ТОЖЕ: иначе их строка исчезала из журнала задним
  // числом вместе со всеми отметками за прошлые месяцы.
  const rosterUsers = [...employees, ...inactiveEmployees].filter((employee) =>
    includedEmployeeIds.includes(employee.id)
  );
  const printableEmployees = buildHygieneExampleEmployees(
    rosterUsers,
    // Ровно сотрудники + запрошенные под печать пустые строки. Прежний
    // «пол» в 5 строк дорисовывал пустую строку-заготовку в конце таблицы,
    // которая ничего не значила.
    Math.max(rosterUsers.length + printEmptyRows, 1)
  );
  const monthLabel = formatMonthLabel(dateFrom, dateTo);
  const organizationLabel = organizationName || ORG_NAME_FALLBACK;
  const documentTitle = title || "Журнал здоровья";

  const selectedCount = selectedEmployeeIds.length;
  const allSelected = rosterUsers.length > 0 && selectedCount === rosterUsers.length;
  const isActive = status === "active";
  // Последняя строка таблицы открывает то же окно, что и «Добавить».
  const [addRowOpen, setAddRowOpen] = useState(false);

  // Полоса «сколько осталось заполнить сегодня»: только реальные строки
  // сотрудников (без пустых строк-заглушек бланка под печать) и только
  // пока сегодняшняя дата попадает в период документа — иначе «сегодня»
  // бессмысленно для документа за прошлый период.
  const todayInPeriod = dateKeys.includes(todayKey);
  const todayProgress = useMemo(() => {
    if (!todayInPeriod) return { filled: 0, total: 0 };
    const realEmployees = printableEmployees.filter((employee) => employee.name);
    // Читаем из initialEntries напрямую (а не из `entryMap` выше) —
    // `entryMap` пересобирается новым объектом на каждый рендер, и
    // react-hooks/exhaustive-deps справедливо ругается на такую
    // зависимость useMemo. `initialEntries` — стабильный проп.
    const signedTodayByEmployee = new Map(
      initialEntries
        .filter((entry) => entry.date === todayKey)
        .map((entry) => [entry.employeeId, normalizeHealthEntryData(entry.data).signed])
    );
    const filled = realEmployees.reduce(
      (count, employee) => count + (signedTodayByEmployee.get(employee.id) ? 1 : 0),
      0
    );
    return { filled, total: realEmployees.length };
  }, [initialEntries, printableEmployees, todayInPeriod, todayKey]);

  // Предупреждение перед «Закончить журнал»: дни периода до сегодня
  // включительно, где нет ни одной подписи — день пропущен целиком.
  const closeWarning = useMemo(() => {
    const filledDates = new Set(
      initialEntries
        .filter((entry) => normalizeHealthEntryData(entry.data).signed)
        .map((entry) => entry.date)
    );
    const missing = dateKeys.filter(
      (dateKey) => dateKey <= todayKey && !filledDates.has(dateKey)
    ).length;
    return missing > 0
      ? `Не заполнено дней: ${missing}. После закрытия дописать их будет нельзя.`
      : undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEntries, dateKeys.join(","), todayKey]);

  /** «Перейти» в полосе прогресса — скролл к сегодняшней колонке дня. */
  function scrollToTodayColumn() {
    document.querySelector("[data-focus-today]")?.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "center",
    });
  }

  function toggleEmployee(employeeId: string, checked: boolean) {
    setSelectedEmployeeIds((current) =>
      checked ? [...new Set([...current, employeeId])] : current.filter((item) => item !== employeeId)
    );
  }

  /**
   * Кто и что вправе править — ровно то же правило, что на сервере
   * (`journal-entry-scope.ts`): руководство и ответственный правят любые
   * строки и дни, рядовой сотрудник — только свою строку и только сегодня.
   */
  const viewerHasFullAccess = viewer
    ? hasFullDocumentAccess({ actor: viewer, responsibleUserId: props.responsibleUserId ?? null })
    : true;

  /** Причина, по которой ячейка закрыта, или null. */
  function cellLockReason(employeeId: string, dateKey: string): string | null {
    if (todayKey !== "" && dateKey > todayKey) return FUTURE_DAY_LOCKED_MESSAGE;
    if (pastDaysLocked && todayKey !== "" && dateKey < todayKey) {
      return PAST_DAY_LOCKED_MESSAGE;
    }
    if (viewerHasFullAccess || !viewer) return null;
    if (employeeId !== viewer.id) return FOREIGN_ROW_MESSAGE;
    if (todayKey !== "" && dateKey !== todayKey) return NOT_TODAY_MESSAGE;
    return null;
  }

  /** Записать ячейку с оптимистичным применением и откатом при ошибке. */
  async function persistEntry(
    employeeId: string,
    dateKey: string,
    nextData: HealthEntryData
  ) {
    const key = makeCellKey(employeeId, dateKey);
    const previous = entryMap[key];
    const isEmpty = !nextData.signed && !nextData.measures;

    setEntryMap((current) => {
      const copy = { ...current };
      if (isEmpty) delete copy[key];
      else copy[key] = nextData;
      return copy;
    });
    setSavingCellKey(key);

    try {
      await requestJson(`/api/journal-documents/${documentId}/entries`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId,
          date: dateKey,
          // Пустой объект сервер отвергает (`data` обязательна), поэтому
          // «очистить» — это явные null'ы, а не отсутствие полей.
          data: {
            signed: nextData.signed ?? null,
            measures: nextData.measures ?? null,
          },
        }),
      });
      router.refresh();
    } catch (error) {
      setEntryMap((current) => {
        const copy = { ...current };
        if (previous) copy[key] = previous;
        else delete copy[key];
        return copy;
      });
      toast.error(humanizeFetchError(error, "Ошибка сохранения"));
    } finally {
      setSavingCellKey((current) => (current === key ? null : current));
    }
  }

  /** Открыть меню ячейки (ПКМ в таблице, обычный тап в карточках). */
  function openCellMenu(
    event: React.MouseEvent,
    employeeId: string,
    dateKey: string,
    interactive: boolean
  ) {
    if (!isActive || !interactive) return;
    const reason = cellLockReason(employeeId, dateKey);
    if (reason) {
      toast.error(reason);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setCellMenu({ x: event.clientX, y: event.clientY, employeeId, dateKey });
  }

  /** Спросить «Принятые меры» и записать их в ту же ячейку. */
  async function editMeasures(menu: HealthCellMenu) {
    const current = normalizeHealthEntryData(
      entryMap[makeCellKey(menu.employeeId, menu.dateKey)]
    );
    const value = await promptAsync({
      title: "Принятые меры",
      description:
        "Что сделали по результатам осмотра: отстранение от работы, направление к врачу и т. п. Пусто — меры не потребовались.",
      label: "Принятые меры",
      defaultValue: current.measures || "",
      confirmLabel: "Сохранить",
    });
    if (value === null) return;
    await persistEntry(menu.employeeId, menu.dateKey, {
      signed: current.signed ?? null,
      measures: value.trim() || null,
    });
  }

  function buildCellMenuItems(menu: HealthCellMenu): TableContextMenuItem[] {
    const current = normalizeHealthEntryData(
      entryMap[makeCellKey(menu.employeeId, menu.dateKey)]
    );

    return [
      {
        key: "signed",
        code: "+",
        label: "Подпись есть",
        active: current.signed === true,
        onSelect: () => {
          void persistEntry(menu.employeeId, menu.dateKey, {
            signed: true,
            measures: current.measures ?? null,
          });
        },
      },
      {
        key: "not-signed",
        code: "—",
        label: "Нет подписи",
        active: current.signed === false,
        onSelect: () => {
          void persistEntry(menu.employeeId, menu.dateKey, {
            signed: false,
            measures: current.measures ?? null,
          });
        },
      },
      {
        key: "measures",
        label: current.measures ? "Изменить принятые меры" : "Принятые меры…",
        separatorBefore: true,
        onSelect: () => {
          void editMeasures(menu);
        },
      },
      {
        key: "clear",
        label: "Очистить",
        danger: true,
        separatorBefore: true,
        onSelect: () => {
          void persistEntry(menu.employeeId, menu.dateKey, {
            signed: null,
            measures: null,
          });
        },
      },
    ];
  }

  async function handleDeleteSelected() {
    if (selectedEmployeeIds.length === 0) return;
    if (!isActive) return;

    // Удаление строки уносит с собой все отметки за период — без
    // подтверждения это слишком дёшево для необратимого действия.
    const marks = initialEntries.filter((entry) =>
      selectedEmployeeIds.includes(entry.employeeId)
    ).length;
    const confirmed = await confirmAsync({
      title: "Удалить выбранных сотрудников из журнала?",
      description:
        "Строки исчезнут из бланка вместе со всеми отметками за период документа.",
      variant: "danger",
      confirmLabel: "Удалить",
      bullets: [
        { label: `Строк сотрудников: ${selectedEmployeeIds.length}`, tone: "warn" },
        { label: `Отметок будет удалено: ${marks}`, tone: "warn" },
        { label: "Восстановить данные будет нельзя", tone: "warn" },
      ],
    });
    if (!confirmed) return;

    setIsDeleting(true);
    try {
      await Promise.all(
        selectedEmployeeIds.map((employeeId) =>
          requestJson(`/api/journal-documents/${documentId}/entries`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ employeeId }),
          })
        )
      );
      toast.success(
        `Удалено: ${selectedEmployeeIds.length} ${
          selectedEmployeeIds.length === 1 ? "строка" : "строк"
        }, отметок: ${marks}`
      );
      setSelectedEmployeeIds([]);
      router.refresh();
    } catch (error) {
      toast.error(humanizeFetchError(error, "Ошибка удаления строк"));
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="bg-white text-black">
      <FocusTodayScroller />
      {/* Back-link + Print are rendered by StaffJournalToolbar below. */}
      <style jsx global>{`
        /* A1: локальный @page убран — ориентация задаётся один раз в
           globals.css (именованный @page journal-landscape + маркер
           [data-journal-print-root] страницы документа). Локальные
           дубли конфликтовали между собой по порядку загрузки. */

        @media print {
          html,
          body {
            background: #ffffff !important;
          }

          body {
            margin: 0;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          .screen-only {
            display: none !important;
          }

          .health-sheet {
            width: 100%;
            max-width: none !important;
            padding: 0 !important;
            margin: 0 !important;
          }

          .health-grid {
            width: 100% !important;
            min-width: 0 !important;
            table-layout: fixed;
          }

          .health-grid th,
          .health-grid td {
            font-size: 10px !important;
            line-height: 1.1 !important;
            padding: 4px 3px !important;
          }

          .health-header td {
            font-size: 11px !important;
            line-height: 1.15 !important;
            padding: 8px 10px !important;
          }

          .health-title {
            font-size: 24px !important;
            margin-bottom: 24px !important;
          }

          .health-notes {
            font-size: 10px !important;
            line-height: 1.25 !important;
            margin-top: 24px !important;
          }

          .health-checkbox {
            width: 10px !important;
            height: 10px !important;
            border-radius: 2px !important;
          }
        }
      `}</style>

      {/* Q3: верхнего padding'а нет — «крошки → H1» задаёт `space-y-3`
          контейнера раздела (12px), один для всех 13 журналов. */}
      <div className="health-sheet pb-4 sm:pb-6">
        {/* Нижний отступ этого блока задаёт полоса автозаполнения внутри
            <StaffJournalToolbar> (DOC_AUTOFILL_STRIP_CLASS, 40px до бумажной
            шапки) — свой mb здесь удваивал бы канон. */}
        <div className="screen-only space-y-4">
          <StaffJournalToolbar
            subtitle={getJournalDocumentPeriodLabel("health_check", dateFrom, dateTo)}
            documentId={documentId}
            closeWarning={closeWarning}
            heading="Журнал здоровья"
            title={documentTitle}
            status={status}
            autoFill={autoFill}
            responsibleTitle={props.responsibleTitle}
            responsibleUserId={props.responsibleUserId ?? null}
            users={employees}
            includedEmployeeIds={includedEmployeeIds}
            routeCode="health_check"
            organizationName={organizationLabel}
            showHeaderActions
            useV2={useV2}
            // Раньше кнопку «Настройки» перехватывал собственный диалог
            // журнала здоровья: там не было ни ответственного, ни
            // «Периодичности контроля», и сохранение стирало её из шапки.
            // Теперь общий диалог, а своё поле приходит доп. блоком.
            controlPeriodicity={controlPeriodicity}
            dateFrom={dateFrom}
            dateTo={dateTo}
            countOutsidePeriod={(from, to) =>
              initialEntries.filter(
                (entry) => entry.date < from || entry.date > to
              ).length
            }
            settingsExtraConfig={{
              printEmptyRows: Math.max(0, Number(emptyRows) || 0),
            }}
            settingsExtraFields={
              <div className="space-y-2">
                <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
                  Добавлять пустых строк при печати
                </Label>
                <Select value={emptyRows} onValueChange={setEmptyRows}>
                  <SelectTrigger className="h-10 w-full rounded-xl border-[#dcdfed] bg-white px-3.5 text-[13.5px] transition-colors duration-150 focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EMPTY_ROWS_OPTIONS.map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            }
          />

          <TodayProgressStrip
            filled={todayProgress.filled}
            total={todayProgress.total}
            label="сотрудников"
            onJumpToToday={scrollToTodayColumn}
          />

          {!isActive ? (
            <JournalClosedBanner hint="Откройте журнал заново, чтобы редактировать отметки сотрудников." documentId={props.documentId} />
          ) : null}

          {isActive && (
            <JournalSelectionBar
              count={selectedCount}
              onClear={() => setSelectedEmployeeIds([])}
              onDelete={handleDeleteSelected}
              deleting={isDeleting}
              hint="Сотрудники будут удалены из журнала вместе с отметками"
            />
          )}

          {/* Mobile-only view toggle. Cards = accordion per employee (a
              lot easier to read on a 320-px phone than a 1100-px grid
              behind horizontal scroll). */}
          <MobileViewToggle mobileView={mobileView} onChange={switchMobileView} />
        </div>

        {/* Mobile Cards view — hidden on sm+ and in print. Read-only
            display of each employee's per-day sign-off and measures. */}
        {mobileView === "cards" ? (
          <div className="mb-6 space-y-2 sm:hidden print:hidden">
            {printableEmployees
              .filter((employee) => employee.name)
              .map((employee) => {
                const expanded = expandedEmployeeId === employee.id;
                const signedCount = dateKeys.reduce((acc, dk) => {
                  const d = entryMap[makeCellKey(employee.id, dk)];
                  return acc + (d?.signed ? 1 : 0);
                }, 0);
                const isSelected = selectedEmployeeIds.includes(employee.id);
                const measures = getHealthMeasures(
                  employee.id,
                  dateKeys,
                  entryMap
                );

                return (
                  <div
                    key={employee.id}
                    className="rounded-2xl border border-[#ececf4] bg-white"
                  >
                    <div className="flex items-center gap-3 px-3 py-3">
                      <span
                        onClick={(event) => event.stopPropagation()}
                        className="shrink-0"
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={(checked) => {
                            if (!isActive) return;
                            toggleEmployee(employee.id, Boolean(checked));
                          }}
                          disabled={!isActive}
                          className="size-5"
                        />
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedEmployeeId(expanded ? null : employee.id)
                        }
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="line-clamp-3 break-words text-[14px] font-medium leading-snug text-[#0b1024]">
                            {employee.name}
                          </div>
                          <div className="line-clamp-2 break-words text-[12px] text-[#6f7282]">
                            {employee.position ||
                              getHygienePositionLabel("operator")}
                          </div>
                        </div>
                        <span className="shrink-0 rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[11px] font-semibold text-[#5566f6]">
                          {signedCount}/{dateKeys.length}
                        </span>
                        <ChevronDown
                          className={`size-4 shrink-0 text-[#6f7282] transition-transform ${
                            expanded ? "rotate-180" : ""
                          }`}
                        />
                      </button>
                    </div>
                    {expanded ? (
                      <div className="space-y-1.5 border-t border-[#ececf4] p-3">
                        {dateKeys.map((dateKey) => {
                          const key = makeCellKey(employee.id, dateKey);
                          const d = entryMap[key];
                          const signed = d?.signed === true;
                          const refused = d?.signed === false;
                          const lockReason = cellLockReason(employee.id, dateKey);
                          const locked = lockReason !== null;
                          return (
                            <div
                              key={key}
                              className={`flex items-center gap-2 rounded-xl px-1 py-1.5 ${
                                savingCellKey === key ? "bg-[#f7f8ff]" : ""
                              }`}
                            >
                              <span className="w-12 shrink-0 text-center text-[13px] font-medium text-[#6f7282]">
                                {getDayNumber(dateKey)}{" "}
                                {getWeekdayShort(dateKey)}.
                              </span>
                              {locked ? (
                                <Lock
                                  className="size-3.5 shrink-0 text-[#9b9fb3]"
                                  aria-label={lockReason ?? undefined}
                                />
                              ) : null}
                              <button
                                type="button"
                                // Закрытая клетка остаётся нажимаемой:
                                // на телефоне подсказку из `title` не
                                // увидеть, а замок молчит. Тап объясняет
                                // причину тостом, записать всё равно нельзя.
                                onClick={(event) => {
                                  if (locked) {
                                    toast.info(lockReason ?? PAST_DAY_LOCKED_MESSAGE);
                                    return;
                                  }
                                  openCellMenu(event, employee.id, dateKey, true);
                                }}
                                disabled={!isActive}
                                title={lockReason ?? undefined}
                                className={`min-w-0 flex-1 rounded-lg px-3 py-2 text-left text-[12px] font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 ${
                                  locked ? "opacity-60" : ""
                                } ${
                                  signed
                                    ? "bg-[#f5f6ff] text-[#5566f6] hover:bg-[#eef1ff]"
                                    : refused
                                      ? "bg-[#fff2f1] text-[#d2453d] hover:bg-[#ffe8e6]"
                                      : "bg-[#fafbff] text-[#9b9fb3] hover:bg-[#f5f6ff]"
                                }`}
                              >
                                {signed
                                  ? "Подпись есть"
                                  : refused
                                    ? "Нет подписи"
                                    : "— не заполнено"}
                                {d?.measures ? (
                                  <span className="ml-1.5 text-[#6f7282]">
                                    · {d.measures}
                                  </span>
                                ) : null}
                              </button>
                            </div>
                          );
                        })}
                        {isActive ? (
                          <div className="pt-1 text-[11px] text-[#6f7282]">
                            Нажмите на день, чтобы отметить подпись или
                            записать принятые меры.
                          </div>
                        ) : null}
                        {measures.length > 0 ? (
                          <div className="mt-2 rounded-xl border border-[#ececf4] bg-[#fafbff] p-3 text-[13px] leading-5 text-[#3c4053]">
                            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6f7282]">
                              Принятые меры
                            </div>
                            {measures.map((item) => (
                              <div key={`${employee.id}:m:${item}`}>{item}</div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            {printableEmployees.filter((employee) => employee.name).length ===
            0 ? (
              <div className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] p-5 text-center text-[13px] text-[#6f7282]">
                В документе пока нет сотрудников.
              </div>
            ) : null}
          </div>
        ) : null}

        {/* R1: бумажное полотно — во всю ширину контентной колонки. */}
        <div
          className={`${DOC_PAPER_CANVAS_CLASS} ${
            mobileView === "cards" ? "hidden sm:block print:block" : ""
          }`}
        >
        <div className={GRID_VIEWPORT_CLASS}>
        <div className="min-w-[1100px] py-6 sm:min-w-0">
          <div className={DOC_PAPER_HEADER_CLASS}>
            <HealthHeader
              organizationLabel={organizationLabel}
              pageLabel="СТР. 1 ИЗ 1"
              startedAt={dateFrom}
              finishedAt={status === "closed" ? dateTo : null}
              controlPeriodicity={controlPeriodicity}
            />
          </div>

          {/* КАПС-заголовок — общий компонент (16-18px), как во всех
              остальных журналах. Раньше здесь стоял локальный 34px. */}
          <JournalDocumentTitle className={`health-title ${DOC_CAPS_TITLE_CLASS}`}>
            {documentTitle}
          </JournalDocumentTitle>

          {/* «Добавить» — слева непосредственно над таблицей (эталон).
              Раньше кнопка жила в шапке страницы, выше бумажной шапки.
              `sticky left-0` держит её у левого края при горизонтальном
              скролле широкого листа. */}
          <StaffJournalAddButton
            documentId={documentId}
            title={documentTitle}
            status={status}
            users={employees}
            includedEmployeeIds={includedEmployeeIds}
            className={`${DOC_ADD_ROW_CLASS} sticky left-0 w-fit`}
          />

          <table className="health-grid w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th
                  className={`w-[42px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight print:hidden`}
                  rowSpan={2}
                >
                  <HealthCheckbox
                    checked={allSelected}
                    disabled={!isActive}
                    onCheckedChange={(checked) => {
                      if (!isActive) return;
                      setSelectedEmployeeIds(
                        checked ? rosterUsers.map((employee) => employee.id) : []
                      );
                    }}
                  />
                </th>
                <th
                  className={`w-[72px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}
                  rowSpan={2}
                >
                  №
                  <br />
                  п/п
                </th>
                <th
                  className={`w-[150px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}
                  rowSpan={2}
                >
                  Ф.И.О. работника
                </th>
                <th
                  className={`w-[270px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}
                  rowSpan={2}
                >
                  Должность
                </th>
                <th
                  className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center text-[13px] font-semibold leading-tight`}
                  colSpan={dateKeys.length}
                >
                  Месяц {monthLabel}
                </th>
                <th
                  className={`w-[200px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}
                  rowSpan={2}
                >
                  Принятые меры
                </th>
              </tr>
              <tr>
                {dateKeys.map((dateKey) => (
                  <th
                    key={dateKey}
                    data-focus-today={dateKey === todayKey ? "" : undefined}
                    /* R5-4: на бумаге колонка дня сжимается, и «Сб.»
                       ломалось ПО ТОЧКЕ — заголовок вырастал в три
                       строки («1» / «Сб» / «.») и распирал всю шапку.
                       Заголовок дня короткий по определению (число +
                       двухбуквенный день недели), переносить в нём
                       нечего, поэтому запрещаем перенос целиком. */
                    className={`w-[58px] ${GRID_HEAD_CELL_CLASS} whitespace-nowrap px-2 py-1.5 text-center font-semibold leading-tight`}
                  >
                    <div>{getDayNumber(dateKey)}</div>
                    <div>{getWeekdayShort(dateKey)}.</div>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {printableEmployees.map((employee) => {
                const measures = getHealthMeasures(employee.id, dateKeys, entryMap);

                return (
                  <tr key={employee.id}>
                    <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center align-middle leading-tight print:hidden`}>
                      {employee.name ? (
                        <HealthCheckbox
                          checked={selectedEmployeeIds.includes(employee.id)}
                          disabled={!isActive}
                          onCheckedChange={(checked) => {
                            if (!isActive) return;
                            toggleEmployee(employee.id, checked);
                          }}
                        />
                      ) : null}
                    </td>
                    <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center align-middle leading-tight`}>
                      {employee.name ? employee.number : ""}
                    </td>
                    <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center align-middle leading-tight`}>
                      {employee.name || ""}
                    </td>
                    <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center align-middle leading-tight`}>
                      {employee.name
                        ? employee.position || getHygienePositionLabel("operator")
                        : ""}
                    </td>
                    {dateKeys.map((dateKey) => {
                      const key = makeCellKey(employee.id, dateKey);
                      const data = entryMap[key];
                      const interactive = Boolean(employee.name);
                      const lockReason = interactive
                        ? cellLockReason(employee.id, dateKey)
                        : null;
                      const locked = lockReason !== null;

                      return (
                        <td
                          key={key}
                          title={lockReason ?? undefined}
                          className={`${GRID_CELL_CLASS} px-2 py-1 text-center align-middle leading-tight ${getDayColumnBgClass(
                            dateKey
                          )} ${
                            locked
                              ? "cursor-not-allowed text-[#9b9fb3]"
                              : isActive && interactive
                                ? "cursor-pointer transition-colors duration-150 hover:bg-[#f5f6ff]"
                                : ""
                          } ${savingCellKey === key ? "bg-[#f7f8ff]" : ""}`}
                          data-print-keep-bg={getDayColumnPrintKeepBg(dateKey)}
                          onClick={(event) =>
                            openCellMenu(event, employee.id, dateKey, interactive)
                          }
                          onContextMenu={(event) =>
                            openCellMenu(event, employee.id, dateKey, interactive)
                          }
                        >
                          {data?.signed === true
                            ? "+"
                            : data?.signed === false
                              ? "—"
                              : ""}
                        </td>
                      );
                    })}
                    <td className={`${GRID_CELL_CLASS} px-3 py-1 align-middle leading-tight`}>
                      <div className="space-y-1 text-left text-[14px] leading-5">
                        {measures.map((item) => (
                          <div key={`${employee.id}:${item}`}>{item}</div>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {isActive ? (
                <JournalAddRow
                  // Сетка как у строки данных: галочка + № п/п — leading,
                  // ФИО + Должность — под подпись, дальше дни месяца и
                  // «Принятые меры» остаются пустыми ячейками.
                  leading={2}
                  labelSpan={2}
                  trailing={dateKeys.length + 1}
                  label="Добавить сотрудника"
                  onClick={() => setAddRowOpen(true)}
                />
              ) : null}

              {/* Хвостовая пустая строка бланка — только на бумаге: там она
                  место для дозаписи от руки. На экране вместо неё строка
                  выше, по которой открывается добавление. */}
              <tr className="hidden print:table-row">
                <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center align-middle leading-tight print:hidden`}>
                  <HealthCheckbox checked={false} disabled />
                </td>
                <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`} />
                <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`} />
                <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`} />
                {dateKeys.map((dateKey) => (
                  <td
                    key={`blank:${dateKey}`}
                    className={`${GRID_CELL_CLASS} px-2 py-1 leading-tight ${getDayColumnBgClass(dateKey)}`}
                    data-print-keep-bg={getDayColumnPrintKeepBg(dateKey)}
                  />
                ))}
                <td className={`${GRID_CELL_CLASS} px-2 py-1 leading-tight`} />
              </tr>
            </tbody>
          </table>

          <AddEmployeeDialog
            open={addRowOpen}
            onOpenChange={setAddRowOpen}
            users={employees}
            includedEmployeeIds={includedEmployeeIds}
            documentId={documentId}
          />

          <div className={`health-notes ${DOC_EXTRA_BLOCK_CLASS} space-y-3 ${DOC_NOTE_TEXT_CLASS}`}>
            {HEALTH_REGISTER_NOTES.map((note) => (
              <p key={note}>{note}</p>
            ))}
            <p className="font-semibold">{HEALTH_REGISTER_REMINDER}</p>
          </div>
        </div>
        </div>
        </div>
      </div>

      {/* Меню ячейки дня — то же, что ПКМ в гигиеническом журнале;
          на телефоне приходит листом снизу. */}
      {cellMenu ? (
        <TableContextMenu
          x={cellMenu.x}
          y={cellMenu.y}
          onClose={closeCellMenu}
          ariaLabel="Отметка о состоянии здоровья"
          items={buildCellMenuItems(cellMenu)}
        />
      ) : null}
    </div>
  );
}
