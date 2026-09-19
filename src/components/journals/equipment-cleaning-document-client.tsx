"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Plus, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "next-auth/react";
import { USER_ROLE_LABEL_VALUES, getUserRoleLabel, getUsersForRoleLabel, isManagementRole } from "@/lib/user-roles";
import {
  emptyEquipmentCleaningRow,
  EQUIPMENT_CLEANING_VARIANT_LABELS,
  formatEquipmentCleaningDate,
  getEquipmentCleaningEntryDateBounds,
  getEquipmentCleaningPeriodEnd,
  getEquipmentCleaningResultLabel,
  resolveEquipmentCleaningRowName,
  type EquipmentCleaningDocumentConfig,
  type EquipmentCleaningFieldVariant,
  type EquipmentCleaningRowData,
} from "@/lib/equipment-cleaning-document";
import { DOC_PRIMARY_BUTTON_CLASS } from "@/components/journals/journal-responsive";
import { JournalDocumentShell } from "@/components/journals/journal-document-shell";
import { JournalDocumentHeader } from "@/components/journals/journal-document-header";
import { JournalAddRow } from "@/components/journals/journal-add-row";
import { GRID_CELL_CLASS, GRID_HEAD_CELL_CLASS } from "@/components/journals/journal-grid";
import { JournalSettingsModal } from "@/components/journals/v2/journal-settings-modal";
import { FocusTodayScroller } from "@/components/journals/focus-today-scroller";
import { JournalSelectionBar } from "@/components/journals/journal-selection-bar";
import { SelectionEditButton } from "@/components/journals/selection-edit-button";
import { useSequentialEdit } from "@/components/journals/use-sequential-edit";
import { useMobileView } from "@/lib/use-mobile-view";
import {
  MobileViewToggle,
  MobileViewTableWrapper,
} from "@/components/journals/mobile-view-toggle";
import {
  RecordCardsView,
  type RecordCardItem,
} from "@/components/journals/record-cards-view";

import { toast } from "sonner";
import { PublishUndoToHeader } from "@/components/journals/journal-undo-slot";
import { useJournalUndo } from "@/lib/journal-undo";
import { PositionNativeOptions } from "@/components/shared/position-select";
import { useRosterViewerId } from "@/components/journals/use-roster-viewer";
import { rankRosterForSlot } from "@/lib/journal-roster";
import { useTodayKey } from "@/lib/use-today-key";
import { EquipmentDirectoryField } from "@/components/journals/equipment-directory-field";
import type { EquipmentDirectoryOption } from "@/lib/equipment-directory-link";
type UserItem = {
  id: string;
  name: string;
  role: string;
};

type EquipmentCleaningRow = {
  id: string;
  data: EquipmentCleaningRowData;
};

type Props = {
  documentId: string;
  routeCode?: string;
  title: string;
  templateCode: string;
  organizationName: string;
  status: "active" | "closed";
  dateFrom: string;
  config: EquipmentCleaningDocumentConfig;
  users: UserItem[];
  equipmentOptions: string[];
  /** Справочник «Оборудование» организации — связь строки с единицей. */
  equipmentDirectory?: EquipmentDirectoryOption[];
  initialRows: EquipmentCleaningRow[];
  /** Design v2 toggle. */
  useV2?: boolean;
};

type RowDraftState = {
  id: string | null;
  data: EquipmentCleaningRowData;
};

const ROLE_OPTIONS = USER_ROLE_LABEL_VALUES;
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0"));
const MINUTE_OPTIONS = Array.from({ length: 12 }, (_, index) =>
  String(index * 5).padStart(2, "0")
);

function userRoleLabel(role: string) {
  return getUserRoleLabel(role);
}

function splitTime(value: string) {
  const [hour = "00", minute = "00"] = value.split(":");
  return { hour, minute };
}

function mergeTime(hour: string, minute: string) {
  return `${hour}:${minute}`;
}

function buildPayload(data: EquipmentCleaningRowData) {
  return {
    ...data,
    rinseTemperature:
      data.rinseTemperature && data.rinseTemperature.trim().length > 0
        ? data.rinseTemperature.trim()
        : null,
  };
}

