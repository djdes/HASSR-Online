"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Archive, ExternalLink, FileCheck2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  AUDIT_REPORT_DOCUMENT_TITLE,
  createAuditReportFinding,
  createAuditReportSignature,
  importAuditReportFindingsFromProtocol,
  normalizeAuditReportConfig,
  type AuditReportConfig,
  type AuditReportFinding,
  type AuditReportProtocolSource,
} from "@/lib/audit-report-document";
import { AUDIT_PROTOCOL_TEMPLATE_CODE } from "@/lib/audit-protocol-document";
import { ResponsiveMenu } from "@/components/ui/responsive-menu";
import { confirmAsync } from "@/components/ui/confirm-async";
import { DOC_PRIMARY_BUTTON_CLASS } from "@/components/journals/journal-responsive";
import { JournalDocumentShell } from "@/components/journals/journal-document-shell";
import { JournalDocumentHeader } from "@/components/journals/journal-document-header";
import { FocusTodayScroller } from "@/components/journals/focus-today-scroller";
import { useDocumentCloseAction } from "@/components/journals/document-close-button";
import { JournalSettingsModal } from "@/components/journals/v2/journal-settings-modal";

import { toast } from "sonner";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";
type Props = {
  documentId: string;
  title: string;
  organizationName: string;
  status: string;
  config: unknown;
  /**
   * Протоколы аудита организации — источник для «Перенести
   * несоответствия». Пусто ⇒ кнопка не показывается.
   */
  protocolSources?: AuditReportProtocolSource[];
  /** Design v2 toggle. */
  useV2?: boolean;
};

/**
 * «Перенести несоответствия из протокола»: выбор протокола списком в
 * стиле проекта (на телефоне — лист снизу), рядом — сколько «Нет» в нём.
 */
function ImportFromProtocolButton({
  protocols,
  onPick,
}: {
  protocols: AuditReportProtocolSource[];
  onPick: (protocol: AuditReportProtocolSource) => void;
}) {
  const withFindings = protocols.filter((item) => item.rows.length > 0);
  if (withFindings.length === 0) return null;
  return (
    <ResponsiveMenu
      title="Из какого протокола перенести"
      contentClassName="w-[360px] rounded-[22px] border-0 p-3 shadow-xl"
      items={withFindings.map((protocol) => ({
        key: protocol.documentId,
        label: `${protocol.title} · несоответствий: ${protocol.rows.length}`,
        icon: <FileCheck2 className="size-4 text-[#6f7282]" />,
        onSelect: () => onPick(protocol),
      }))}
      trigger={
        <Button
          type="button"
          variant="outline"
          className="h-11 rounded-xl border-[#dcdfed] px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
        >
          <FileCheck2 className="size-4 text-[#5566f6]" />
          Перенести несоответствия из протокола
        </Button>
      }
    />
  );
}

