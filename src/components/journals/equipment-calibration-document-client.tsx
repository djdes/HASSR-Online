"use client";

import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/locales";
import { calibrationDate, calibrationPositionLabel, calibrationDocumentTitle, calibrationErrorKey, checkCalibrationResponse } from "./equipment-calibration-presentation";
import { EquipmentCalibrationPositionItems } from "./equipment-calibration-position-items";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ListPlus, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { getUserRoleLabel, getUserPositionLabel } from "@/lib/user-roles";
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
  type EquipmentCalibrationConfig,
  type CalibrationRow,
  createCalibrationRow,
  normalizeEquipmentCalibrationConfig,
  calculateNextCalibrationDate,
  isCalibrationOverdue,
} from "@/lib/equipment-calibration-document";
import {
  getMissingDirectoryEquipment,
  resolveEquipmentRowName,
  type EquipmentDirectoryOption,
} from "@/lib/equipment-directory-link";
import { EquipmentDirectoryField } from "@/components/journals/equipment-directory-field";
import { getUserDisplayName } from "@/lib/user-display-name";
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
  usePositionEmployeeCascade,
} from "@/components/shared/position-select";
import { localDayKey } from "@/lib/entry-defaults";
import { resolveApprover } from "@/lib/approver-display";

type Props = {
  documentId: string;
  title: string;
  organizationName: string;
  dateFrom: string;
  status: string;
  initialConfig: EquipmentCalibrationConfig;
  users: { id: string; name: string; role: string }[];
  /** Справочник «Оборудование» организации — источник имён для строк. */
  equipmentDirectory?: EquipmentDirectoryOption[];
  /** Design v2 toggle. */
  useV2?: boolean;
};



