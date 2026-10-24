"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
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
import {
  getRowEmployeeTitle,
  getUserDisplayTitle,
  getUsersForRoleLabel,
  isManagementRole,
} from "@/lib/user-roles";
import {
  emptyEquipmentCleaningRow,
  formatEquipmentCleaningDate,
  getEquipmentCleaningEntryDateBounds,
  getEquipmentCleaningPeriodEnd,
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
import { humanizeFetchError } from "@/lib/humanize-fetch-error";
type UserItem = {
  id: string;
  name: string;
  role: string;
  // Должность из карточки (как в UserLike) — подпись мойщика и контролёра.
  positionTitle?: string | null;
  jobPosition?: { name: string; categoryKey: string } | null;
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

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0"));
const MINUTE_OPTIONS = Array.from({ length: 12 }, (_, index) =>
  String(index * 5).padStart(2, "0")
);

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
  const t = useTranslations("journalUi.equipmentCleaning");
  const common = useTranslations("common");
  const controls = useTranslations("journalControls");
  const staff = useTranslations("journalWidgets.staff");
  const scan = useTranslations("journalScan");
  const journalNames = useTranslations("journals.names");
  const variantLabels: Record<EquipmentCleaningFieldVariant, string> = {
    rinse_temperature: t("variantRinseTemperature"),
    rinse_completeness: t("variantRinseCompleteness"),
  };
  const resultLabel = (value: EquipmentCleaningRowData["rinseResult"]) =>
    value === "non_compliant" ? t("nonCompliant") : value === "compliant" ? t("compliant") : "";
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
      // Без «Управляющий» по умолчанию: должность подставится из карточки
      // выбранного контролёра.
      controllerPosition: "",
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

  // Должность контролёра — из его карточки, не копия строки (туда
  // подставлялось «Управляющий» по роли). Копия — если его уже нет.
  const controllerTitle = (data: EquipmentCleaningRowData) =>
    getRowEmployeeTitle(
      users.find((user) => user.id === data.controllerUserId),
      data.controllerPosition
    );

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
      { label: t("detergentCard"), value: row.data.detergentName, hideIfEmpty: true },
      { label: t("detergentConcentrationCard"), value: row.data.detergentConcentration, hideIfEmpty: true },
      { label: t("disinfectantCard"), value: row.data.disinfectantName, hideIfEmpty: true },
      { label: t("disinfectantConcentrationCard"), value: row.data.disinfectantConcentration, hideIfEmpty: true },
      {
        label: fieldVariant === "rinse_temperature" ? t("rinseTemperature") : t("phNeutral"),
        value: fieldVariant === "rinse_temperature"
          ? row.data.rinseTemperature
          : resultLabel(row.data.rinseResult),
        hideIfEmpty: true,
      },
      { label: t("washer"), value: row.data.washerName, hideIfEmpty: true },
      {
        label: t("control"),
        value: [controllerTitle(row.data), row.data.controllerName].filter(Boolean).join(", "),
        hideIfEmpty: true,
      },
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
        // Должность мойщика — из карточки вошедшего (справочник должностей),
        // а не лейбл роли: иначе селект с должностями открывался пустым.
        washerPosition: washer ? getUserDisplayTitle(washer) : "",
        washerName: washer?.name || "",
        washerUserId: washer?.id || null,
        controllerPosition: controller ? getUserDisplayTitle(controller) : "",
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
        toast.error(t("equipmentNameRequired"));
        return;
      }
      if (!target.data.washDate) {
        toast.error(t("washDateRequired"));
        return;
      }
      if (target.data.washDate > dateBounds.max) {
        toast.error(t("washDateFuture"));
        return;
      }
      if (target.data.washDate < dateBounds.min) {
        toast.error(t("washDateBeforeStart"));
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
        throw new Error(payload?.error || t("saveRowFailed"));
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
      toast.error(humanizeFetchError(error, t("saveRowError")));
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
      toast.error(t("deleteRowsFailed"));
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
      toast.error(t("saveJournalSettingsFailed"));
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
      toast.error(controls("closeDocument.failed"));
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
                    toast.error(t("deleteRowsFailed"));
                  });
                }
              : undefined
          }
          hint={t("deleteRowsHint")}
        >
          <SelectionEditButton count={selectedIds.length} disabled={status !== "active"} onClick={() => seq.start(selectedIds)} />
        </JournalSelectionBar>
      ) : null}

      <FocusTodayScroller selector="[data-focus-today]" emptyTitle={scan("focus.emptyTitle")} emptyBody={scan("focus.emptyBody")} />
      <JournalDocumentShell
        title={title}
        subtitle={`${t("startedOn", { date: formatEquipmentCleaningDate(settingsDateFrom) })}${isSaving ? ` · ${common("saving")}` : ""}`}
        documentId={documentId}
        backHref={`/journals/${journalRouteCode}`}
        onSettings={() => setSettingsOpen(true)}
        closed={status !== "active"}
        closedHint={t("closedHint")}
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
                  label: staff("closeJournal"),
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
            emptyLabel={t("noRecordsCards")}
          />
        }
        paperHeader={
          <JournalDocumentHeader
            orgName={organizationName}
            title={journalNames("equipment_cleaning")}
            startedAt={settingsDateFrom}
            finishedAt={status === "closed" ? new Date() : null}
          />
        }
        sheetTitle={journalNames("equipment_cleaning")}
        sheetMinWidth={1380}
        toolbar={
          <Button
            type="button"
            onClick={openCreateRow}
            disabled={status !== "active"}
            className={DOC_PRIMARY_BUTTON_CLASS}
          >
            <Plus className="size-5" />
            {common("add")}
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
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>{t("washDateTime")}</th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>{controls("equipmentDirectory.label")}</th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>{t("detergentName")}</th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>{t("detergentConcentration")}</th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>{t("disinfectantName")}</th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>{t("disinfectantConcentration")}</th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>
                  {fieldVariant === "rinse_temperature"
                    ? t("rinseTemperature")
                    : t("rinseCompletenessHeader")}
                </th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>{t("washerFull")}</th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>{t("controllerFull")}</th>
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
                      : resultLabel(row.data.rinseResult) || "—"}
                  </td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{row.data.washerName}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>
                    {[controllerTitle(row.data), row.data.controllerName].filter(Boolean).join(", ")}
                  </td>
                </tr>
              ))}
              {sortedRows.length === 0 ? (
                <tr>
                  <td colSpan={10} className={`${GRID_CELL_CLASS} px-2 py-6 text-center text-[#6d7287]`}>
                    {scan("focus.emptyTitle")}
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
                  label={t("addRecord")}
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
              {draft.id ? `${t("editRowTitle")}${seq.progress ? ` ${seq.progress}` : ""}` : t("addRowTitle")}
            </DialogTitle>
          </DialogHeader>

          <div className="max-h-[calc(92vh-160px)] space-y-5 overflow-y-auto px-6 py-5">
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">{t("washDateTime")}</Label>
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
                    <option key={hour} value={hour}>{t("hoursOption", { hour })}</option>
                  ))}
                </select>
                <select
                  className="h-9 w-full rounded-xl border border-[#dcdfed] bg-white px-3.5 text-[13.5px] text-[#0b1024]"
                  value={draftTime.minute}
                  onChange={(e) => updateDraft({ washTime: mergeTime(draftTime.hour, e.target.value) })}
                >
                  {MINUTE_OPTIONS.map((minute) => (
                    <option key={minute} value={minute}>{t("minutesOption", { minute })}</option>
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
                <Label className="text-[13px] font-medium text-[#3c4053]">{controls("equipmentDirectory.label")}</Label>
                <Input
                  list="equipment-cleaning-options"
                  className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
                  value={draft.data.equipmentName}
                  onChange={(e) => updateDraft({ equipmentName: e.target.value })}
                  placeholder={t("enterEquipmentName")}
                />
                <datalist id="equipment-cleaning-options">
                  {Array.from(new Set(equipmentOptions)).map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">{t("detergentName")}</Label>
              <Input
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
                value={draft.data.detergentName}
                onChange={(e) => updateDraft({ detergentName: e.target.value })}
                placeholder={t("enterDetergentName")}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">{t("detergentConcentration")}</Label>
              <Input
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
                value={draft.data.detergentConcentration}
                onChange={(e) => updateDraft({ detergentConcentration: e.target.value })}
                placeholder={t("enterDetergentConcentration")}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">{t("disinfectantName")}</Label>
              <Input
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
                value={draft.data.disinfectantName}
                onChange={(e) => updateDraft({ disinfectantName: e.target.value })}
                placeholder={t("enterDisinfectantName")}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">{t("disinfectantConcentration")}</Label>
              <Input
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
                value={draft.data.disinfectantConcentration}
                onChange={(e) => updateDraft({ disinfectantConcentration: e.target.value })}
                placeholder={t("enterDisinfectantConcentration")}
              />
            </div>

            {fieldVariant === "rinse_temperature" ? (
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#3c4053]">{t("rinseTemperature")}</Label>
                <Input
                  className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
                  value={draft.data.rinseTemperature || ""}
                  onChange={(e) => updateDraft({ rinseTemperature: e.target.value })}
                  placeholder={t("enterRinseTemperature")}
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#3c4053]">
                  {t("rinseCompleteness")}
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ["compliant", t("compliant"), "#136b2a", "#ecfdf5"],
                      ["non_compliant", t("nonCompliant"), "#d2453d", "#fff4f2"],
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
                <Label className="text-[13px] font-medium text-[#3c4053]">{t("washer")}</Label>
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
                  <option value="">{t("choose")}</option>
                  <PositionNativeOptions users={users} />
                </select>
              </div>
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#3c4053]">{staff("employee")}</Label>
                <select
                  className="h-9 w-full rounded-xl border border-[#dcdfed] bg-white px-3.5 text-[13.5px] text-[#0b1024]"
                  value={draft.data.washerUserId || ""}
                  onChange={(e) => {
                    const value = e.target.value;
                    const user = users.find((item) => item.id === value);
                    updateDraft({
                      washerUserId: value,
                      washerName: user?.name || "",
                      // Должность выбранного человека из карточки.
                      ...(user ? { washerPosition: getUserDisplayTitle(user) } : {}),
                    });
                  }}
                >
                  <option value="">{t("choose")}</option>
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
                <Label className="text-[13px] font-medium text-[#3c4053]">{t("controllerPosition")}</Label>
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
                  <option value="">{t("choose")}</option>
                  <PositionNativeOptions users={users} />
                </select>
              </div>
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#3c4053]">{staff("employee")}</Label>
                <select
                  className="h-9 w-full rounded-xl border border-[#dcdfed] bg-white px-3.5 text-[13.5px] text-[#0b1024]"
                  value={draft.data.controllerUserId || ""}
                  onChange={(e) => {
                    const value = e.target.value;
                    const user = users.find((item) => item.id === value);
                    updateDraft({
                      controllerUserId: value,
                      controllerName: user?.name || "",
                      ...(user ? { controllerPosition: getUserDisplayTitle(user) } : {}),
                    });
                  }}
                >
                  <option value="">{t("choose")}</option>
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
              {common("cancel")}
            </Button>
            <Button
              type="button"
              className="h-10 w-full rounded-xl bg-[#5566f6] px-5 text-[14px] font-medium text-white hover:bg-[#4a5bf0] sm:w-auto"
              onClick={() => void saveRow()}
              disabled={isSaving}
            >
              {isSaving ? common("saving") : draft.id ? common("save") : common("add")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {useV2 ? (
        <JournalSettingsModal
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          title={staff("settings")}
          description={t("settingsDescription")}
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
              {staff("documentName")}
            </Label>
            <Input
              value={settingsTitle}
              onChange={(e) => setSettingsTitle(e.target.value)}
              className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              {scan("metadata.startDate")}
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
              {t("fieldName")}
            </div>
            {(Object.keys(variantLabels) as EquipmentCleaningFieldVariant[]).map((variant) => (
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
                  {variantLabels[variant]}
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
                {staff("settings")}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-5 px-6 py-5">
              <div className="space-y-3">
                <Label>{staff("documentName")}</Label>
                <Input value={settingsTitle} onChange={(e) => setSettingsTitle(e.target.value)} />
              </div>
              <div className="space-y-3">
                <Label>{scan("metadata.startDate")}</Label>
                <Input
                  type="date"
                  value={settingsDateFrom}
                  onChange={(e) => setSettingsDateFrom(e.target.value)}
                />
              </div>
              <div className="space-y-3">
                <div className="text-[18px] font-semibold text-black">{t("fieldName")}</div>
                <div className="flex flex-col gap-3 text-[18px] text-black sm:flex-row sm:gap-8">
                  {(Object.keys(variantLabels) as EquipmentCleaningFieldVariant[]).map((variant) => (
                    <label key={variant} className="flex items-center gap-3">
                      <input
                        type="radio"
                        checked={fieldVariant === variant}
                        onChange={() => setFieldVariant(variant)}
                        className="size-5 accent-[#5566f6]"
                      />
                      {variantLabels[variant]}
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex justify-end">
                <Button onClick={saveSettings} disabled={isSaving} className="bg-[#5566f6] text-white hover:bg-[#4d58f5]">
                  {isSaving ? common("saving") : common("save")}
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
              {controls("documentLifecycle.finishTitle", { title })}
            </DialogTitle>
          </DialogHeader>
          <div className="flex justify-end px-6 py-6">
            <Button onClick={closeDocument} disabled={isClosing} className="bg-[#5566f6] text-white hover:bg-[#4d58f5]">
              {isClosing ? controls("documentLifecycle.finishing") : controls("documentLifecycle.finishAction")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
