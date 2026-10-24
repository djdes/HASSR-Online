"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, Plus, ListPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { getUserRoleLabel } from "@/lib/user-roles";
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
import { useLocale, useTranslations } from "next-intl";
import { presentMaintenanceValue, createMaintenanceFailureRegistry, maintenanceText, maintenanceRoleUsesFactory, maintenanceServerSourceIdentity } from "@/lib/equipment-maintenance-presentation";
import type { Locale } from "@/i18n/locales";
import {
  PositionSelectItems,
  usePositionEmployeeCascade,
} from "@/components/shared/position-select";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";
import { formatPositionWithName } from "@/lib/position-name-label";
import { resolveApprover } from "@/lib/approver-display";

type Props = {
  documentId: string;
  title: string;
  organizationName: string;
  dateFrom: string;
  status: string;
  initialConfig: EquipmentMaintenanceConfig;
  /** Raw config before normalization; absence identifies injected defaults. */
  sourceConfig?: unknown;
  users: { id: string; name: string; role: string }[];
  /** Справочник «Оборудование» организации — источник имён для строк. */
  equipmentDirectory?: EquipmentDirectoryOption[];
  /** Design v2 toggle. */
  useV2?: boolean;
};


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
  sourceConfig,
  users,
  equipmentDirectory = [],
  useV2 = false,
}: Props) {
  const t = useTranslations("journalEquipmentMaintenance");
  const text = useTranslations();
  const locale = useLocale() as Locale;
  const committed = useRef({ t, text, locale });
  useLayoutEffect(() => { committed.current = { t, text, locale }; });
  const router = useRouter();
  const [failureRegistry] = useState(createMaintenanceFailureRegistry);
  const [, startTransition] = useTransition();
  const [isSaving, setIsSaving] = useState(false);
  const [config, setConfig] = useState(() =>
    normalizeEquipmentMaintenanceConfig(initialConfig)
  );
  // «УТВЕРЖДАЮ»: должность и ФИО одного человека — из его карточки.
  const approver = resolveApprover(config, users);
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
  const [settingsTitleMissing, setSettingsTitleMissing] = useState(!title);
  const [savedRoleOverrides, setSavedRoleOverrides] = useState(false);
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
  const organizationLabel = presentMaintenanceValue(organizationName, !organizationName, t("organizationFallback"));
  const displayTitle = presentMaintenanceValue(title, !title, t("title"));
  // Stored/custom roles remain raw, including values identical to standard Russian labels.
  const roleLabel = (value: string, field: "approveRole" | "responsibleRole", boundId?: string | null) =>
    !savedRoleOverrides && sourceConfig !== undefined && maintenanceRoleUsesFactory(sourceConfig, field) && !boundId
      ? text(field === "approveRole" ? "personnelMaintenancePdf.manager" : "personnelMaintenancePdf.head_chef")
      : value;
  const { mobileView, switchMobileView } = useMobileView("equipment_maintenance");
  const { closeDocument, isClosing } = useDocumentCloseAction({ documentId, title });

  /** Имя строки: у связанных — из справочника, у остальных — сохранённое. */
  const rowName = (row: EquipmentMaintenanceRow) =>
    resolveEquipmentRowName(row, equipmentDirectory);
  const previousServer = useRef({ documentId, serialized: maintenanceServerSourceIdentity(initialConfig, sourceConfig) });

  const missingEquipment = getMissingDirectoryEquipment(
    equipmentDirectory,
    config.rows
  );

  const cardItems: RecordCardItem[] = config.rows.map((row, index) => {
    const planSummary = MONTH_KEYS.map((k) => `${t(`monthShort_${k}`)}:${row.plan[k] || "—"}`)
      .filter((s) => !s.endsWith(":-"))
      .join(" · ");
    const factSummary = MONTH_KEYS.map((k) => `${t(`monthShort_${k}`)}:${row.fact[k] || "—"}`)
      .filter((s) => !s.endsWith(":—"))
      .join(" · ");
    return {
      id: row.id,
      title: `№${index + 1} · ${rowName(row) || "—"}`,
      subtitle: row.workType || undefined,
      badge: (
        <span className="rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[11px] font-semibold text-[#5566f6]">
          {t("typeBadge", { type: maintenanceText(row.maintenanceType) })}
        </span>
      ),
      leading: !isClosed ? (
        <Checkbox
          aria-label={t("selectRow", { number: maintenanceText(index + 1) })}
          checked={selectedRows.includes(row.id)}
          onCheckedChange={(checked) => toggleRow(row.id, checked === true)}
          className="size-5"
        />
      ) : null,
      fields: [
        { label: t("planSummary"), value: planSummary, hideIfEmpty: true },
        { label: t("factSummary"), value: factSummary, hideIfEmpty: true },
      ],
      onClick: !isClosed ? () => openEditRow(row.id) : undefined,
      actions: !isClosed ? (
        <button
          type="button"
          onClick={() => openEditRow(row.id)}
          className="inline-flex h-10 items-center justify-center rounded-2xl bg-[#5563ff] px-4 text-[14px] font-medium text-white hover:bg-[#4452ee]"
        >
          {text("common.edit")}
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
      const error = new Error(result?.error || committed.current.t("saveFailed"));
      if (!result?.error) failureRegistry.mark(error, "saveFailed");
      throw error;
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
        failureRegistry.key(error) ? committed.current.t(failureRegistry.key(error)!) : humanizeFetchError(error, committed.current.t("saveFailed"), committed.current.t("networkError"))
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
    toast.success(committed.current.t("addedFromDirectory", { count: maintenanceText(added.length) }));
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

  const cancelSequentialEdit = seq.cancelled;
  useEffect(() => {
    const serialized = maintenanceServerSourceIdentity(initialConfig, sourceConfig);
    const previous = previousServer.current;
    if (previous.documentId === documentId && previous.serialized === serialized) return;
    previousServer.current = { documentId, serialized };
    const next = normalizeEquipmentMaintenanceConfig(initialConfig);
    const previousEditingRow = configRef.current.rows.find((row) => row.id === editingRowId);
    const nextEditingRow = next.rows.find((row) => row.id === editingRowId);
    configRef.current = next;
    setConfig(next);
    setSavedRoleOverrides(false);
    setSelectedRows((selected) => selected.filter((id) => next.rows.some((row) => row.id === id)));
    if (previous.documentId !== documentId || (editingRowId && !nextEditingRow)) {
      cancelSequentialEdit();
      setEditModalOpen(false);
      setEditingRowId(null);
    } else if (nextEditingRow && JSON.stringify(previousEditingRow) !== JSON.stringify(nextEditingRow)) {
      setEditSourceEquipmentId(nextEditingRow.sourceEquipmentId);
      setEditEquipmentName(nextEditingRow.equipmentName);
      setEditWorkType(nextEditingRow.workType);
      setEditMaintenanceType(nextEditingRow.maintenanceType);
      setEditPlan(Object.fromEntries(MONTH_KEYS.map((key) => [key, nextEditingRow.plan[key] || "-"])));
      setEditFact(Object.fromEntries(MONTH_KEYS.map((key) => [key, nextEditingRow.fact[key] || ""])));
    }
    if (previous.documentId !== documentId) {
      setSelectedRows([]);
      setAddModalOpen(false);
      setEditModalOpen(false);
      setEditingRowId(null);
      setSettingsOpen(false);
    }
  }, [documentId, initialConfig, sourceConfig, editingRowId, cancelSequentialEdit]);

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
    setSettingsTitleMissing(!title);
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
    const previousRoleOverrides = savedRoleOverrides;
    setSavedRoleOverrides(true);
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
        const error = new Error(result?.error || committed.current.t("settingsFailed"));
        if (!result?.error) failureRegistry.mark(error, "settingsFailed");
        throw error;
      }
      setSettingsOpen(false);
      startTransition(() => router.refresh());
    } catch (error) {
      // Roll back the config and its presentation provenance together.
      setSavedRoleOverrides(previousRoleOverrides);
      applyConfig(previous);
      toast.error(
        failureRegistry.key(error) ? committed.current.t(failureRegistry.key(error)!) : humanizeFetchError(error, committed.current.t("settingsFailed"), committed.current.t("networkError"))
      );
    } finally {
      setIsSaving(false);
    }
  }

  /* ---------- helpers ---------- */

  const yearOptions = buildYearOptions(config.year);

  return (
    <div className="space-y-6 text-black">
      <FocusTodayScroller selector="[data-focus-today]" emptyTitle={text("journalScan.focus.emptyTitle")} emptyBody={text("journalScan.focus.emptyBody")} copy={{ noCreateBody: text("journalScan.focus.noCreateBody"), later: text("journalScan.focus.later"), close: text("common.close") }} />

      {selectedRows.length > 0 && !isClosed && (
        <JournalSelectionBar
          count={selectedRows.length}
          onClear={() => setSelectedRows([])}
          onDelete={removeSelectedRows}
          hint={t("selectionHint")}
        >
          <SelectionEditButton count={selectedRows.length} disabled={isClosed} onClick={() => seq.start(selectedRows)} />
        </JournalSelectionBar>
      )}

      <JournalDocumentShell
        title={displayTitle}
        documentId={documentId}
        backHref="/journals/equipment_maintenance"
        onSettings={openSettings}
        closed={isClosed}
        closedHint={t("closedHint")}
        menuItems={
          !isClosed
            ? [
                {
                  key: "close-journal",
                  label: text("journalWidgets.staff.closeJournal"),
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
          <RecordCardsView items={cardItems} emptyLabel={t("noEquipment")}  />
        }
        paperHeader={
          <>
            <JournalDocumentHeader
              orgName={organizationLabel}
              title={t("header")}
              startedAt={dateFrom}
              finishedAt={isClosed ? config.documentDate : null}
            />

            {/* "УТВЕРЖДАЮ" block */}
            <div className="mt-4 flex justify-end">
              <div className="w-[400px] text-right text-sm leading-relaxed">
                <div className="font-semibold uppercase">{text("personnelMaintenancePdf.approve")}</div>
                <div>{roleLabel(approver.title, "approveRole", config.approveEmployeeId)}</div>
                <div className="mt-1 flex items-center justify-end gap-2">
                  <span className="inline-block w-[180px] border-b border-black" />
                  <span>{approver.name}</span>
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
        sheetTitle={t("yearTitle", { year: maintenanceText(config.year) })}
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
                {text("common.add")}
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
                  title={t("addDirectoryHint")}
                >
                  <ListPlus className="size-4" />
                  {t("addDirectory", { count: maintenanceText(missingEquipment.length) })}
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
                {t("maintenanceTypeLegend")}
              </td>
              <td className={`${GRID_CELL_CLASS} px-2 py-1.5 leading-tight`}>
                {t("monthly")}
              </td>
              <td className={`${GRID_CELL_CLASS} px-2 py-1.5 leading-tight`}>
                {t("yearly")}
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
                {text("personnelMaintenancePdf.number")}
              </th>
              <th className={`w-[220px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 leading-tight`}>
                {t("equipmentWork")}
              </th>
              <th className={`w-16 ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 leading-tight`} />
              {MONTH_KEYS.map((key) => (
                <th key={key} className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>
                  {t(`monthShort_${key}`)}
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
                        aria-label={t("selectRow", { number: maintenanceText(index + 1) })}
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
                    {text("personnelMaintenancePdf.type")}
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
                    {t("plan")}
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
                    {text("personnelMaintenancePdf.actual")}
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
                          aria-label={t("rowActualDayAria", { equipment: maintenanceText(rowName(row)), month: t(`monthFull_${key}`) })}
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
                  {t("emptyRows")}
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
                label={t("addEquipment")}
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
                {/* Без сотрудника было «Ответственный: Управляющий,» —
                    запятая с пустотой. Разделитель — только между частями. */}
                {text("personnelMaintenancePdf.responsible", { person: formatPositionWithName(
                  roleLabel(config.responsibleRole, "responsibleRole", config.responsibleEmployeeId),
                  config.responsibleEmployee,
                  { separator: ", ", emptyValue: "—" }
                ) })}
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
        <DialogContent closeLabel={text("common.close")} className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] max-h-[92vh] supports-[height:100dvh]:max-h-[92dvh] overflow-hidden rounded-[24px] border-0 p-0 sm:max-w-[640px]">
          <DialogHeader className="border-b px-6 py-5">
            <DialogTitle className="text-[18px] font-semibold tracking-[-0.02em] text-[#0b1024]">
              {text("journalWidgets.staff.addEmployeeTitle")}
            </DialogTitle>
          </DialogHeader>

          <div className="max-h-[calc(92vh-160px)] space-y-5 overflow-y-auto px-6 py-5">
            <EquipmentDirectoryField
              label={t("equipmentName")}
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
              <Label className="text-[13px] font-medium text-[#3c4053]">{t("workType")}</Label>
              <Textarea
                className="rounded-2xl border-[#dcdfed] px-4 py-3 text-[15px]"
                value={draftWorkType}
                onChange={(e) => setDraftWorkType(e.target.value)}
                placeholder={t("workPlaceholder")}
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">{t("maintenanceType")}</Label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  ["A", t("monthly")],
                  ["B", t("yearly")],
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
              <Label className="text-[13px] font-medium text-[#3c4053]">{t("plannedDays")}</Label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {MONTH_KEYS.map((key) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="w-20 text-[13px] text-[#3c4053]">{t(`monthFull_${key}`)}</span>
                    <select
                      className="h-10 flex-1 rounded-xl border border-[#dcdfed] bg-white px-3 text-[14px] text-[#0b1024]"
                      aria-label={t("plannedDayAria", { month: t(`monthFull_${key}`) })}
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
              {text("common.cancel")}
            </Button>
            <Button
              type="button"
              className="h-10 w-full rounded-xl bg-[#5566f6] px-5 text-[14px] font-medium text-white hover:bg-[#4a5bf0] sm:w-auto"
              onClick={saveDraftRow}
              disabled={!draftEquipmentName.trim()}
            >
              {text("common.add")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ---------- Edit Row Dialog ---------- */}
      <Dialog open={editModalOpen} onOpenChange={(open) => (open ? setEditModalOpen(true) : closeEditModal())}>
        <DialogContent closeLabel={text("common.close")} className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] max-h-[92vh] supports-[height:100dvh]:max-h-[92dvh] overflow-hidden rounded-[24px] border-0 p-0 sm:max-w-[640px]">
          <DialogHeader className="border-b px-6 py-5">
            <DialogTitle className="text-[18px] font-semibold tracking-[-0.02em] text-[#0b1024]">
              {t("editRowTitle", { progress: seq.progress ? ` ${seq.progress}` : "" })}
            </DialogTitle>
          </DialogHeader>

          <div className="max-h-[calc(92vh-160px)] space-y-5 overflow-y-auto px-6 py-5">
            <EquipmentDirectoryField
              label={t("equipmentName")}
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
              <Label className="text-[13px] font-medium text-[#3c4053]">{t("workType")}</Label>
              <Textarea
                className="rounded-2xl border-[#dcdfed] px-4 py-3 text-[15px]"
                value={editWorkType}
                onChange={(e) => setEditWorkType(e.target.value)}
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">{t("maintenanceType")}</Label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  ["A", t("monthly")],
                  ["B", t("yearly")],
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
              <Label className="text-[13px] font-medium text-[#3c4053]">{t("plannedDays")}</Label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {MONTH_KEYS.map((key) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="w-20 text-[13px] text-[#3c4053]">{t(`monthFull_${key}`)}</span>
                    <select
                      className="h-10 flex-1 rounded-xl border border-[#dcdfed] bg-white px-3 text-[14px] text-[#0b1024]"
                      aria-label={t("plannedDayAria", { month: t(`monthFull_${key}`) })}
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
                {t("actualDays")}
              </Label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {MONTH_KEYS.map((key) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="w-20 text-[13px] text-[#3c4053]">{t(`monthFull_${key}`)}</span>
                    <select
                      className="h-10 flex-1 rounded-xl border border-[#dcdfed] bg-white px-3 text-[14px] text-[#0b1024]"
                      aria-label={t("actualDayAria", { month: t(`monthFull_${key}`) })}
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
              {text("common.cancel")}
            </Button>
            <Button
              type="button"
              className="h-10 w-full rounded-xl bg-[#5566f6] px-5 text-[14px] font-medium text-white hover:bg-[#4a5bf0] sm:w-auto"
              onClick={saveEditRow}
            >
              {text("common.save")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ---------- Settings Dialog ---------- */}
      {useV2 ? (
        <JournalSettingsModal
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          title={text("journalWidgets.staff.settings")}
          description={t("settingsDescription")}
          size="md"
          isSaving={isSaving}
          onSave={handleSaveSettings}
          onCancel={() => setSettingsOpen(false)}
        >
          <div className="space-y-2">
            <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              {text("journalWidgets.staff.documentName")}
            </Label>
            <Input
              value={presentMaintenanceValue(settingsTitle, settingsTitleMissing, t("title"))}
              onChange={(e) => { setSettingsTitle(e.target.value); setSettingsTitleMissing(false); }}
              className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
                {text("journalScan.metadata.documentDate")}
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
                {t("year")}
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
              {text("journalScan.metadata.approverPosition")}
            </Label>
            <Select
              value={settingsApproveRole}
              onValueChange={approveCascade.handlePositionChange}
            >
              <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-white text-[13.5px]">
                <SelectValue placeholder={text("journalWidgets.staff.selectPlaceholder")}  />
              </SelectTrigger>
              <SelectContent>
                <PositionSelectItems users={users} />
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              {t("approvingEmployee")}
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
                <SelectValue placeholder={text("journalWidgets.staff.selectPlaceholder")}  />
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
              {text("journalWidgets.staff.responsiblePosition")}
            </Label>
            <Select
              value={settingsResponsibleRole}
              onValueChange={responsibleCascade.handlePositionChange}
            >
              <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-white text-[13.5px]">
                <SelectValue placeholder={text("journalWidgets.staff.selectPlaceholder")}  />
              </SelectTrigger>
              <SelectContent>
                <PositionSelectItems users={users} />
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              {t("responsibleEmployee")}
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
                <SelectValue placeholder={text("journalWidgets.staff.selectPlaceholder")}  />
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
          <DialogContent closeLabel={text("common.close")} className="max-h-[92vh] supports-[height:100dvh]:max-h-[92dvh] overflow-y-auto sm:max-w-[520px]">
            <DialogHeader>
              <DialogTitle>{text("journalWidgets.staff.settings")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <Label>{text("journalWidgets.staff.documentName")}</Label>
              <Input
                value={presentMaintenanceValue(settingsTitle, settingsTitleMissing, t("title"))}
                onChange={(e) => { setSettingsTitle(e.target.value); setSettingsTitleMissing(false); }}
              />

              <Label>{text("journalScan.metadata.documentDate")}</Label>
              <Input
                type="date"
                value={settingsDate}
                onChange={(e) => setSettingsDate(e.target.value)}
              />

              <Label>{t("year")}</Label>
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

              <Label>{text("journalScan.metadata.approverPosition")}</Label>
              <Select
                value={settingsApproveRole}
                onValueChange={approveCascade.handlePositionChange}
              >
                <SelectTrigger>
                  <SelectValue placeholder={text("journalWidgets.staff.choosePosition")}  />
                </SelectTrigger>
                <SelectContent>
                  <PositionSelectItems users={users} />
                </SelectContent>
              </Select>

              <Label>{t("approvingEmployee")}</Label>
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
                  <SelectValue placeholder={text("journalWidgets.staff.chooseEmployee")}  />
                </SelectTrigger>
                <SelectContent>
                  {(settingsApproveRole ? approveCascade.candidates : users).map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {buildStaffOptionLabel(u)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Label>{text("journalWidgets.staff.responsiblePosition")}</Label>
              <Select
                value={settingsResponsibleRole}
                onValueChange={responsibleCascade.handlePositionChange}
              >
                <SelectTrigger>
                  <SelectValue placeholder={text("journalWidgets.staff.choosePosition")}  />
                </SelectTrigger>
                <SelectContent>
                  <PositionSelectItems users={users} />
                </SelectContent>
              </Select>

              <Label>{t("responsibleEmployee")}</Label>
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
                  <SelectValue placeholder={text("journalWidgets.staff.chooseEmployee")}  />
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
                  {text("common.save")}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
