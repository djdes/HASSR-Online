"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Loader2, Pencil, Plus, Trash2, TrendingDown } from "lucide-react";
import { toast } from "sonner";
import { JournalSelectionBar } from "@/components/journals/journal-selection-bar";
import { SelectionEditButton } from "@/components/journals/selection-edit-button";
import { useSequentialEdit } from "@/components/journals/use-sequential-edit";
import { DOC_PRIMARY_BUTTON_CLASS } from "@/components/journals/journal-responsive";
import { JournalDocumentShell } from "@/components/journals/journal-document-shell";
import { JournalDocumentHeader } from "@/components/journals/journal-document-header";
import { GRID_CELL_CLASS, GRID_HEAD_CELL_CLASS } from "@/components/journals/journal-grid";
import { JournalAddRow } from "@/components/journals/journal-add-row";
import { JournalSettingsModal } from "@/components/journals/v2/journal-settings-modal";
import { FocusTodayScroller } from "@/components/journals/focus-today-scroller";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getUserDisplayTitle, getUsersForRoleLabel } from "@/lib/user-roles";
import { Textarea } from "@/components/ui/textarea";
import {
  canCreateLossFromWriteoffRow,
  createProductWriteoffCommissionMember,
  createProductWriteoffRow,
  getProductWriteoffDocumentListTitle,
  normalizeProductWriteoffConfig,
  writeoffRowToLossDraft,
  type ProductWriteoffCommissionMember,
  type ProductWriteoffConfig,
  type ProductWriteoffRow,
} from "@/lib/product-writeoff-document";
import { useDocumentCloseAction } from "@/components/journals/document-close-button";
import { PositionNativeOptions } from "@/components/shared/position-select";
import { useMobileView } from "@/lib/use-mobile-view";
import {
  RecordCardsView,
  type RecordCardItem,
} from "@/components/journals/record-cards-view";
import { OrgDirectoryDialog } from "@/components/journals/org-directory-dialog";
import { mergeIntoList } from "@/lib/org-directory";

// Должность из карточки (как в UserLike) — должность члена комиссии.
type UserItem = {
  id: string;
  name: string;
  role: string;
  positionTitle?: string | null;
  jobPosition?: { name: string; categoryKey: string } | null;
};

type Props = {
  documentId: string;
  title: string;
  organizationName: string;
  dateFrom: string;
  status: string;
  initialConfig: ProductWriteoffConfig;
  users: UserItem[];
  /** Design v2 toggle. */
  useV2?: boolean;
};

type RowDialogState = {
  open: boolean;
  index: number | null;
  row: ProductWriteoffRow;
  newProductName: string;
};

type CommissionDialogState = {
  open: boolean;
  index: number | null;
  member: ProductWriteoffCommissionMember;
};

function emptyRow() {
  return createProductWriteoffRow();
}

function emptyCommissionMember() {
  // Без «Управляющий» по умолчанию: должность придёт с выбранным человеком
  // (с ней список сотрудников часто оказывался пустым).
  return createProductWriteoffCommissionMember({ role: "" });
}

function getRoleLabelByUserId(users: UserItem[], userId: string) {
  const user = users.find((item) => item.id === userId);
  // Должность из справочника, а не лейбл роли.
  return user ? getUserDisplayTitle(user) : "";
}

function actDateParts(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { day: "__", month: "", year: "____" };
  return {
    day: String(date.getDate()).padStart(2, "0"),
    month: new Intl.DateTimeFormat("ru-RU", { month: "long" }).format(date),
    year: String(date.getFullYear()),
  };
}

