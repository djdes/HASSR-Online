"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { USER_ROLE_LABEL_VALUES, getUserRoleLabel, getUsersForRoleLabel, pickPrimaryManager } from "@/lib/user-roles";
import {
  GLASS_LIST_PAGE_TITLE,
  createGlassListRow,
  formatGlassListDateLong,
  normalizeGlassListConfig,
  type GlassListConfig,
  type GlassListRow,
} from "@/lib/glass-list-document";
import { useDocumentCloseAction } from "@/components/journals/document-close-button";
import { useMobileView } from "@/lib/use-mobile-view";
import {
  RecordCardsView,
  type RecordCardItem,
} from "@/components/journals/record-cards-view";

import { toast } from "sonner";
import { confirmAsync } from "@/components/ui/confirm-async";
import { PositionNativeOptions } from "@/components/shared/position-select";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";
type UserItem = {
  id: string;
  name: string;
  role: string;
};

type Props = {
  documentId: string;
  title: string;
  organizationName: string;
  status: string;
  initialConfig: GlassListConfig;
  users: UserItem[];
  /** Design v2 toggle. */
  useV2?: boolean;
};

type RowDialogState = {
  open: boolean;
  rowIndex: number | null;
  row: GlassListRow;
};

const RESPONSIBLE_TITLES = USER_ROLE_LABEL_VALUES;

function emptyRow(location: string) {
  return createGlassListRow({ location });
}

