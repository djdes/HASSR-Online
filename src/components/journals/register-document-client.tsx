"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useGenericRegisterCopy } from "./use-generic-register-copy";
import { presentRegisterField, registerCell, registerDate, registerName, registerTitle } from "./generic-register-presentation";
import { Archive, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { confirmAsync } from "@/components/ui/confirm-async";
import { DOC_PRIMARY_BUTTON_CLASS } from "@/components/journals/journal-responsive";
import { JournalSelectionBar } from "@/components/journals/journal-selection-bar";
import { SelectionEditButton } from "@/components/journals/selection-edit-button";
import { useSequentialEdit } from "@/components/journals/use-sequential-edit";
import { JournalDocumentShell } from "@/components/journals/journal-document-shell";
import { JournalDocumentHeader } from "@/components/journals/journal-document-header";
import { JournalAddRow } from "@/components/journals/journal-add-row";
import { GRID_CELL_CLASS, GRID_HEAD_CELL_CLASS } from "@/components/journals/journal-grid";
import { JournalSettingsModal } from "@/components/journals/v2/journal-settings-modal";
import { FocusTodayScroller } from "@/components/journals/focus-today-scroller";
import { confirmDateInPeriod } from "@/components/journals/confirm-date-in-period";
import {
  RecordCardsView,
  type RecordCardItem,
} from "@/components/journals/record-cards-view";
import {
  createRegisterDocumentRow,
  getRegisterDocumentTitle,
  normalizeRegisterDocumentConfig,
  type RegisterDocumentConfig,
  type RegisterDocumentRow,
  type RegisterField,
} from "@/lib/register-document";
import {
  getRegisterJournal,
  type RegisterJournalField,
} from "@/lib/register-journals";
import { useMobileView } from "@/lib/use-mobile-view";
import { localDayKey } from "@/lib/entry-defaults";
import { resolveJournalPeriodForDate } from "@/lib/journal-period";

/**
 * Экран табличного журнала-реестра без собственной вёрстки: суточные
 * пробы, витаминизация, рацион, перевозка, бой посуды, вода в бассейне.
 *
 * Колонки, форма строки и карточки на телефоне строятся из описания
 * журнала (`register-journals.ts`) — того же, из которого засеяны поля
 * шаблона и по которому печатается PDF (`drawRegisterPdf`). Поведение —
 * как у журнала жалоб: строки в `config.rows`, правка в окне, выделение
 * с удалением и правкой по очереди, «Закончить журнал».
 */

type EmployeeItem = { id: string; name: string; role: string };

type Props = {
  documentId: string;
  templateCode: string;
  title: string;
  organizationName: string;
  dateFrom: string;
  dateTo?: string;
  status: string;
  initialConfig: RegisterDocumentConfig;
  users: EmployeeItem[];
  useV2?: boolean;
};

const FIELD_INPUT_CLASS =
  "h-11 rounded-2xl border-[#dcdfed] px-4 text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] focus-visible:border-[#5566f6] focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";
const FIELD_LABEL_CLASS = "text-[13px] font-medium text-[#6f7282]";

function toRegisterFields(fields: RegisterJournalField[]): RegisterField[] {
  return fields.map((field) => ({
    key: field.key,
    label: field.label,
    type: field.type,
    required: field.required,
    options: field.options ?? [],
    showIf: null,
  }));
}

function currentTimeKey() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function RowDialog({
  open,
  onOpenChange,
  row,
  fields,
  templateCode,
  hint,
  titleSuffix,
  period,
  users,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: RegisterDocumentRow | null;
  fields: RegisterJournalField[];
  templateCode: string;
  hint: string;
  titleSuffix?: string;
  period: { dateFrom: string; dateTo: string };
  users: EmployeeItem[];
  onSave: (row: RegisterDocumentRow) => Promise<void>;
}) {
  const { t, locale, messages, latest } = useGenericRegisterCopy();
  const periodT = useTranslations("journalControls.dateInPeriod");
  const registerFields = useMemo(() => toRegisterFields(fields), [fields]);
  const buildEmpty = useMemo(
    () => () => {
      const values: Record<string, string> = {};
      for (const field of fields) {
        if (field.type === "date" && field.key === "date") values[field.key] = localDayKey();
        if (field.type === "time" && (field.key === "time" || field.key === "takenAt")) {
          values[field.key] = currentTimeKey();
        }
      }
      return createRegisterDocumentRow(registerFields, { values });
    },
    [fields, registerFields]
  );
  const [draft, setDraft] = useState<RegisterDocumentRow>(() => buildEmpty());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(row || buildEmpty());
  }, [open, row, buildEmpty]);

  function setValue(key: string, value: string) {
    setDraft((current) => ({ ...current, values: { ...current.values, [key]: value } }));
  }

  const missing = fields.filter(
    (field) => field.required && !(draft.values[field.key] || "").trim()
  );

  async function handleSave() {
    if (missing.length > 0) {
      toast.error(t("row.required", { fields: missing.map(field => presentRegisterField(templateCode, field, messages).displayLabel).join(", ") }));
      return;
    }
    const dateField = fields.find((field) => field.type === "date");
    if (dateField && !(await confirmDateInPeriod(draft.values[dateField.key] || "", period, { locale, t: periodT }))) {
      return;
    }
    setSubmitting(true);
    try {
      await onSave(draft);
    } catch {
      toast.error(latest.current.t("row.saveFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  const responsibleListId = `register-responsible-${draft.id}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="max-h-[90vh] max-w-[calc(100vw-1rem)] overflow-hidden rounded-3xl border-0 p-0 sm:max-w-[640px]">
        <DialogClose className="absolute right-4 top-4 rounded-full p-2" aria-label={t("actions.close")}><X className="size-5" /></DialogClose>
        <DialogHeader className="shrink-0 border-b border-[#ececf4] px-6 py-5 sm:px-8">
          <DialogTitle className="text-[20px] font-semibold tracking-[-0.02em] text-[#0b1024]">
            {row ? titleSuffix ? t("row.editProgressTitle", { progress: titleSuffix }) : t("row.editTitle") : t("row.newTitle")}
          </DialogTitle>
          <p className="text-[13px] leading-[1.5] text-[#6f7282]">{hint}</p>
        </DialogHeader>
        <div className="max-h-[calc(90vh-170px)] space-y-4 overflow-y-auto px-6 py-5 sm:px-8">
          {fields.map((field) => {
            const id = `register-field-${field.key}`;
            const value = draft.values[field.key] || "";
            const display = presentRegisterField(templateCode, field, messages);
            return (
              <div key={field.key} className="space-y-1.5">
                <Label htmlFor={id} className={FIELD_LABEL_CLASS}>
                  {display.displayLabel}
                  {field.required ? <span className="text-[#a13a32]"> *</span> : null}
                </Label>
                {field.type === "select" ? (
                  <Select value={value} onValueChange={(next) => setValue(field.key, next)}>
                    <SelectTrigger id={id} className={`w-full ${FIELD_INPUT_CLASS}`}>
                      <SelectValue placeholder={t("row.selectPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {value && !(field.options ?? []).some(option => option.value === value) ? <SelectItem value={value}>{value}</SelectItem> : null}
                      {(display.displayOptions ?? []).map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : field.type === "textarea" ? (
                  <Textarea
                    id={id}
                    value={value}
                    placeholder={display.displayPlaceholder}
                    onChange={(event) => setValue(field.key, event.target.value)}
                    className="min-h-[96px] rounded-2xl border-[#dcdfed] px-4 py-3 text-[15px] focus-visible:border-[#5566f6] focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                  />
                ) : (
                  <Input
                    id={id}
                    type={field.type === "number" ? "number" : field.type === "date" ? "date" : field.type === "time" ? "time" : "text"}
                    inputMode={field.type === "number" ? "decimal" : undefined}
                    step={field.type === "number" ? field.step ?? "any" : undefined}
                    value={value}
                    placeholder={display.displayPlaceholder}
                    list={field.key === "responsible" ? responsibleListId : undefined}
                    onChange={(event) => setValue(field.key, event.target.value)}
                    className={FIELD_INPUT_CLASS}
                  />
                )}
              </div>
            );
          })}
          <datalist id={responsibleListId}>
            {users.map((user) => (
              <option key={user.id} value={user.name} />
            ))}
          </datalist>
        </div>
        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-[#ececf4] px-6 py-4 sm:flex-row sm:justify-end sm:px-8">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-11 rounded-2xl border-[#dcdfed] px-5 text-[15px] text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
          >
            {t("actions.cancel")}
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={submitting}
            className="h-11 rounded-2xl bg-[#5566f6] px-5 text-[15px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0]"
          >
            {submitting ? t("actions.saving") : row ? t("actions.save") : t("actions.addRow")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function RegisterDocumentClient({
  documentId,
  templateCode,
  title,
  organizationName,
  dateFrom,
  dateTo,
  status,
  initialConfig,
  users,
  useV2 = false,
}: Props) {
  const { t, locale, messages, latest } = useGenericRegisterCopy();
  const journal = getRegisterJournal(templateCode);
  const fields = useMemo(() => journal?.fields ?? [], [journal]);
  const registerFields = useMemo(() => toRegisterFields(fields), [fields]);
  const defaultTitle = getRegisterDocumentTitle(templateCode);
  const documentPeriod = useMemo(
    () => (dateTo ? { dateFrom, dateTo } : resolveJournalPeriodForDate(templateCode, dateFrom)),
    [dateFrom, dateTo, templateCode]
  );
  const displayTitle = (value: string, from = dateFrom) => registerTitle(value, templateCode, from, documentPeriod.dateTo, locale, messages, t);
  const displayDefaultTitle = registerName(templateCode, defaultTitle, messages);
  const hint = messages.genericRegister.journals[templateCode]?.hint ?? journal?.hint ?? "";
  const router = useRouter();
  const [config, setConfig] = useState(() =>
    normalizeRegisterDocumentConfig(initialConfig, registerFields)
  );
  const [documentTitle, setDocumentTitle] = useState(title || defaultTitle);
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [rowDialogOpen, setRowDialogOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<RegisterDocumentRow | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTitle, setSettingsTitle] = useState(documentTitle);
  const [settingsDate, setSettingsDate] = useState(dateFrom);
  const [savingSettings, setSavingSettings] = useState(false);
  const [isPending, startTransition] = useTransition();
  const { mobileView, switchMobileView } = useMobileView(templateCode);
  const active = status === "active";

  useEffect(() => {
    setConfig(normalizeRegisterDocumentConfig(initialConfig, registerFields));
  }, [initialConfig, registerFields]);

  useEffect(() => {
    setDocumentTitle(title || defaultTitle);
  }, [title, defaultTitle]);

  const titleField = fields.find((field) => field.key === journal?.titleKey) ?? fields[0];
  const dateField = journal?.dateKey
    ? fields.find((field) => field.key === journal.dateKey) ?? null
    : null;
  const allSelected = config.rows.length > 0 && selectedRowIds.length === config.rows.length;

  function toggleRow(rowId: string, checked: boolean) {
    setSelectedRowIds((current) =>
      checked ? [...new Set([...current, rowId])] : current.filter((id) => id !== rowId)
    );
  }

  function openRow(row: RegisterDocumentRow | null) {
    if (!active) return;
    setEditingRow(row);
    setRowDialogOpen(true);
  }

  async function persist(
    nextTitle: string,
    nextConfig: RegisterDocumentConfig,
    patch?: Record<string, unknown>
  ) {
    const response = await fetch(`/api/journal-documents/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: nextTitle, config: nextConfig, ...patch }),
    });
    await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error("register_write_failed");
    }
    setDocumentTitle(nextTitle);
    setConfig(nextConfig);
    startTransition(() => router.refresh());
  }

  const seq = useSequentialEdit({
    open: (id) => {
      const row = config.rows.find((item) => item.id === id);
      if (!row || !active) return false;
      setEditingRow(row);
      setRowDialogOpen(true);
      return true;
    },
    close: () => {
      setRowDialogOpen(false);
      setEditingRow(null);
    },
  });

  async function handleSaveRow(row: RegisterDocumentRow) {
    const nextRows = editingRow
      ? config.rows.map((item) => (item.id === editingRow.id ? row : item))
      : [...config.rows, row];
    await persist(documentTitle, { ...config, rows: nextRows });
    if (editingRow) {
      seq.saved();
      return;
    }
    toast.success(latest.current.t("row.added"));
    setEditingRow(null);
    setRowDialogOpen(false);
  }

  async function handleDeleteSelected() {
    if (selectedRowIds.length === 0) return;
    const count = selectedRowIds.length;
    const confirmed = await confirmAsync({
      locale,
      title: t("selection.deleteTitle"),
      description: t("selection.deleteDescription"),
      variant: "danger",
      confirmLabel: t("actions.delete"),
      bullets: [
        { label: t("selection.deleteCount", { count }), tone: "warn" },
        { label: t("selection.remainingCount", { count: config.rows.length - count }), tone: "default" },
      ],
    });
    if (!confirmed) return;
    await persist(documentTitle, {
      ...config,
      rows: config.rows.filter((row) => !selectedRowIds.includes(row.id)),
    });
    setSelectedRowIds([]);
    toast.success(latest.current.t("selection.deleted", { count }));
  }

  async function handleSaveSettings() {
    setSavingSettings(true);
    try {
      await persist(
        settingsTitle.trim() || defaultTitle,
        config,
        resolveJournalPeriodForDate(templateCode, settingsDate || dateFrom)
      );
      setSettingsOpen(false);
      toast.success(latest.current.t("settings.saved"));
    } catch {
      toast.error(latest.current.t("settings.saveFailed"));
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleFinish() {
    const confirmed = await confirmAsync({
      locale,
      title: t("finish.title", { title: displayTitle(documentTitle) }),
      description: t("finish.description"),
      variant: "warn",
      confirmLabel: t("actions.finish"),
      bullets: [
        { label: t("finish.count", { count: config.rows.length }), tone: "default" },
        { label: t("finish.warning"), tone: "warn" },
      ],
    });
    if (!confirmed) return;
    try {
      await persist(documentTitle, { ...config, finishedAt: localDayKey() }, { status: "closed" });
      router.push(`/journals/${templateCode}?tab=closed`);
    } catch {
      toast.error(latest.current.t("finish.failed"));
    }
  }

  const cardItems: RecordCardItem[] = config.rows.map((row, index) => ({
    id: row.id,
    title: t("row.cardTitle", { number: index + 1, title: (titleField && row.values[titleField.key]) || "—" }),
    subtitle: dateField ? registerDate(row.values[dateField.key] || "", locale) || undefined : undefined,
    leading: (
      <Checkbox
        aria-label={t("row.selectOne", { number: index + 1 })}
        checked={selectedRowIds.includes(row.id)}
        onCheckedChange={(checked) => toggleRow(row.id, checked === true)}
        disabled={!active}
        className="size-5"
      />
    ),
    fields: fields
      .filter((field) => field !== titleField && field !== dateField)
      .map((field) => ({
        label: presentRegisterField(templateCode, field, messages).displayLabel,
        value: registerCell(templateCode, field, row.values[field.key] || "", locale, messages),
        hideIfEmpty: true,
      })),
    onClick: active ? () => openRow(row) : undefined,
    actions: active ? (
      <button
        type="button"
        onClick={() => openRow(row)}
        className="inline-flex h-10 items-center justify-center rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white transition-colors hover:bg-[#4a5bf0]"
      >
        {t("actions.edit")}
      </button>
    ) : null,
  }));

  // Ширина листа: колонка «№» + галочка + по ~150 px на поле.
  const sheetMinWidth = Math.max(960, 140 + fields.length * 150);
  const labelSpan = Math.min(2, fields.length);

  // Описания нет только при рассинхроне кода шаблона и register-journals.ts.
  if (!journal) return null;

  return (
    <>
      <div className="space-y-6 text-black">
        <FocusTodayScroller
          selector="[data-focus-today]"
          emptyTitle={t("empty.title")}
          emptyBody={t("empty.guidance")}
        />
        {selectedRowIds.length > 0 && active ? (
          <JournalSelectionBar
            count={selectedRowIds.length}
            onClear={() => setSelectedRowIds([])}
            onDelete={() =>
              handleDeleteSelected().catch(() =>
                toast.error(latest.current.t("selection.deleteFailed"))
              )
            }
            deleting={isPending}
            hint={t("selection.hint")}
          >
            <SelectionEditButton count={selectedRowIds.length} onClick={() => seq.start(selectedRowIds)} />
          </JournalSelectionBar>
        ) : null}

        <JournalDocumentShell
          title={displayTitle(documentTitle)}
          subtitle={t("document.started", { date: registerDate(dateFrom, locale) })}
          documentId={documentId}
          backHref={`/journals/${templateCode}`}
          onSettings={() => {
            setSettingsTitle(documentTitle);
            setSettingsDate(dateFrom);
            setSettingsOpen(true);
          }}
          closed={!active}
          closedHint={t("document.closedHint")}
          menuItems={
            active
              ? [
                  {
                    key: "close-journal",
                    label: t("actions.finishJournal"),
                    icon: <Archive className="size-4" />,
                    onSelect: () => void handleFinish(),
                  },
                ]
              : []
          }
          mobileView={mobileView}
          onMobileView={switchMobileView}
          cards={<RecordCardsView items={cardItems} emptyLabel={t("empty.cards")} />}
          paperHeader={
            <JournalDocumentHeader
              orgName={organizationName}
              title={displayDefaultTitle}
              startedAt={dateFrom}
              finishedAt={active ? null : config.finishedAt ?? null}
            />
          }
          sheetTitle={displayDefaultTitle}
          sheetMinWidth={sheetMinWidth}
          toolbar={
            active ? (
              <Button type="button" onClick={() => openRow(null)} className={DOC_PRIMARY_BUTTON_CLASS}>
                <Plus className="size-5" />
                {t("actions.add")}
              </Button>
            ) : undefined
          }
        >
          <p className="mb-3 text-[13px] leading-[1.5] text-[#6f7282] print:hidden">{hint}</p>
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className={`w-[42px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight print:hidden`}>
                  <Checkbox
                    aria-label={t("row.selectAll")}
                    checked={allSelected}
                    onCheckedChange={(checked) =>
                      setSelectedRowIds(checked === true ? config.rows.map((row) => row.id) : [])
                    }
                    disabled={!active || config.rows.length === 0}
                  />
                </th>
                <th className={`w-[56px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>{t("row.numberColumn")}</th>
                {fields.map((field) => (
                  <th
                    key={field.key}
                    className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}
                  >
                    {presentRegisterField(templateCode, field, messages).displayLabel}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {config.rows.map((row, index) => (
                <tr
                  key={row.id}
                  className={active ? "cursor-pointer transition-colors hover:bg-[#f5f6ff]" : undefined}
                  onClick={() => openRow(row)}
                >
                  <td
                    className={`${GRID_CELL_CLASS} px-2 py-1 text-center align-top leading-tight print:hidden`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Checkbox
                      aria-label={t("row.selectOne", { number: index + 1 })}
                      checked={selectedRowIds.includes(row.id)}
                      onCheckedChange={(checked) => toggleRow(row.id, checked === true)}
                      disabled={!active}
                    />
                  </td>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center align-top leading-tight tabular-nums`}>
                    {index + 1}
                  </td>
                  {fields.map((field) => (
                    <td
                      key={field.key}
                      className={`${GRID_CELL_CLASS} whitespace-pre-wrap px-2 py-1 align-top leading-tight ${field.type === "number" ? "text-center tabular-nums" : ""}`}
                    >
                      {registerCell(templateCode, field, row.values[field.key] || "", locale, messages) || "—"}
                    </td>
                  ))}
                </tr>
              ))}
              {config.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={fields.length + 2}
                    className={`${GRID_CELL_CLASS} px-4 py-10 text-center text-[15px] text-[#6f7282]`}
                  >
                    {t("empty.title")}
                  </td>
                </tr>
              ) : null}
              {active ? (
                <JournalAddRow
                  leading={2}
                  labelSpan={labelSpan}
                  trailing={Math.max(0, fields.length - labelSpan)}
                  label={t("actions.add")}
                  onClick={() => openRow(null)}
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
          seq.cancelled();
        }}
        row={editingRow}
        fields={fields}
        templateCode={templateCode}
        hint={hint}
        titleSuffix={seq.progress ?? undefined}
        period={documentPeriod}
        users={users}
        onSave={handleSaveRow}
      />

      {useV2 ? (
        <JournalSettingsModal
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          title={t("settings.title")}
          description={t("settings.description")}
          size="md"
          isSaving={savingSettings}
          onSave={handleSaveSettings}
          onCancel={() => setSettingsOpen(false)}
        >
          <SettingsFields
            title={displayTitle(settingsTitle, settingsDate)}
            date={settingsDate}
            onTitle={setSettingsTitle}
            onDate={setSettingsDate}
          />
        </JournalSettingsModal>
      ) : (
        <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DialogContent showCloseButton={false} className="max-w-[calc(100vw-1rem)] rounded-3xl border-0 p-0 sm:max-w-[560px]">
            <DialogClose className="absolute right-4 top-4 rounded-full p-2" aria-label={t("actions.close")}><X className="size-5" /></DialogClose>
            <DialogHeader className="border-b border-[#ececf4] px-6 py-5 sm:px-8">
              <DialogTitle className="text-[20px] font-semibold tracking-[-0.02em] text-[#0b1024]">
                {t("settings.title")}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 px-6 py-5 sm:px-8">
              <SettingsFields
                title={displayTitle(settingsTitle, settingsDate)}
                date={settingsDate}
                onTitle={setSettingsTitle}
                onDate={setSettingsDate}
              />
              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={handleSaveSettings}
                  disabled={savingSettings}
                  className="h-11 rounded-2xl bg-[#5566f6] px-5 text-[15px] font-medium text-white transition-colors hover:bg-[#4a5bf0]"
                >
                  {savingSettings ? t("actions.saving") : t("actions.save")}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

function SettingsFields({
  title,
  date,
  onTitle,
  onDate,
}: {
  title: string;
  date: string;
  onTitle: (value: string) => void;
  onDate: (value: string) => void;
}) {
  const { t } = useGenericRegisterCopy();
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="register-settings-title" className={FIELD_LABEL_CLASS}>
          {t("settings.documentTitle")}
        </Label>
        <Input
          id="register-settings-title"
          value={title}
          onChange={(event) => onTitle(event.target.value)}
          className={FIELD_INPUT_CLASS}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="register-settings-date" className={FIELD_LABEL_CLASS}>
          {t("settings.startDate")}
        </Label>
        <Input
          id="register-settings-date"
          type="date"
          value={date}
          onChange={(event) => onDate(event.target.value)}
          className={FIELD_INPUT_CLASS}
        />
      </div>
    </>
  );
}
