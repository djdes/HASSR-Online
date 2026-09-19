"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  CalendarDays,
  Paperclip,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { JournalSelectionBar } from "@/components/journals/journal-selection-bar";
import { SelectionEditButton } from "@/components/journals/selection-edit-button";
import { useSequentialEdit } from "@/components/journals/use-sequential-edit";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createMetalImpurityRow,
  getMetalImpurityEmployeeOptions,
  getMetalImpurityOptionName,
  getMetalImpurityValuePerKg,
  METAL_IMPURITY_DOCUMENT_TITLE,
  METAL_IMPURITY_PAGE_TITLE,
  METAL_IMPURITY_RESPONSIBLE_POSITIONS,
  METAL_IMPURITY_TEMPLATE_CODE,
  normalizeMetalImpurityConfig,
  type MetalImpurityDocumentConfig,
  type MetalImpurityOption,
  type MetalImpurityRow,
  type MetalImpurityUser,
} from "@/lib/metal-impurity-document";
import { buildStaffOptionLabel } from "@/lib/journal-staff-binding";
import { DOC_PRIMARY_BUTTON_CLASS } from "@/components/journals/journal-responsive";
import { JournalDocumentShell } from "@/components/journals/journal-document-shell";
import { JournalDocumentHeader } from "@/components/journals/journal-document-header";
import { JournalAddRow } from "@/components/journals/journal-add-row";
import { GRID_CELL_CLASS, GRID_HEAD_CELL_CLASS } from "@/components/journals/journal-grid";
import { JournalSettingsModal } from "@/components/journals/v2/journal-settings-modal";
import { FocusTodayScroller } from "@/components/journals/focus-today-scroller";
import { useMobileView } from "@/lib/use-mobile-view";
import {
  RecordCardsView,
  type RecordCardItem,
} from "@/components/journals/record-cards-view";

import { toast } from "sonner";
import { confirmAsync } from "@/components/ui/confirm-async";
import {
  EMPTY_SELECT_VALUE,
  PositionSelectItems,
  usePositionEmployeeCascade,
} from "@/components/shared/position-select";
import { localDayKey } from "@/lib/entry-defaults";
type Props = {
  documentId: string;
  title: string;
  organizationName: string;
  status: string;
  config: unknown;
  users: MetalImpurityUser[];
  /** Design v2 toggle. */
  useV2?: boolean;
};

type RowDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: MetalImpurityRow | null;
  /** «(k из N)» при правке выделенных строк по очереди. */
  titleSuffix?: string;
  materials: MetalImpurityOption[];
  suppliers: MetalImpurityOption[];
  users: MetalImpurityUser[];
  responsiblePosition: string;
  responsibleEmployeeId?: string | null;
  responsibleEmployee: string;
  onSave: (row: MetalImpurityRow, additions?: { materialName?: string; supplierName?: string }) => Promise<void>;
};

type ListEditorSectionProps = {
  title: string;
  items: MetalImpurityOption[];
  draftValue: string;
  onDraftChange: (value: string) => void;
  onAdd: () => void;
  editingId: string | null;
  editingValue: string;
  onEditStart: (id: string, value: string) => void;
  onEditChange: (value: string) => void;
  onEditCommit: () => void;
  addPlaceholder: string;
  onImportClick: () => void;
  onImportFile: (file: File) => void;
  /** Удаление ошибочно добавленной позиции. */
  onDelete: (item: MetalImpurityOption) => void;
};

function formatRuDate(value: string) {
  if (!value) return "__________";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("ru-RU");
}