export function GlassListDocumentClient({
  documentId,
  title,
  organizationName,
  status,
  initialConfig,
  users,
  useV2 = false,
}: Props) {
  const router = useRouter();
  const isClosed = status === "closed";
  const { mobileView, switchMobileView } = useMobileView("glass_items_list");
  const [config, setConfig] = useState(() => normalizeGlassListConfig(initialConfig));
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rowDialog, setRowDialog] = useState<RowDialogState>({
    open: false,
    rowIndex: null,
    row: emptyRow(config.location),
  });
  const [saving, setSaving] = useState(false);

  const responsibleUser = useMemo(
    () => users.find((user) => user.id === config.responsibleUserId) || null,
    [config.responsibleUserId, users]
  );
  const { closeDocument } = useDocumentCloseAction({ documentId, title });

  /**
   * `withHeader` — поля шапки (название, дата, ответственный). Они
   * management-only, поэтому правка самих позиций шлёт ТОЛЬКО `config`:
   * иначе у рядового сотрудника любой PATCH падал 403.
   */
  async function persist(nextConfig: GlassListConfig, withHeader = false) {
    setSaving(true);
    try {
      const response = await fetch(`/api/journal-documents/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          withHeader
            ? {
                title: nextConfig.documentName || title,
                dateFrom: nextConfig.documentDate,
                dateTo: nextConfig.documentDate,
                responsibleTitle: nextConfig.responsibleTitle || null,
                responsibleUserId: nextConfig.responsibleUserId || null,
                config: nextConfig,
              }
            : { config: nextConfig }
        ),
      });

      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.error || "Не удалось сохранить документ");
      }

      setConfig(nextConfig);
      router.refresh();
      return true;
    } catch (error) {
      toast.error(
        humanizeFetchError(error, "Не удалось сохранить документ")
      );
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveSettings() {
    const ok = await persist(config, true);
    if (ok) setSettingsOpen(false);
  }

  /** Правка выделенных строк по очереди — тем же окном. */
  const seq = useSequentialEdit({
    open: (id) => {
      // Окно работает по индексу — ищем его по id в актуальном списке.
      const index = config.rows.findIndex((item) => item.id === id);
      if (index === -1 || isClosed) return false;
      setRowDialog({ open: true, rowIndex: index, row: config.rows[index] });
      return true;
    },
    close: () =>
      setRowDialog({
        open: false,
        rowIndex: null,
        row: emptyRow(config.location),
      }),
  });

  async function saveRow() {
    const nextConfig = structuredClone(config) as GlassListConfig;
    if (rowDialog.rowIndex === null) nextConfig.rows.push(rowDialog.row);
    else nextConfig.rows[rowDialog.rowIndex] = rowDialog.row;

    const ok = await persist(nextConfig);
    if (ok) {
      if (rowDialog.rowIndex !== null) {
        // Очередь правок откроет следующую строку или закроет окно.
        seq.saved();
        return;
      }
      setRowDialog({
        open: false,
        rowIndex: null,
        row: emptyRow(nextConfig.location),
      });
    }
  }

  async function deleteSelectedRows() {
    if (selectedRows.length === 0) return;
    const doomed = config.rows.filter((row) => selectedRows.includes(row.id));
    // Удаление позиции стирает и её количество — считаем, что теряется.
    const filledValues = doomed.reduce(
      (total, row) =>
        total +
        [row.itemName, row.quantity, row.location].filter(
          (value) => (value || "").trim() !== ""
        ).length,
      0
    );
    const confirmed = await confirmAsync({
      title: "Удалить выбранные позиции?",
      description:
        "Позиции перечня изделий из стекла и хрупкого пластика будут удалены безвозвратно.",
      variant: "danger",
      confirmLabel: "Удалить",
      bullets: [
        { label: `Позиций будет удалено: ${doomed.length}`, tone: "warn" },
        { label: `Заполненных значений потеряется: ${filledValues}`, tone: "warn" },
        {
          label: `Останется позиций: ${config.rows.length - doomed.length}`,
          tone: "default",
        },
      ],
    });
    if (!confirmed) return;
    const nextConfig: GlassListConfig = {
      ...config,
      rows: config.rows.filter((row) => !selectedRows.includes(row.id)),
    };
    const ok = await persist(nextConfig);
    if (ok) {
      setSelectedRows([]);
      toast.success(
        `Удалено позиций: ${doomed.length}; значений: ${filledValues}`
      );
    }
  }

  return (
    <div className="space-y-6 text-black">
      <FocusTodayScroller selector="[data-focus-today]" emptyTitle="Записей пока нет" emptyBody="Нажмите «Добавить» в таблице ниже, чтобы создать запись." />
      {selectedRows.length > 0 && !isClosed && (
        <JournalSelectionBar
          count={selectedRows.length}
          onClear={() => setSelectedRows([])}
          onDelete={() => deleteSelectedRows().catch(() => undefined)}
          hint="Позиции перечня будут удалены без возможности отмены"
        >
          <SelectionEditButton count={selectedRows.length} disabled={isClosed} onClick={() => seq.start(selectedRows)} />
        </JournalSelectionBar>
      )}

      <JournalDocumentShell
        title={title}
        documentId={documentId}
        backHref="/journals/glass_items_list"
        onSettings={isClosed ? undefined : () => setSettingsOpen(true)}
        closed={isClosed}
        closedHint="Откройте журнал заново, чтобы добавлять и редактировать позиции."
        menuItems={
          isClosed
            ? []
            : [
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
        cards={
          <RecordCardsView
            items={config.rows.map((row, index) => ({
              id: row.id,
              title: `№${index + 1} · ${row.itemName || "—"}`,
              subtitle: row.location || undefined,
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
                { label: "Участок", value: row.location, hideIfEmpty: true },
                { label: "Кол-во", value: row.quantity, hideIfEmpty: true },
              ],
              onClick: !isClosed
                ? () => setRowDialog({ open: true, rowIndex: index, row })
                : undefined,
            }))}
            emptyLabel="Предметов из стекла ещё не внесено."
          />
        }
        paperHeader={
          <>
            <JournalDocumentHeader
              orgName={organizationName}
              title="ПЕРЕЧЕНЬ ИЗДЕЛИЙ ИЗ СТЕКЛА И ХРУПКОГО ПЛАСТИКА"
              startedAt={config.documentDate}
              finishedAt={null}
            />
            <div className="flex justify-end pt-4">
              <div className="min-w-[360px] space-y-2 text-right text-[18px]">
                <div className="font-semibold uppercase">УТВЕРЖДАЮ</div>
                <div>{config.responsibleTitle || "Управляющий"}</div>
                <div>
                  ____________________ {responsibleUser?.name || "Иванов И.И."}
                </div>
                <div>« {formatGlassListDateLong(config.documentDate)} г.</div>
              </div>
            </div>
          </>
        }
        sheetTitle={GLASS_LIST_PAGE_TITLE}
        sheetMinWidth={1100}
        toolbar={
          !isClosed ? (
            <Button
              type="button"
              className={DOC_PRIMARY_BUTTON_CLASS}
              onClick={() =>
                setRowDialog({
                  open: true,
                  rowIndex: null,
                  row: emptyRow(config.location),
                })
              }
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
              <th className={`w-[42px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`} />
              <th className={`w-[260px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>Место расположения (участок)</th>
              <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>Наименование объекта контроля (предмета)</th>
              <th className={`w-[120px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>Кол-во</th>
            </tr>
          </thead>
          <tbody>
            {config.rows.map((row, index) => (
              <tr
                key={row.id}
                className={!isClosed ? "cursor-pointer hover:bg-[#fbfbff]" : undefined}
                onClick={(event) => {
                  if (isClosed) return;
                  if ((event.target as HTMLElement).closest("button")) return;
                  if ((event.target as HTMLElement).closest("[role='checkbox']")) return;
                  setRowDialog({ open: true, rowIndex: index, row });
                }}
              >
                <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center align-top leading-tight`}>
                  <Checkbox
                    checked={selectedRows.includes(row.id)}
                    onCheckedChange={(checked) =>
                      setSelectedRows((prev) =>
                        checked === true
                          ? [...new Set([...prev, row.id])]
                          : prev.filter((id) => id !== row.id)
                      )
                    }
                  />
                </td>
                <td className={`${GRID_CELL_CLASS} px-2 py-1 align-top leading-tight`}>{row.location}</td>
                <td className={`${GRID_CELL_CLASS} px-2 py-1 align-top leading-tight`}>{row.itemName}</td>
                <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center align-top leading-tight`}>{row.quantity}</td>
              </tr>
            ))}
            {/* Последняя строка — кликабельная «пустая»: то же окно, что и
                «Добавить» в toolbar над таблицей. */}
            {!isClosed ? (
              <JournalAddRow
                // Галочка — leading. Подпись растянута на «Место
                // расположения» + «Наименование объекта», «Кол-во»
                // остаётся пустой ячейкой справа.
                leading={1}
                labelSpan={2}
                trailing={1}
                label="Добавить"
                onClick={() =>
                  setRowDialog({
                    open: true,
                    rowIndex: null,
                    row: emptyRow(config.location),
                  })
                }
              />
            ) : null}
            {/* Пустая строка-заготовка бланка — только для печати: на
                бумаге инспектор дописывает запись от руки. На экране она
                была некликабельной заглушкой, теперь кликабельность даёт
                JournalAddRow выше. */}
            <tr className="hidden print:table-row">
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
          description="Название, место расположения, дата и ответственный сотрудник."
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
              onChange={(event) =>
                setConfig((prev) => ({ ...prev, documentName: event.target.value }))
              }
              className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
                Место расположения
              </Label>
              <Input
                value={config.location}
                onChange={(event) =>
                  setConfig((prev) => ({ ...prev, location: event.target.value }))
                }
                placeholder="Участок"
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
                onChange={(event) =>
                  setConfig((prev) => ({ ...prev, documentDate: event.target.value }))
                }
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              Должность
            </Label>
            <select
              value={config.responsibleTitle}
              onChange={(event) => {
                const newTitle = event.target.value;
                setConfig((prev) => {
                  const candidates = getUsersForRoleLabel(users, newTitle);
                  const stillValid = candidates.some((u) => u.id === prev.responsibleUserId);
                  return {
                    ...prev,
                    responsibleTitle: newTitle,
                    responsibleUserId: stillValid ? prev.responsibleUserId : candidates[0]?.id || "",
                  };
                });
              }}
              className="h-9 w-full rounded-xl border border-[#dcdfed] bg-white px-3.5 text-[13.5px] text-[#0b1024]"
            >
              <PositionNativeOptions users={users} />
            </select>
          </div>
          <div className="space-y-2">
            <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              Сотрудник
            </Label>
            <select
              value={config.responsibleUserId}
              onChange={(event) => {
                const userId = event.target.value;
                setConfig((prev) => {
                  if (!prev.responsibleTitle && userId) {
                    const user = users.find((u) => u.id === userId);
                    if (user) {
                      return {
                        ...prev,
                        responsibleUserId: userId,
                        responsibleTitle: getUserRoleLabel(user.role),
                      };
                    }
                  }
                  return { ...prev, responsibleUserId: userId };
                });
              }}
              className="h-9 w-full rounded-xl border border-[#dcdfed] bg-white px-3.5 text-[13.5px] text-[#0b1024]"
            >
              <option value="">— Выберите —</option>
              {(config.responsibleTitle ? getUsersForRoleLabel(users, config.responsibleTitle) : users).map(
                (user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                )
              )}
            </select>
          </div>
        </JournalSettingsModal>
      ) : (
        <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DialogContent className="max-w-[calc(100vw-1rem)] rounded-[32px] border-0 p-0 sm:max-w-[760px]">
            <DialogHeader className="border-b px-14 py-10">
              <DialogTitle className="text-[22px] font-medium text-black">
                Настройки документа
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-8 px-14 py-12">
              <div className="space-y-3">
                <Label className="text-[14px] text-[#73738a]">Название документа</Label>
                <Input
                  value={config.documentName}
                  onChange={(event) =>
                    setConfig((prev) => ({ ...prev, documentName: event.target.value }))
                  }
                  className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
                />
              </div>
              <div className="space-y-3">
                <Label className="text-[14px] text-[#73738a]">Место расположения (участок)</Label>
                <Input
                  value={config.location}
                  onChange={(event) =>
                    setConfig((prev) => ({ ...prev, location: event.target.value }))
                  }
                  className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
                />
              </div>
              <div className="space-y-3">
                <Label className="text-[14px] text-[#73738a]">Дата документа</Label>
                <Input
                  type="date"
                  value={config.documentDate}
                  onChange={(event) =>
                    setConfig((prev) => ({ ...prev, documentDate: event.target.value }))
                  }
                  className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
                />
              </div>
              <div className="space-y-3">
                <Label className="text-[14px] text-[#73738a]">Должность</Label>
                <select
                  value={config.responsibleTitle}
                  onChange={(event) => {
                    const newTitle = event.target.value;
                    setConfig((prev) => {
                      const candidates = getUsersForRoleLabel(users, newTitle);
                      const stillValid = candidates.some((u) => u.id === prev.responsibleUserId);
                      return {
                        ...prev,
                        responsibleTitle: newTitle,
                        responsibleUserId: stillValid
                          ? prev.responsibleUserId
                          : candidates[0]?.id || "",
                      };
                    });
                  }}
                  className="h-18 w-full rounded-[22px] border border-[#dfe1ec] bg-[#f3f4fb] px-7 text-[15px]"
                >
                  <PositionNativeOptions users={users} />
                </select>
              </div>
              <div className="space-y-3">
                <Label className="text-[14px] text-[#73738a]">Сотрудник</Label>
                <select
                  value={config.responsibleUserId}
                  onChange={(event) => {
                    const userId = event.target.value;
                    setConfig((prev) => {
                      if (!prev.responsibleTitle && userId) {
                        const user = users.find((u) => u.id === userId);
                        if (user) {
                          return { ...prev, responsibleUserId: userId, responsibleTitle: getUserRoleLabel(user.role) };
                        }
                      }
                      return { ...prev, responsibleUserId: userId };
                    });
                  }}
                  className="h-18 w-full rounded-[22px] border border-[#dfe1ec] bg-[#f3f4fb] px-7 text-[15px]"
                >
                  <option value="">- Выберите значение -</option>
                  {(config.responsibleTitle ? getUsersForRoleLabel(users, config.responsibleTitle) : users).map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  disabled={saving}
                  onClick={() => saveSettings().catch(() => undefined)}
                  className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] text-white hover:bg-[#4b57ff]"
                >
                  {saving ? "Сохранение..." : "Сохранить"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      <Dialog
        open={rowDialog.open}
        onOpenChange={(open) =>
          // Закрытие без сохранения прерывает очередь («Изменено k из N»).
          !open && seq.cancelled()
        }
      >
        <DialogContent className="max-w-[calc(100vw-1rem)] rounded-[32px] border-0 p-0 sm:max-w-[760px]">
          <DialogHeader className="border-b px-14 py-10">
            <DialogTitle className="text-[22px] font-medium text-black">
              {rowDialog.rowIndex === null ? "Добавление новой строки" : `Редактирование строки${seq.progress ? ` ${seq.progress}` : ""}`}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-8 px-14 py-12">
            <div className="space-y-3">
              <Label className="text-[14px] text-[#73738a]">Место расположения (участок)</Label>
              <Input
                value={rowDialog.row.location}
                onChange={(event) =>
                  setRowDialog((prev) => ({
                    ...prev,
                    row: { ...prev.row, location: event.target.value },
                  }))
                }
                className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
              />
            </div>
            <div className="space-y-3">
              <Label className="text-[14px] text-[#73738a]">Наименование объекта контроля (предмета)</Label>
              <Input
                value={rowDialog.row.itemName}
                onChange={(event) =>
                  setRowDialog((prev) => ({
                    ...prev,
                    row: { ...prev.row, itemName: event.target.value },
                  }))
                }
                className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
              />
            </div>
            <div className="space-y-3">
              <Label className="text-[14px] text-[#73738a]">Кол-во</Label>
              <Input
                value={rowDialog.row.quantity}
                onChange={(event) =>
                  setRowDialog((prev) => ({
                    ...prev,
                    row: { ...prev.row, quantity: event.target.value },
                  }))
                }
                className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
              />
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                disabled={saving}
                onClick={() => saveRow().catch(() => undefined)}
                className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] text-white hover:bg-[#4b57ff]"
              >
                {saving ? "Сохранение..." : rowDialog.rowIndex === null ? "Добавить" : "Сохранить"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
