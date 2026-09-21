"use client";

import { Fragment, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, Plus, ListPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { USER_ROLE_LABEL_VALUES, getUserRoleLabel } from "@/lib/user-roles";
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
  type EquipmentMaintenanceConfig,
  type EquipmentMaintenanceRow,
  type MaintenanceType,
  createEquipmentMaintenanceRow,
  normalizeEquipmentMaintenanceConfig,
  MONTH_KEYS,
  MONTH_LABELS,
  MONTH_FULL_LABELS,
  getMonthDayOptions,
  formatMaintenanceDate,
} from "@/lib/equipment-maintenance-document";
import {
  getMissingDirectoryEquipment,
  resolveEquipmentRowName,
  type EquipmentDirectoryOption,
} from "@/lib/equipment-directory-link";
import { EquipmentDirectoryField } from "@/components/journals/equipment-directory-field";
import { buildStaffOptionLabel } from "@/lib/journal-staff-binding";
import { JournalDocumentShell } from "@/components/journals/journal-document-shell";
import { JournalDocumentHeader } from "@/components/journals/journal-document-header";
import { JournalAddRow } from "@/components/journals/journal-add-row";
import { GRID_CELL_CLASS, GRID_HEAD_CELL_CLASS } from "@/components/journals/journal-grid";
import { JournalSettingsModal } from "@/components/journals/v2/journal-settings-modal";
import { FocusTodayScroller } from "@/components/journals/focus-today-scroller";
import { JournalSelectionBar } from "@/components/journals/journal-selection-bar";
import { SelectionEditButton } from "@/components/journals/selection-edit-button";
import { useSequentialEdit } from "@/components/journals/use-sequential-edit";
import { useDocumentCloseAction } from "@/components/journals/document-close-button";
import { useMobileView } from "@/lib/use-mobile-view";
import {
  RecordCardsView,
  type RecordCardItem,
} from "@/components/journals/record-cards-view";

import { toast } from "sonner";
import {
  PositionSelectItems,
  usePositionEmployeeCascade,
} from "@/components/shared/position-select";
import { ORG_NAME_FALLBACK } from "@/lib/journal-constants";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";

type Props = {
  documentId: string;
  title: string;
  organizationName: string;
  dateFrom: string;
  status: string;
  initialConfig: EquipmentMaintenanceConfig;
  users: { id: string; name: string; role: string }[];
  /** Справочник «Оборудование» организации — источник имён для строк. */
  equipmentDirectory?: EquipmentDirectoryOption[];
  /** Design v2 toggle. */
  useV2?: boolean;
};

const POSITION_OPTIONS = USER_ROLE_LABEL_VALUES;

function buildYearOptions(currentYear: number) {
  const options: number[] = [];
  for (let y = currentYear - 5; y <= currentYear + 5; y++) {
    options.push(y);
  }
  return options;
}