function FindingDialog({
  open,
  onOpenChange,
  finding,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finding: AuditReportFinding | null;
  onSave: (finding: AuditReportFinding) => Promise<void>;
}) {
  const [draft, setDraft] = useState<AuditReportFinding>(
    finding || createAuditReportFinding()
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] supports-[height:100dvh]:max-h-[92dvh] w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-[32px] border-0 p-0 sm:max-w-[920px]">
        <DialogHeader className="border-b px-12 py-10">
          <DialogTitle className="text-[22px] font-medium text-black">
            {finding ? "Редактирование несоответствия" : "Добавить несоответствие"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-5 px-12 py-10">
          <Textarea value={draft.nonConformity} onChange={(e) => setDraft({ ...draft, nonConformity: e.target.value })} placeholder="Описание несоответствия" className="min-h-[120px] rounded-[18px] border-[#dfe1ec] px-5 py-4 text-[18px]" />
          <Textarea value={draft.correctionActions} onChange={(e) => setDraft({ ...draft, correctionActions: e.target.value })} placeholder="Коррекция, описание действий" className="min-h-[120px] rounded-[18px] border-[#dfe1ec] px-5 py-4 text-[18px]" />
          <Textarea value={draft.correctiveActions} onChange={(e) => setDraft({ ...draft, correctiveActions: e.target.value })} placeholder="Корректирующие действия" className="min-h-[120px] rounded-[18px] border-[#dfe1ec] px-5 py-4 text-[18px]" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5">
            <Input value={draft.responsibleName} onChange={(e) => setDraft({ ...draft, responsibleName: e.target.value })} placeholder="ФИО ответственного" className="h-10 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]" />
            <Input value={draft.responsiblePosition} onChange={(e) => setDraft({ ...draft, responsiblePosition: e.target.value })} placeholder="Должность ответственного" className="h-10 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]" />
            <Input type="date" value={draft.dueDatePlan} onChange={(e) => setDraft({ ...draft, dueDatePlan: e.target.value })} className="h-10 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]" />
            <Input type="date" value={draft.dueDateFact} onChange={(e) => setDraft({ ...draft, dueDateFact: e.target.value })} className="h-10 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]" />
          </div>
          <div className="flex justify-end">
            <Button type="button" onClick={async () => { await onSave(draft); onOpenChange(false); }} className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] text-white hover:bg-[#4b57ff]">
              Сохранить
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AuditReportDocumentClient({
  documentId,
  title,
  organizationName,
  status,
  config: initialConfig,
  protocolSources = [],
  useV2 = false,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [documentTitle, setDocumentTitle] = useState(title || AUDIT_REPORT_DOCUMENT_TITLE);
  const [config, setConfig] = useState(() => normalizeAuditReportConfig(initialConfig));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [findingOpen, setFindingOpen] = useState(false);
  const [editingFinding, setEditingFinding] = useState<AuditReportFinding | null>(null);
  const closeAction = useDocumentCloseAction({ documentId, title: documentTitle });

  useEffect(() => {
    setConfig(normalizeAuditReportConfig(initialConfig));
  }, [initialConfig]);

  useEffect(() => {
    setDocumentTitle(title || AUDIT_REPORT_DOCUMENT_TITLE);
  }, [title]);

  async function persist(nextTitle: string, nextConfig: AuditReportConfig, patch?: Record<string, unknown>) {
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

  async function saveFinding(finding: AuditReportFinding) {
    const findings = editingFinding
      ? config.findings.map((item) => (item.id === editingFinding.id ? finding : item))
      : [...config.findings, finding];
    await persist(documentTitle, { ...config, findings });
    setEditingFinding(null);
  }

  /**
   * Перенос несоответствий из протокола. Копия: текст живёт в отчёте
   * дальше сам по себе, повторный перенос дублей не создаёт.
   */
  async function importFromProtocol(protocol: AuditReportProtocolSource) {
    const preview = importAuditReportFindingsFromProtocol(config, protocol);
    if (preview.added === 0) {
      toast.info("Все несоответствия этого протокола уже перенесены");
      return;
    }

    const ok = await confirmAsync({
      title: "Перенести несоответствия?",
      description: `Протокол: «${protocol.title}».`,
      variant: "info",
      confirmLabel: "Перенести",
      bullets: [
        { label: `Добавится несоответствий: ${preview.added}`, tone: "info" },
        ...(preview.skipped > 0
          ? [{ label: `Уже перенесено ранее: ${preview.skipped}`, tone: "info" as const }]
          : []),
        { label: "Переносятся только строки с результатом «Нет»" },
        { label: "Это копия: правка протокола задним числом отчёт не изменит" },
      ],
    });
    if (!ok) return;

    try {
      await persist(documentTitle, preview.config);
      toast.success(`Перенесено несоответствий: ${preview.added}`);
    } catch (error) {
      toast.error(humanizeFetchError(error, "Ошибка сохранения"));
    }
  }

  async function deleteFinding(findingId: string) {
    await persist(documentTitle, {
      ...config,
      findings: config.findings.filter((item) => item.id !== findingId),
    });
    if (editingFinding?.id === findingId) {
      setEditingFinding(null);
      setFindingOpen(false);
    }
  }

  return (
    <>
      <FocusTodayScroller selector="[data-focus-today]" emptyTitle="Записей пока нет" emptyBody="Нажмите «Добавить» в таблице ниже, чтобы создать запись." />
      <JournalDocumentShell
        title={documentTitle}
        documentId={documentId}
        backHref="/journals/audit_report"
        onSettings={status === "active" ? () => setSettingsOpen(true) : undefined}
        closed={status !== "active"}
        closedHint="Откройте журнал заново, чтобы редактировать отчёт."
        menuItems={
          status === "active"
            ? [
                {
                  key: "close-journal",
                  label: "Закончить журнал",
                  icon: <Archive className="size-4" />,
                  onSelect: () => void closeAction.closeDocument(),
                },
              ]
            : []
        }
        paperHeader={
          // На телефоне бумажная шапка уезжала за правый край — она
          // шире экрана. На компьютере и в печати остаётся.
          <div className="max-sm:hidden print:block">
            <JournalDocumentHeader
              orgName={organizationName}
              title="ОТЧЕТ О ВНУТРЕННЕМ АУДИТЕ"
              startedAt={config.documentDate}
              finishedAt={null}
            />
          </div>
        }
      >
        {/* `max-sm:px-4` — бумажное полотно отчёта на телефоне идёт в край
            экрана (общее правило для листов с таблицей), а текст и поля
            ввода отчёта должны стоять по обычным полям страницы. */}
        <section className="space-y-6 max-sm:px-4 print:p-0">
          <div className="grid gap-3 text-[18px]">
            <div><span className="font-semibold">Дата аудита:</span> {config.documentDate}</div>
            <div><span className="font-semibold">Основание:</span> {config.basisTitle}</div>
            <div><span className="font-semibold">Объект аудита:</span> {config.auditedObject}</div>
            <div><span className="font-semibold">Тип проверки:</span> {config.auditType === "planned" ? "Плановая" : "Внеплановая"}</div>
            <div><span className="font-semibold">Аудиторы:</span> {config.auditors.join(", ")}</div>
            {/* Откуда взяты несоответствия — ссылка в сам протокол. */}
            {config.sourceProtocolDocumentId ? (
              <div>
                <span className="font-semibold">По протоколу:</span>{" "}
                <Link
                  href={`/journals/${AUDIT_PROTOCOL_TEMPLATE_CODE}/documents/${config.sourceProtocolDocumentId}`}
                  className="inline-flex items-center gap-1 text-[#5566f6] underline-offset-2 transition-colors duration-150 hover:text-[#4a5bf0] hover:underline print:text-black print:no-underline"
                >
                  {config.sourceProtocolTitle || "протокол аудита"}
                  <ExternalLink className="size-4 print:hidden" />
                </Link>
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <div className="text-[24px] font-semibold">Результаты аудита</div>
            {status === "active" ? (
              <Textarea value={config.summary} onChange={(e) => setConfig({ ...config, summary: e.target.value })} onBlur={() => persist(documentTitle, config).catch((error) => toast.error(humanizeFetchError(error, "Ошибка сохранения")))} className="min-h-[140px] rounded-[18px] border-[#dfe1ec] px-5 py-4 text-[18px]" />
            ) : (
              <div className="whitespace-pre-wrap text-[18px]">{config.summary}</div>
            )}
          </div>

          {status === "active" && (
            <div className="flex flex-wrap gap-3 print:hidden">
              <Button type="button" onClick={() => { setEditingFinding(null); setFindingOpen(true); }} className={DOC_PRIMARY_BUTTON_CLASS}>
                <Plus className="size-5" />
                Добавить несоответствие
              </Button>
              <ImportFromProtocolButton
                protocols={protocolSources}
                onPick={(protocol) => void importFromProtocol(protocol)}
              />
            </div>
          )}

          <div className="space-y-5">
            {config.findings.map((finding, index) => (
              <div key={finding.id} className="rounded-[18px] border border-black/70">
                <div className="border-b border-black/70 px-5 py-4 text-[20px] font-semibold">
                  Несоответствие #{index + 1}
                </div>
                {status === "active" ? (
                  <div className="border-b border-black/70 px-5 py-3">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 rounded-xl border-[#ffd7d3] px-4 text-[14px] text-[#ff3b30] hover:bg-[#fff3f2]"
                      onClick={() =>
                        deleteFinding(finding.id).catch((error) =>
                          toast.error(humanizeFetchError(error, "Ошибка удаления"))
                        )
                      }
                    >
                      Удалить
                    </Button>
                  </div>
                ) : null}
                <div className="grid gap-0 text-[16px]">
                  {[
                    ["Описание несоответствия", finding.nonConformity],
                    ["Коррекция, описание действий", finding.correctionActions],
                    ["Корректирующие действия", finding.correctiveActions],
                    ["Ответственный", `${finding.responsibleName}${finding.responsiblePosition ? `, ${finding.responsiblePosition}` : ""}`],
                    ["Дата завершения КД: план / факт", `${finding.dueDatePlan || "—"} / ${finding.dueDateFact || "—"}`],
                  ].map(([label, value], rowIndex) => (
                    <div key={`${finding.id}-${rowIndex}`} className="grid grid-cols-1 gap-2 sm:grid-cols-[280px_1fr] border-t border-black/70 first:border-t-0">
                      <div className="border-r border-black/70 px-5 py-4 font-medium">{label}</div>
                      <button
                        type="button"
                        disabled={status !== "active"}
                        onClick={() => {
                          if (status !== "active") return;
                          setEditingFinding(finding);
                          setFindingOpen(true);
                        }}
                        className="px-5 py-4 text-left whitespace-pre-wrap disabled:cursor-default"
                      >
                        {value || "—"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <div className="text-[24px] font-semibold">Рекомендации и наблюдения</div>
            {status === "active" ? (
              <Textarea value={config.recommendations} onChange={(e) => setConfig({ ...config, recommendations: e.target.value })} onBlur={() => persist(documentTitle, config).catch((error) => toast.error(humanizeFetchError(error, "Ошибка сохранения")))} className="min-h-[140px] rounded-[18px] border-[#dfe1ec] px-5 py-4 text-[18px]" />
            ) : (
              <div className="whitespace-pre-wrap text-[18px]">{config.recommendations}</div>
            )}
          </div>

          <div className="space-y-3">
            <div className="text-[24px] font-semibold">Подписи</div>
            {config.signatures.map((signature, index) => (
              <div key={signature.id} className="grid grid-cols-1 gap-3 sm:grid-cols-[180px_1fr_220px_180px]">
                <Input value={signature.role} disabled={status !== "active"} onChange={(e) => setConfig((current) => ({ ...current, signatures: current.signatures.map((item, idx) => idx === index ? { ...item, role: e.target.value } : item) }))} onBlur={() => persist(documentTitle, config).catch((error) => toast.error(humanizeFetchError(error, "Ошибка сохранения")))} className="h-12 rounded-xl border-[#d8dae6] px-4 text-[16px]" />
                <Input value={signature.name} disabled={status !== "active"} onChange={(e) => setConfig((current) => ({ ...current, signatures: current.signatures.map((item, idx) => idx === index ? { ...item, name: e.target.value } : item) }))} onBlur={() => persist(documentTitle, config).catch((error) => toast.error(humanizeFetchError(error, "Ошибка сохранения")))} className="h-12 rounded-xl border-[#d8dae6] px-4 text-[16px]" />
                <Input value={signature.position} disabled={status !== "active"} onChange={(e) => setConfig((current) => ({ ...current, signatures: current.signatures.map((item, idx) => idx === index ? { ...item, position: e.target.value } : item) }))} onBlur={() => persist(documentTitle, config).catch((error) => toast.error(humanizeFetchError(error, "Ошибка сохранения")))} className="h-12 rounded-xl border-[#d8dae6] px-4 text-[16px]" />
                <Input type="date" value={signature.signedAt} disabled={status !== "active"} onChange={(e) => setConfig((current) => ({ ...current, signatures: current.signatures.map((item, idx) => idx === index ? { ...item, signedAt: e.target.value } : item) }))} onBlur={() => persist(documentTitle, config).catch((error) => toast.error(humanizeFetchError(error, "Ошибка сохранения")))} className="h-12 rounded-xl border-[#d8dae6] px-4 text-[16px]" />
              </div>
            ))}
            {status === "active" && (
              <Button type="button" variant="outline" disabled={isPending} onClick={() => persist(documentTitle, { ...config, signatures: [...config.signatures, createAuditReportSignature()] }).catch((error) => toast.error(humanizeFetchError(error, "Ошибка сохранения")))}>
                Добавить подпись
              </Button>
            )}
          </div>
        </section>
      </JournalDocumentShell>

      {useV2 ? (
        <JournalSettingsModal
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          title="Настройки документа"
          description="Параметры отчёта о внутреннем аудите"
          size="md"
          onSave={async () => {
            await persist(documentTitle.trim() || AUDIT_REPORT_DOCUMENT_TITLE, config);
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
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
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
                <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">Тип проверки</Label>
                <Select value={config.auditType} onValueChange={(value: "planned" | "unplanned") => setConfig({ ...config, auditType: value })}>
                  <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-white px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="planned">Плановая</SelectItem>
                    <SelectItem value="unplanned">Внеплановая</SelectItem>
                  </SelectContent>
                </Select>
              </div>
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
              <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">Объект аудита</Label>
              <Input
                value={config.auditedObject}
                onChange={(e) => setConfig({ ...config, auditedObject: e.target.value })}
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">Аудиторы (через запятую)</Label>
              <Input
                value={config.auditors.join(", ")}
                onChange={(e) => setConfig({ ...config, auditors: e.target.value.split(",").map((item) => item.trim()).filter(Boolean) })}
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
              />
            </div>
          </div>
        </JournalSettingsModal>
      ) : (
        <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DialogContent className="max-w-[calc(100vw-1rem)] rounded-[32px] border-0 p-0 sm:max-w-[760px]">
            <DialogHeader className="border-b px-12 py-10">
              <DialogTitle className="text-[22px] font-medium text-black">Настройки документа</DialogTitle>
            </DialogHeader>
            <div className="space-y-5 px-12 py-10">
              <div className="space-y-3">
                <Label className="text-[14px] text-[#73738a]">Название документа</Label>
                <Input value={documentTitle} onChange={(e) => setDocumentTitle(e.target.value)} className="h-10 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]" />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5">
                <Input type="date" value={config.documentDate} onChange={(e) => setConfig({ ...config, documentDate: e.target.value })} className="h-10 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]" />
                <Select value={config.auditType} onValueChange={(value: "planned" | "unplanned") => setConfig({ ...config, auditType: value })}>
                  <SelectTrigger className="h-10 rounded-xl border-[#dfe1ec] bg-[#f5f6fb] px-3.5 text-[13.5px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="planned">Плановая</SelectItem>
                    <SelectItem value="unplanned">Внеплановая</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Input value={config.basisTitle} onChange={(e) => setConfig({ ...config, basisTitle: e.target.value })} placeholder="Основание проверки" className="h-10 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]" />
              <Input value={config.auditedObject} onChange={(e) => setConfig({ ...config, auditedObject: e.target.value })} placeholder="Объект аудита" className="h-10 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]" />
              <Input value={config.auditors.join(", ")} onChange={(e) => setConfig({ ...config, auditors: e.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} placeholder="Аудиторы через запятую" className="h-10 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]" />
              <div className="flex justify-end">
                <Button type="button" onClick={async () => { await persist(documentTitle.trim() || AUDIT_REPORT_DOCUMENT_TITLE, config); setSettingsOpen(false); }} className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] text-white hover:bg-[#4b57ff]">
                  Сохранить
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {findingOpen && (
        <FindingDialog
          key={editingFinding?.id || "new-finding"}
          open={findingOpen}
          onOpenChange={(open) => {
            setFindingOpen(open);
            if (!open) setEditingFinding(null);
          }}
          finding={editingFinding}
          onSave={saveFinding}
        />
      )}
    </>
  );
}