export function EquipmentCleaningDocumentClient({
  documentId,
  routeCode,
  title,
  templateCode,
  organizationName,
  status,
  dateFrom,
  config,
  users,
  equipmentOptions,
  equipmentDirectory = [],
  initialRows,
  useV2 = false,
}: Props) {
  const router = useRouter();
  const journalRouteCode = routeCode || templateCode;
  const viewerId = useRosterViewerId(users);
  // «Сегодня» — из контекста документа (пояс организации), не из часов
  // устройства: по нему и подсветка строки, и верхняя граница даты мойки.
  const todayKey = useTodayKey();
  // DELETE на сервере требует управленческой роли — кнопку «Удалить»
  // рядовому сотруднику не показываем, иначе она просто отдавала 403.
  const { data: sessionData } = useSession();
  const canDelete =
    sessionData?.user?.isRoot === true ||
    isManagementRole(sessionData?.user?.role ?? "");
  const [rows, setRows] = useState(initialRows);
  // История отмены: только правки этого человека в этой вкладке.
  const undoStack = useJournalUndo({ enabled: status === "active" });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [rowModalOpen, setRowModalOpen] = useState(false);
  const [settingsTitle, setSettingsTitle] = useState(title);
  const [settingsDateFrom, setSettingsDateFrom] = useState(dateFrom);
  const [fieldVariant, setFieldVariant] =
    useState<EquipmentCleaningFieldVariant>(config.fieldVariant);
  const [draft, setDraft] = useState<RowDraftState>({
    id: null,
    data: emptyEquipmentCleaningRow({
      // «Мойщик» в списке должностей отсутствует — селект оказывался
      // пустым. Должность подставляем из реальной роли сотрудника.
      washerPosition: "",
      controllerPosition: "Управляющий",
    }),
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  const sortedRows = useMemo(
    () =>
      [...rows].sort((left, right) => {
        const leftKey = `${left.data.washDate}T${left.data.washTime}`;
        const rightKey = `${right.data.washDate}T${right.data.washTime}`;
        return leftKey.localeCompare(rightKey);
      }),
    [rows]
  );

  // Разрешённый диапазон даты мойки — тот же, что проверяет сервер.
  const dateBounds = useMemo(
    () => getEquipmentCleaningEntryDateBounds(dateFrom, todayKey),
    [dateFrom, todayKey]
  );

  const allSelected = rows.length > 0 && selectedIds.length === rows.length;
  const { mobileView, switchMobileView } = useMobileView("equipment_cleaning");

  const cardItems: RecordCardItem[] = sortedRows.map((row, index) => ({
    id: row.id,
    // Якорь «Перейти к сегодня» для режима карточек (телефон).
    title: (
      <span data-focus-today={row.data.washDate === todayKey ? "" : undefined}>
        {`№${index + 1} · ${resolveEquipmentCleaningRowName(row.data, equipmentDirectory) || "—"}`}
      </span>
    ),
    subtitle: `${formatEquipmentCleaningDate(row.data.washDate)} ${row.data.washTime || ""}`.trim() || undefined,
    leading: status === "active" ? (
      <Checkbox
        checked={selectedIds.includes(row.id)}
        onCheckedChange={(checked) =>
          setSelectedIds((current) =>
            checked === true
              ? [...new Set([...current, row.id])]
              : current.filter((id) => id !== row.id)
          )
        }
        className="size-5"
      />
    ) : null,
    fields: [
      { label: "Моющий раствор", value: row.data.detergentName, hideIfEmpty: true },
      { label: "Концентрация моющего, %", value: row.data.detergentConcentration, hideIfEmpty: true },
      { label: "Дезинфицирующий раствор", value: row.data.disinfectantName, hideIfEmpty: true },
      { label: "Концентрация дез. ср-ва, %", value: row.data.disinfectantConcentration, hideIfEmpty: true },
      {
        label: fieldVariant === "rinse_temperature" ? "Ополаскивание, °C" : "pH-нейтральность",
        value: fieldVariant === "rinse_temperature"
          ? row.data.rinseTemperature
          : getEquipmentCleaningResultLabel(row.data.rinseResult),
        hideIfEmpty: true,
      },
      { label: "Мойщик", value: row.data.washerName, hideIfEmpty: true },
      { label: "Контроль", value: `${row.data.controllerPosition || ""}, ${row.data.controllerName || ""}`.trim().replace(/^,\s*|\s*,\s*$/g, ""), hideIfEmpty: true },
    ],
    onClick: status === "active" ? () => openEditRow(row) : undefined,
  }));

  function openCreateRow() {
    // Мойщик — вошедший, если он в ростере; контроль — руководство по
    // правилам ростера (без аккаунтов-заглушек «имя = почта»). Раньше —
    // первый в списке и владелец.
    const washer = users.find((user) => user.id === viewerId) || null;
    const controller = rankRosterForSlot(users, { kind: "verifier" });

    setDraft({
      id: null,
      data: emptyEquipmentCleaningRow({
        equipmentName: equipmentOptions[0] || "",
        // Должность мойщика — из роли вошедшего: строки «Мойщик» в списке
        // должностей нет, и селект открывался пустым.
        washerPosition: washer ? userRoleLabel(washer.role) : "",
        washerName: washer?.name || "",
        washerUserId: washer?.id || null,
        controllerPosition: userRoleLabel(controller?.role || "owner"),
        controllerName: controller?.name || "",
        controllerUserId: controller?.id || null,
      }),
    });
    setRowModalOpen(true);
  }

  function openEditRow(row: EquipmentCleaningRow) {
    setDraft({
      id: row.id,
      data: row.data,
    });
    setRowModalOpen(true);
  }

  /** Правка выделенных строк по очереди — тем же окном. */
  const seq = useSequentialEdit({
    open: (id) => {
      const row = rows.find((item) => item.id === id);
      if (!row || status !== "active") return false;
      openEditRow(row);
      return true;
    },
    close: () => setRowModalOpen(false),
  });

  function closeRowModal() {
    // Закрытие без сохранения прерывает очередь («Изменено k из N»).
    seq.cancelled();
  }

  function updateDraft(patch: Partial<EquipmentCleaningRowData>) {
    setDraft((current) => ({
      ...current,
      data: {
        ...current.data,
        ...patch,
      },
    }));
  }

  /**
   * Запись строки. Отмена (Ctrl+Z) — это повторная запись прежних
   * значений тем же PATCH; создание новой строки в историю не попадает
   * (undo для него означал бы удаление, а это другое действие).
   *
   * `silent` — вызов из истории: нового шага не кладём и пробрасываем
   * ошибку, чтобы протухший шаг вылетел из стека.
   */
  async function saveRow(
    override?: { id: string; data: EquipmentCleaningRowData },
    options?: { silent?: boolean }
  ) {
    const target = override ?? draft;
    // Валидация до запроса: пустая строка и дата в будущем / вне периода
    // уходили на сервер молча.
    if (!options?.silent) {
      if (!target.data.equipmentName.trim()) {
        toast.error("Укажите наименование оборудования");
        return;
      }
      if (!target.data.washDate) {
        toast.error("Укажите дату мойки");
        return;
      }
      if (target.data.washDate > dateBounds.max) {
        toast.error("Дата мойки не может быть в будущем");
        return;
      }
      if (target.data.washDate < dateBounds.min) {
        toast.error("Дата мойки раньше начала журнала");
        return;
      }
    }
    const previousRow = target.id
      ? rows.find((row) => row.id === target.id)
      : undefined;
    setIsSaving(true);
    try {
      const response = await fetch(`/api/journal-documents/${documentId}/equipment-cleaning`, {
        method: target.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: target.id,
          data: buildPayload(target.data),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.entry) {
        throw new Error(payload?.error || "Не удалось сохранить строку");
      }

      const nextRow = payload.entry as EquipmentCleaningRow;
      setRows((current) => {
        const withoutCurrent = current.filter((row) => row.id !== nextRow.id);
        return [...withoutCurrent, nextRow];
      });
      if (!options?.silent && previousRow) {
        const restored = { id: previousRow.id, data: previousRow.data };
        const applied = { id: nextRow.id, data: nextRow.data };
        undoStack.push({
          undo: () => saveRow(restored, { silent: true }),
          redo: () => saveRow(applied, { silent: true }),
        });
      }
      if (!override) {
        setDraft({
          id: null,
          data: emptyEquipmentCleaningRow(),
        });
        if (target.id) {
          // Очередь правок откроет следующую строку или закроет окно.
          seq.saved();
          return;
        }
        setRowModalOpen(false);
      }
    } catch (error) {
      if (options?.silent) throw error;
      toast.error(error instanceof Error ? error.message : "Ошибка сохранения строки");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteSelectedRows() {
    if (selectedIds.length === 0) return;

    const response = await fetch(`/api/journal-documents/${documentId}/equipment-cleaning`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: selectedIds }),
    });
    if (!response.ok) {
      toast.error("Не удалось удалить строки");
      return;
    }

    setRows((current) => current.filter((row) => !selectedIds.includes(row.id)));
    setSelectedIds([]);
  }

  async function saveSettings() {
    setIsSaving(true);
    try {
      const response = await fetch(`/api/journal-documents/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: settingsTitle.trim(),
          dateFrom: settingsDateFrom,
          // Журнал годовой: dateTo = settingsDateFrom схлопывал период в
          // один день и запрещал мойку задним числом.
          dateTo: getEquipmentCleaningPeriodEnd(settingsDateFrom),
          config: {
            fieldVariant,
          },
        }),
      });
      if (!response.ok) {
        throw new Error();
      }
      setSettingsOpen(false);
      router.refresh();
    } catch {
      toast.error("Не удалось сохранить настройки журнала");
    } finally {
      setIsSaving(false);
    }
  }

  async function closeDocument() {
    setIsClosing(true);
    try {
      const response = await fetch(`/api/journal-documents/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "closed",
        }),
      });
      if (!response.ok) {
        throw new Error();
      }
      setCloseOpen(false);
      router.push(`/journals/${journalRouteCode}?tab=closed`);
      router.refresh();
    } catch {
      toast.error("Не удалось закрыть журнал");
    } finally {
      setIsClosing(false);
    }
  }

  const draftTime = splitTime(draft.data.washTime);

  return (
    <div className="space-y-6 text-black">
      {selectedIds.length > 0 && status === "active" ? (
        <JournalSelectionBar
          count={selectedIds.length}
          onClear={() => setSelectedIds([])}
          onDelete={
            canDelete
              ? () => {
                  deleteSelectedRows().catch(() => {
                    toast.error("Не удалось удалить строки");
                  });
                }
              : undefined
          }
          hint="Строки мойки будут удалены без возможности отмены"
        >
          <SelectionEditButton count={selectedIds.length} disabled={status !== "active"} onClick={() => seq.start(selectedIds)} />
        </JournalSelectionBar>
      ) : null}

      <FocusTodayScroller selector="[data-focus-today]" emptyTitle="Записей пока нет" emptyBody="Нажмите «Добавить» в таблице ниже, чтобы создать запись." />
      <JournalDocumentShell
        title={title}
        subtitle={`Начат ${formatEquipmentCleaningDate(settingsDateFrom)}${isSaving ? " · Сохранение…" : ""}`}
        documentId={documentId}
        backHref={`/journals/${journalRouteCode}`}
        onSettings={() => setSettingsOpen(true)}
        closed={status !== "active"}
        closedHint="Откройте журнал заново, чтобы добавлять и править строки мойки."
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
        menuItems={
          status === "active"
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
        cards={
          <RecordCardsView
            items={cardItems}
            emptyLabel="Записей по мойке оборудования нет."
          />
        }
        paperHeader={
          <JournalDocumentHeader
            orgName={organizationName}
            title="Журнал мойки и дезинфекции оборудования"
            startedAt={settingsDateFrom}
            finishedAt={status === "closed" ? new Date() : null}
          />
        }
        sheetTitle="Журнал мойки и дезинфекции оборудования"
        sheetMinWidth={1380}
        toolbar={
          <Button
            type="button"
            onClick={openCreateRow}
            disabled={status !== "active"}
            className={DOC_PRIMARY_BUTTON_CLASS}
          >
            <Plus className="size-5" />
            Добавить
          </Button>
        }
      >

          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className={`w-[48px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center print:hidden`}>
                  {status === "active" ? (
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={(checked) =>
                        setSelectedIds(checked === true ? rows.map((row) => row.id) : [])
                      }
                    />
                  ) : null}
                </th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>Дата и время мойки</th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>Наименование оборудования</th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>Наименование моющего раствора</th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>Концентрация моющего раствора, %</th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>Наименование дезинфицирующего раствора</th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>Концентрация дезинфицирующего раствора, %</th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>
                  {fieldVariant === "rinse_temperature"
                    ? "Ополаскивание, °C"
                    : "Полнота смываемости дез. ср-ва с оборудования и инвентаря (тест на pH нейтральность)"}
                </th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>Мойщик (ФИО)</th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>Контролирующее лицо (должность, ФИО)</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <tr
                  key={row.id}
                  // Якорь «Перейти к сегодня»: без него скроллер не
                  // находил цель и всегда показывал «Записей пока нет».
                  data-focus-today={row.data.washDate === todayKey ? "" : undefined}
                  className={status === "active" ? "cursor-pointer hover:bg-[#fafbff]" : ""}
                  onClick={() => status === "active" && openEditRow(row)}
                >
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`} onClick={(event) => event.stopPropagation()}>
                    {status === "active" ? (
                      <Checkbox
                        checked={selectedIds.includes(row.id)}
                        onCheckedChange={(checked) =>
                          setSelectedIds((current) =>
                            checked === true
                              ? [...new Set([...current, row.id])]
                              : current.filter((id) => id !== row.id)
                          )
                        }
                      />
                    ) : null}
                  </td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>
                    {formatEquipmentCleaningDate(row.data.washDate)}
                    <br />
                    {row.data.washTime}
                  </td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{resolveEquipmentCleaningRowName(row.data, equipmentDirectory)}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{row.data.detergentName}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{row.data.detergentConcentration}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{row.data.disinfectantName}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{row.data.disinfectantConcentration}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>
                    {fieldVariant === "rinse_temperature"
                      ? row.data.rinseTemperature || "—"
                      : getEquipmentCleaningResultLabel(row.data.rinseResult) || "—"}
                  </td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{row.data.washerName}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>
                    {`${row.data.controllerPosition}, ${row.data.controllerName}`}
                  </td>
                </tr>
              ))}
              {sortedRows.length === 0 ? (
                <tr>
                  <td colSpan={10} className={`${GRID_CELL_CLASS} px-2 py-6 text-center text-[#6d7287]`}>
                    Записей пока нет
                  </td>
                </tr>
              ) : null}

              {/* Кликабельная пустая строка — то же окно, что и кнопка
                  «Добавить» в тулбаре шапки документа. leading=1 (чекбокс),
                  labelSpan=2 — подпись растянута на «Дата и время мойки» +
                  «Наименование оборудования»: вместе они опознают запись
                  (когда и что мыли), остальные 7 колонок (растворы,
                  концентрации, результат, мойщик, контролирующее лицо) —
                  данные, для новой строки пустые (trailing=7). Сумма
                  1+2+7=10 — тот же colSpan, что был раньше. */}
              {status === "active" ? (
                <JournalAddRow
                  leading={1}
                  labelSpan={2}
                  trailing={7}
                  label="Добавить запись"
                  onClick={openCreateRow}
                />
              ) : null}
            </tbody>
          </table>
      </JournalDocumentShell>


      <Dialog open={rowModalOpen} onOpenChange={(open) => (open ? setRowModalOpen(true) : closeRowModal())}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] max-h-[92vh] supports-[height:100dvh]:max-h-[92dvh] overflow-hidden rounded-[24px] border-0 p-0 sm:max-w-[640px]">
          <DialogHeader className="border-b px-6 py-5">
            <DialogTitle className="text-[18px] font-semibold tracking-[-0.02em] text-[#0b1024]">
              {draft.id ? `Редактирование строки${seq.progress ? ` ${seq.progress}` : ""}` : "Добавление новой строки"}
            </DialogTitle>
          </DialogHeader>

          <div className="max-h-[calc(92vh-160px)] space-y-5 overflow-y-auto px-6 py-5">
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">Дата и время мойки</Label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.4fr_1fr_1fr]">
                <Input
                  type="date"
                  className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
                  value={draft.data.washDate}
                  // Задним числом — можно, вперёд — нет.
                  min={dateBounds.min}
                  max={dateBounds.max}
                  onChange={(e) => updateDraft({ washDate: e.target.value })}
                />
                <select
                  className="h-9 w-full rounded-xl border border-[#dcdfed] bg-white px-3.5 text-[13.5px] text-[#0b1024]"
                  value={draftTime.hour}
                  onChange={(e) => updateDraft({ washTime: mergeTime(e.target.value, draftTime.minute) })}
                >
                  {HOUR_OPTIONS.map((hour) => (
                    <option key={hour} value={hour}>{hour} ч</option>
                  ))}
                </select>
                <select
                  className="h-9 w-full rounded-xl border border-[#dcdfed] bg-white px-3.5 text-[13.5px] text-[#0b1024]"
                  value={draftTime.minute}
                  onChange={(e) => updateDraft({ washTime: mergeTime(draftTime.hour, e.target.value) })}
                >
                  {MINUTE_OPTIONS.map((minute) => (
                    <option key={minute} value={minute}>{minute} мин</option>
                  ))}
                </select>
              </div>
            </div>

            {equipmentDirectory.length > 0 ? (
              // Со справочником: имя берём из него, своё название тоже
              // можно вписать и одной кнопкой завести в справочник.
              <EquipmentDirectoryField
                value={draft.data.equipmentName}
                sourceEquipmentId={draft.data.sourceEquipmentId ?? null}
                directory={equipmentDirectory}
                documentId={documentId}
                onChange={(name, sourceId) =>
                  updateDraft({ equipmentName: name, sourceEquipmentId: sourceId })
                }
              />
            ) : (
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#3c4053]">Наименование оборудования</Label>
                <Input
                  list="equipment-cleaning-options"
                  className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
                  value={draft.data.equipmentName}
                  onChange={(e) => updateDraft({ equipmentName: e.target.value })}
                  placeholder="Введите наименование оборудования"
                />
                <datalist id="equipment-cleaning-options">
                  {Array.from(new Set(equipmentOptions)).map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">Наименование моющего раствора</Label>
              <Input
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
                value={draft.data.detergentName}
                onChange={(e) => updateDraft({ detergentName: e.target.value })}
                placeholder="Введите наименование моющего раствора"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">Концентрация моющего раствора, %</Label>
              <Input
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
                value={draft.data.detergentConcentration}
                onChange={(e) => updateDraft({ detergentConcentration: e.target.value })}
                placeholder="Введите концентрацию моющего раствора, %"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">Наименование дезинфицирующего раствора</Label>
              <Input
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
                value={draft.data.disinfectantName}
                onChange={(e) => updateDraft({ disinfectantName: e.target.value })}
                placeholder="Введите наименование дезинфицирующего раствора"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">Концентрация дезинфицирующего раствора, %</Label>
              <Input
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
                value={draft.data.disinfectantConcentration}
                onChange={(e) => updateDraft({ disinfectantConcentration: e.target.value })}
                placeholder="Введите концентрацию дезинфицирующего раствора, %"
              />
            </div>

            {fieldVariant === "rinse_temperature" ? (
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#3c4053]">Ополаскивание, °C</Label>
                <Input
                  className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
                  value={draft.data.rinseTemperature || ""}
                  onChange={(e) => updateDraft({ rinseTemperature: e.target.value })}
                  placeholder="Введите температуру ополаскивания"
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#3c4053]">
                  Полнота смываемости дез. ср-ва
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ["compliant", "Соответствует", "#136b2a", "#ecfdf5"],
                      ["non_compliant", "Не соответствует", "#d2453d", "#fff4f2"],
                    ] as const
                  ).map(([value, label, fg, bg]) => {
                    // Незаполненное (null) не подсвечиваем как «Соответствует».
                    const active = draft.data.rinseResult === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => updateDraft({ rinseResult: value })}
                        className={`flex h-9 items-center justify-center gap-2 rounded-xl border px-3.5 text-[14px] font-medium transition-colors ${
                          active
                            ? "border-transparent text-white"
                            : "border-[#dcdfed] bg-white text-[#0b1024] hover:bg-[#fafbff]"
                        }`}
                        style={
                          active ? { backgroundColor: fg, color: "white" } : { backgroundColor: bg, color: fg, borderColor: bg }
                        }
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#3c4053]">Мойщик</Label>
                <select
                  className="h-9 w-full rounded-xl border border-[#dcdfed] bg-white px-3.5 text-[13.5px] text-[#0b1024]"
                  value={draft.data.washerPosition}
                  onChange={(e) => {
                    const value = e.target.value;
                    const candidates = getUsersForRoleLabel(users, value);
                    const currentId = draft.data.washerUserId || "";
                    const stillValid = candidates.some((u) => u.id === currentId);
                    updateDraft({
                      washerPosition: value,
                      ...(stillValid
                        ? {}
                        : { washerUserId: "", washerName: "" }),
                    });
                  }}
                >
                  <option value="">— выберите —</option>
                  <PositionNativeOptions users={users} />
                </select>
              </div>
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#3c4053]">Сотрудник</Label>
                <select
                  className="h-9 w-full rounded-xl border border-[#dcdfed] bg-white px-3.5 text-[13.5px] text-[#0b1024]"
                  value={draft.data.washerUserId || ""}
                  onChange={(e) => {
                    const value = e.target.value;
                    const user = users.find((item) => item.id === value);
                    updateDraft({
                      washerUserId: value,
                      washerName: user?.name || "",
                      ...(!draft.data.washerPosition && user
                        ? { washerPosition: getUserRoleLabel(user.role) }
                        : {}),
                    });
                  }}
                >
                  <option value="">— выберите —</option>
                  {(draft.data.washerPosition
                    ? getUsersForRoleLabel(users, draft.data.washerPosition)
                    : users).map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#3c4053]">Должность лица, проводившего контроль</Label>
                <select
                  className="h-9 w-full rounded-xl border border-[#dcdfed] bg-white px-3.5 text-[13.5px] text-[#0b1024]"
                  value={draft.data.controllerPosition}
                  onChange={(e) => {
                    const value = e.target.value;
                    const candidates = getUsersForRoleLabel(users, value);
                    const currentId = draft.data.controllerUserId || "";
                    const stillValid = candidates.some((u) => u.id === currentId);
                    updateDraft({
                      controllerPosition: value,
                      ...(stillValid
                        ? {}
                        : { controllerUserId: "", controllerName: "" }),
                    });
                  }}
                >
                  <option value="">— выберите —</option>
                  <PositionNativeOptions users={users} />
                </select>
              </div>
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#3c4053]">Сотрудник</Label>
                <select
                  className="h-9 w-full rounded-xl border border-[#dcdfed] bg-white px-3.5 text-[13.5px] text-[#0b1024]"
                  value={draft.data.controllerUserId || ""}
                  onChange={(e) => {
                    const value = e.target.value;
                    const user = users.find((item) => item.id === value);
                    updateDraft({
                      controllerUserId: value,
                      controllerName: user?.name || "",
                      ...(!draft.data.controllerPosition && user
                        ? { controllerPosition: getUserRoleLabel(user.role) }
                        : {}),
                    });
                  }}
                >
                  <option value="">— выберите —</option>
                  {(draft.data.controllerPosition
                    ? getUsersForRoleLabel(users, draft.data.controllerPosition)
                    : users).map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="flex flex-col-reverse gap-2 border-t bg-white px-6 py-4 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="h-9 w-full rounded-xl border-[#dcdfed] px-5 text-[14px] font-medium text-[#0b1024] shadow-none hover:bg-[#fafbff] sm:w-auto"
              onClick={closeRowModal}
            >
              Отмена
            </Button>
            <Button
              type="button"
              className="h-10 w-full rounded-xl bg-[#5566f6] px-5 text-[14px] font-medium text-white hover:bg-[#4a5bf0] sm:w-auto"
              onClick={() => void saveRow()}
              disabled={isSaving}
            >
              {isSaving ? "Сохранение..." : draft.id ? "Сохранить" : "Добавить"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {useV2 ? (
        <JournalSettingsModal
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          title="Настройки документа"
          description="Название журнала, дата начала и формат поля."
          size="md"
          isSaving={isSaving}
          onSave={async () => {
            await saveSettings();
          }}
          onCancel={() => {
            // Вариант поля — локальный state, он применяется к таблице
            // сразу; при отмене возвращаем сохранённый.
            setFieldVariant(config.fieldVariant);
            setSettingsOpen(false);
          }}
        >
          <div className="space-y-2">
            <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              Название документа
            </Label>
            <Input
              value={settingsTitle}
              onChange={(e) => setSettingsTitle(e.target.value)}
              className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              Дата начала
            </Label>
            <Input
              type="date"
              value={settingsDateFrom}
              onChange={(e) => setSettingsDateFrom(e.target.value)}
              className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
            />
          </div>
          <div className="space-y-2">
            <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              Название поля
            </div>
            {(Object.keys(EQUIPMENT_CLEANING_VARIANT_LABELS) as EquipmentCleaningFieldVariant[]).map((variant) => (
              <label
                key={variant}
                className="flex cursor-pointer items-center gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3 transition-colors hover:bg-[#f5f6ff]"
              >
                <input
                  type="radio"
                  checked={fieldVariant === variant}
                  onChange={() => setFieldVariant(variant)}
                  className="size-4 accent-[#5566f6]"
                />
                <span className="text-[14px] text-[#0b1024]">
                  {EQUIPMENT_CLEANING_VARIANT_LABELS[variant]}
                </span>
              </label>
            ))}
          </div>
        </JournalSettingsModal>
      ) : (
        <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DialogContent className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[24px] border-0 p-0 sm:max-w-[720px]">
            <DialogHeader className="border-b px-6 py-5">
              <DialogTitle className="text-[24px] font-medium text-black">
                Настройки документа
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-5 px-6 py-5">
              <div className="space-y-3">
                <Label>Название документа</Label>
                <Input value={settingsTitle} onChange={(e) => setSettingsTitle(e.target.value)} />
              </div>
              <div className="space-y-3">
                <Label>Дата начала</Label>
                <Input
                  type="date"
                  value={settingsDateFrom}
                  onChange={(e) => setSettingsDateFrom(e.target.value)}
                />
              </div>
              <div className="space-y-3">
                <div className="text-[18px] font-semibold text-black">Название поля</div>
                <div className="flex flex-col gap-3 text-[18px] text-black sm:flex-row sm:gap-8">
                  {(Object.keys(EQUIPMENT_CLEANING_VARIANT_LABELS) as EquipmentCleaningFieldVariant[]).map((variant) => (
                    <label key={variant} className="flex items-center gap-3">
                      <input
                        type="radio"
                        checked={fieldVariant === variant}
                        onChange={() => setFieldVariant(variant)}
                        className="size-5 accent-[#5566f6]"
                      />
                      {EQUIPMENT_CLEANING_VARIANT_LABELS[variant]}
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex justify-end">
                <Button onClick={saveSettings} disabled={isSaving} className="bg-[#5566f6] text-white hover:bg-[#4d58f5]">
                  {isSaving ? "Сохранение..." : "Сохранить"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[24px] border-0 p-0 sm:max-w-[560px]">
          <DialogHeader className="border-b px-6 py-5">
            <DialogTitle className="text-[24px] font-medium text-black">
              {`Закончить журнал "${title}"`}
            </DialogTitle>
          </DialogHeader>
          <div className="flex justify-end px-6 py-6">
            <Button onClick={closeDocument} disabled={isClosing} className="bg-[#5566f6] text-white hover:bg-[#4d58f5]">
              {isClosing ? "Завершение..." : "Закончить"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