function AddableSelectField(props: {
  label: string;
  value: string;
  options: MetalImpurityOption[];
  selectPlaceholder: string;
  addPlaceholder: string;
  addValue: string;
  onValueChange: (value: string) => void;
  onAddValueChange: (value: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="space-y-3">
      <Label className="text-[14px] text-[#73738a]">{props.label}</Label>
      <Select value={props.value} onValueChange={props.onValueChange}>
        <SelectTrigger className="h-10 rounded-xl border-[#dfe1ec] bg-white px-5 text-[16px]">
          <SelectValue placeholder={props.selectPlaceholder} />
        </SelectTrigger>
        <SelectContent>
          {props.options.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex gap-3">
        <Input
          value={props.addValue}
          placeholder={props.addPlaceholder}
          onChange={(event) => props.onAddValueChange(event.target.value)}
          className="h-9 rounded-xl border-[#dfe1ec] px-5 text-[16px]"
        />
        <Button
          type="button"
          onClick={props.onAdd}
          className="size-14 rounded-[14px] bg-[#5566f6] p-0 text-white hover:bg-[#4b57ff]"
        >
          <Plus className="size-5" />
        </Button>
      </div>
    </div>
  );
}

function RowDialog({
  open,
  onOpenChange,
  row,
  titleSuffix,
  materials,
  suppliers,
  users,
  responsiblePosition,
  responsibleEmployeeId,
  responsibleEmployee,
  onSave,
}: RowDialogProps) {
  const today = localDayKey();
  const [draft, setDraft] = useState<MetalImpurityRow>(
    createMetalImpurityRow({
      date: today,
      responsibleEmployeeId: responsibleEmployeeId || null,
      responsibleName: responsibleEmployee,
    })
  );
  const [draftPosition, setDraftPosition] = useState(responsiblePosition);
  const [draftEmployeeId, setDraftEmployeeId] = useState(responsibleEmployeeId || "");
  const [newSupplier, setNewSupplier] = useState("");
  const [newMaterial, setNewMaterial] = useState("");
  const [materialOptions, setMaterialOptions] = useState<MetalImpurityOption[]>([]);
  const [supplierOptions, setSupplierOptions] = useState<MetalImpurityOption[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const rowCascade = usePositionEmployeeCascade({
    users,
    positionTitle: draftPosition,
    userId: draftEmployeeId,
    onChange: (next) => {
      const user = users.find((item) => item.id === next.userId) || null;
      setDraftPosition(next.positionTitle);
      setDraftEmployeeId(next.userId);
      setDraft((current) => ({
        ...current,
        responsibleRole: next.positionTitle,
        responsibleEmployeeId: next.userId || null,
        responsibleName: user?.name || "",
      }));
    },
    resolveCandidates: (roleLabel) =>
      getMetalImpurityEmployeeOptions(
        users,
        roleLabel,
        draftEmployeeId || responsibleEmployeeId || null,
        [responsibleEmployeeId, draft.responsibleEmployeeId]
      ),
    autoPick: "first",
  });
  const employeeOptions = rowCascade.candidates;

  useEffect(() => {
    if (!open) return;
    const initialRow =
      row ||
      createMetalImpurityRow({
        date: today,
        materialId: materials[0]?.id || "",
        supplierId: suppliers[0]?.id || "",
        responsibleRole: responsiblePosition,
        responsibleEmployeeId: responsibleEmployeeId || null,
        responsibleName: responsibleEmployee,
      });
    setDraft(initialRow);
    setDraftPosition(initialRow.responsibleRole || responsiblePosition);
    setDraftEmployeeId(initialRow.responsibleEmployeeId || responsibleEmployeeId || "");
    setNewSupplier("");
    setNewMaterial("");
    setMaterialOptions(materials);
    setSupplierOptions(suppliers);
    setSubmitting(false);
  }, [materials, open, responsibleEmployee, responsibleEmployeeId, responsiblePosition, row, suppliers, today]);

  function appendOption(items: MetalImpurityOption[], nextItem: MetalImpurityOption) {
    if (items.some((item) => item.id === nextItem.id || item.name.toLowerCase() === nextItem.name.toLowerCase())) {
      return items;
    }
    return [...items, nextItem];
  }

  useEffect(() => {
    if (!open || employeeOptions.length === 0) return;
    if (!employeeOptions.some((employee) => employee.id === draftEmployeeId)) {
      const nextEmployee = employeeOptions[0] || null;
      setDraftEmployeeId(nextEmployee?.id || "");
      setDraft((current) => ({
        ...current,
        responsibleEmployeeId: nextEmployee?.id || null,
        responsibleName: nextEmployee?.name || "",
      }));
    }
  }, [draftEmployeeId, employeeOptions, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-1rem)] rounded-[32px] border-0 p-0 sm:max-w-[760px]">
        <DialogHeader className="border-b px-5 py-6 sm:px-10 sm:py-8">
          <DialogTitle className="text-[22px] font-medium text-black">
            {row ? `Редактирование строки${titleSuffix ? ` ${titleSuffix}` : ""}` : "Добавление новой строки"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-5 px-5 py-6 sm:px-10 sm:py-8">
          <div className="space-y-3">
            <Label className="text-[14px] text-[#73738a]">Дата</Label>
            <div className="relative">
              <Input
                type="date"
                value={draft.date}
                onChange={(event) => setDraft({ ...draft, date: event.target.value })}
                className="h-9 rounded-xl border-[#dfe1ec] px-5 pr-12 text-[16px]"
              />
              <CalendarDays className="pointer-events-none absolute right-4 top-1/2 size-5 -translate-y-1/2 text-[#767b90]" />
            </div>
          </div>

          <AddableSelectField
            label="Поставщик"
            value={draft.supplierId}
            options={supplierOptions}
            selectPlaceholder="Выберите из списка или добавьте новое"
            addPlaceholder="Добавить название нового поставщика"
            addValue={newSupplier}
            onValueChange={(value) => setDraft({ ...draft, supplierId: value })}
            onAddValueChange={setNewSupplier}
            onAdd={() => {
              const value = newSupplier.trim();
              if (!value) return;
              const nextId = `new-supplier:${value}`;
              setSupplierOptions((current) => appendOption(current, { id: nextId, name: value }));
              setDraft({ ...draft, supplierId: nextId });
              setNewSupplier("");
            }}
          />

          <AddableSelectField
            label="Сырье"
            value={draft.materialId}
            options={materialOptions}
            selectPlaceholder="Выберите из списка или добавьте новое"
            addPlaceholder="Добавить название нового сырья"
            addValue={newMaterial}
            onValueChange={(value) => setDraft({ ...draft, materialId: value })}
            onAddValueChange={setNewMaterial}
            onAdd={() => {
              const value = newMaterial.trim();
              if (!value) return;
              const nextId = `new-material:${value}`;
              setMaterialOptions((current) => appendOption(current, { id: nextId, name: value }));
              setDraft({ ...draft, materialId: nextId });
              setNewMaterial("");
            }}
          />

          <div className="space-y-3">
            <Input
              value={draft.consumedQuantityKg}
              placeholder="Введите кол-во израсходованного сырья, кг"
              onChange={(event) =>
                setDraft({ ...draft, consumedQuantityKg: event.target.value })
              }
              className="h-9 rounded-xl border-[#dfe1ec] px-5 text-[16px]"
            />
          </div>

          <div className="space-y-3">
            <Input
              value={draft.impurityQuantityG}
              placeholder="Введите кол-во металломагнитной примеси, г"
              onChange={(event) =>
                setDraft({ ...draft, impurityQuantityG: event.target.value })
              }
              className="h-9 rounded-xl border-[#dfe1ec] px-5 text-[16px]"
            />
          </div>

          <div className="space-y-3">
            <Input
              value={draft.impurityCharacteristic}
              placeholder="Введите хар-ку металломагнитной примеси"
              onChange={(event) =>
                setDraft({ ...draft, impurityCharacteristic: event.target.value })
              }
              className="h-9 rounded-xl border-[#dfe1ec] px-5 text-[16px]"
            />
          </div>

          <div className="space-y-3">
            <Label className="text-[14px] text-[#73738a]">Должность ответственного</Label>
            <Select
              value={draftPosition}
              onValueChange={rowCascade.handlePositionChange}
            >
              <SelectTrigger className="h-10 rounded-xl border-[#dfe1ec] bg-[#f3f4fb] px-5 text-[16px]">
                <SelectValue placeholder="- Выберите значение -" />
              </SelectTrigger>
              <SelectContent>
                <PositionSelectItems users={users} />
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3">
            <Label className="text-[14px] text-[#73738a]">Сотрудник</Label>
            <Select
              value={draftEmployeeId || EMPTY_SELECT_VALUE}
              onValueChange={rowCascade.handleEmployeeChange}
              open={rowCascade.employeeOpen}
              onOpenChange={rowCascade.setEmployeeOpen}
            >
              <SelectTrigger className="h-10 rounded-xl border-[#dfe1ec] bg-[#f3f4fb] px-5 text-[16px]">
                <SelectValue placeholder="- Выберите значение -" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={EMPTY_SELECT_VALUE}>- Выберите значение -</SelectItem>
                {employeeOptions.map((employee) => (
                  <SelectItem key={employee.id} value={employee.id}>
                    {buildStaffOptionLabel(employee)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end">
            <Button
              type="button"
              disabled={submitting}
              onClick={async () => {
                setSubmitting(true);
                try {
                  await onSave(
                    {
                      ...draft,
                      responsibleRole: draftPosition,
                      responsibleEmployeeId: draftEmployeeId || null,
                      responsibleName:
                        users.find((user) => user.id === draftEmployeeId)?.name || draft.responsibleName,
                    },
                    {
                      materialName: newMaterial.trim() || undefined,
                      supplierName: newSupplier.trim() || undefined,
                    }
                  );
                  // Окно закрывает родитель: при правке по очереди он откроет следующую строку.
                } catch (error) {
                  // Без catch ошибка глохла: окно висело, тоста не было.
                  toast.error(
                    error instanceof Error ? error.message : "Не удалось сохранить строку"
                  );
                } finally {
                  setSubmitting(false);
                }
              }}
              className="h-10 rounded-xl bg-[#5566f6] px-8 text-[16px] text-white hover:bg-[#4b57ff]"
            >
              {submitting ? "Сохранение..." : row ? "Сохранить" : "Добавить"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SettingsDialog({
  open,
  onOpenChange,
  title,
  config,
  users,
  employeeOptions,
  onSave,
  useV2 = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  config: MetalImpurityDocumentConfig;
  users: MetalImpurityUser[];
  employeeOptions: MetalImpurityUser[];
  onSave: (params: { title: string; config: MetalImpurityDocumentConfig }) => Promise<void>;
  useV2?: boolean;
}) {
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftConfig, setDraftConfig] = useState(config);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraftTitle(title);
    setDraftConfig(config);
    setSubmitting(false);
  }, [config, open, title]);

  const settingsCascade = usePositionEmployeeCascade({
    users,
    positionTitle: draftConfig.responsiblePosition,
    userId: draftConfig.responsibleEmployeeId || "",
    onChange: (next) =>
      setDraftConfig((current) => {
        const user = users.find((item) => item.id === next.userId) || null;
        return {
          ...current,
          responsiblePosition: next.positionTitle,
          responsibleEmployeeId: next.userId || null,
          responsibleEmployee: user
            ? user.name
            : next.positionTitle !== current.responsiblePosition
              ? current.responsibleEmployee
              : "",
        };
      }),
    resolveCandidates: (roleLabel) =>
      getMetalImpurityEmployeeOptions(
        users,
        roleLabel,
        draftConfig.responsibleEmployeeId || null,
        employeeOptions.map((employee) => employee.id)
      ),
    autoPick: "first",
  });
  const filteredEmployees = settingsCascade.candidates;

  useEffect(() => {
    if (!open || filteredEmployees.length === 0) return;
    if (!filteredEmployees.some((employee) => employee.id === draftConfig.responsibleEmployeeId)) {
      setDraftConfig((current) => ({
        ...current,
        responsibleEmployeeId: filteredEmployees[0]?.id || null,
        responsibleEmployee: filteredEmployees[0]?.name || "",
      }));
    }
  }, [draftConfig.responsibleEmployeeId, filteredEmployees, open]);

  async function handleSave() {
    setSubmitting(true);
    try {
      await onSave({ title: draftTitle, config: draftConfig });
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  if (useV2) {
    return (
      <JournalSettingsModal
        open={open}
        onOpenChange={onOpenChange}
        title="Настройки документа"
        description="Название журнала, дата и ответственный сотрудник."
        size="md"
        isSaving={submitting}
        onSave={handleSave}
        onCancel={() => onOpenChange(false)}
      >
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            Название документа
          </Label>
          <Input
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            Дата начала
          </Label>
          <Input
            type="date"
            value={draftConfig.startDate}
            onChange={(event) =>
              setDraftConfig({ ...draftConfig, startDate: event.target.value })
            }
            className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            Должность ответственного
          </Label>
          <Select
            value={draftConfig.responsiblePosition}
            onValueChange={settingsCascade.handlePositionChange}
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
            Сотрудник
          </Label>
          <Select
            value={draftConfig.responsibleEmployeeId || EMPTY_SELECT_VALUE}
            onValueChange={settingsCascade.handleEmployeeChange}
            open={settingsCascade.employeeOpen}
            onOpenChange={settingsCascade.setEmployeeOpen}
          >
            <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-white text-[13.5px]">
              <SelectValue placeholder="— Выберите —" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={EMPTY_SELECT_VALUE}>— не выбран —</SelectItem>
              {filteredEmployees.map((employee) => (
                <SelectItem key={employee.id} value={employee.id}>
                  {buildStaffOptionLabel(employee)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </JournalSettingsModal>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-1rem)] rounded-[32px] border-0 p-0 sm:max-w-[760px]">
        <DialogHeader className="border-b px-5 py-6 sm:px-10 sm:py-8">
          <DialogTitle className="text-[22px] font-medium text-black">
            Настройки документа
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-5 px-5 py-6 sm:px-10 sm:py-8">
          <div className="space-y-3">
            <Label className="text-[14px] text-[#73738a]">Название документа</Label>
            <Input
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              className="h-9 rounded-xl border-[#dfe1ec] px-5 text-[16px]"
            />
          </div>
          <div className="space-y-3">
            <Label className="text-[14px] text-[#73738a]">Дата начала</Label>
            <div className="relative">
              <Input
                type="date"
                value={draftConfig.startDate}
                onChange={(event) =>
                  setDraftConfig({ ...draftConfig, startDate: event.target.value })
                }
                className="h-9 rounded-xl border-[#dfe1ec] px-5 pr-12 text-[16px]"
              />
              <CalendarDays className="pointer-events-none absolute right-4 top-1/2 size-5 -translate-y-1/2 text-[#767b90]" />
            </div>
          </div>
          <div className="space-y-3">
            <Label className="text-[14px] text-[#73738a]">Должность ответственного</Label>
            <Select
              value={draftConfig.responsiblePosition}
              onValueChange={settingsCascade.handlePositionChange}
            >
              <SelectTrigger className="h-10 rounded-xl border-[#dfe1ec] bg-[#f3f4fb] px-5 text-[16px]">
                <SelectValue placeholder="- Выберите значение -" />
              </SelectTrigger>
              <SelectContent>
                <PositionSelectItems users={users} />
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-3">
            <Label className="text-[14px] text-[#73738a]">Сотрудник</Label>
            <Select
              value={draftConfig.responsibleEmployeeId || EMPTY_SELECT_VALUE}
              onValueChange={settingsCascade.handleEmployeeChange}
              open={settingsCascade.employeeOpen}
              onOpenChange={settingsCascade.setEmployeeOpen}
            >
              <SelectTrigger className="h-10 rounded-xl border-[#dfe1ec] bg-[#f3f4fb] px-5 text-[16px]">
                <SelectValue placeholder="- Выберите значение -" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={EMPTY_SELECT_VALUE}>- Выберите значение -</SelectItem>
                {filteredEmployees.map((employee) => (
                  <SelectItem key={employee.id} value={employee.id}>
                    {buildStaffOptionLabel(employee)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              disabled={submitting}
              onClick={handleSave}
              className="h-10 rounded-xl bg-[#5566f6] px-8 text-[16px] text-white hover:bg-[#4b57ff]"
            >
              {submitting ? "Сохранение..." : "Сохранить"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ListEditorSection({
  title,
  items,
  draftValue,
  onDraftChange,
  onAdd,
  editingId,
  editingValue,
  onEditStart,
  onEditChange,
  onEditCommit,
  addPlaceholder,
  onImportClick,
  onImportFile,
  onDelete,
}: ListEditorSectionProps) {
  return (
    <div className="space-y-4">
      <div className="text-[24px] font-semibold text-black">{title}</div>
      <div className="space-y-3">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-3 rounded-[18px] bg-[#f6f7fb] px-4 py-4"
          >
            {/* Декоративный «чекбокс» убран: он ничего не выбирал. */}
            {editingId === item.id ? (
              <Input
                autoFocus
                value={editingValue}
                onChange={(event) => onEditChange(event.target.value)}
                onBlur={onEditCommit}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onEditCommit();
                }}
                className="h-10 border-0 bg-transparent px-0 text-[16px] shadow-none"
              />
            ) : (
              <div className="flex-1 text-[16px] text-black">{item.name}</div>
            )}
            <button
              type="button"
              onClick={() => onEditStart(item.id, item.name)}
              className="rounded-lg p-2 text-[#5566f6] transition-colors duration-150 hover:bg-[#eef1ff] hover:text-[#4b57ff]"
              title="Переименовать"
            >
              <Pencil className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => onDelete(item)}
              className="rounded-lg p-2 text-[#9a9db0] transition-colors duration-150 hover:bg-[#fff3f2] hover:text-[#ff3b30]"
              title="Удалить из списка"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}

        <div className="flex gap-3">
          <Input
            value={draftValue}
            onChange={(event) => onDraftChange(event.target.value)}
            placeholder={addPlaceholder}
            className="h-9 rounded-xl border-[#dfe1ec] px-5 text-[16px]"
          />
          <Button
            type="button"
            onClick={onAdd}
            className="size-14 rounded-[14px] bg-[#5566f6] p-0 text-white hover:bg-[#4b57ff]"
          >
            <Plus className="size-5" />
          </Button>
        </div>

          <div className="space-y-3 pt-1 text-[14px] text-[#6d7288]">
            <button
              type="button"
              onClick={onImportClick}
            className="text-left text-[#5f66ff] underline underline-offset-2"
          >
            Добавить из файла
          </button>
          <div>
            Список должен быть в файле Excel, на первом листе в первом столбце и начинаться с
            первой строки.
          </div>
            <div
              role="button"
              tabIndex={0}
              onClick={onImportClick}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onImportClick();
                }
              }}
              onDragOver={(event) => {
                event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                const file = event.dataTransfer.files?.[0];
                if (file) onImportFile(file);
              }}
              className="flex min-h-[96px] cursor-pointer items-center justify-center rounded-[18px] border border-dashed border-[#cfd4e9] bg-white text-center transition-colors hover:border-[#5566f6] hover:bg-[#f5f6ff]"
            >
              <div className="flex flex-col items-center gap-2 text-[#727890]">
                <Paperclip className="size-5" />
                <span>Выберите файл или перетащите его сюда</span>
              </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ListsDialog({
  open,
  onOpenChange,
  config,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: MetalImpurityDocumentConfig;
  onSave: (config: MetalImpurityDocumentConfig) => Promise<void>;
}) {
  const [draft, setDraft] = useState(config);
  const [newMaterial, setNewMaterial] = useState("");
  const [newSupplier, setNewSupplier] = useState("");
  const [editingMaterialId, setEditingMaterialId] = useState<string | null>(null);
  const [editingSupplierId, setEditingSupplierId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const materialFileInputRef = useRef<HTMLInputElement>(null);
  const supplierFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(config);
    setNewMaterial("");
    setNewSupplier("");
    setEditingMaterialId(null);
    setEditingSupplierId(null);
    setEditingValue("");
    setSubmitting(false);
  }, [config, open]);

  function commitMaterialEdit() {
    if (!editingMaterialId) return;
    const value = editingValue.trim();
    if (value) {
      setDraft((current) => ({
        ...current,
        materials: current.materials.map((item) =>
          item.id === editingMaterialId ? { ...item, name: value } : item
        ),
      }));
    }
    setEditingMaterialId(null);
    setEditingValue("");
  }

  function commitSupplierEdit() {
    if (!editingSupplierId) return;
    const value = editingValue.trim();
    if (value) {
      setDraft((current) => ({
        ...current,
        suppliers: current.suppliers.map((item) =>
          item.id === editingSupplierId ? { ...item, name: value } : item
        ),
      }));
    }
    setEditingSupplierId(null);
    setEditingValue("");
  }

  /**
   * Удаление позиции справочника. Пока она стоит в строках журнала,
   * удалять нельзя: строки ссылаются на неё по id и остались бы без
   * наименования.
   */
  function removeOption(target: "materials" | "suppliers", item: MetalImpurityOption) {
    const used = draft.rows.some(
      (row) => (target === "materials" ? row.materialId : row.supplierId) === item.id
    );
    if (used) {
      toast.error(
        `«${item.name}» уже стоит в записях журнала — сначала измените эти строки`
      );
      return;
    }
    setDraft((current) => ({
      ...current,
      [target]: (target === "materials" ? current.materials : current.suppliers).filter(
        (option) => option.id !== item.id
      ),
    }));
    toast.success(`Удалено из списка: ${item.name}`);
  }

  async function importItems(file: File, target: "materials" | "suppliers") {
    try {
      // xlsx (SheetJS) — 402 КБ / 135 КБ gzip. При статическом импорте она
      // попадала в общий чанк ВСЕХ 35 редакторов журналов: открываешь
      // гигиенический журнал — качаешь парсер Excel. Грузим по требованию,
      // ровно как в acceptance-document-client и fryer-oil-document-client.
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1 });
      const items = rows.map((row) => String(row[0] ?? "").trim()).filter(Boolean);
      if (items.length === 0) throw new Error("empty");
      setDraft((current) => {
        const currentItems = target === "materials" ? current.materials : current.suppliers;
        const existingNames = new Set(currentItems.map((item) => item.name.toLowerCase()));
        const imported = items
          .filter((item) => !existingNames.has(item.toLowerCase()))
          .map((name, index) => ({
            id: `${target.slice(0, -1)}-import-${Date.now()}-${index}`,
            name,
          }));
        return target === "materials"
          ? { ...current, materials: [...current.materials, ...imported] }
          : { ...current, suppliers: [...current.suppliers, ...imported] };
      });
    } catch {
      toast.error("Не удалось импортировать файл");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-1rem)] rounded-[32px] border-0 p-0 sm:max-w-[620px]">
        <DialogHeader className="border-b px-8 py-6">
          <DialogTitle className="text-[24px] font-medium text-black">
            Редактировать список
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-8 px-8 py-6">
          <ListEditorSection
            title="Сырье"
            items={draft.materials}
            draftValue={newMaterial}
            onDraftChange={setNewMaterial}
            onAdd={() => {
              const value = newMaterial.trim();
              if (!value) return;
              setDraft((current) => ({
                ...current,
                materials: [
                  ...current.materials,
                  { id: `material-${Date.now()}`, name: value },
                ],
              }));
              setNewMaterial("");
            }}
            editingId={editingMaterialId}
            editingValue={editingValue}
            onEditStart={(id, value) => {
              commitSupplierEdit();
              setEditingMaterialId(id);
              setEditingValue(value);
            }}
            onEditChange={setEditingValue}
            onEditCommit={commitMaterialEdit}
            addPlaceholder="Введите название нового сырья"
            onImportClick={() => materialFileInputRef.current?.click()}
            onImportFile={(file) => {
              importItems(file, "materials").catch(() => undefined);
            }}
            onDelete={(item) => removeOption("materials", item)}
          />

          <ListEditorSection
            title="Поставщики"
            items={draft.suppliers}
            draftValue={newSupplier}
            onDraftChange={setNewSupplier}
            onAdd={() => {
              const value = newSupplier.trim();
              if (!value) return;
              setDraft((current) => ({
                ...current,
                suppliers: [
                  ...current.suppliers,
                  { id: `supplier-${Date.now()}`, name: value },
                ],
              }));
              setNewSupplier("");
            }}
            editingId={editingSupplierId}
            editingValue={editingValue}
            onEditStart={(id, value) => {
              commitMaterialEdit();
              setEditingSupplierId(id);
              setEditingValue(value);
            }}
            onEditChange={setEditingValue}
            onEditCommit={commitSupplierEdit}
            addPlaceholder="Введите название нового поставщика"
            onImportClick={() => supplierFileInputRef.current?.click()}
            onImportFile={(file) => {
              importItems(file, "suppliers").catch(() => undefined);
            }}
            onDelete={(item) => removeOption("suppliers", item)}
          />

          <div className="flex justify-end">
            <Button
              type="button"
              disabled={submitting}
              onClick={async () => {
                setSubmitting(true);
                try {
                  await onSave(draft);
                  onOpenChange(false);
                } finally {
                  setSubmitting(false);
                }
              }}
              className="h-10 rounded-xl bg-[#5566f6] px-8 text-[16px] text-white hover:bg-[#4b57ff]"
            >
              {submitting ? "Сохранение..." : "Закрыть"}
            </Button>
          </div>
        </div>
        <input
          ref={materialFileInputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) importItems(file, "materials").catch(() => undefined);
            event.currentTarget.value = "";
          }}
        />
        <input
          ref={supplierFileInputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) importItems(file, "suppliers").catch(() => undefined);
            event.currentTarget.value = "";
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

export function MetalImpurityDocumentClient({
  documentId,
  title,
  organizationName,
  status,
  config: initialConfig,
  users,
  useV2 = false,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [documentTitle, setDocumentTitle] = useState(title || METAL_IMPURITY_DOCUMENT_TITLE);
  const [config, setConfig] = useState(() => normalizeMetalImpurityConfig(initialConfig));
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [rowDialogOpen, setRowDialogOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<MetalImpurityRow | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [listsOpen, setListsOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);

  useEffect(() => {
    setConfig(normalizeMetalImpurityConfig(initialConfig));
  }, [initialConfig]);

  useEffect(() => {
    setDocumentTitle(title || METAL_IMPURITY_DOCUMENT_TITLE);
  }, [title]);

  const allSelected = config.rows.length > 0 && selectedRowIds.length === config.rows.length;
  const { mobileView, switchMobileView } = useMobileView("metal_impurity");

  const supplierNameById = useMemo(
    () => new Map(config.suppliers.map((s) => [s.id, s.name])),
    [config.suppliers]
  );
  const materialNameById = useMemo(
    () => new Map(config.materials.map((m) => [m.id, m.name])),
    [config.materials]
  );

  const cardItems: RecordCardItem[] = config.rows.map((row, index) => ({
    id: row.id,
    title: `№${index + 1} · ${formatRuDate(row.date) || "—"}`,
    subtitle: supplierNameById.get(row.supplierId) || undefined,
    leading: status === "active" ? (
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
    fields: [
      { label: "Наименование сырья", value: materialNameById.get(row.materialId) || "", hideIfEmpty: true },
      { label: "Количество сырья, кг", value: row.consumedQuantityKg, hideIfEmpty: true },
      { label: "Количество примеси, г", value: row.impurityQuantityG, hideIfEmpty: true },
      { label: "Характеристика примеси", value: row.impurityCharacteristic, hideIfEmpty: true },
      // Главная цифра журнала (норма — не более 3 мг/кг) была только в
      // таблице и в печати: с телефона превышение было не увидеть.
      {
        label: "Количество в мг на 1 кг",
        value: getMetalImpurityValuePerKg(row.impurityQuantityG, row.consumedQuantityKg),
        hideIfEmpty: true,
        hint:
          Number(getMetalImpurityValuePerKg(row.impurityQuantityG, row.consumedQuantityKg)) > 3
            ? "Превышение: норма — не более 3 мг/кг"
            : undefined,
      },
      { label: "Ответственный", value: row.responsibleName, hideIfEmpty: true },
    ],
    onClick: status === "active"
      ? () => {
          setEditingRow(row);
          setRowDialogOpen(true);
        }
      : undefined,
    actions: status === "active" ? (
      <button
        type="button"
        onClick={() => {
          setEditingRow(row);
          setRowDialogOpen(true);
        }}
        className="inline-flex h-10 items-center justify-center rounded-2xl bg-[#5563ff] px-4 text-[14px] font-medium text-white hover:bg-[#4452ee]"
      >
        Редактировать
      </button>
    ) : null,
  }));
  const employeeOptions = useMemo(
    () =>
      getMetalImpurityEmployeeOptions(
        users,
        config.responsiblePosition,
        editingRow?.responsibleEmployeeId || config.responsibleEmployeeId || null,
        config.rows.map((row) => row.responsibleEmployeeId)
      ),
    [config.responsibleEmployeeId, config.responsiblePosition, config.rows, editingRow?.responsibleEmployeeId, users]
  );

  async function persist(
    nextTitle: string,
    nextConfig: MetalImpurityDocumentConfig,
    patch?: Record<string, unknown>
  ) {
    const response = await fetch(`/api/journal-documents/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: nextTitle,
        dateFrom: nextConfig.startDate,
        dateTo: nextConfig.endDate || nextConfig.startDate,
        responsibleTitle: nextConfig.responsiblePosition,
        responsibleUserId: nextConfig.responsibleEmployeeId || null,
        config: nextConfig,
        ...patch,
      }),
    });

    const result = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(result?.error || "Не удалось сохранить журнал");
    }

    setDocumentTitle(nextTitle);
    setConfig(nextConfig);
    startTransition(() => router.refresh());
  }

  /** Правка выделенных строк по очереди — тем же окном. */
  const seq = useSequentialEdit({
    open: (id) => {
      const row = config.rows.find((item) => item.id === id);
      if (!row || status !== "active") return false;
      setEditingRow(row);
      setRowDialogOpen(true);
      return true;
    },
    close: () => {
      setRowDialogOpen(false);
      setEditingRow(null);
    },
  });

  async function saveRow(
    row: MetalImpurityRow,
    additions?: { materialName?: string; supplierName?: string }
  ) {
    let nextConfig = { ...config };
    const normalizedRow = { ...row };

    if (additions?.materialName) {
      const item = { id: `material-${Date.now()}`, name: additions.materialName };
      nextConfig = { ...nextConfig, materials: [...nextConfig.materials, item] };
      normalizedRow.materialId = item.id;
    } else if (normalizedRow.materialId.startsWith("new-material:")) {
      const name = normalizedRow.materialId.slice("new-material:".length);
      const item = { id: `material-${Date.now()}`, name };
      nextConfig = { ...nextConfig, materials: [...nextConfig.materials, item] };
      normalizedRow.materialId = item.id;
    }

    if (additions?.supplierName) {
      const item = { id: `supplier-${Date.now()}`, name: additions.supplierName };
      nextConfig = { ...nextConfig, suppliers: [...nextConfig.suppliers, item] };
      normalizedRow.supplierId = item.id;
    } else if (normalizedRow.supplierId.startsWith("new-supplier:")) {
      const name = normalizedRow.supplierId.slice("new-supplier:".length);
      const item = { id: `supplier-${Date.now()}`, name };
      nextConfig = { ...nextConfig, suppliers: [...nextConfig.suppliers, item] };
      normalizedRow.supplierId = item.id;
    }

    const nextRows = editingRow
      ? nextConfig.rows.map((item) => (item.id === editingRow.id ? normalizedRow : item))
      : [...nextConfig.rows, normalizedRow];
    await persist(documentTitle, { ...nextConfig, rows: nextRows });
    if (editingRow) {
      // Очередь правок откроет следующую строку или закроет окно.
      seq.saved();
      return;
    }
    setEditingRow(null);
    setRowDialogOpen(false);
  }

  async function deleteSelectedRows() {
    if (selectedRowIds.length === 0) return;
    const count = selectedRowIds.length;
    const confirmed = await confirmAsync({
      title: "Удалить выбранные строки?",
      description: "Записи контроля металлопримесей исчезнут из журнала.",
      variant: "danger",
      confirmLabel: "Удалить",
      bullets: [
        { label: `Строк будет удалено: ${count}`, tone: "warn" },
        { label: `Останется строк: ${config.rows.length - count}`, tone: "default" },
      ],
    });
    if (!confirmed) return;
    await persist(documentTitle, {
      ...config,
      rows: config.rows.filter((row) => !selectedRowIds.includes(row.id)),
    });
    setSelectedRowIds([]);
    toast.success(`Удалено строк: ${count}`);
  }

  async function finishJournal() {
    const today = localDayKey();
    await persist(
      documentTitle,
      { ...config, endDate: today },
      { status: "closed", dateTo: today }
    );
    router.push(`/journals/${METAL_IMPURITY_TEMPLATE_CODE}?tab=closed`);
  }

  const rows = useMemo(
    () =>
      config.rows.map((row) => ({
        ...row,
        materialName: getMetalImpurityOptionName(config.materials, row.materialId),
        supplierName: getMetalImpurityOptionName(config.suppliers, row.supplierId),
        valuePerKg: getMetalImpurityValuePerKg(
          row.impurityQuantityG,
          row.consumedQuantityKg
        ),
      })),
    [config.materials, config.rows, config.suppliers]
  );

  return (
    <>
      <div className="space-y-8 bg-white text-black">
        {selectedRowIds.length > 0 && status === "active" && (
          <JournalSelectionBar
            count={selectedRowIds.length}
            onClear={() => setSelectedRowIds([])}
            onDelete={() =>
              deleteSelectedRows().catch((error) =>
                toast.error(error instanceof Error ? error.message : "Ошибка удаления")
              )
            }
            deleting={isPending}
            hint="Записи контроля металлопримесей будут удалены без возможности отмены"
          >
            <SelectionEditButton count={selectedRowIds.length} onClick={() => seq.start(selectedRowIds)} />
          </JournalSelectionBar>
        )}

        <FocusTodayScroller selector="[data-focus-today]" emptyTitle="Записей пока нет" emptyBody="Нажмите «Добавить» в таблице ниже, чтобы создать запись." />

        <JournalDocumentShell
          title={documentTitle}
          documentId={documentId}
          backHref={`/journals/${METAL_IMPURITY_TEMPLATE_CODE}`}
          onSettings={status === "active" ? () => setSettingsOpen(true) : undefined}
          closed={status !== "active"}
          closedHint="Откройте журнал заново, чтобы добавлять и редактировать строки."
          menuItems={
            status === "active"
              ? [
                  {
                    key: "edit-lists",
                    label: "Редактировать списки",
                    icon: <Pencil className="size-4" />,
                    onSelect: () => setListsOpen(true),
                  },
                  {
                    key: "close-journal",
                    label: "Закончить журнал",
                    icon: <Archive className="size-4" />,
                    onSelect: () => setFinishOpen(true),
                  },
                ]
              : []
          }
          mobileView={mobileView}
          onMobileView={switchMobileView}
          cards={<RecordCardsView items={cardItems} emptyLabel="Записей пока нет." />}
          paperHeader={
            <JournalDocumentHeader
              orgName={organizationName}
              title="ЖУРНАЛ УЧЕТА МЕТАЛЛОПРИМЕСЕЙ В СЫРЬЕ"
              startedAt={config.startDate}
              finishedAt={config.endDate || null}
            />
          }
          sheetTitle="Журнал учета металлопримесей в сырье"
          sheetMinWidth={1540}
          toolbar={
            status === "active" ? (
              <Button
                type="button"
                onClick={() => {
                  setEditingRow(null);
                  setRowDialogOpen(true);
                }}
                className={DOC_PRIMARY_BUTTON_CLASS}
              >
                <Plus className="size-5" />
                Добавить
              </Button>
            ) : null
          }
        >
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className={`w-[42px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight print:hidden`}>
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={(checked) =>
                      setSelectedRowIds(checked === true ? config.rows.map((row) => row.id) : [])
                    }
                    disabled={status !== "active" || config.rows.length === 0}
                  />
                </th>
                <th className={`w-[130px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>
                  Дата
                </th>
                <th className={`w-[220px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>
                  Поставщик
                </th>
                <th className={`w-[220px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>
                  Наименование сырья
                </th>
                <th className={`w-[180px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>
                  Количество израсходованного сырья, кг
                </th>
                <th className={`w-[180px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>
                  Количество металломагнитной примеси, г
                </th>
                <th className={`w-[260px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>
                  Характеристика металломагнитной примеси
                </th>
                <th className={`w-[170px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>
                  Количество в мг на 1 кг муки (N - не более 3 мг)
                </th>
                <th className={`w-[220px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>
                  ФИО ответственного
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className={status === "active" ? "cursor-pointer hover:bg-[#f5f6ff]" : undefined}
                  onClick={() => {
                    if (status !== "active") return;
                    setEditingRow(row);
                    setRowDialogOpen(true);
                  }}
                >
                  <td
                    className={`${GRID_CELL_CLASS} px-2 py-1 text-center align-top leading-tight print:hidden`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Checkbox
                      checked={selectedRowIds.includes(row.id)}
                      onCheckedChange={(checked) =>
                        setSelectedRowIds((current) =>
                          checked === true
                            ? [...new Set([...current, row.id])]
                            : current.filter((id) => id !== row.id)
                        )
                      }
                      disabled={status !== "active"}
                    />
                  </td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 align-top leading-tight`}>
                    <button
                      type="button"
                      disabled={status !== "active"}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (status !== "active") return;
                        setEditingRow(row);
                        setRowDialogOpen(true);
                      }}
                      className="w-full text-left disabled:cursor-default"
                    >
                      {formatRuDate(row.date)}
                    </button>
                  </td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 align-top leading-tight`}>{row.supplierName}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 align-top leading-tight`}>{row.materialName}</td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 align-top leading-tight`}>
                    {row.consumedQuantityKg || "—"}
                  </td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 align-top leading-tight`}>
                    {row.impurityQuantityG || "—"}
                  </td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 align-top leading-tight whitespace-pre-wrap`}>
                    {row.impurityCharacteristic || "—"}
                  </td>
                  {/* Норма — не более 3 мг/кг: превышение подсвечиваем,
                      как отклонения в других журналах. */}
                  <td
                    className={`${GRID_CELL_CLASS} px-2 py-1 align-top leading-tight${
                      Number(row.valuePerKg) > 3 ? " bg-[#fff2f1] font-semibold text-[#d43a2f]" : ""
                    }`}
                  >
                    {row.valuePerKg || "—"}
                  </td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 align-top leading-tight`}>
                    {row.responsibleName || "—"}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
                    className={`${GRID_CELL_CLASS} px-2 py-6 text-center text-[#6d7287]`}
                  >
                    Записей пока нет
                  </td>
                </tr>
              )}
              {status === "active" ? (
                <JournalAddRow
                  // Галочка — leading, подпись растянута на «Дата» +
                  // «Поставщик», остальные 6 колонок расчёта остаются
                  // пустыми ячейками.
                  leading={1}
                  labelSpan={2}
                  trailing={6}
                  label="Добавить"
                  onClick={() => {
                    setEditingRow(null);
                    setRowDialogOpen(true);
                  }}
                />
              ) : null}
            </tbody>
          </table>
        </JournalDocumentShell>
      </div>

      <RowDialog
        open={rowDialogOpen}
        onOpenChange={(open) => {
          if (open) {
            setRowDialogOpen(true);
            return;
          }
          // Закрытие без сохранения прерывает очередь («Изменено k из N»).
          seq.cancelled();
        }}
        row={editingRow}
        titleSuffix={seq.progress ?? undefined}
        materials={config.materials}
        suppliers={config.suppliers}
        users={users}
        responsiblePosition={config.responsiblePosition}
        responsibleEmployeeId={config.responsibleEmployeeId}
        responsibleEmployee={config.responsibleEmployee}
        onSave={saveRow}
      />

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        title={documentTitle}
        config={config}
        users={users}
        employeeOptions={employeeOptions}
        onSave={async ({ title: nextTitle, config: nextConfig }) => {
          await persist(nextTitle.trim() || METAL_IMPURITY_DOCUMENT_TITLE, nextConfig);
        }}
        useV2={useV2}
      />

      <ListsDialog
        open={listsOpen}
        onOpenChange={setListsOpen}
        config={config}
        onSave={async (nextConfig) => {
          await persist(documentTitle, nextConfig);
        }}
      />

      <Dialog open={finishOpen} onOpenChange={setFinishOpen}>
        <DialogContent className="max-w-[calc(100vw-1rem)] rounded-[32px] border-0 p-0 sm:max-w-[680px]">
          <DialogHeader className="border-b px-5 py-6 sm:px-10 sm:py-8">
            <DialogTitle className="pr-10 text-[22px] font-medium text-black">
              {`Закончить журнал "${documentTitle}"`}
            </DialogTitle>
          </DialogHeader>
          <div className="flex justify-end px-5 py-6 sm:px-10 sm:py-8">
            <Button
              type="button"
              onClick={() =>
                finishJournal().catch((error) =>
                  toast.error(error instanceof Error ? error.message : "Ошибка закрытия")
                )
              }
              className="h-10 rounded-xl bg-[#5566f6] px-8 text-[16px] text-white hover:bg-[#4b57ff]"
            >
              Закончить
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