export function EquipmentMaintenanceDocumentClient({
  documentId,
  title,
  organizationName,
  dateFrom,
  status,
  initialConfig,
  users,
  equipmentDirectory = [],
  useV2 = false,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [isSaving, setIsSaving] = useState(false);
  const [config, setConfig] = useState(() =>
    normalizeEquipmentMaintenanceConfig(initialConfig)
  );
  // Последний применённый конфиг — источник правды для быстрых подряд
  // идущих правок (см. mutateConfig).
  const configRef = useRef(config);
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Settings form state
  const [settingsTitle, setSettingsTitle] = useState(title);
  const [settingsDate, setSettingsDate] = useState(config.documentDate);
  const [settingsYear, setSettingsYear] = useState(config.year);
  const [settingsApproveRole, setSettingsApproveRole] = useState(config.approveRole);
  const [settingsApproveEmployeeId, setSettingsApproveEmployeeId] = useState(
    config.approveEmployeeId || ""
  );
  const [settingsApproveEmployee, setSettingsApproveEmployee] = useState(config.approveEmployee);
  const [settingsResponsibleRole, setSettingsResponsibleRole] = useState(config.responsibleRole);
  const [settingsResponsibleEmployeeId, setSettingsResponsibleEmployeeId] = useState(
    config.responsibleEmployeeId || ""
  );
  const [settingsResponsibleEmployee, setSettingsResponsibleEmployee] = useState(config.responsibleEmployee);
  const approveCascade = usePositionEmployeeCascade({
    users,
    positionTitle: settingsApproveRole,
    userId: settingsApproveEmployeeId,
    onChange: (next) => {
      const user = users.find((item) => item.id === next.userId);
      setSettingsApproveRole(next.positionTitle);
      setSettingsApproveEmployeeId(next.userId);
      setSettingsApproveEmployee(user?.name || settingsApproveEmployee);
    },
    autoPick: "first",
  });
  const responsibleCascade = usePositionEmployeeCascade({
    users,
    positionTitle: settingsResponsibleRole,
    userId: settingsResponsibleEmployeeId,
    onChange: (next) => {
      const user = users.find((item) => item.id === next.userId);
      setSettingsResponsibleRole(next.positionTitle);
      setSettingsResponsibleEmployeeId(next.userId);
      setSettingsResponsibleEmployee(user?.name || settingsResponsibleEmployee);
    },
    autoPick: "first",
  });

  // Add row draft state
  const [draftSourceEquipmentId, setDraftSourceEquipmentId] = useState<
    string | null
  >(null);
  const [draftEquipmentName, setDraftEquipmentName] = useState("");
  const [draftWorkType, setDraftWorkType] = useState("");
  const [draftMaintenanceType, setDraftMaintenanceType] = useState<MaintenanceType>("A");
  const [draftPlan, setDraftPlan] = useState<Record<string, string>>(() =>
    Object.fromEntries(MONTH_KEYS.map((k) => [k, "-"]))
  );

  // Edit row draft state — те же поля, что и при добавлении: раньше в
  // окне правки нельзя было изменить тип обслуживания и план, а факт
  // нельзя было отметить с телефона (в «Карточках» нет таблицы).
  const [editSourceEquipmentId, setEditSourceEquipmentId] = useState<
    string | null
  >(null);
  const [editEquipmentName, setEditEquipmentName] = useState("");
  const [editWorkType, setEditWorkType] = useState("");
  const [editMaintenanceType, setEditMaintenanceType] =
    useState<MaintenanceType>("A");
  const [editPlan, setEditPlan] = useState<Record<string, string>>(() =>
    Object.fromEntries(MONTH_KEYS.map((k) => [k, "-"]))
  );
  const [editFact, setEditFact] = useState<Record<string, string>>(() =>
    Object.fromEntries(MONTH_KEYS.map((k) => [k, ""]))
  );

  const isClosed = status === "closed";
  const organizationLabel = organizationName || ORG_NAME_FALLBACK;
  const { mobileView, switchMobileView } = useMobileView("equipment_maintenance");
  const { closeDocument, isClosing } = useDocumentCloseAction({ documentId, title });

  /** Имя строки: у связанных — из справочника, у остальных — сохранённое. */
  const rowName = (row: EquipmentMaintenanceRow) =>
    resolveEquipmentRowName(row, equipmentDirectory);
  const missingEquipment = getMissingDirectoryEquipment(
    equipmentDirectory,
    config.rows
  );

  const cardItems: RecordCardItem[] = config.rows.map((row, index) => {
    const planSummary = MONTH_KEYS.map((k) => `${MONTH_LABELS[k]}:${row.plan[k] || "—"}`)
      .filter((s) => !s.endsWith(":-"))
      .join(" · ");
    const factSummary = MONTH_KEYS.map((k) => `${MONTH_LABELS[k]}:${row.fact[k] || "—"}`)
      .filter((s) => !s.endsWith(":—"))
      .join(" · ");
    return {
      id: row.id,
      title: `№${index + 1} · ${rowName(row) || "—"}`,
      subtitle: row.workType || undefined,
      badge: (
        <span className="rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[11px] font-semibold text-[#5566f6]">
          Тип {row.maintenanceType}
        </span>
      ),
      leading: !isClosed ? (
        <Checkbox
          checked={selectedRows.includes(row.id)}
          onCheckedChange={(checked) => toggleRow(row.id, checked === true)}
          className="size-5"
        />
      ) : null,
      fields: [
        { label: "План по месяцам", value: planSummary, hideIfEmpty: true },
        { label: "Факт по месяцам", value: factSummary, hideIfEmpty: true },
      ],
      onClick: !isClosed ? () => openEditRow(row.id) : undefined,
      actions: !isClosed ? (
        <button
          type="button"
          onClick={() => openEditRow(row.id)}
          className="inline-flex h-10 items-center justify-center rounded-2xl bg-[#5563ff] px-4 text-[14px] font-medium text-white hover:bg-[#4452ee]"
        >
          Редактировать
        </button>
      ) : null,
    };
  });

  /* ---------- persistence ---------- */

  async function saveConfig(nextConfig: EquipmentMaintenanceConfig) {
    const response = await fetch(`/api/journal-documents/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: nextConfig }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(result?.error || "Не удалось сохранить журнал");
    }
    startTransition(() => router.refresh());
  }

  /**
   * ПОЧЕМУ ref + функциональная правка: отметки факта ставят подряд, а
   * `next` строился из `config` из замыкания — второй клик до re-render'а
   * затирал первый. И при отказе сервера оптимистичное состояние
   * оставалось на экране, хотя в базу ничего не легло.
   */
  function applyConfig(next: EquipmentMaintenanceConfig) {
    configRef.current = next;
    setConfig(next);
  }

  async function mutateConfig(
    mutate: (current: EquipmentMaintenanceConfig) => EquipmentMaintenanceConfig
  ) {
    const previous = configRef.current;
    const next = mutate(previous);
    applyConfig(next);
    setIsSaving(true);
    try {
      await saveConfig(next);
    } catch (error) {
      applyConfig(previous);
      toast.error(
        humanizeFetchError(error, "Не удалось сохранить журнал")
      );
    } finally {
      setIsSaving(false);
    }
  }

  /* ---------- row helpers ---------- */

  function toggleRow(id: string, checked: boolean) {
    setSelectedRows((prev) =>
      checked ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)
    );
  }

  function removeSelectedRows() {
    if (selectedRows.length === 0) return;
    const doomed = selectedRows;
    setSelectedRows([]);
    void mutateConfig((current) => ({
      ...current,
      rows: current.rows.filter((row) => !doomed.includes(row.id)),
    }));
  }

  /* ---------- add row ---------- */

  /**
   * Дописывает строки для оборудования, которого в графике ещё нет.
   * План и факт пустые — отметки ставит человек.
   */
  function addMissingFromDirectory() {
    if (missingEquipment.length === 0) return;
    const added = missingEquipment.map((item) =>
      createEquipmentMaintenanceRow({
        sourceEquipmentId: item.id,
        equipmentName: item.name,
        maintenanceType: "A",
        plan: Object.fromEntries(MONTH_KEYS.map((k) => [k, "-"])),
        fact: Object.fromEntries(MONTH_KEYS.map((k) => [k, ""])),
      })
    );
    void mutateConfig((current) => ({
      ...current,
      rows: [...current.rows, ...added],
    }));
    toast.success(`Добавлено строк из справочника: ${added.length}`);
  }

  function resetDraft() {
    setDraftSourceEquipmentId(null);
    setDraftEquipmentName("");
    setDraftWorkType("");
    setDraftMaintenanceType("A");
    setDraftPlan(Object.fromEntries(MONTH_KEYS.map((k) => [k, "-"])));
  }

  function saveDraftRow() {
    const newRow = createEquipmentMaintenanceRow({
      sourceEquipmentId: draftSourceEquipmentId,
      equipmentName: draftEquipmentName,
      workType: draftWorkType,
      maintenanceType: draftMaintenanceType,
      plan: { ...draftPlan },
      fact: Object.fromEntries(MONTH_KEYS.map((k) => [k, ""])),
    });
    void mutateConfig((current) => ({
      ...current,
      rows: [...current.rows, newRow],
    }));
    resetDraft();
    setAddModalOpen(false);
  }

  /* ---------- edit row ---------- */

  function openEditRow(rowId: string) {
    const row = configRef.current.rows.find((r) => r.id === rowId);
    if (!row) return;
    setEditingRowId(rowId);
    setEditSourceEquipmentId(row.sourceEquipmentId);
    setEditEquipmentName(row.equipmentName);
    setEditWorkType(row.workType);
    setEditMaintenanceType(row.maintenanceType);
    setEditPlan(
      Object.fromEntries(MONTH_KEYS.map((k) => [k, row.plan[k] || "-"]))
    );
    setEditFact(
      Object.fromEntries(MONTH_KEYS.map((k) => [k, row.fact[k] || ""]))
    );
    setEditModalOpen(true);
  }

  /** Правка выделенных строк по очереди — тем же окном. */
  const seq = useSequentialEdit({
    open: (id) => {
      const row = configRef.current.rows.find((item) => item.id === id);
      if (!row || isClosed) return false;
      openEditRow(id);
      return true;
    },
    close: () => {
      setEditModalOpen(false);
      setEditingRowId(null);
    },
  });

  function closeEditModal() {
    // Закрытие без сохранения прерывает очередь («Изменено k из N»).
    seq.cancelled();
  }

  function saveEditRow() {
    if (!editingRowId) return;
    const rowId = editingRowId;
    const patch = {
      sourceEquipmentId: editSourceEquipmentId,
      equipmentName: editEquipmentName,
      workType: editWorkType,
      maintenanceType: editMaintenanceType,
      plan: { ...editPlan },
      fact: { ...editFact },
    };
    void mutateConfig((current) => ({
      ...current,
      rows: current.rows.map((row) =>
        row.id === rowId ? { ...row, ...patch } : row
      ),
    }));
    // Очередь правок откроет следующую строку или закроет окно.
    seq.saved();
  }

  /* ---------- fact cell change ---------- */

  function handleFactChange(rowId: string, monthKey: string, value: string) {
    void mutateConfig((current) => ({
      ...current,
      rows: current.rows.map((row) =>
        row.id === rowId
          ? { ...row, fact: { ...row.fact, [monthKey]: value } }
          : row
      ),
    }));
  }

  /* ---------- settings save ---------- */

  function openSettings() {
    setSettingsTitle(title);
    setSettingsDate(config.documentDate);
    setSettingsYear(config.year);
    setSettingsApproveRole(config.approveRole);
    setSettingsApproveEmployeeId(config.approveEmployeeId || "");
    setSettingsApproveEmployee(config.approveEmployee);
    setSettingsResponsibleRole(config.responsibleRole);
    setSettingsResponsibleEmployeeId(config.responsibleEmployeeId || "");
    setSettingsResponsibleEmployee(config.responsibleEmployee);
    setSettingsOpen(true);
  }

  async function handleSaveSettings() {
    const nextConfig: EquipmentMaintenanceConfig = {
      ...configRef.current,
      documentDate: settingsDate,
      year: settingsYear,
      approveRole: settingsApproveRole,
      approveEmployeeId: settingsApproveEmployeeId || null,
      approveEmployee: settingsApproveEmployee,
      responsibleRole: settingsResponsibleRole,
      responsibleEmployeeId: settingsResponsibleEmployeeId || null,
      responsibleEmployee: settingsResponsibleEmployee,
    };
    const previous = configRef.current;
    applyConfig(nextConfig);

    setIsSaving(true);
    try {
      const response = await fetch(`/api/journal-documents/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: nextConfig, title: settingsTitle }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.error || "Не удалось сохранить настройки");
      }
      setSettingsOpen(false);
      startTransition(() => router.refresh());
    } catch (error) {
      // Откат: иначе на экране остаются настройки, которых нет в базе.
      applyConfig(previous);
      toast.error(
        humanizeFetchError(error, "Не удалось сохранить настройки")
      );
    } finally {
      setIsSaving(false);
    }
  }

  /* ---------- helpers ---------- */

  const yearOptions = buildYearOptions(config.year);

  return (
    <div className="space-y-6 text-black">
      <FocusTodayScroller selector="[data-focus-today]" emptyTitle="Записей пока нет" emptyBody="Нажмите «Добавить» в таблице ниже, чтобы создать запись." />

      {selectedRows.length > 0 && !isClosed && (
        <JournalSelectionBar
          count={selectedRows.length}
          onClear={() => setSelectedRows([])}
          onDelete={removeSelectedRows}
          hint="Строки графика будут удалены без возможности отмены"
        >
          <SelectionEditButton count={selectedRows.length} disabled={isClosed} onClick={() => seq.start(selectedRows)} />
        </JournalSelectionBar>
      )}

      <JournalDocumentShell
        title={title}
        documentId={documentId}
        backHref="/journals/equipment_maintenance"
        onSettings={openSettings}
        closed={isClosed}
        closedHint="Откройте журнал заново, чтобы редактировать график обслуживания."
        menuItems={
          !isClosed
            ? [
                {
                  key: "close-journal",
                  label: "Закончить журнал",
                  icon: <Archive className="size-4" />,
                  onSelect: () => void closeDocument(),
                  disabled: isClosing,
                },
              ]
            : []
        }
        mobileView={mobileView}
        onMobileView={switchMobileView}
        cards={
          <RecordCardsView items={cardItems} emptyLabel="Оборудование не внесено." />
        }
        paperHeader={
          <>
            <JournalDocumentHeader
              orgName={organizationLabel}
              title="ГРАФИК ПРОФИЛАКТИЧЕСКОГО ОБСЛУЖИВАНИЯ ОБОРУДОВАНИЯ"
              startedAt={dateFrom}
              finishedAt={isClosed ? config.documentDate : null}
            />

            {/* "УТВЕРЖДАЮ" block */}
            <div className="mt-4 flex justify-end">
              <div className="w-[400px] text-right text-sm leading-relaxed">
                <div className="font-semibold uppercase">УТВЕРЖДАЮ</div>
                <div>{config.approveRole}</div>
                <div className="mt-1 flex items-center justify-end gap-2">
                  <span className="inline-block w-[180px] border-b border-black" />
                  <span>{config.approveEmployee}</span>
                </div>
                <div className="mt-1">
                  {config.documentDate
                    ? formatMaintenanceDate(config.documentDate)
                    : ""}
                </div>
              </div>
            </div>
          </>
        }
        sheetTitle={`График профилактического обслуживания оборудования на ${config.year} г.`}
        sheetMinWidth={1200}
        toolbar={
          !isClosed ? (
            <>
              <Button
                type="button"
                className="bg-[#5566f6] hover:bg-[#4d58f5]"
                onClick={() => {
                  resetDraft();
                  setAddModalOpen(true);
                }}
              >
                <Plus className="size-4" />
                Добавить
              </Button>

              {/* Одно действие вместо ручного переписывания справочника:
                  добавленное в /settings/equipment раньше не попадало в
                  уже созданный график вообще. */}
              {missingEquipment.length > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  className="border-[#dcdfed]"
                  onClick={addMissingFromDirectory}
                  title="Оборудование из справочника, которого нет в графике"
                >
                  <ListPlus className="size-4" />
                  Добавить из справочника ({missingEquipment.length})
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      >
        <table className="mb-2 w-full border-collapse text-[13px]">
          <tbody>
            <tr>
              <td className={`${GRID_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>
                Тип профилактического обслуживания
              </td>
              <td className={`${GRID_CELL_CLASS} px-2 py-1.5 leading-tight`}>
                <span className="font-bold">A</span> = Ежемесячно
              </td>
              <td className={`${GRID_CELL_CLASS} px-2 py-1.5 leading-tight`}>
                <span className="font-bold">B</span> = Ежегодно
              </td>
            </tr>
          </tbody>
        </table>

        {/* Main table */}
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className={`w-10 ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 leading-tight`} />
              <th className={`w-12 ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 leading-tight`}>
                № п/п
              </th>
              <th className={`w-[220px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 leading-tight`}>
                Название оборудования / Вид работ
              </th>
              <th className={`w-16 ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 leading-tight`} />
              {MONTH_KEYS.map((key) => (
                <th key={key} className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>
                  {MONTH_LABELS[key]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {config.rows.map((row, index) => {
              const rowClickHandler = () => {
                if (isClosed) return;
                openEditRow(row.id);
              };
              const rowClassName = !isClosed ? "cursor-pointer hover:bg-gray-50" : undefined;
              return (
              <Fragment key={row.id}>
                {/* Sub-row 1: Тип */}
                <tr className={rowClassName} onClick={rowClickHandler}>
                  <td
                    rowSpan={3}
                    className={`${GRID_CELL_CLASS} px-2 py-1 text-center align-middle leading-tight`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {!isClosed && (
                      <Checkbox
                        checked={selectedRows.includes(row.id)}
                        onCheckedChange={(checked) =>
                          toggleRow(row.id, checked === true)
                        }
                      />
                    )}
                  </td>
                  <td
                    rowSpan={3}
                    className={`${GRID_CELL_CLASS} px-2 py-1 text-center align-middle leading-tight`}
                  >
                    {index + 1}
                  </td>
                  <td
                    rowSpan={3}
                    className={`${GRID_CELL_CLASS} px-2 py-2 align-top leading-tight`}
                  >
                    <div className="font-medium">{rowName(row)}</div>
                    {row.workType && (
                      <div className="mt-1 text-[13px] text-gray-500">
                        {row.workType}
                      </div>
                    )}
                  </td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center text-[13px] font-medium leading-tight`}>
                    Тип
                  </td>
                  {MONTH_KEYS.map((key) => (
                    <td
                      key={`type-${key}`}
                      className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}
                    >
                      <span className="font-bold">{row.maintenanceType}</span>
                    </td>
                  ))}
                </tr>

                {/* Sub-row 2: План */}
                <tr className={rowClassName} onClick={rowClickHandler}>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center text-[13px] font-medium leading-tight`}>
                    План
                  </td>
                  {MONTH_KEYS.map((key) => (
                    <td
                      key={`plan-${key}`}
                      className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}
                    >
                      {row.plan[key] || "-"}
                    </td>
                  ))}
                </tr>

                {/* Sub-row 3: Факт */}
                <tr className={rowClassName} onClick={rowClickHandler}>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center text-[13px] font-medium leading-tight`}>
                    Факт
                  </td>
                  {MONTH_KEYS.map((key) => (
                    <td
                      key={`fact-${key}`}
                      className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {isClosed ? (
                        row.fact[key] || ""
                      ) : (
                        <select
                          className="w-full border-0 bg-transparent text-center text-sm outline-none cursor-pointer"
                          value={row.fact[key] || ""}
                          onChange={(e) =>
                            handleFactChange(row.id, key, e.target.value)
                          }
                        >
                          <option value="">--</option>
                          {getMonthDayOptions(key, config.year).map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                  ))}
                </tr>
              </Fragment>
              );
            })}

            {config.rows.length === 0 && (
              <tr>
                <td
                  colSpan={4 + MONTH_KEYS.length}
                  className={`${GRID_CELL_CLASS} px-2 py-4 text-center text-gray-400 leading-tight`}
                >
                  Нет записей. Нажмите &laquo;Добавить&raquo; чтобы добавить оборудование.
                </td>
              </tr>
            )}

            {/* Кликабельная пустая строка — то же окно, что и кнопка
                «Добавить» в тулбаре шапки документа. Стоит ПЕРЕД строкой
                «Ответственный»: та строка — часть бланка и остаётся снизу,
                как на бумаге. leading=2 (чекбокс + № п/п), labelSpan=1 —
                подпись под колонкой «Название оборудования / Вид работ»,
                единственным содержательным столбцом записи. Всё остальное
                пустое: колонка-метка Тип/План/Факт (не содержит данных
                самой записи) + месяцы — trailing = 1 + MONTH_KEYS.length.
                Сумма 2+1+(1+MONTH_KEYS.length) = 4+MONTH_KEYS.length — тот
                же colSpan, что был раньше. */}
            {!isClosed ? (
              <JournalAddRow
                leading={2}
                labelSpan={1}
                trailing={1 + MONTH_KEYS.length}
                label="Добавить оборудование"
                onClick={() => {
                  resetDraft();
                  setAddModalOpen(true);
                }}
              />
            ) : null}

            {/* Responsible row */}
            <tr>
              <td
                colSpan={4 + MONTH_KEYS.length}
                className={`${GRID_CELL_CLASS} px-2 py-2 text-[13px] leading-tight`}
              >
                Ответственный: {config.responsibleRole},{" "}
                {config.responsibleEmployee}
              </td>
            </tr>

            {/* Extra blank row — раньше была единственной «пустой строкой»
                бланка, но на экране была нежива (чекбокс задизейблен,
                клика нет). Теперь эту роль играет JournalAddRow выше, а
                эта строка остаётся только «полом» бланка при печати. */}
            <tr className="hidden print:table-row">
              <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>
                <Checkbox disabled />
              </td>
              <td
                colSpan={3 + MONTH_KEYS.length}
                className={`${GRID_CELL_CLASS} px-2 py-1 leading-tight`}
              />
            </tr>
          </tbody>
        </table>
      </JournalDocumentShell>

      {/* ---------- Add Row Dialog ---------- */}
      <Dialog open={addModalOpen} onOpenChange={setAddModalOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] max-h-[92vh] supports-[height:100dvh]:max-h-[92dvh] overflow-hidden rounded-[24px] border-0 p-0 sm:max-w-[640px]">
          <DialogHeader className="border-b px-6 py-5">
            <DialogTitle className="text-[18px] font-semibold tracking-[-0.02em] text-[#0b1024]">
              Добавление новой строки
            </DialogTitle>
          </DialogHeader>

          <div className="max-h-[calc(92vh-160px)] space-y-5 overflow-y-auto px-6 py-5">
            <EquipmentDirectoryField
              label="Название оборудования"
              value={draftEquipmentName}
              sourceEquipmentId={draftSourceEquipmentId}
              directory={equipmentDirectory}
              documentId={documentId}
              onChange={(name, sourceId) => {
                setDraftEquipmentName(name);
                setDraftSourceEquipmentId(sourceId);
              }}
            />

            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">Вид работ по обслуживанию</Label>
              <Textarea
                className="rounded-2xl border-[#dcdfed] px-4 py-3 text-[15px]"
                value={draftWorkType}
                onChange={(e) => setDraftWorkType(e.target.value)}
                placeholder="Вид работ"
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">Тип обслуживания</Label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  ["A", "A = Ежемесячно"],
                  ["B", "B = Ежегодно"],
                ] as const).map(([value, label]) => {
                  const active = draftMaintenanceType === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setDraftMaintenanceType(value)}
                      className={`flex h-9 items-center justify-center rounded-xl border px-3.5 text-[14px] font-medium transition-colors ${
                        active
                          ? "border-[#5566f6] bg-[#5566f6] text-white"
                          : "border-[#dcdfed] bg-white text-[#0b1024] hover:bg-[#fafbff]"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">Плановые дни по месяцам</Label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {MONTH_KEYS.map((key) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="w-20 text-[13px] text-[#3c4053]">{MONTH_FULL_LABELS[key]}</span>
                    <select
                      className="h-10 flex-1 rounded-xl border border-[#dcdfed] bg-white px-3 text-[14px] text-[#0b1024]"
                      value={draftPlan[key]}
                      onChange={(e) =>
                        setDraftPlan((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                    >
                      {getMonthDayOptions(key, config.year).map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col-reverse gap-2 border-t bg-white px-6 py-4 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="h-9 w-full rounded-xl border-[#dcdfed] px-5 text-[14px] font-medium text-[#0b1024] shadow-none hover:bg-[#fafbff] sm:w-auto"
              onClick={() => setAddModalOpen(false)}
            >
              Отмена
            </Button>
            <Button
              type="button"
              className="h-10 w-full rounded-xl bg-[#5566f6] px-5 text-[14px] font-medium text-white hover:bg-[#4a5bf0] sm:w-auto"
              onClick={saveDraftRow}
              disabled={!draftEquipmentName.trim()}
            >
              Добавить
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ---------- Edit Row Dialog ---------- */}
      <Dialog open={editModalOpen} onOpenChange={(open) => (open ? setEditModalOpen(true) : closeEditModal())}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] max-h-[92vh] supports-[height:100dvh]:max-h-[92dvh] overflow-hidden rounded-[24px] border-0 p-0 sm:max-w-[640px]">
          <DialogHeader className="border-b px-6 py-5">
            <DialogTitle className="text-[18px] font-semibold tracking-[-0.02em] text-[#0b1024]">
              Редактирование строки{seq.progress ? ` ${seq.progress}` : ""}
            </DialogTitle>
          </DialogHeader>

          <div className="max-h-[calc(92vh-160px)] space-y-5 overflow-y-auto px-6 py-5">
            <EquipmentDirectoryField
              label="Название оборудования"
              value={editEquipmentName}
              sourceEquipmentId={editSourceEquipmentId}
              directory={equipmentDirectory}
              documentId={documentId}
              onChange={(name, sourceId) => {
                setEditEquipmentName(name);
                setEditSourceEquipmentId(sourceId);
              }}
            />

            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">Вид работ по обслуживанию</Label>
              <Textarea
                className="rounded-2xl border-[#dcdfed] px-4 py-3 text-[15px]"
                value={editWorkType}
                onChange={(e) => setEditWorkType(e.target.value)}
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">Тип обслуживания</Label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  ["A", "A = Ежемесячно"],
                  ["B", "B = Ежегодно"],
                ] as const).map(([value, label]) => {
                  const active = editMaintenanceType === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setEditMaintenanceType(value)}
                      className={`flex h-9 items-center justify-center rounded-xl border px-3.5 text-[14px] font-medium transition-colors ${
                        active
                          ? "border-[#5566f6] bg-[#5566f6] text-white"
                          : "border-[#dcdfed] bg-white text-[#0b1024] hover:bg-[#fafbff]"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">Плановые дни по месяцам</Label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {MONTH_KEYS.map((key) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="w-20 text-[13px] text-[#3c4053]">{MONTH_FULL_LABELS[key]}</span>
                    <select
                      className="h-10 flex-1 rounded-xl border border-[#dcdfed] bg-white px-3 text-[14px] text-[#0b1024]"
                      value={editPlan[key] || "-"}
                      onChange={(e) =>
                        setEditPlan((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                    >
                      {getMonthDayOptions(key, config.year).map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            {/* Факт — чтобы обслуживание можно было отметить с телефона:
                в «Карточках» таблицы нет, а факт живёт только в ней. */}
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">
                Фактические дни обслуживания
              </Label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {MONTH_KEYS.map((key) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="w-20 text-[13px] text-[#3c4053]">{MONTH_FULL_LABELS[key]}</span>
                    <select
                      className="h-10 flex-1 rounded-xl border border-[#dcdfed] bg-white px-3 text-[14px] text-[#0b1024]"
                      value={editFact[key] || ""}
                      onChange={(e) =>
                        setEditFact((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                    >
                      <option value="">--</option>
                      {getMonthDayOptions(key, config.year)
                        .filter((opt) => opt !== "-")
                        .map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col-reverse gap-2 border-t bg-white px-6 py-4 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="h-9 w-full rounded-xl border-[#dcdfed] px-5 text-[14px] font-medium text-[#0b1024] shadow-none hover:bg-[#fafbff] sm:w-auto"
              onClick={closeEditModal}
            >
              Отмена
            </Button>
            <Button
              type="button"
              className="h-10 w-full rounded-xl bg-[#5566f6] px-5 text-[14px] font-medium text-white hover:bg-[#4a5bf0] sm:w-auto"
              onClick={saveEditRow}
            >
              Сохранить
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ---------- Settings Dialog ---------- */}
      {useV2 ? (
        <JournalSettingsModal
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          title="Настройки журнала"
          description="Название, дата, год и две роли: утверждающий и ответственный."
          size="md"
          isSaving={isSaving}
          onSave={handleSaveSettings}
          onCancel={() => setSettingsOpen(false)}
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
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
                Дата документа
              </Label>
              <Input
                type="date"
                value={settingsDate}
                onChange={(e) => setSettingsDate(e.target.value)}
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
                Год
              </Label>
              <Select
                value={String(settingsYear)}
                onValueChange={(val) => setSettingsYear(Number(val))}
              >
                <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-white text-[13.5px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {yearOptions.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              Должность «Утверждаю»
            </Label>
            <Select
              value={settingsApproveRole}
              onValueChange={approveCascade.handlePositionChange}
            >
              <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-white text-[13.5px]">
                <SelectValue placeholder="— Выберите —" />
              </SelectTrigger>
              <SelectContent>
                <PositionSelectItems users={users} />
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              Сотрудник (утверждает)
            </Label>
            <Select
              value={settingsApproveEmployeeId}
              onValueChange={(value) => {
                const user = users.find((item) => item.id === value);
                setSettingsApproveEmployeeId(value);
                setSettingsApproveEmployee(user?.name || settingsApproveEmployee);
                if (user) setSettingsApproveRole(getUserRoleLabel(user.role));
              }}
              open={approveCascade.employeeOpen}
              onOpenChange={approveCascade.setEmployeeOpen}
            >
              <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-white text-[13.5px]">
                <SelectValue placeholder="— Выберите —" />
              </SelectTrigger>
              <SelectContent>
                {(settingsApproveRole ? approveCascade.candidates : users).map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {buildStaffOptionLabel(u)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              Должность ответственного
            </Label>
            <Select
              value={settingsResponsibleRole}
              onValueChange={responsibleCascade.handlePositionChange}
            >
              <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-white text-[13.5px]">
                <SelectValue placeholder="— Выберите —" />
              </SelectTrigger>
              <SelectContent>
                <PositionSelectItems users={users} />
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              Сотрудник (ответственный)
            </Label>
            <Select
              value={settingsResponsibleEmployeeId}
              onValueChange={(value) => {
                const user = users.find((item) => item.id === value);
                setSettingsResponsibleEmployeeId(value);
                setSettingsResponsibleEmployee(user?.name || settingsResponsibleEmployee);
                if (user) setSettingsResponsibleRole(getUserRoleLabel(user.role));
              }}
              open={responsibleCascade.employeeOpen}
              onOpenChange={responsibleCascade.setEmployeeOpen}
            >
              <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-white text-[13.5px]">
                <SelectValue placeholder="— Выберите —" />
              </SelectTrigger>
              <SelectContent>
                {(settingsResponsibleRole ? responsibleCascade.candidates : users).map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {buildStaffOptionLabel(u)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </JournalSettingsModal>
      ) : (
        <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DialogContent className="max-h-[92vh] supports-[height:100dvh]:max-h-[92dvh] overflow-y-auto sm:max-w-[520px]">
            <DialogHeader>
              <DialogTitle>Настройки журнала</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <Label>Название документа</Label>
              <Input
                value={settingsTitle}
                onChange={(e) => setSettingsTitle(e.target.value)}
              />

              <Label>Дата документа</Label>
              <Input
                type="date"
                value={settingsDate}
                onChange={(e) => setSettingsDate(e.target.value)}
              />

              <Label>Год</Label>
              <Select
                value={String(settingsYear)}
                onValueChange={(val) => setSettingsYear(Number(val))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {yearOptions.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Label>Должность &laquo;Утверждаю&raquo;</Label>
              <Select
                value={settingsApproveRole}
                onValueChange={approveCascade.handlePositionChange}
              >
                <SelectTrigger>
                  <SelectValue placeholder="- Выберите значение -" />
                </SelectTrigger>
                <SelectContent>
                  <PositionSelectItems users={users} />
                </SelectContent>
              </Select>

              <Label>Сотрудник (утверждает)</Label>
              <Select
                value={settingsApproveEmployeeId}
                onValueChange={(value) => {
                  const user = users.find((item) => item.id === value);
                  setSettingsApproveEmployeeId(value);
                  setSettingsApproveEmployee(user?.name || settingsApproveEmployee);
                  if (user) setSettingsApproveRole(getUserRoleLabel(user.role));
                }}
                open={approveCascade.employeeOpen}
                onOpenChange={approveCascade.setEmployeeOpen}
              >
                <SelectTrigger>
                  <SelectValue placeholder="- Выберите значение -" />
                </SelectTrigger>
                <SelectContent>
                  {(settingsApproveRole ? approveCascade.candidates : users).map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {buildStaffOptionLabel(u)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Label>Должность ответственного</Label>
              <Select
                value={settingsResponsibleRole}
                onValueChange={responsibleCascade.handlePositionChange}
              >
                <SelectTrigger>
                  <SelectValue placeholder="- Выберите значение -" />
                </SelectTrigger>
                <SelectContent>
                  <PositionSelectItems users={users} />
                </SelectContent>
              </Select>

              <Label>Сотрудник (ответственный)</Label>
              <Select
                value={settingsResponsibleEmployeeId}
                onValueChange={(value) => {
                  const user = users.find((item) => item.id === value);
                  setSettingsResponsibleEmployeeId(value);
                  setSettingsResponsibleEmployee(user?.name || settingsResponsibleEmployee);
                  if (user) setSettingsResponsibleRole(getUserRoleLabel(user.role));
                }}
                open={responsibleCascade.employeeOpen}
                onOpenChange={responsibleCascade.setEmployeeOpen}
              >
                <SelectTrigger>
                  <SelectValue placeholder="- Выберите значение -" />
                </SelectTrigger>
                <SelectContent>
                  {(settingsResponsibleRole ? responsibleCascade.candidates : users).map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {buildStaffOptionLabel(u)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex justify-end">
                <Button onClick={handleSaveSettings} disabled={isSaving}>
                  Сохранить
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
