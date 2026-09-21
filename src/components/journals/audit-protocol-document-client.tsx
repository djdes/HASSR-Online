"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Archive, ClipboardList, ExternalLink, Plus } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  AUDIT_PROTOCOL_DOCUMENT_TITLE,
  createAuditProtocolRow,
  createAuditProtocolSection,
  createAuditProtocolSignature,
  fillAuditProtocolFromPlan,
  normalizeAuditProtocolConfig,
  type AuditProtocolConfig,
  type AuditProtocolPlanSource,
  type AuditProtocolRow,
  type AuditProtocolSection,
  type AuditProtocolSignature,
} from "@/lib/audit-protocol-document";
import { AUDIT_PLAN_TEMPLATE_CODE } from "@/lib/audit-plan-document";
import { ResponsiveMenu } from "@/components/ui/responsive-menu";
import { confirmAsync } from "@/components/ui/confirm-async";
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
import { JournalSettingsModal } from "@/components/journals/v2/journal-settings-modal";
import { JournalDocumentShell } from "@/components/journals/journal-document-shell";
import { JournalDocumentHeader } from "@/components/journals/journal-document-header";
import { JournalAddRow } from "@/components/journals/journal-add-row";
import { GRID_CELL_CLASS, GRID_HEAD_CELL_CLASS } from "@/components/journals/journal-grid";
import { DOC_EXTRA_BLOCK_CLASS } from "@/components/journals/journal-responsive";

import { toast } from "sonner";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";
type Props = {
  documentId: string;
  title: string;
  organizationName: string;
  status: string;
  config: unknown;
  /**
   * Планы аудитов организации — источник для «Заполнить из плана».
   * Пусто ⇒ кнопка не показывается (планов ещё нет).
   */
  planSources?: AuditProtocolPlanSource[];
  /** Design v2 toggle. */
  useV2?: boolean;
};

/**
 * Кнопка «Заполнить из плана аудитов»: выбор плана списком в стиле
 * проекта (на телефоне — лист снизу). После выбора — подтверждение со
 * счётчиком, что именно скопируется.
 */
function FillFromPlanButton({
  plans,
  onPick,
}: {
  plans: AuditProtocolPlanSource[];
  onPick: (plan: AuditProtocolPlanSource) => void;
}) {
  if (plans.length === 0) return null;
  return (
    <ResponsiveMenu
      title="Из какого плана заполнить"
      contentClassName="w-[340px] rounded-[22px] border-0 p-3 shadow-xl"
      items={plans.map((plan) => ({
        key: plan.documentId,
        label: `${plan.title} · требований: ${plan.rows.filter((row) => row.text.trim()).length}`,
        icon: <ClipboardList className="size-4 text-[#6f7282]" />,
        onSelect: () => onPick(plan),
      }))}
      trigger={
        <Button
          type="button"
          variant="outline"
          className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
        >
          <ClipboardList className="size-4 text-[#5566f6]" />
          Заполнить из плана аудитов
        </Button>
      }
    />
  );
}

function SectionDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (title: string) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-1rem)] rounded-[28px] border-0 p-0 sm:max-w-[620px]">
        <DialogHeader className="border-b px-8 py-6">
          <DialogTitle className="text-[22px] font-semibold text-black">Добавить новый раздел</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 px-8 py-6">
          <Input value={value} onChange={(e) => setValue(e.target.value)} className="h-10 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]" />
          <div className="flex justify-end">
            <Button type="button" onClick={async () => { if (!value.trim()) return; await onCreate(value.trim()); onOpenChange(false); setValue(""); }} className="h-9 rounded-xl bg-[#5563ff] px-3.5 text-[13.5px] text-white hover:bg-[#4554ff]">
              Добавить
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RowDialog({
  open,
  onOpenChange,
  sections,
  row,
  titleSuffix,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: AuditProtocolSection[];
  row: AuditProtocolRow | null;
  /** «(k из N)» при правке по очереди. */
  titleSuffix?: string;
  onSave: (row: AuditProtocolRow) => Promise<void>;
}) {
  const [draft, setDraft] = useState<AuditProtocolRow>(
    row ||
      createAuditProtocolRow({
        sectionId: sections[0]?.id || "",
      })
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-1rem)] rounded-[28px] border-0 p-0 sm:max-w-[700px]">
        <DialogHeader className="border-b px-8 py-6">
          <DialogTitle className="text-[22px] font-semibold text-black">
            {row ? `Редактирование строки${titleSuffix ? ` ${titleSuffix}` : ""}` : "Добавление новой строки"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 px-8 py-6">
          <div className="space-y-2">
            <Label className="text-[14px] text-[#73738a]">Раздел</Label>
            <Select value={draft.sectionId} onValueChange={(value) => setDraft({ ...draft, sectionId: value })}>
              <SelectTrigger className="h-10 rounded-xl border-[#d8dae6] bg-[#f1f2f8] px-3.5 text-[13.5px]">
                <SelectValue placeholder="Выберите раздел" />
              </SelectTrigger>
              <SelectContent>
                {sections.map((section) => (
                  <SelectItem key={section.id} value={section.id}>{section.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-[14px] text-[#73738a]">Требование</Label>
            <Textarea value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} className="min-h-[160px] rounded-2xl border-[#d8dae6] px-4 py-3 text-[18px]" />
          </div>
          {/* Результат и примечание были только в таблице: на телефоне
              окно строки не давало поставить Да/Нет вообще. */}
          <div className="space-y-2">
            <Label className="text-[14px] text-[#73738a]">Результат</Label>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ["yes", "Да"],
                  ["no", "Нет"],
                  ["", "Не проверено"],
                ] as const
              ).map(([value, label]) => {
                const active = draft.result === value;
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setDraft({ ...draft, result: value })}
                    className={`flex h-10 items-center justify-center rounded-xl border px-3 text-[14px] font-medium transition-colors duration-150 ${
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
            <Label className="text-[14px] text-[#73738a]">Примечания</Label>
            <Textarea value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} className="min-h-[90px] rounded-2xl border-[#d8dae6] px-4 py-3 text-[15px]" />
          </div>
          <div className="flex justify-end">
            <Button type="button" onClick={async () => { await onSave(draft); onOpenChange(false); }} className="h-9 rounded-xl bg-[#5563ff] px-3.5 text-[13.5px] text-white hover:bg-[#4554ff]">
              Сохранить
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AuditProtocolDocumentClient({
  documentId,
  title,
  organizationName,
  status,
  config: initialConfig,
  planSources = [],
  useV2 = false,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [documentTitle, setDocumentTitle] = useState(title || AUDIT_PROTOCOL_DOCUMENT_TITLE);
  const [config, setConfig] = useState(() => normalizeAuditProtocolConfig(initialConfig));
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sectionOpen, setSectionOpen] = useState(false);
  const [rowOpen, setRowOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<AuditProtocolRow | null>(null);
  // Окно само зовёт onOpenChange(false) после сохранения — это не отмена.
  const rowSavedRef = useRef(false);

  useEffect(() => {
    setConfig(normalizeAuditProtocolConfig(initialConfig));
  }, [initialConfig]);

  // Клики «Да/Нет» по разным строкам строились от ОДНОГО снимка config —
  // второй запрос затирал первый. Держим актуальный config в ref и шлём
  // правки по очереди.
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);
  const rowQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  function toggleRowResult(rowId: string, result: "yes" | "no") {
    rowQueueRef.current = rowQueueRef.current
      .then(async () => {
        const current = configRef.current;
        const next: AuditProtocolConfig = {
          ...current,
          rows: current.rows.map((item) =>
            item.id === rowId
              ? { ...item, result: item.result === result ? "" : result }
              : item
          ),
        };
        configRef.current = next;
        await persist(documentTitle, next);
      })
      .catch((error) => {
        configRef.current = config;
        toast.error(humanizeFetchError(error, "Ошибка сохранения"));
      });
  }

  useEffect(() => {
    setDocumentTitle(title || AUDIT_PROTOCOL_DOCUMENT_TITLE);
  }, [title]);

  async function persist(nextTitle: string, nextConfig: AuditProtocolConfig, patch?: Record<string, unknown>) {
    const response = await fetch(`/api/journal-documents/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: nextTitle,
        dateFrom: nextConfig.documentDate,
        dateTo: nextConfig.documentDate,
        config: nextConfig,
        ...patch,
      }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error || "Не удалось сохранить документ");
    setDocumentTitle(nextTitle);
    setConfig(nextConfig);
    startTransition(() => router.refresh());
  }

  /** Правка выделенных строк по очереди — тем же окном. */
  const seq = useSequentialEdit({
    open: (id) => {
      const row = configRef.current.rows.find((item) => item.id === id);
      if (!row || status !== "active") return false;
      setEditingRow(row);
      setRowOpen(true);
      return true;
    },
    close: () => {
      setRowOpen(false);
      setEditingRow(null);
    },
  });

  async function saveRow(row: AuditProtocolRow) {
    const nextRows = editingRow
      ? config.rows.map((item) => (item.id === editingRow.id ? row : item))
      : [...config.rows, row];
    await persist(documentTitle, { ...config, rows: nextRows });
    if (editingRow) {
      // Очередь правок откроет следующую строку или закроет окно.
      rowSavedRef.current = true;
      seq.saved();
      return;
    }
    setEditingRow(null);
  }

  async function deleteSelected() {
    if (selectedRowIds.length === 0) return;
    await persist(documentTitle, {
      ...config,
      rows: config.rows.filter((row) => !selectedRowIds.includes(row.id)),
    });
    setSelectedRowIds([]);
  }

  /**
   * Заполнение протокола из плана. Копия, а не ссылка: план потом можно
   * править, подписанный протокол от этого не изменится.
   */
  async function fillFromPlan(plan: AuditProtocolPlanSource) {
    const preview = fillAuditProtocolFromPlan(config, plan);
    if (preview.addedRows === 0) {
      toast.info(
        preview.skippedRows > 0
          ? "Все требования этого плана уже перенесены в протокол"
          : "В этом плане нет требований для переноса"
      );
      return;
    }

    const ok = await confirmAsync({
      title: "Заполнить протокол из плана?",
      description: `План: «${plan.title}».`,
      variant: "info",
      confirmLabel: "Заполнить",
      bullets: [
        { label: `Добавится требований: ${preview.addedRows}`, tone: "info" },
        ...(preview.skippedRows > 0
          ? [{ label: `Уже перенесено ранее: ${preview.skippedRows}`, tone: "info" as const }]
          : []),
        { label: "Это копия: правка плана задним числом протокол не изменит" },
        { label: "Уже заполненные строки протокола остаются на месте" },
      ],
    });
    if (!ok) return;

    try {
      await persist(documentTitle, preview.config);
      toast.success(`Перенесено требований: ${preview.addedRows}`);
    } catch (error) {
      toast.error(humanizeFetchError(error, "Ошибка сохранения"));
    }
  }

  async function addSection(title: string) {
    await persist(documentTitle, {
      ...config,
      sections: [...config.sections, createAuditProtocolSection(title)],
    });
  }

  async function saveSettings(nextTitle: string, nextConfig: AuditProtocolConfig) {
    await persist(nextTitle, nextConfig);
  }

  async function saveSignature(index: number, next: AuditProtocolSignature) {
    const signatures = [...config.signatures];
    signatures[index] = next;
    await persist(documentTitle, { ...config, signatures });
  }

  const rowsBySection = useMemo(
    () =>
      config.sections.map((section) => ({
        section,
        rows: config.rows.filter((row) => row.sectionId === section.id),
      })),
    [config.rows, config.sections]
  );

  const allSelected = config.rows.length > 0 && selectedRowIds.length === config.rows.length;
  const { mobileView, switchMobileView } = useMobileView("audit_protocol");
  const { closeDocument } = useDocumentCloseAction({ documentId, title: documentTitle });

  const cardItems: RecordCardItem[] = config.rows.map((row, index) => {
    const section = config.sections.find((s) => s.id === row.sectionId);
    const resultLabel =
      row.result === "yes" ? "Да (+)" : row.result === "no" ? "Нет (−)" : "";
    return {
      id: row.id,
      title: `№${index + 1} · ${row.text || "—"}`,
      subtitle: section?.title || undefined,
      badge: row.result ? (
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            row.result === "yes"
              ? "bg-[#e6f8ec] text-[#1f7a3c]"
              : "bg-[#fff2f1] text-[#d2453d]"
          }`}
        >
          {resultLabel}
        </span>
      ) : undefined,
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
        { label: "Результат", value: resultLabel, hideIfEmpty: true },
        { label: "Примечания", value: row.note, hideIfEmpty: true },
      ],
      onClick: status === "active"
        ? () => {
            setEditingRow(row);
            setRowOpen(true);
          }
        : undefined,
    };
  });

  return (
    <>
      <div className="space-y-5">
        {selectedRowIds.length > 0 && status === "active" && (
          <JournalSelectionBar
            count={selectedRowIds.length}
            onClear={() => setSelectedRowIds([])}
            onDelete={() => deleteSelected().catch((error) => toast.error(humanizeFetchError(error, "Ошибка удаления")))}
            hint="Строки протокола будут удалены без возможности отмены"
          >
            <SelectionEditButton count={selectedRowIds.length} disabled={status !== "active"} onClick={() => seq.start(selectedRowIds)} />
          </JournalSelectionBar>
        )}

        <FocusTodayScroller selector="[data-focus-today]" emptyTitle="Записей пока нет" emptyBody="Нажмите «Добавить» в таблице ниже, чтобы создать запись." />

        <JournalDocumentShell
          title={documentTitle}
          documentId={documentId}
          backHref="/journals/audit_protocol"
          onSettings={status === "active" ? () => setSettingsOpen(true) : undefined}
          closed={status !== "active"}
          closedHint="Откройте журнал заново, чтобы добавлять и править пункты протокола."
          menuItems={
            status === "active"
              ? [
                  {
                    key: "close-journal",
                    label: "Закончить журнал",
                    icon: <Archive className="size-4" />,
                    onSelect: () => void closeDocument(),
                  },
                ]
              : []
          }
          mobileView={mobileView}
          onMobileView={switchMobileView}
          cards={
            <RecordCardsView items={cardItems} emptyLabel="Пунктов протокола пока нет." />
          }
          paperHeader={
          <>
            <JournalDocumentHeader
              orgName={organizationName}
              title="ПРОТОКОЛ ВНУТРЕННЕГО АУДИТА"
              startedAt={config.documentDate}
              finishedAt={null}
            />
            <div className="grid gap-2 text-[18px]">
                <div><span className="font-semibold">Дата:</span> {config.documentDate}</div>
                <div><span className="font-semibold">Основание проверки:</span> {config.basisTitle}</div>
                <div><span className="font-semibold">Проверяемый объект:</span> {config.auditedObject}</div>
                {/* Откуда взяты требования: видно и в печати, и на экране.
                    Ссылка ведёт в сам документ плана. */}
                {config.sourcePlanDocumentId ? (
                  <div>
                    <span className="font-semibold">Составлен по плану:</span>{" "}
                    <Link
                      href={`/journals/${AUDIT_PLAN_TEMPLATE_CODE}/documents/${config.sourcePlanDocumentId}`}
                      className="inline-flex items-center gap-1 text-[#5566f6] underline-offset-2 transition-colors duration-150 hover:text-[#4a5bf0] hover:underline print:text-black print:no-underline"
                    >
                      {config.sourcePlanTitle || "план аудитов"}
                      <ExternalLink className="size-4 print:hidden" />
                    </Link>
                  </div>
                ) : null}
              </div>
            </>
          }
          toolbar={
            status === "active" ? (
              <>
                <Button className="h-9 rounded-xl bg-[#5563ff] px-3.5 text-[13.5px] text-white hover:bg-[#4554ff]" onClick={() => { setEditingRow(null); setRowOpen(true); }}>
                  <Plus className="size-5" /> Добавить строку
                </Button>
                <Button className="h-9 rounded-xl bg-[#5563ff] px-3.5 text-[13.5px] text-white hover:bg-[#4554ff]" onClick={() => setSectionOpen(true)}>
                  <Plus className="size-5" /> Добавить новый раздел
                </Button>
                <FillFromPlanButton
                  plans={planSources}
                  onPick={(plan) => void fillFromPlan(plan)}
                />
              </>
            ) : undefined
          }
          extra={
            <div className={`${DOC_EXTRA_BLOCK_CLASS} space-y-3`}>
              <div className="text-[20px] font-semibold">Подписи</div>
              {config.signatures.map((signature, index) => (
                <div key={signature.id} className="grid grid-cols-1 gap-3 sm:grid-cols-[220px_1fr_240px]">
                  <Input value={signature.role} disabled={status !== "active"} onChange={(e) => setConfig((current) => ({ ...current, signatures: current.signatures.map((item, idx) => idx === index ? { ...item, role: e.target.value } : item) }))} onBlur={() => saveSignature(index, config.signatures[index]).catch((error) => toast.error(humanizeFetchError(error, "Ошибка сохранения")))} className="h-12 rounded-xl border-[#d8dae6] px-4 text-[16px]" />
                  <Input value={signature.name} disabled={status !== "active"} onChange={(e) => setConfig((current) => ({ ...current, signatures: current.signatures.map((item, idx) => idx === index ? { ...item, name: e.target.value } : item) }))} onBlur={() => saveSignature(index, config.signatures[index]).catch((error) => toast.error(humanizeFetchError(error, "Ошибка сохранения")))} className="h-12 rounded-xl border-[#d8dae6] px-4 text-[16px]" />
                  <Input type="date" value={signature.signedAt} disabled={status !== "active"} onChange={(e) => setConfig((current) => ({ ...current, signatures: current.signatures.map((item, idx) => idx === index ? { ...item, signedAt: e.target.value } : item) }))} onBlur={() => saveSignature(index, config.signatures[index]).catch((error) => toast.error(humanizeFetchError(error, "Ошибка сохранения")))} className="h-12 rounded-xl border-[#d8dae6] px-4 text-[16px]" />
                </div>
              ))}
              {status === "active" && (
                <Button type="button" variant="outline" onClick={() => persist(documentTitle, { ...config, signatures: [...config.signatures, createAuditProtocolSignature()] }).catch((error) => toast.error(humanizeFetchError(error, "Ошибка сохранения")))}>
                  Добавить подпись
                </Button>
              )}
            </div>
          }
        >
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className={`w-14 ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight print:hidden`}>
                  <Checkbox checked={allSelected} onCheckedChange={(checked) => setSelectedRowIds(checked === true ? config.rows.map((row) => row.id) : [])} disabled={status !== "active"} />
                </th>
                <th className={`w-[60px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>№ п/п</th>
                <th className={`min-w-[520px] ${GRID_HEAD_CELL_CLASS} px-3 py-1.5 font-semibold leading-tight`}>Требования</th>
                <th className={`w-[110px] ${GRID_HEAD_CELL_CLASS} px-3 py-1.5 font-semibold leading-tight`}>Да (+)</th>
                <th className={`w-[110px] ${GRID_HEAD_CELL_CLASS} px-3 py-1.5 font-semibold leading-tight`}>Нет (-)</th>
                <th className={`min-w-[260px] ${GRID_HEAD_CELL_CLASS} px-3 py-1.5 font-semibold leading-tight`}>Примечания</th>
              </tr>
            </thead>
            <tbody>
              {rowsBySection.map(({ section, rows }) => (
                <Fragment key={section.id}>
                  <tr>
                    <td colSpan={6} className={`${GRID_CELL_CLASS} px-3 py-1 text-center font-semibold leading-tight`}>{section.title}</td>
                  </tr>
                  {rows.map((row) => {
                    const rowNumber = config.rows.findIndex((item) => item.id === row.id) + 1;
                    return (
                      <tr key={row.id}>
                        <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight print:hidden`}>
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
                        <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{rowNumber}</td>
                        <td className={`${GRID_CELL_CLASS} px-3 py-1 leading-tight`}>
                          <button type="button" disabled={status !== "active"} className="w-full text-left disabled:cursor-default" onClick={() => { if (status !== "active") return; setEditingRow(row); setRowOpen(true); }}>
                            {row.text}
                          </button>
                        </td>
                        <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>
                          <Checkbox checked={row.result === "yes"} disabled={status !== "active"} onCheckedChange={() => toggleRowResult(row.id, "yes")} />
                        </td>
                        <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>
                          <Checkbox checked={row.result === "no"} disabled={status !== "active"} onCheckedChange={() => toggleRowResult(row.id, "no")} />
                        </td>
                        <td className={`${GRID_CELL_CLASS} px-2 py-1 leading-tight`}>
                          {status === "active" ? (
                            <Textarea value={row.note} onChange={(event) => setConfig((current) => ({ ...current, rows: current.rows.map((item) => item.id === row.id ? { ...item, note: event.target.value } : item) }))} onBlur={() => persist(documentTitle, config).catch((error) => toast.error(humanizeFetchError(error, "Ошибка сохранения")))} className="min-h-[70px] border-0 px-0 py-0 text-[14px] shadow-none focus-visible:ring-0" />
                          ) : (
                            row.note
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
              {status === "active" ? (
                <JournalAddRow
                  // Галочка + № п/п — leading, «Требования» (широкая
                  // колонка) — под подпись, «Да/Нет/Примечания» остаются
                  // пустыми ячейками.
                  leading={2}
                  labelSpan={1}
                  trailing={3}
                  label="Добавить строку"
                  onClick={() => {
                    setEditingRow(null);
                    setRowOpen(true);
                  }}
                />
              ) : null}
            </tbody>
          </table>
        </JournalDocumentShell>
      </div>

      {useV2 ? (
        <JournalSettingsModal
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          title="Настройки документа"
          description="Параметры протокола внутреннего аудита"
          size="md"
          onSave={async () => {
            await saveSettings(documentTitle.trim() || AUDIT_PROTOCOL_DOCUMENT_TITLE, config);
            setSettingsOpen(false);
          }}
          onCancel={() => setSettingsOpen(false)}
        >
          <div className="space-y-5">
            <div className="space-y-2">
              <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">Название документа</Label>
              <Input
                value={documentTitle}
                onChange={(e) => setDocumentTitle(e.target.value)}
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">Дата документа</Label>
              <Input
                type="date"
                value={config.documentDate}
                onChange={(e) => setConfig({ ...config, documentDate: e.target.value })}
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">Основание проверки</Label>
              <Input
                value={config.basisTitle}
                onChange={(e) => setConfig({ ...config, basisTitle: e.target.value })}
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">Проверяемый объект</Label>
              <Input
                value={config.auditedObject}
                onChange={(e) => setConfig({ ...config, auditedObject: e.target.value })}
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
              />
            </div>
          </div>
        </JournalSettingsModal>
      ) : (
        <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DialogContent className="max-w-[calc(100vw-1rem)] rounded-[28px] border-0 p-0 sm:max-w-[760px]">
            <DialogHeader className="border-b px-8 py-6">
              <DialogTitle className="text-[22px] font-semibold text-black">Настройки документа</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 px-8 py-6">
              <div className="space-y-2">
                <Label className="text-[14px] text-[#73738a]">Название документа</Label>
                <Input value={documentTitle} onChange={(e) => setDocumentTitle(e.target.value)} className="h-10 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]" />
              </div>
              <div className="space-y-2">
                <Label className="text-[14px] text-[#73738a]">Дата документа</Label>
                <Input type="date" value={config.documentDate} onChange={(e) => setConfig({ ...config, documentDate: e.target.value })} className="h-10 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]" />
              </div>
              <div className="space-y-2">
                <Label className="text-[14px] text-[#73738a]">Основание проверки</Label>
                <Input value={config.basisTitle} onChange={(e) => setConfig({ ...config, basisTitle: e.target.value })} className="h-10 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]" />
              </div>
              <div className="space-y-2">
                <Label className="text-[14px] text-[#73738a]">Проверяемый объект</Label>
                <Input value={config.auditedObject} onChange={(e) => setConfig({ ...config, auditedObject: e.target.value })} className="h-10 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]" />
              </div>
              <div className="flex justify-end">
                <Button type="button" onClick={async () => { await saveSettings(documentTitle.trim() || AUDIT_PROTOCOL_DOCUMENT_TITLE, config); setSettingsOpen(false); }} className="h-9 rounded-xl bg-[#5563ff] px-3.5 text-[13.5px] text-white hover:bg-[#4554ff]">
                  Сохранить
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      <SectionDialog open={sectionOpen} onOpenChange={setSectionOpen} onCreate={addSection} />
      {rowOpen && (
        <RowDialog
          key={editingRow?.id || `new-${config.sections[0]?.id || "empty"}`}
          open={rowOpen}
          onOpenChange={(open) => {
            if (open) {
              setRowOpen(true);
              return;
            }
            if (rowSavedRef.current) {
              rowSavedRef.current = false;
              return;
            }
            seq.cancelled();
          }}
          sections={config.sections}
          row={editingRow}
          titleSuffix={seq.progress ?? undefined}
          onSave={saveRow}
        />
      )}
    </>
  );
}