export function ProductWriteoffDocumentClient({
  documentId,
  title,
  organizationName,
  dateFrom,
  status,
  initialConfig,
  users,
  useV2 = false,
}: Props) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isClosed = status === "closed";
  const { mobileView, switchMobileView } = useMobileView("product_writeoff");
  const [config, setConfig] = useState(() => normalizeProductWriteoffConfig(initialConfig));
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  // «Из справочника организации» — общий список продуктов организации.
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [listsOpen, setListsOpen] = useState(false);
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [rowDialog, setRowDialog] = useState<RowDialogState>({
    open: false,
    index: null,
    row: emptyRow(),
    newProductName: "",
  });
  const [rowDialogProductOptions, setRowDialogProductOptions] = useState<string[]>([]);
  const [commissionDialog, setCommissionDialog] = useState<CommissionDialogState>({
    open: false,
    index: null,
    member: emptyCommissionMember(),
  });

  const productOptions = useMemo(
    () => Array.from(new Set(config.productLists.flatMap((list) => list.items).filter(Boolean))),
    [config.productLists]
  );
  const { closeDocument } = useDocumentCloseAction({ documentId, title });

  const actDate = actDateParts(config.documentDate || dateFrom);

  async function persistConfig(nextConfig: ProductWriteoffConfig) {
    setSaving(true);
    try {
      const response = await fetch(`/api/journal-documents/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: nextConfig.documentName || title,
          dateFrom: nextConfig.documentDate || dateFrom,
          dateTo: nextConfig.documentDate || dateFrom,
          config: nextConfig,
        }),
      });

      if (!response.ok) throw new Error();
      setConfig(nextConfig);
      router.refresh();
      return true;
    } catch {
      toast.error("Не удалось сохранить акт");
      return false;
    } finally {
      setSaving(false);
    }
  }

  function updateConfig(patch: Partial<ProductWriteoffConfig>) {
    setConfig((prev) => ({ ...prev, ...patch }));
  }

  async function saveSettings() {
    const ok = await persistConfig(config);
    if (ok) setSettingsOpen(false);
  }

  /** Правка выделенных строк по очереди — тем же окном. */
  const seq = useSequentialEdit({
    open: (id) => {
      // Окно работает по индексу — ищем его по id в актуальном списке.
      const index = config.rows.findIndex((item) => item.id === id);
      if (index === -1 || isClosed) return false;
      setRowDialog({ open: true, index, row: config.rows[index], newProductName: "" });
      setRowDialogProductOptions(productOptions);
      return true;
    },
    close: () => {
      setRowDialog({ open: false, index: null, row: emptyRow(), newProductName: "" });
      setRowDialogProductOptions([]);
    },
  });

  async function saveRow() {
    const nextRow = {
      ...rowDialog.row,
      productName: rowDialog.newProductName.trim() || rowDialog.row.productName,
    };

    if (!nextRow.productName.trim()) {
      toast.error("Укажите наименование ТМЦ");
      return;
    }

    const nextConfig = structuredClone(config) as ProductWriteoffConfig;
    if (rowDialog.index === null) nextConfig.rows.push(nextRow);
    else nextConfig.rows[rowDialog.index] = nextRow;

    if (rowDialog.newProductName.trim() && nextConfig.productLists[0]) {
      nextConfig.productLists[0].items = Array.from(
        new Set([...nextConfig.productLists[0].items, rowDialog.newProductName.trim()])
      );
    }

    const ok = await persistConfig(nextConfig);
    if (ok) {
      if (rowDialog.index !== null) {
        // Очередь правок откроет следующую строку или закроет окно.
        seq.saved();
        return;
      }
      setRowDialog({ open: false, index: null, row: emptyRow(), newProductName: "" });
      setRowDialogProductOptions([]);
    }
  }

  /**
   * Акт списания → учёт потерь. Запись заводим по строке акта и
   * оставляем в ней ссылку: повторно по той же строке потерю не
   * создаём (см. `canCreateLossFromWriteoffRow`).
   */
  async function createLossFromRow(index: number) {
    const row = config.rows[index];
    if (!row || !canCreateLossFromWriteoffRow(row)) return;
    setSaving(true);
    try {
      const draft = writeoffRowToLossDraft(row, config);
      const response = await fetch("/api/losses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, sourceEntryId: documentId }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        toast.error(payload?.error || "Не удалось записать потерю");
        return;
      }
      const record = (await response.json()) as { id: string };
      const nextRow = { ...row, lossRecordId: record.id };
      const nextConfig: ProductWriteoffConfig = {
        ...config,
        rows: config.rows.map((item, i) => (i === index ? nextRow : item)),
      };
      const ok = await persistConfig(nextConfig);
      if (!ok) return;
      setRowDialog((prev) => (prev.open ? { ...prev, row: nextRow } : prev));
      toast.success("Записано в потери", {
        action: { label: "Открыть", onClick: () => router.push("/losses") },
      });
    } finally {
      setSaving(false);
    }
  }

  async function deleteSelectedRows() {
    if (selectedRows.length === 0) return;
    const ok = await persistConfig({
      ...config,
      rows: config.rows.filter((row) => !selectedRows.includes(row.id)),
    });
    if (ok) setSelectedRows([]);
  }

  async function saveCommissionMember() {
    if (!commissionDialog.member.employeeName.trim()) {
      toast.error("Выберите сотрудника");
      return;
    }
    const normalizedMember = {
      ...commissionDialog.member,
      role:
        getRoleLabelByUserId(users, commissionDialog.member.employeeId) ||
        commissionDialog.member.role,
    };
    const nextConfig = structuredClone(config) as ProductWriteoffConfig;
    if (commissionDialog.index === null) nextConfig.commissionMembers.push(normalizedMember);
    else nextConfig.commissionMembers[commissionDialog.index] = normalizedMember;
    const ok = await persistConfig(nextConfig);
    if (ok) setCommissionDialog({ open: false, index: null, member: emptyCommissionMember() });
  }

  async function deleteCommissionMember(index: number) {
    await persistConfig({
      ...config,
      commissionMembers: config.commissionMembers.filter((_, currentIndex) => currentIndex !== index),
    });
  }

  async function importItemsFromFile(file: File) {
    setImporting(true);
    try {
      // См. metal-impurity-document-client: статический импорт xlsx тянул
      // 135 КБ gzip в общий чанк всех редакторов журналов. Внутри try —
      // сбой загрузки чанка попадёт в тот же toast, что и битый файл.
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1 });
      const items = rows.map((row) => String(row[0] ?? "").trim()).filter(Boolean);
      if (items.length === 0) throw new Error();
      await persistConfig({
        ...config,
        productLists: config.productLists.map((list, index) =>
          index === 0 ? { ...list, items: Array.from(new Set([...list.items, ...items])) } : list
        ),
      });
      toast.success(`Импортировано ${items.length} позиций`);
    } catch {
      toast.error("Не удалось импортировать файл");
    } finally {
      setImporting(false);
    }
  }

  const cardItems: RecordCardItem[] = config.rows.map((row, index) => ({
    id: row.id,
    title: `№${index + 1} · ${row.productName || "—"}`,
    subtitle: [row.batchNumber, row.productionDate].filter(Boolean).join(" · ") || undefined,
    leading: !isClosed ? (
      <Checkbox
        checked={selectedRows.includes(row.id)}
        onCheckedChange={(checked) =>
          setSelectedRows((prev) =>
            checked === true
              ? [...new Set([...prev, row.id])]
              : prev.filter((id) => id !== row.id)
          )
        }
        className="size-5"
      />
    ) : null,
    fields: [
      { label: "Количество", value: row.quantity, hideIfEmpty: true },
      { label: "Несоответствие", value: row.discrepancyDescription, hideIfEmpty: true },
      { label: "Действия с ТМЦ", value: row.action, hideIfEmpty: true },
    ],
    onClick: !isClosed
      ? () => {
          setRowDialog({ open: true, index, row, newProductName: "" });
          setRowDialogProductOptions(productOptions);
        }
      : undefined,
    actions: !isClosed ? (
      <button
        type="button"
        onClick={() => {
          setRowDialog({ open: true, index, row, newProductName: "" });
          setRowDialogProductOptions(productOptions);
        }}
        className="inline-flex h-10 items-center justify-center rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white hover:bg-[#4b57ff]"
      >
        Редактировать
      </button>
    ) : null,
  }));

  /** Состав комиссии — один и тот же блок для бланка и для телефона. */
  const commissionBlock = (
    <div>
      Комиссия в составе:
      <div className="ml-5 mt-1 space-y-1">
        {config.commissionMembers.map((member, index) => (
          <div key={member.id} className="flex items-center gap-3">
            <button type="button" className="underline" disabled={isClosed} onClick={() => !isClosed && setCommissionDialog({ open: true, index, member })}>
              {member.role} {member.employeeName}
            </button>
            {!isClosed && <button type="button" className="rounded-full p-1 text-[#5566f6]" onClick={() => setCommissionDialog({ open: true, index, member })}><Pencil className="size-4" /></button>}
          </div>
        ))}
        {!isClosed && <button type="button" className="text-left underline" onClick={() => setCommissionDialog({ open: true, index: null, member: emptyCommissionMember() })}>Добавить</button>}
      </div>
    </div>
  );

  return (
    <div className="space-y-6 text-black">
      <FocusTodayScroller selector="[data-focus-today]" emptyTitle="Записей пока нет" emptyBody="Нажмите «Добавить» в таблице ниже, чтобы создать запись." />
      {selectedRows.length > 0 && !isClosed && (
        <JournalSelectionBar
          count={selectedRows.length}
          onClear={() => setSelectedRows([])}
          onDelete={() => deleteSelectedRows().catch(() => undefined)}
          hint="Строки акта будут удалены без возможности отмены"
        >
          <SelectionEditButton count={selectedRows.length} disabled={isClosed} onClick={() => seq.start(selectedRows)} />
        </JournalSelectionBar>
      )}

      <JournalDocumentShell
        title={title}
        documentId={documentId}
        backHref="/journals/product_writeoff"
        // В режиме «Карточки» бланк (а с ним и состав комиссии) скрыт —
        // на телефоне комиссию было не поправить. Дублируем блок над
        // переключателем ТОЛЬКО для этого режима: на печати и на десктопе
        // он остаётся на своём месте внутри бланка.
        beforeToggle={
          mobileView === "cards" ? (
            <div className="mb-4 rounded-[20px] bg-white px-4 py-4 text-[16px] leading-7 sm:hidden print:hidden">
              {commissionBlock}
            </div>
          ) : undefined
        }
        onSettings={isClosed ? undefined : () => setSettingsOpen(true)}
        closed={isClosed}
        closedHint="Откройте журнал заново, чтобы добавлять и редактировать акт."
        menuItems={
          isClosed
            ? []
            : [
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
                  onSelect: () => void closeDocument(),
                },
              ]
        }
        mobileView={mobileView}
        onMobileView={switchMobileView}
        cards={<RecordCardsView items={cardItems} emptyLabel="Списаний пока не зарегистрировано." />}
        paperHeader={
          <>
            <JournalDocumentHeader
              orgName={organizationName}
              title={config.documentName}
              startedAt={config.documentDate || dateFrom}
              finishedAt={null}
            />
            <div className="space-y-4 pt-4 text-center">
              <div className="text-[30px] font-semibold">АКТ</div>
              <div className="text-[24px] font-semibold">№ {config.actNumber || "1"} от « {actDate.day} » {actDate.month} {actDate.year} г.</div>
            </div>
          </>
        }
        sheetMinWidth={1100}
        extra={
          <div className="mt-6 space-y-2 text-[18px]">
            <div>Подписи членов комиссии:</div>
            {config.commissionMembers.length === 0 && <div>________________</div>}
            {config.commissionMembers.map((member) => (
              <div key={member.id} className="flex items-end gap-3">
                <span>{member.employeeName}</span>
                <span className="min-w-[180px] border-b border-black" />
              </div>
            ))}
          </div>
        }
        toolbar={
          !isClosed ? (
            <Button type="button" className={DOC_PRIMARY_BUTTON_CLASS} onClick={() => { setRowDialog({ open: true, index: null, row: emptyRow(), newProductName: "" }); setRowDialogProductOptions(productOptions); }}>
              <Plus className="size-5" />
              Добавить
            </Button>
          ) : null
        }
      >
        <div className="space-y-5 py-4 text-[18px] leading-8">
          {commissionBlock}

          <p>составила настоящий АКТ о том, что « {actDate.day} » {actDate.month} {actDate.year} г. на предприятии выявлены ТМЦ с несоответствиями по качеству и (или) безопасности согласно списку ниже.</p>
          <p className="flex flex-wrap items-center gap-2">
            Указанные ТМЦ были выработаны
            <input value={config.supplierName} disabled={isClosed} onChange={(event) => updateConfig({ supplierName: event.target.value })} onBlur={() => persistConfig(config).catch(() => undefined)} className="min-w-[280px] flex-1 border-b border-black bg-transparent px-1 outline-none" />
            и поставлены...
          </p>
          <p>Комиссия постановила выполнить в отношении выявленных ТМЦ следующие действия:</p>
        </div>

        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              {!isClosed && <th className={`w-[34px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 print:hidden`} />}
              <th className={`w-[70px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>№ п/п</th>
              <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>Наименование ТМЦ</th>
              <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>№ партии, дата выработки</th>
              <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>Количество (кг, шт)</th>
              <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>Описание несоответствия</th>
              <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>Действия с ТМЦ</th>
            </tr>
          </thead>
          <tbody>
            {config.rows.map((row, index) => (
              <tr key={row.id} className={!isClosed ? "cursor-pointer hover:bg-[#fbfbff]" : undefined} onClick={(event) => {
                if (isClosed) return;
                if ((event.target as HTMLElement).closest("button")) return;
                if ((event.target as HTMLElement).closest("[role='checkbox']")) return;
                setRowDialog({ open: true, index, row, newProductName: "" });
                setRowDialogProductOptions(productOptions);
              }}>
                {!isClosed && <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center align-top leading-tight print:hidden`}><Checkbox checked={selectedRows.includes(row.id)} onCheckedChange={(checked) => setSelectedRows((prev) => checked === true ? [...new Set([...prev, row.id])] : prev.filter((id) => id !== row.id))} /></td>}
                <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center align-top leading-tight`}>{index + 1}</td>
                <td className={`${GRID_CELL_CLASS} px-2 py-1 align-top leading-tight`}>{row.productName}</td>
                <td className={`${GRID_CELL_CLASS} px-2 py-1 align-top leading-tight`}><div>{row.batchNumber}</div><div>{row.productionDate}</div></td>
                <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center align-top leading-tight`}>{row.quantity}</td>
                <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center align-top leading-tight`}>{row.discrepancyDescription}</td>
                <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center align-top leading-tight`}>{row.action}</td>
              </tr>
            ))}
            {/* Последняя строка — кликабельная «пустая»: то же окно, что и
                «Добавить» в toolbar над таблицей. Чекбокс рендерится по
                тому же условию, что и сам JournalAddRow (!isClosed) —
                считаем его существующим: leading=2 (чекбокс + № п/п, как в
                эталоне гигиенического журнала). labelSpan=1 — подпись под
                «Наименование ТМЦ», единственной содержательной колонкой
                записи. Остальные 4 колонки (№ партии/дата выработки,
                количество, описание несоответствия, действия с ТМЦ) —
                данные, пустые в новой строке: trailing=4. Сумма
                2+1+4=7 — тот же colSpan, что был раньше. */}
            {!isClosed ? (
              <JournalAddRow
                leading={2}
                labelSpan={1}
                trailing={4}
                label="Добавить"
                onClick={() => {
                  setRowDialog({ open: true, index: null, row: emptyRow(), newProductName: "" });
                  setRowDialogProductOptions(productOptions);
                }}
              />
            ) : null}
            {/* Пустая строка-заготовка бланка — только для печати: на
                бумаге инспектор дописывает запись от руки. На экране она
                была некликабельной заглушкой, теперь кликабельность даёт
                JournalAddRow выше. */}
            <tr className="hidden print:table-row">
              {!isClosed && <td className={`${GRID_CELL_CLASS} px-2 py-4 print:hidden`} />}
              <td className={`${GRID_CELL_CLASS} px-2 py-4`} />
              <td className={`${GRID_CELL_CLASS} px-2 py-4`} />
              <td className={`${GRID_CELL_CLASS} px-2 py-4`} />
              <td className={`${GRID_CELL_CLASS} px-2 py-4`} />
              <td className={`${GRID_CELL_CLASS} px-2 py-4`} />
              <td className={`${GRID_CELL_CLASS} px-2 py-4`} />
            </tr>
          </tbody>
        </table>
      </JournalDocumentShell>

      {useV2 ? (
        <JournalSettingsModal
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          title="Настройки документа"
          description="Название документа, № акта, дата и комментарий."
          size="md"
          isSaving={saving}
          onSave={async () => {
            await saveSettings();
          }}
          onCancel={() => setSettingsOpen(false)}
        >
          <div className="space-y-2">
            <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              Название документа
            </Label>
            <Input
              value={config.documentName}
              onChange={(event) => updateConfig({ documentName: event.target.value })}
              className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
                № акта
              </Label>
              <Input
                value={config.actNumber}
                onChange={(event) => updateConfig({ actNumber: event.target.value })}
                placeholder="Например: 1"
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
                Дата документа
              </Label>
              <Input
                type="date"
                value={config.documentDate}
                onChange={(event) => updateConfig({ documentDate: event.target.value })}
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              Комментарий
            </Label>
            <Textarea
              value={config.comment}
              onChange={(event) => updateConfig({ comment: event.target.value })}
              className="min-h-[100px] rounded-2xl border-[#dcdfed] px-4 py-3 text-[14px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
            />
          </div>
        </JournalSettingsModal>
      ) : (
        <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DialogContent className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[28px] border-0 p-0 sm:max-w-[720px]">
            <DialogHeader className="border-b px-8 py-6">
              <DialogTitle className="text-[24px] font-medium text-black">Настройки документа</DialogTitle>
            </DialogHeader>
            <div className="space-y-5 px-8 py-6">
              <div className="space-y-2">
                <Label>Название документа</Label>
                <Input value={config.documentName} onChange={(event) => updateConfig({ documentName: event.target.value })} className="h-10 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]" />
              </div>
              <div className="space-y-2">
                <Label>№ акта</Label>
                <Input value={config.actNumber} onChange={(event) => updateConfig({ actNumber: event.target.value })} className="h-10 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]" />
              </div>
              <div className="space-y-2">
                <Label>Дата документа</Label>
                <Input type="date" value={config.documentDate} onChange={(event) => updateConfig({ documentDate: event.target.value })} className="h-10 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]" />
              </div>
              <div className="space-y-2">
                <Label>Комментарий</Label>
                <Textarea value={config.comment} onChange={(event) => updateConfig({ comment: event.target.value })} className="min-h-[160px] rounded-2xl border-[#dfe1ec] px-5 py-4 text-[18px]" />
              </div>
              <div className="flex justify-end">
                <Button type="button" onClick={() => saveSettings().catch(() => undefined)} disabled={saving} className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] text-white hover:bg-[#4a5bf0]">
                  {saving ? "Сохранение..." : "Сохранить"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={rowDialog.open} onOpenChange={(open) => {
        if (open) return;
        // Закрытие без сохранения прерывает очередь («Изменено k из N»).
        seq.cancelled();
      }}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] max-h-[92vh] supports-[height:100dvh]:max-h-[92dvh] overflow-hidden rounded-[24px] border-0 p-0 sm:max-w-[640px]">
          <DialogHeader className="border-b px-6 py-5">
            <DialogTitle className="text-[18px] font-semibold tracking-[-0.02em] text-[#0b1024]">
              {rowDialog.index === null ? "Добавление новой строки" : `Редактирование строки${seq.progress ? ` ${seq.progress}` : ""}`}
            </DialogTitle>
          </DialogHeader>

          <div className="max-h-[calc(92vh-160px)] space-y-5 overflow-y-auto px-6 py-5">
            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">Наименование ТМЦ</Label>
              <select value={rowDialog.row.productName} onChange={(event) => setRowDialog((prev) => ({ ...prev, row: { ...prev.row, productName: event.target.value } }))} className="h-9 w-full rounded-xl border border-[#dcdfed] bg-white px-3.5 text-[13.5px] text-[#0b1024]">
                <option value="">Выберите из списка</option>
                {Array.from(new Set(rowDialogProductOptions.length > 0 ? rowDialogProductOptions : productOptions)).map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
              <div className="flex gap-2">
                <Input value={rowDialog.newProductName} onChange={(event) => setRowDialog((prev) => ({ ...prev, newProductName: event.target.value }))} placeholder="Добавить название новых ТМЦ" className="h-10 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]" />
                <Button type="button" className="h-10 rounded-xl bg-[#5566f6] px-5 text-[14px] text-white hover:bg-[#4a5bf0]" onClick={() => {
                  const item = rowDialog.newProductName.trim();
                  if (!item) return;
                  setRowDialogProductOptions((current) => (
                    current.some((value) => value.toLowerCase() === item.toLowerCase())
                      ? current
                      : [...current, item]
                  ));
                  setRowDialog((prev) => ({ ...prev, row: { ...prev.row, productName: item }, newProductName: "" }));
                }}>
                  <Plus className="size-5" />
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#3c4053]">№ партии</Label>
                <Input value={rowDialog.row.batchNumber} onChange={(event) => setRowDialog((prev) => ({ ...prev, row: { ...prev.row, batchNumber: event.target.value } }))} className="h-10 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]" />
              </div>
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#3c4053]">Дата выработки</Label>
                <Input value={rowDialog.row.productionDate} onChange={(event) => setRowDialog((prev) => ({ ...prev, row: { ...prev.row, productionDate: event.target.value } }))} placeholder="02.04.2025" className="h-10 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]" />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">Количество (кг, шт)</Label>
              <Input value={rowDialog.row.quantity} onChange={(event) => setRowDialog((prev) => ({ ...prev, row: { ...prev.row, quantity: event.target.value } }))} className="h-10 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]" />
            </div>

            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">Описание несоответствия</Label>
              <Textarea value={rowDialog.row.discrepancyDescription} onChange={(event) => setRowDialog((prev) => ({ ...prev, row: { ...prev.row, discrepancyDescription: event.target.value } }))} className="rounded-2xl border-[#dcdfed] px-4 py-3 text-[15px]" rows={4} />
            </div>

            <div className="space-y-2">
              <Label className="text-[13px] font-medium text-[#3c4053]">Действия с ТМЦ</Label>
              <Textarea value={rowDialog.row.action} onChange={(event) => setRowDialog((prev) => ({ ...prev, row: { ...prev.row, action: event.target.value } }))} className="rounded-2xl border-[#dcdfed] px-4 py-3 text-[15px]" rows={3} />
            </div>
          </div>

          <div className="flex flex-col-reverse gap-2 border-t bg-white px-6 py-4 sm:flex-row sm:items-center sm:justify-end">
            {/* Акт забраковки → учёт потерь: запись заводится отсюда,
                повторно по той же строке — уже ссылкой. */}
            {rowDialog.row.lossRecordId ? (
              <a
                href="/losses"
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-[#dcdfed] px-4 text-[13.5px] font-medium text-[#3848c7] transition-colors duration-150 hover:bg-[#f5f6ff] sm:mr-auto sm:w-auto"
              >
                <TrendingDown className="size-4" />
                Записано в потери
              </a>
            ) : rowDialog.index !== null &&
              !isClosed &&
              canCreateLossFromWriteoffRow(rowDialog.row) ? (
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => void createLossFromRow(rowDialog.index as number)}
                title="Заведёт запись в «Учёте потерь»: категория «Списание», продукт, количество, причина и дата акта"
                className="h-9 w-full gap-1.5 rounded-xl border-[#5566f6]/30 bg-[#f5f6ff] px-4 text-[13.5px] font-medium text-[#5566f6] shadow-none transition-colors duration-150 hover:bg-[#eef1ff] sm:mr-auto sm:w-auto"
              >
                <TrendingDown className="size-4" />
                Записать в потери
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              className="h-9 w-full rounded-xl border-[#dcdfed] px-5 text-[14px] font-medium text-[#0b1024] shadow-none hover:bg-[#fafbff] sm:w-auto"
              onClick={() => setRowDialog({ open: false, index: null, row: emptyRow(), newProductName: "" })}
            >
              Отмена
            </Button>
            <Button
              type="button"
              onClick={() => saveRow().catch(() => undefined)}
              disabled={saving}
              className="h-10 w-full rounded-xl bg-[#5566f6] px-5 text-[14px] font-medium text-white hover:bg-[#4a5bf0] sm:w-auto"
            >
              {saving ? "Сохранение..." : rowDialog.index === null ? "Добавить" : "Сохранить"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={commissionDialog.open} onOpenChange={(open) => !open && setCommissionDialog({ open: false, index: null, member: emptyCommissionMember() })}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] max-h-[92vh] supports-[height:100dvh]:max-h-[92dvh] overflow-hidden rounded-[24px] border-0 p-0 sm:max-w-[640px]">
          <DialogHeader className="border-b px-6 py-5">
            {/* «Добавить» открывал окно с заголовком «Редактирование
                строки» и кнопкой «Сохранить» — человек не понимал, создаёт
                он новую строку или правит чужую. */}
            <DialogTitle className="text-[18px] font-semibold tracking-[-0.02em] text-[#0b1024]">
              {commissionDialog.index === null ? "Добавление строки" : "Редактирование строки"}
            </DialogTitle>
          </DialogHeader>

          <div className="max-h-[calc(92vh-160px)] space-y-5 overflow-y-auto px-6 py-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#3c4053]">Должность</Label>
                <select
                  value={commissionDialog.member.role}
                  onChange={(event) => {
                    const role = event.target.value;
                    const candidates = getUsersForRoleLabel(users, role);
                    setCommissionDialog((prev) => {
                      const stillValid =
                        prev.member.employeeId &&
                        candidates.some((u) => u.id === prev.member.employeeId);
                      const nextEmployee = stillValid
                        ? candidates.find((u) => u.id === prev.member.employeeId)
                        : candidates[0];
                      return {
                        ...prev,
                        member: {
                          ...prev.member,
                          role,
                          employeeId: nextEmployee?.id || "",
                          employeeName: nextEmployee?.name || "",
                        },
                      };
                    });
                  }}
                  className="h-9 w-full rounded-xl border border-[#dcdfed] bg-white px-3.5 text-[13.5px] text-[#0b1024]"
                >
                  <option value="">— выберите —</option>
                  <PositionNativeOptions users={users} />
                </select>
              </div>
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-[#3c4053]">Сотрудник</Label>
                <select value={commissionDialog.member.employeeId} onChange={(event) => {
                  const user = users.find((item) => item.id === event.target.value);
                  setCommissionDialog((prev) => ({ ...prev, member: { ...prev.member, employeeId: event.target.value, employeeName: user?.name || "", role: user ? getUserDisplayTitle(user) : prev.member.role } }));
                }} className="h-9 w-full rounded-xl border border-[#dcdfed] bg-white px-3.5 text-[13.5px] text-[#0b1024]">
                  <option value="">Выберите сотрудника</option>
                  {(commissionDialog.member.role
                    ? getUsersForRoleLabel(users, commissionDialog.member.role)
                    : users
                  ).map((user) => (
                    <option key={user.id} value={user.id}>{user.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="flex flex-col-reverse gap-2 border-t bg-white px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              {commissionDialog.index !== null ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 w-full rounded-xl border-[#ffd7d3] px-5 text-[14px] font-medium text-[#ff3b30] shadow-none hover:bg-[#fff4f2] sm:w-auto"
                  onClick={() => deleteCommissionMember(commissionDialog.index ?? 0).catch(() => undefined)}
                >
                  Удалить
                </Button>
              ) : null}
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                className="h-9 w-full rounded-xl border-[#dcdfed] px-5 text-[14px] font-medium text-[#0b1024] shadow-none hover:bg-[#fafbff] sm:w-auto"
                onClick={() => setCommissionDialog({ open: false, index: null, member: emptyCommissionMember() })}
              >
                Отмена
              </Button>
              <Button
                type="button"
                onClick={() => saveCommissionMember().catch(() => undefined)}
                disabled={saving}
                className="h-10 w-full rounded-xl bg-[#5566f6] px-5 text-[14px] font-medium text-white hover:bg-[#4a5bf0] sm:w-auto"
              >
                {saving
                  ? "Сохранение..."
                  : commissionDialog.index === null
                    ? "Добавить"
                    : "Сохранить"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Правки списка сохраняем при ЛЮБОМ закрытии окна (крестик, Esc,
          клик мимо), а не только по кнопке «Закрыть». */}
      <Dialog
        open={listsOpen}
        onOpenChange={(open) => {
          setListsOpen(open);
          if (!open) void persistConfig(config).catch(() => undefined);
        }}
      >
        <DialogContent className="max-h-[92vh] supports-[height:100dvh]:max-h-[92dvh] w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-[28px] border-0 p-0 sm:max-w-[720px]">
          <DialogHeader className="border-b px-8 py-6">
            <DialogTitle className="text-[24px] font-medium text-black">Редактировать список продукции</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 px-8 py-6">
            {config.productLists[0]?.items.map((item, index) => (
              <div key={`${item}-${index}`} className="flex items-center gap-3 rounded-2xl bg-[#f5f6ff] px-4 py-3">
                <div className="flex-1 text-[15px]">{item}</div>
                {!isClosed && (
                  <button
                    type="button"
                    className="rounded-full p-2 text-[#ff3b30]"
                    onClick={() =>
                      setConfig((prev) => ({
                        ...prev,
                        productLists: prev.productLists.map((list, listIndex) =>
                          listIndex === 0 ? { ...list, items: list.items.filter((listItem) => listItem !== item) } : list
                        ),
                      }))
                    }
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
            ))}

            {!isClosed && (
              <>
                <div className="flex gap-3">
                  <Input value={rowDialog.newProductName} onChange={(event) => setRowDialog((prev) => ({ ...prev, newProductName: event.target.value }))} placeholder="Введите наименование продукции" className="h-10 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]" />
                  <Button type="button" className="h-9 rounded-xl bg-[#5563ff] px-5 text-[13.5px] text-white" onClick={() => {
                    const item = rowDialog.newProductName.trim();
                    if (!item) return;
                    setConfig((prev) => ({
                      ...prev,
                      productLists: prev.productLists.map((list, index) => index === 0 ? { ...list, items: Array.from(new Set([...list.items, item])) } : list),
                    }));
                    setRowDialog((prev) => ({ ...prev, newProductName: "" }));
                  }}>
                    <Plus className="size-6" />
                  </Button>
                </div>

                <button
                  type="button"
                  className="block text-[18px] text-[#3848c7] underline"
                  onClick={() => setDirectoryOpen(true)}
                  title="Добавить позиции из общего справочника организации"
                >
                  Из справочника организации
                </button>
                <OrgDirectoryDialog
                  open={directoryOpen}
                  onClose={() => setDirectoryOpen(false)}
                  kind="product"
                  existing={config.productLists[0]?.items ?? []}
                  onAdd={(items) =>
                    setConfig((prev) => ({
                      ...prev,
                      productLists: prev.productLists.map((list, index) =>
                        index === 0 ? { ...list, items: mergeIntoList(list.items, items) } : list
                      ),
                    }))
                  }
                />

                <button type="button" className="text-[18px] text-[#6c77ff] underline" onClick={() => fileInputRef.current?.click()} disabled={importing}>
                  Добавить из файла
                </button>

                <div className="rounded-[24px] border border-[#e6e9f5] bg-[#fbfbff] px-5 py-4 text-[15px] leading-7 text-[#505469]">
                  Список должен быть в файле Excel, на первом листе в первом столбце и начинаться с первой строки.
                </div>
              </>
            )}

            <div className="flex justify-end">
              <Button type="button" onClick={() => setListsOpen(false)} disabled={saving} className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] text-white hover:bg-[#4a5bf0]">
                {saving ? "Сохранение..." : "Закрыть"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) importItemsFromFile(file).catch(() => undefined);
          event.currentTarget.value = "";
        }}
      />

      {importing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/20">
          <div className="rounded-2xl bg-white px-6 py-4 text-[18px]">
            <Loader2 className="mr-3 inline size-5 animate-spin" />
            Импортируем Excel...
          </div>
        </div>
      )}
    </div>
  );
}