export function EquipmentCalibrationDocumentClient({
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
  const locale = useLocale() as Locale;
  const t = useTranslations("equipmentCalibration");
  const roles = { manager: t("roles.manager"), head_chef: t("roles.head_chef"), cook: t("roles.cook"), waiter: t("roles.waiter") };
  const positionLabel = (value: string) => calibrationPositionLabel(value, users, roles);
  const documentTitle = (value: string, year: number) => calibrationDocumentTitle(value, year, locale, t("pageTitle"), (name, period) => t("generatedTitle", { name, period }));
  const [, startTransition] = useTransition();
  const [isSaving, setIsSaving] = useState(false);
  const [config, setConfig] = useState(() =>
    normalizeEquipmentCalibrationConfig(initialConfig)
  );
  // «УТВЕРЖДАЮ»: должность и ФИО одного человека — из его карточки.
  const approver = resolveApprover(config, users);
  // Последний применённый конфиг — источник правды для правок подряд.
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

  // Add row draft state
  const [draftSourceEquipmentId, setDraftSourceEquipmentId] = useState<
    string | null
  >(null);
  const [draftName, setDraftName] = useState("");
  const [draftNumber, setDraftNumber] = useState("");
  const [draftLocation, setDraftLocation] = useState("");
  const [draftPurpose, setDraftPurpose] = useState("");
  const [draftRange, setDraftRange] = useState("");
  const [draftInterval, setDraftInterval] = useState("12");
  const [draftLastDate, setDraftLastDate] = useState(localDayKey());
  const [draftNote, setDraftNote] = useState("");

  // Edit row draft state
  const [editSourceEquipmentId, setEditSourceEquipmentId] = useState<
    string | null
  >(null);
  const [editName, setEditName] = useState("");
  const [editNumber, setEditNumber] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editPurpose, setEditPurpose] = useState("");
  const [editRange, setEditRange] = useState("");
  const [editInterval, setEditInterval] = useState("12");
  const [editLastDate, setEditLastDate] = useState("");
  const [editNote, setEditNote] = useState("");

  const isClosed = status === "closed";
  const organizationLabel = organizationName || t("organizationFallback");
  const { mobileView, switchMobileView } = useMobileView("equipment_calibration");
  const { closeDocument, isClosing } = useDocumentCloseAction({ documentId, title: documentTitle(title, config.year) });

  /** Имя строки: у связанных — из справочника, у остальных — сохранённое. */
  const rowName = (row: CalibrationRow) =>
    resolveEquipmentRowName(row, equipmentDirectory);
  const missingEquipment = getMissingDirectoryEquipment(
    equipmentDirectory,
    config.rows
  );

  /**
   * Годы для селекта. Раньше список был жёстко «текущий−3…+6», и у
   * документа за более ранний/поздний год селект показывал пусто.
   */
  const yearOptions = (() => {
    const base = new Date().getFullYear();
    const years = new Set<number>();
    for (let i = -3; i <= 6; i += 1) years.add(base + i);
    if (Number.isFinite(config.year)) years.add(config.year);
    if (Number.isFinite(settingsYear)) years.add(settingsYear);
    return [...years].sort((a, b) => a - b).map(String);
  })();

  const cardItems: RecordCardItem[] = config.rows.map((row, index) => {
    const nextDate = calculateNextCalibrationDate(
      row.lastCalibrationDate,
      row.calibrationInterval
    );
    const overdue = isCalibrationOverdue(
      row.lastCalibrationDate,
      row.calibrationInterval
    );
    return {
      id: row.id,
      title: `№${index + 1} · ${rowName(row) || "—"}`,
      subtitle:
        [row.equipmentNumber, row.location].filter(Boolean).join(" · ") || undefined,
      badge: overdue ? (
        <span className="rounded-full bg-[#fff4f2] px-2 py-0.5 text-[11px] font-semibold text-[#ff3b30]">
          {t("overdue")}</span>
      ) : undefined,
      leading: !isClosed ? (
        <Checkbox
          aria-label={t("selectRow", { number: index + 1 })}
          checked={selectedRows.includes(row.id)}
          onCheckedChange={(checked) => toggleRow(row.id, checked === true)}
          className="size-5"
        />
      ) : null,
      fields: [
        { label: t("purpose"), value: row.purpose, hideIfEmpty: true },
        { label: t("range"), value: row.measurementRange, hideIfEmpty: true },
        { label: t("interval"), value: t("months", { count: row.calibrationInterval }) },
        { label: t("lastVerification"), value: calibrationDate(row.lastCalibrationDate, locale) },
        { label: t("nextVerification"), value: calibrationDate(nextDate, locale) },
        { label: t("note"), value: row.note, hideIfEmpty: true },
      ],
      onClick: !isClosed ? () => openEditRow(row.id) : undefined,
      actions: !isClosed ? (
        <button
          type="button"
          onClick={() => openEditRow(row.id)}
          className="inline-flex h-10 items-center justify-center rounded-2xl bg-[#5563ff] px-4 text-[14px] font-medium text-white hover:bg-[#4452ee]"
        >
          {t("edit")}</button>
      ) : null,
    };
  });

  /* ---------- persistence ---------- */

  /**
   * ПОЧЕМУ ref + функциональная правка: `next` строился из `config` из
   * замыкания, поэтому две быстрые правки подряд затирали друг друга; а
   * при отказе сервера оптимистичное состояние оставалось на экране,
   * хотя в базу ничего не легло — теперь откатываем.
   */
  function applyConfig(next: EquipmentCalibrationConfig) {
    configRef.current = next;
    setConfig(next);
  }

  async function mutateConfig(
    mutate: (current: EquipmentCalibrationConfig) => EquipmentCalibrationConfig
  ) {
    const previous = configRef.current;
    const next = mutate(previous);
    applyConfig(next);
    setIsSaving(true);
    try {
      const response = await fetch(`/api/journal-documents/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: next }),
      });
      await checkCalibrationResponse(response, "saveJournal");
      startTransition(() => router.refresh());
      return true;
    } catch (error) {
      applyConfig(previous);
      toast.error(
        t(`errors.${calibrationErrorKey(error, "saveJournal")}`)
      );
      return false;
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
   * Дописывает строки для СИ из справочника, которых в графике ещё нет.
   * Даты поверки пустые — их проставляет человек.
   */
  async function addMissingFromDirectory() {
    if (missingEquipment.length === 0) return;
    const added = missingEquipment.map((item) =>
      createCalibrationRow({
        sourceEquipmentId: item.id,
        equipmentName: item.name,
      })
    );
    const saved = await mutateConfig((current) => ({
      ...current,
      rows: [...current.rows, ...added],
    }));
    if (saved) toast.success(t("added", { count: added.length }));
  }

  function resetDraft() {
    setDraftSourceEquipmentId(null);
    setDraftName("");
    setDraftNumber("");
    setDraftLocation("");
    setDraftPurpose("");
    setDraftRange("");
    setDraftInterval("12");
    setDraftLastDate(localDayKey());
    setDraftNote("");
  }

  function saveDraftRow() {
    const newRow = createCalibrationRow({
      sourceEquipmentId: draftSourceEquipmentId,
      equipmentName: draftName,
      equipmentNumber: draftNumber,
      location: draftLocation,
      purpose: draftPurpose,
      measurementRange: draftRange,
      calibrationInterval: parseInt(draftInterval, 10) || 12,
      lastCalibrationDate: draftLastDate,
      note: draftNote,
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
    setEditName(row.equipmentName);
    setEditNumber(row.equipmentNumber);
    setEditLocation(row.location);
    setEditPurpose(row.purpose);
    setEditRange(row.measurementRange);
    setEditInterval(String(row.calibrationInterval));
    setEditLastDate(row.lastCalibrationDate);
    setEditNote(row.note);
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
      equipmentName: editName,
      equipmentNumber: editNumber,
      location: editLocation,
      purpose: editPurpose,
      measurementRange: editRange,
      calibrationInterval: parseInt(editInterval, 10) || 12,
      lastCalibrationDate: editLastDate,
      note: editNote,
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

  /* ---------- settings save ---------- */

  function openSettings() {
    setSettingsTitle(title);
    setSettingsDate(config.documentDate);
    setSettingsYear(config.year);
    setSettingsApproveRole(config.approveRole);
    setSettingsApproveEmployeeId(config.approveEmployeeId || "");
    setSettingsApproveEmployee(config.approveEmployee);
    setSettingsOpen(true);
  }

  async function handleSaveSettings() {
    const nextConfig: EquipmentCalibrationConfig = {
      ...configRef.current,
      documentDate: settingsDate,
      year: settingsYear,
      approveRole: settingsApproveRole,
      approveEmployeeId: settingsApproveEmployeeId || null,
      approveEmployee: settingsApproveEmployee,
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
      await checkCalibrationResponse(response, "saveSettings");
      setSettingsOpen(false);
      startTransition(() => router.refresh());
    } catch (error) {
      // Откат: иначе на экране остаются настройки, которых нет в базе.
      applyConfig(previous);
      toast.error(
        t(`errors.${calibrationErrorKey(error, "saveSettings")}`)
      );
    } finally {
      setIsSaving(false);
    }
  }

  /* ---------- render ---------- */

  return (
    <div className="space-y-6 text-black">
      <FocusTodayScroller selector="[data-focus-today]" emptyTitle={t("emptyTitle")} emptyBody={t("emptyBody")} />

      {/* Selection bar */}
      {selectedRows.length > 0 && !isClosed && (
        <JournalSelectionBar
          count={selectedRows.length}
          onClear={() => setSelectedRows([])}
          onDelete={removeSelectedRows}
          hint={t("deleteRowsHint")}
        >
          <SelectionEditButton count={selectedRows.length} disabled={isClosed} onClick={() => seq.start(selectedRows)} />
        </JournalSelectionBar>
      )}

      <JournalDocumentShell
        title={documentTitle(title, config.year)}
        documentId={documentId}
        backHref="/journals/equipment_calibration"
        onSettings={openSettings}
        closed={isClosed}
        closedHint={t("closedHint")}
        /* «Закончить журнал» был в ППР и поломках, а в поверке отсутствовал —
           закрыть график поверки было нечем. */
        menuItems={
          !isClosed
            ? [
                {
                  key: "close-journal",
                  label: t("finish"),
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
          <RecordCardsView items={cardItems} emptyLabel={t("emptyInstruments")} />
        }
        paperHeader={
          <>
            <JournalDocumentHeader
              orgName={organizationLabel}
              title={t("pageTitle").toUpperCase()}
              startedAt={dateFrom}
              finishedAt={isClosed ? config.documentDate : null}
            />

            {/* УТВЕРЖДАЮ block */}
            <div className="mt-4 flex justify-end">
              <div className="w-[400px] text-right text-sm leading-relaxed">
                <div className="font-semibold uppercase">{t("approve")}</div>
                <div>{positionLabel(approver.title)}</div>
                <div className="mt-1 flex items-center justify-end gap-2">
                  <span className="inline-block w-[180px] border-b border-black" />
                  <span>{approver.name}</span>
                </div>
                <div className="mt-1">
                  {config.documentDate ? calibrationDate(config.documentDate, locale, true) : ""}
                </div>
              </div>
            </div>
          </>
        }
        sheetTitle={t("yearTitle", { year: String(config.year) })}
        sheetMinWidth={1100}
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
                {t("add")}</Button>

              {/* Добавленное в /settings/equipment раньше не попадало в
                  уже созданный график поверки вообще. */}
              {missingEquipment.length > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  className="border-[#dcdfed]"
                  onClick={addMissingFromDirectory}
                  title={t("directoryHint")}
                >
                  <ListPlus className="size-4" />
                  {t("addDirectory", { count: missingEquipment.length })}
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      >
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className={`w-10 ${GRID_HEAD_CELL_CLASS} p-1`} rowSpan={2} />
              <th className={`w-12 ${GRID_HEAD_CELL_CLASS} p-1`} rowSpan={2}>
                {t("number")}</th>
              <th className={`w-[280px] ${GRID_HEAD_CELL_CLASS} p-1`} rowSpan={2}>
                {t("identifiers")}</th>
              <th className={`${GRID_HEAD_CELL_CLASS} p-1`} colSpan={2}>
                {t("characteristics")}</th>
              <th className={`${GRID_HEAD_CELL_CLASS} p-1`} rowSpan={2}>
                {t("interval")}</th>
              <th className={`${GRID_HEAD_CELL_CLASS} p-1`} rowSpan={2}>
                {t("lastDate")}</th>
              <th className={`${GRID_HEAD_CELL_CLASS} p-1`} rowSpan={2}>
                {t("nextDate")}</th>
              <th className={`${GRID_HEAD_CELL_CLASS} p-1`} rowSpan={2}>
                {t("note")}</th>
            </tr>
            <tr>
              <th className={`${GRID_HEAD_CELL_CLASS} p-1`}>
                {t("purposeFull")}</th>
              <th className={`${GRID_HEAD_CELL_CLASS} p-1`}>
                {t("rangeFull")}</th>
            </tr>
          </thead>
          <tbody>
            {config.rows.map((row, index) => {
              const nextDate = calculateNextCalibrationDate(row.lastCalibrationDate, row.calibrationInterval);
              const overdue = isCalibrationOverdue(row.lastCalibrationDate, row.calibrationInterval);

              return (
                <tr
                  key={row.id}
                  className={`hover:bg-gray-50 ${!isClosed ? "cursor-pointer" : ""}`}
                  onClick={() => {
                    if (isClosed) return;
                    openEditRow(row.id);
                  }}
                >
                  <td
                    className={`${GRID_CELL_CLASS} p-1 text-center leading-tight`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {!isClosed && (
                      <Checkbox
                        aria-label={t("selectRow", { number: index + 1 })}
          checked={selectedRows.includes(row.id)}
                        onCheckedChange={(checked) =>
                          toggleRow(row.id, checked === true)
                        }
                      />
                    )}
                  </td>
                  <td className={`${GRID_CELL_CLASS} p-1 text-center leading-tight`}>
                    {index + 1}
                  </td>
                  <td className={`${GRID_CELL_CLASS} p-2 leading-tight`}>
                    <div>
                      {rowName(row)}
                      {row.equipmentNumber ? `, ${row.equipmentNumber}` : ""}
                      {row.location ? `, ${row.location}` : ""}
                    </div>
                  </td>
                  <td className={`${GRID_CELL_CLASS} p-1 text-center leading-tight`}>
                    {row.purpose}
                  </td>
                  <td className={`${GRID_CELL_CLASS} p-1 text-center leading-tight`}>
                    {row.measurementRange}
                  </td>
                  <td className={`${GRID_CELL_CLASS} p-1 text-center leading-tight`}>
                    {t("months", { count: row.calibrationInterval })}
                  </td>
                  <td className={`${GRID_CELL_CLASS} p-1 text-center leading-tight`}>
                    {calibrationDate(row.lastCalibrationDate, locale)}
                  </td>
                  <td
                    className={`${GRID_CELL_CLASS} p-1 text-center leading-tight ${overdue ? "font-semibold text-[#ff3b30]" : ""}`}
                  >
                    {calibrationDate(nextDate, locale)}
                  </td>
                  <td className={`${GRID_CELL_CLASS} p-1 text-center leading-tight`}>
                    {row.note}
                  </td>
                </tr>
              );
            })}

            {config.rows.length === 0 && (
              <tr>
                <td
                  colSpan={9}
                  className={`${GRID_CELL_CLASS} p-4 text-center text-gray-400`}
                >
                  {t("emptyTable")}</td>
              </tr>
            )}

            {/* Кликабельная пустая строка — то же окно, что и кнопка
                «Добавить» в тулбаре шапки документа. leading=2 (чекбокс +
                № п/п, как в эталоне гигиенического журнала), labelSpan=1 —
                подпись встаёт под широкую (280px) колонку «Идентификаторы
                СИ»: это единственный содержательный столбец записи, дальше
                уже метрологические характеристики и даты поверки —
                trailing=6. Сумма 2+1+6=9 — тот же colSpan, что был
                раньше. */}
            {!isClosed ? (
              <JournalAddRow
                leading={2}
                labelSpan={1}
                trailing={6}
                label={t("addInstrument")}
                onClick={() => {
                  resetDraft();
                  setAddModalOpen(true);
                }}
              />
            ) : null}

            {/* Extra blank row — раньше была единственной «пустой строкой»
                бланка, но на экране была нежива (чекбокс задизейблен,
                клика нет). Теперь эту роль играет JournalAddRow выше, а
                эта строка остаётся только «полом» бланка при печати. */}
            <tr className="hidden print:table-row">
              <td className={`${GRID_CELL_CLASS} p-1 text-center`}>
                <Checkbox disabled aria-hidden="true" />
              </td>
              <td
                colSpan={8}
                className={`${GRID_CELL_CLASS} p-1`}
              />
            </tr>
          </tbody>
        </table>
      </JournalDocumentShell>

      {/* ---------- Add Row Dialog ---------- */}
      <Dialog open={addModalOpen} onOpenChange={setAddModalOpen}>
        <DialogContent showCloseButton={false} className="max-h-[90vh] supports-[height:100dvh]:max-h-[90dvh] overflow-y-auto w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[24px] border-0 p-0 sm:max-w-[560px]">
          <DialogHeader className="flex flex-row items-center justify-between border-b px-7 py-5">
            <DialogTitle className="text-[24px] font-semibold text-black">
              {t("addRow")}</DialogTitle>
            <button
              type="button"
              aria-label={t("close")}
              className="rounded-md p-1 text-black/80 hover:bg-black/5"
              onClick={() => setAddModalOpen(false)}
            >
              <X className="size-6" />
            </button>
          </DialogHeader>
          <div className="space-y-4 px-7 py-6">
            <EquipmentDirectoryField
              label={t("instrumentName")}
              value={draftName}
              sourceEquipmentId={draftSourceEquipmentId}
              directory={equipmentDirectory}
              documentId={documentId}
              onChange={(name, sourceId) => {
                setDraftName(name);
                setDraftSourceEquipmentId(sourceId);
              }}
            />
            <Input
              aria-label={t("instrumentNumber")} value={draftNumber}
              onChange={(e) => setDraftNumber(e.target.value)}
              placeholder={t("numberPlaceholder")}
              className="h-9 rounded-xl border-[#dfe1ec] px-5 text-[16px]"
            />
            <Input
              aria-label={t("location")} value={draftLocation}
              onChange={(e) => setDraftLocation(e.target.value)}
              placeholder={t("locationPlaceholder")}
              className="h-9 rounded-xl border-[#dfe1ec] px-5 text-[16px]"
            />
            <Input
              aria-label={t("purposeFull")} value={draftPurpose}
              onChange={(e) => setDraftPurpose(e.target.value)}
              placeholder={t("purposePlaceholder")}
              className="h-9 rounded-xl border-[#dfe1ec] px-5 text-[16px]"
            />
            <Input
              aria-label={t("rangeFull")} value={draftRange}
              onChange={(e) => setDraftRange(e.target.value)}
              placeholder={t("rangePlaceholder")}
              className="h-9 rounded-xl border-[#dfe1ec] px-5 text-[16px]"
            />
            <Input
              aria-label={t("intervalMonths")} value={draftInterval}
              onChange={(e) => setDraftInterval(e.target.value)}
              placeholder={t("intervalPlaceholder")}
              className="h-9 rounded-xl border-[#dfe1ec] px-5 text-[16px]"
            />
            <div className="space-y-1">
              <Label className="text-[14px] text-[#6f7282]">{t("lastDate")}</Label>
              <Input
                type="date"
                aria-label={t("lastDate")} value={draftLastDate}
                onChange={(e) => setDraftLastDate(e.target.value)}
                className="h-9 rounded-xl border-[#dfe1ec] px-5 text-[16px]"
              />
            </div>
            <Textarea
              aria-label={t("note")} value={draftNote}
              onChange={(e) => setDraftNote(e.target.value)}
              placeholder={t("note")}
              rows={3}
              className="rounded-2xl border-[#dfe1ec] px-5 py-4 text-[16px]"
            />
            <div className="flex justify-end pt-1">
              <Button
                onClick={saveDraftRow}
                disabled={!draftName.trim()}
                className="h-9 rounded-xl bg-[#5863f8] px-3.5 text-[13.5px] font-medium text-white hover:bg-[#4b57f3]"
              >
                {t("add")}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ---------- Edit Row Dialog ---------- */}
      <Dialog open={editModalOpen} onOpenChange={(open) => (open ? setEditModalOpen(true) : closeEditModal())}>
        <DialogContent showCloseButton={false} className="max-h-[90vh] supports-[height:100dvh]:max-h-[90dvh] overflow-y-auto w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[24px] border-0 p-0 sm:max-w-[560px]">
          <DialogHeader className="flex flex-row items-center justify-between border-b px-7 py-5">
            <DialogTitle className="text-[24px] font-semibold text-black">
              {t("editRow", { progress: seq.progress ? ` ${seq.progress}` : "" })}
            </DialogTitle>
            <button
              type="button"
              aria-label={t("close")}
              className="rounded-md p-1 text-black/80 hover:bg-black/5"
              onClick={closeEditModal}
            >
              <X className="size-6" />
            </button>
          </DialogHeader>
          <div className="space-y-4 px-7 py-6">
            <EquipmentDirectoryField
              label={t("instrumentName")}
              value={editName}
              sourceEquipmentId={editSourceEquipmentId}
              directory={equipmentDirectory}
              documentId={documentId}
              onChange={(name, sourceId) => {
                setEditName(name);
                setEditSourceEquipmentId(sourceId);
              }}
            />
            <div className="space-y-1">
              <Label className="text-[14px] text-[#6f7282]">{t("instrumentNumber")}</Label>
              <Input
                aria-label={t("instrumentNumber")} value={editNumber}
                onChange={(e) => setEditNumber(e.target.value)}
                className="h-9 rounded-xl border-[#dfe1ec] px-5 text-[16px]"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[14px] text-[#6f7282]">{t("location")}</Label>
              <Input
                aria-label={t("location")} value={editLocation}
                onChange={(e) => setEditLocation(e.target.value)}
                className="h-9 rounded-xl border-[#dfe1ec] px-5 text-[16px]"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[14px] text-[#6f7282]">{t("purposeFull")}</Label>
              <Input
                aria-label={t("purposeFull")} value={editPurpose}
                onChange={(e) => setEditPurpose(e.target.value)}
                className="h-9 rounded-xl border-[#dfe1ec] px-5 text-[16px]"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[14px] text-[#6f7282]">{t("rangeFull")}</Label>
              <Input
                aria-label={t("rangeFull")} value={editRange}
                onChange={(e) => setEditRange(e.target.value)}
                className="h-9 rounded-xl border-[#dfe1ec] px-5 text-[16px]"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[14px] text-[#6f7282]">{t("intervalMonths")}</Label>
              <Input
                aria-label={t("intervalMonths")} value={editInterval}
                onChange={(e) => setEditInterval(e.target.value)}
                className="h-9 rounded-xl border-[#dfe1ec] px-5 text-[16px]"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[14px] text-[#6f7282]">{t("lastDate")}</Label>
              <Input
                type="date"
                aria-label={t("lastDate")} value={editLastDate}
                onChange={(e) => setEditLastDate(e.target.value)}
                className="h-9 rounded-xl border-[#dfe1ec] px-5 text-[16px]"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[14px] text-[#6f7282]">{t("note")}</Label>
              <Textarea
                aria-label={t("note")} value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
                rows={3}
                className="rounded-2xl border-[#dfe1ec] px-5 py-4 text-[16px]"
              />
            </div>
            <div className="flex justify-end pt-1">
              <Button
                onClick={saveEditRow}
                className="h-9 rounded-xl bg-[#5863f8] px-3.5 text-[13.5px] font-medium text-white hover:bg-[#4b57f3]"
              >
                {t("save")}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ---------- Settings Dialog ---------- */}
      {useV2 ? (
        <JournalSettingsModal
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          title={t("settingsTitle")}
          description={t("settingsDescription")}
          size="md"
          isSaving={isSaving}
          onSave={handleSaveSettings}
          onCancel={() => setSettingsOpen(false)}
        >
          <div className="space-y-2">
            <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              {t("documentTitle")}</Label>
            <Input
              aria-label={t("documentTitle")} value={settingsTitle}
              onChange={(e) => setSettingsTitle(e.target.value)}
              className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
                {t("documentDate")}</Label>
              <Input
                type="date"
                aria-label={t("documentDate")} value={settingsDate}
                onChange={(e) => setSettingsDate(e.target.value)}
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
                {t("year")}</Label>
              <Select
                value={String(settingsYear)}
                onValueChange={(val) => setSettingsYear(Number(val))}
              >
                <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-white text-[13.5px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {yearOptions.map((y) => (
                    <SelectItem key={y} value={y}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              {t("approvalRole")}</Label>
            <Select
              value={settingsApproveRole}
              onValueChange={approveCascade.handlePositionChange}
            >
              <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-white text-[13.5px]">
                <SelectValue placeholder={t("choose")} />
              </SelectTrigger>
              <SelectContent>
                <EquipmentCalibrationPositionItems users={users} />
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              {t("employee")}</Label>
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
                <SelectValue placeholder={t("choose")} />
              </SelectTrigger>
              <SelectContent>
                {(settingsApproveRole ? approveCascade.candidates : users).map((u) => (
                  <SelectItem key={u.id} value={u.id}>{`${positionLabel(getUserPositionLabel(u))} - ${getUserDisplayName(u, t("noName"))}`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </JournalSettingsModal>
      ) : (
        <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DialogContent showCloseButton={false} className="max-h-[90vh] supports-[height:100dvh]:max-h-[90dvh] overflow-y-auto w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[24px] border-0 p-0 sm:max-w-[560px]">
            <DialogHeader className="flex flex-row items-center justify-between border-b px-7 py-5">
              <DialogTitle className="text-[24px] font-semibold text-black">
                {t("settingsTitle")}</DialogTitle>
              <button
                type="button"
                aria-label={t("close")}
                className="rounded-md p-1 text-black/80 hover:bg-black/5"
                onClick={() => setSettingsOpen(false)}
              >
                <X className="size-6" />
              </button>
            </DialogHeader>
            <div className="space-y-4 px-7 py-6">
              <div className="space-y-1">
                <Label className="text-[14px] text-[#6f7282]">{t("documentTitle")}</Label>
                <Input
                  aria-label={t("documentTitle")} value={settingsTitle}
                  onChange={(e) => setSettingsTitle(e.target.value)}
                  className="h-9 rounded-xl border-[#dfe1ec] px-5 text-[16px]"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[14px] text-[#6f7282]">{t("documentDate")}</Label>
                <Input
                  type="date"
                  aria-label={t("documentDate")} value={settingsDate}
                  onChange={(e) => setSettingsDate(e.target.value)}
                  className="h-9 rounded-xl border-[#dfe1ec] px-5 text-[16px]"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[14px] text-[#6f7282]">{t("year")}</Label>
                <Select
                  value={String(settingsYear)}
                  onValueChange={(val) => setSettingsYear(Number(val))}
                >
                  <SelectTrigger className="h-10 rounded-xl border-[#dfe1ec] bg-[#f3f4fb] px-5 text-[16px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {yearOptions.map((y) => (
                      <SelectItem key={y} value={y}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[14px] text-[#6f7282]">{t("approvalRole")}</Label>
                <Select
                  value={settingsApproveRole}
                  onValueChange={approveCascade.handlePositionChange}
                >
                  <SelectTrigger className="h-10 rounded-xl border-[#dfe1ec] bg-[#f3f4fb] px-5 text-[16px]">
                    <SelectValue placeholder={t("choosePosition")} />
                  </SelectTrigger>
                  <SelectContent>
                    <EquipmentCalibrationPositionItems users={users} />
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[14px] text-[#6f7282]">{t("employee")}</Label>
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
                  <SelectTrigger className="h-10 rounded-xl border-[#dfe1ec] bg-[#f3f4fb] px-5 text-[16px]">
                    <SelectValue placeholder={t("chooseEmployee")} />
                  </SelectTrigger>
                  <SelectContent>
                    {(settingsApproveRole ? approveCascade.candidates : users).map((u) => (
                      <SelectItem key={u.id} value={u.id}>{`${positionLabel(getUserPositionLabel(u))} - ${getUserDisplayName(u, t("noName"))}`}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end pt-1">
                <Button
                  onClick={handleSaveSettings}
                  disabled={isSaving}
                  className="h-9 rounded-xl bg-[#5863f8] px-3.5 text-[13.5px] font-medium text-white hover:bg-[#4b57f3]"
                >
                  {isSaving ? t("saving") : t("save")}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
