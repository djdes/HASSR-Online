"use client";

import { useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { auditReportText, presentAuditReportTitle, createAuditReportFailureRegistry } from "@/lib/audit-report-presentation";
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
function useAuditReportCopy() {
  const text = useTranslations();
  const locale = useLocale();
  const committed = useRef({ text, locale });
  useLayoutEffect(() => { committed.current = { text, locale }; });
  return { text, locale, committed };
}

type PresentedProtocolSource = AuditReportProtocolSource & { displayTitleMissing?: boolean };

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
  protocolSources?: PresentedProtocolSource[];
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
  protocols: PresentedProtocolSource[];
  onPick: (protocol: PresentedProtocolSource) => void;
}) {
  const { text } = useAuditReportCopy();
  const withFindings = protocols.filter((item) => item.rows.length > 0);
  if (withFindings.length === 0) return null;
  return (
    <ResponsiveMenu
      title={text("journalAuditReport.chooseProtocol")}
      contentClassName="w-[360px] rounded-[22px] border-0 p-3 shadow-xl"
      items={withFindings.map((protocol) => ({
        key: protocol.documentId,
        label: text("journalAuditReport.protocolItem", { title: auditReportText(presentAuditReportTitle(protocol.title, protocol.displayTitleMissing, text("auditTraceabilityPdf.protocolTitle"))), count: auditReportText(protocol.rows.length) }),
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
          {text("journalAuditReport.importProtocol")}
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
  const { text } = useAuditReportCopy();
  const [draft, setDraft] = useState<AuditReportFinding>(
    finding || createAuditReportFinding()
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={text("common.close")} className="max-h-[92vh] supports-[height:100dvh]:max-h-[92dvh] w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-[32px] border-0 p-0 sm:max-w-[920px]">
        <DialogHeader className="border-b px-12 py-10">
          <DialogTitle className="text-[22px] font-medium text-black">
            {finding ? text("journalAuditReport.editFinding") : text("journalAuditReport.addFinding")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-5 px-12 py-10">
          <Textarea value={draft.nonConformity} onChange={(e) => setDraft({ ...draft, nonConformity: e.target.value })} placeholder={text("journalAuditReport.findingDescription")} className="min-h-[120px] rounded-[18px] border-[#dfe1ec] px-5 py-4 text-[18px]" />
          <Textarea value={draft.correctionActions} onChange={(e) => setDraft({ ...draft, correctionActions: e.target.value })} placeholder={text("journalAuditReport.correctionDescription")} className="min-h-[120px] rounded-[18px] border-[#dfe1ec] px-5 py-4 text-[18px]" />
          <Textarea value={draft.correctiveActions} onChange={(e) => setDraft({ ...draft, correctiveActions: e.target.value })} placeholder={text("auditTraceabilityPdf.corrective")} className="min-h-[120px] rounded-[18px] border-[#dfe1ec] px-5 py-4 text-[18px]" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5">
            <Input value={draft.responsibleName} onChange={(e) => setDraft({ ...draft, responsibleName: e.target.value })} placeholder={text("auditTraceabilityPdf.responsibleName")} className="h-10 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]" />
            <Input value={draft.responsiblePosition} onChange={(e) => setDraft({ ...draft, responsiblePosition: e.target.value })} placeholder={text("journalWidgets.staff.responsiblePosition")} className="h-10 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]" />
            <Input type="date" value={draft.dueDatePlan} aria-label={text("journalAuditReport.plannedCompletionDate")} onChange={(e) => setDraft({ ...draft, dueDatePlan: e.target.value })} className="h-10 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]" />
            <Input type="date" value={draft.dueDateFact} aria-label={text("journalAuditReport.actualCompletionDate")} onChange={(e) => setDraft({ ...draft, dueDateFact: e.target.value })} className="h-10 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]" />
          </div>
          <div className="flex justify-end">
            <Button type="button" onClick={async () => { await onSave(draft); onOpenChange(false); }} className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] text-white hover:bg-[#4b57ff]">
              {text("common.save")}
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
  const { text, committed } = useAuditReportCopy();
  const closeCopy = useTranslations("journalControls.closeDocument");
  const [failureRegistry] = useState(createAuditReportFailureRegistry);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [documentTitle, setDocumentTitle] = useState(title || AUDIT_REPORT_DOCUMENT_TITLE);
  const [titleIsFallback, setTitleIsFallback] = useState(!title);
  const displayTitle = titleIsFallback ? text("auditTraceabilityPdf.reportTitle") : documentTitle;
  function editDocumentTitle(value: string) { setDocumentTitle(value); setTitleIsFallback(false); }
  const [config, setConfig] = useState(() => normalizeAuditReportConfig(initialConfig));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [findingOpen, setFindingOpen] = useState(false);
  const [editingFinding, setEditingFinding] = useState<AuditReportFinding | null>(null);
  const closeAction = useDocumentCloseAction({ documentId, title: documentTitle, confirmMessage: closeCopy("confirmTitle", { title: displayTitle }) });

  const previousServerConfig = useRef<{ documentId: string; serialized: string | undefined } | null>(null);
  useEffect(() => {
    // A language refresh reserializes the same server JSON; retain unsaved local edits.
    const serialized = JSON.stringify(initialConfig);
    const previous = previousServerConfig.current;
    if (previous?.documentId === documentId && previous.serialized === serialized) return;
    previousServerConfig.current = { documentId, serialized };
    setConfig(normalizeAuditReportConfig(initialConfig));
  }, [documentId, initialConfig]);

  useEffect(() => {
    setDocumentTitle(title || AUDIT_REPORT_DOCUMENT_TITLE);
    setTitleIsFallback(!title);
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
    if (!response.ok) {
      const failure = result?.error;
      const error = new Error(failure || "Не удалось сохранить документ");
      if (!failure) failureRegistry.mark(error);
      throw error;
    }
    setDocumentTitle(nextTitle);
    setTitleIsFallback(false);
    setConfig(nextConfig);
    startTransition(() => router.refresh());
  }

  function presentSaveError(error: unknown, fallback: "journalAuditReport.saveOperationFailed" | "journalAuditReport.deleteOperationFailed") {
    const current = committed.current;
    const displayed = humanizeFetchError(error, current.text(fallback), current.text("journalWidgets.headerEdit.networkError"));
    return failureRegistry.has(error) ? current.text("journalAuditReport.saveDocumentFailed") : displayed;
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
  async function importFromProtocol(protocol: PresentedProtocolSource) {
    const preview = importAuditReportFindingsFromProtocol(config, protocol);
    if (preview.added === 0) {
      toast.info(committed.current.text("journalAuditReport.allImported"));
      return;
    }

    const ok = await confirmAsync({
      locale: committed.current.locale,
      title: committed.current.text("journalAuditReport.confirmImport"),
      description: committed.current.text("journalAuditReport.protocolDescription", { title: auditReportText(presentAuditReportTitle(protocol.title, protocol.displayTitleMissing, committed.current.text("auditTraceabilityPdf.protocolTitle"))) }),
      variant: "info",
      confirmLabel: committed.current.text("journalAuditReport.importAction"),
      bullets: [
        { label: committed.current.text("journalAuditReport.willImport", { count: auditReportText(preview.added) }), tone: "info" },
        ...(preview.skipped > 0
          ? [{ label: committed.current.text("journalAuditReport.alreadyImportedCount", { count: auditReportText(preview.skipped) }), tone: "info" as const }]
          : []),
        { label: committed.current.text("journalAuditReport.onlyNoRows") },
        { label: committed.current.text("journalAuditReport.copyIndependent") },
      ],
    });
    if (!ok) return;

    try {
      await persist(documentTitle, preview.config);
      toast.success(committed.current.text("journalAuditReport.importedCount", { count: auditReportText(preview.added) }));
    } catch (error) {
      toast.error(presentSaveError(error, "journalAuditReport.saveOperationFailed"));
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
      <FocusTodayScroller copy={{ noCreateBody: text("journalScan.focus.noCreateBody"), later: text("journalScan.focus.later"), close: text("common.close") }} selector="[data-focus-today]" emptyTitle={text("journalScan.focus.emptyTitle")} emptyBody={text("journalScan.focus.emptyBody")} />
      <JournalDocumentShell
        title={<>{displayTitle}</>}
        documentId={documentId}
        backHref="/journals/audit_report"
        onSettings={status === "active" ? () => setSettingsOpen(true) : undefined}
        closed={status !== "active"}
        closedHint={text("journalAuditReport.closedHint")}
        menuItems={
          status === "active"
            ? [
                {
                  key: "close-journal",
                  label: text("journalControls.closeDocument.close"),
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
              title={text("journalAuditReport.paperHeading")}
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
            <div><span className="font-semibold">{text("journalAuditReport.auditDateLabel")}</span> {config.documentDate}</div>
            <div><span className="font-semibold">{text("journalAuditReport.basisLabel")}</span> {config.basisTitle}</div>
            <div><span className="font-semibold">{text("journalAuditReport.auditedObjectLabel")}</span> {config.auditedObject}</div>
            <div><span className="font-semibold">{text("journalAuditReport.auditTypeLabel")}</span> {config.auditType === "planned" ? text("journalAuditReport.planned") : text("journalAuditReport.unplanned")}</div>
            <div><span className="font-semibold">{text("journalAuditReport.auditorsLabel")}</span> {config.auditors.join(", ")}</div>
            {/* Откуда взяты несоответствия — ссылка в сам протокол. */}
            {config.sourceProtocolDocumentId ? (
              <div>
                <span className="font-semibold">{text("journalAuditReport.sourceProtocolLabel")}</span>{" "}
                <Link
                  href={`/journals/${AUDIT_PROTOCOL_TEMPLATE_CODE}/documents/${config.sourceProtocolDocumentId}`}
                  className="inline-flex items-center gap-1 text-[#5566f6] underline-offset-2 transition-colors duration-150 hover:text-[#4a5bf0] hover:underline print:text-black print:no-underline"
                >
                  {config.sourceProtocolTitle || text("journalAuditReport.protocolFallback")}
                  <ExternalLink className="size-4 print:hidden" />
                </Link>
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <div className="text-[24px] font-semibold">{text("journalAuditReport.auditResults")}</div>
            {status === "active" ? (
              <Textarea value={config.summary} aria-label={text("journalAuditReport.auditResults")} onChange={(e) => setConfig({ ...config, summary: e.target.value })} onBlur={() => persist(documentTitle, config).catch((error) => toast.error(presentSaveError(error, "journalAuditReport.saveOperationFailed")))} className="min-h-[140px] rounded-[18px] border-[#dfe1ec] px-5 py-4 text-[18px]" />
            ) : (
              <div className="whitespace-pre-wrap text-[18px]">{config.summary}</div>
            )}
          </div>

          {status === "active" && (
            <div className="flex flex-wrap gap-3 print:hidden">
              <Button type="button" onClick={() => { setEditingFinding(null); setFindingOpen(true); }} className={DOC_PRIMARY_BUTTON_CLASS}>
                <Plus className="size-5" />
                {text("journalAuditReport.addFinding")}
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
                  {text("journalAuditReport.findingNumber", { number: auditReportText(index + 1) })}
                </div>
                {status === "active" ? (
                  <div className="border-b border-black/70 px-5 py-3">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 rounded-xl border-[#ffd7d3] px-4 text-[14px] text-[#ff3b30] hover:bg-[#fff3f2]"
                      onClick={() =>
                        deleteFinding(finding.id).catch((error) =>
                          toast.error(presentSaveError(error, "journalAuditReport.deleteOperationFailed"))
                        )
                      }
                    >
                      {text("common.delete")}
                    </Button>
                  </div>
                ) : null}
                <div className="grid gap-0 text-[16px]">
                  {[
                    [text("journalAuditReport.findingDescription"), finding.nonConformity],
                    [text("journalAuditReport.correctionDescription"), finding.correctionActions],
                    [text("auditTraceabilityPdf.corrective"), finding.correctiveActions],
                    [text("auditTraceabilityPdf.responsible"), `${finding.responsibleName}${finding.responsiblePosition ? `, ${finding.responsiblePosition}` : ""}`],
                    [text("journalAuditReport.completionPlanActual"), `${finding.dueDatePlan || "—"} / ${finding.dueDateFact || "—"}`],
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
            <div className="text-[24px] font-semibold">{text("journalAuditReport.recommendations")}</div>
            {status === "active" ? (
              <Textarea value={config.recommendations} aria-label={text("journalAuditReport.recommendations")} onChange={(e) => setConfig({ ...config, recommendations: e.target.value })} onBlur={() => persist(documentTitle, config).catch((error) => toast.error(presentSaveError(error, "journalAuditReport.saveOperationFailed")))} className="min-h-[140px] rounded-[18px] border-[#dfe1ec] px-5 py-4 text-[18px]" />
            ) : (
              <div className="whitespace-pre-wrap text-[18px]">{config.recommendations}</div>
            )}
          </div>

          <div className="space-y-3">
            <div className="text-[24px] font-semibold">{text("journalAuditReport.signatures")}</div>
            {config.signatures.map((signature, index) => (
              <div key={signature.id} className="grid grid-cols-1 gap-3 sm:grid-cols-[180px_1fr_220px_180px]">
                <Input value={signature.role} aria-label={text("journalAuditReport.signatureRole")} disabled={status !== "active"} onChange={(e) => setConfig((current) => ({ ...current, signatures: current.signatures.map((item, idx) => idx === index ? { ...item, role: e.target.value } : item) }))} onBlur={() => persist(documentTitle, config).catch((error) => toast.error(presentSaveError(error, "journalAuditReport.saveOperationFailed")))} className="h-12 rounded-xl border-[#d8dae6] px-4 text-[16px]" />
                <Input value={signature.name} aria-label={text("journalAuditReport.signatureName")} disabled={status !== "active"} onChange={(e) => setConfig((current) => ({ ...current, signatures: current.signatures.map((item, idx) => idx === index ? { ...item, name: e.target.value } : item) }))} onBlur={() => persist(documentTitle, config).catch((error) => toast.error(presentSaveError(error, "journalAuditReport.saveOperationFailed")))} className="h-12 rounded-xl border-[#d8dae6] px-4 text-[16px]" />
                <Input value={signature.position} aria-label={text("journalAuditReport.signaturePosition")} disabled={status !== "active"} onChange={(e) => setConfig((current) => ({ ...current, signatures: current.signatures.map((item, idx) => idx === index ? { ...item, position: e.target.value } : item) }))} onBlur={() => persist(documentTitle, config).catch((error) => toast.error(presentSaveError(error, "journalAuditReport.saveOperationFailed")))} className="h-12 rounded-xl border-[#d8dae6] px-4 text-[16px]" />
                <Input type="date" value={signature.signedAt} aria-label={text("journalAuditReport.signatureDate")} disabled={status !== "active"} onChange={(e) => setConfig((current) => ({ ...current, signatures: current.signatures.map((item, idx) => idx === index ? { ...item, signedAt: e.target.value } : item) }))} onBlur={() => persist(documentTitle, config).catch((error) => toast.error(presentSaveError(error, "journalAuditReport.saveOperationFailed")))} className="h-12 rounded-xl border-[#d8dae6] px-4 text-[16px]" />
              </div>
            ))}
            {status === "active" && (
              <Button type="button" variant="outline" disabled={isPending} onClick={() => persist(documentTitle, { ...config, signatures: [...config.signatures, createAuditReportSignature()] }).catch((error) => toast.error(presentSaveError(error, "journalAuditReport.saveOperationFailed")))}>
                {text("journalAuditReport.addSignature")}
              </Button>
            )}
          </div>
        </section>
      </JournalDocumentShell>

      {useV2 ? (
        <JournalSettingsModal
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          title={text("journalWidgets.staff.settings")}
          description={text("journalAuditReport.settingsDescription")}
          size="md"
          onSave={async () => {
            await persist(documentTitle.trim() || AUDIT_REPORT_DOCUMENT_TITLE, config);
            setSettingsOpen(false);
          }}
          onCancel={() => setSettingsOpen(false)}
        >
          <div className="space-y-5">
            <div className="space-y-2">
              <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">{text("journalWidgets.staff.documentName")}</Label>
              <Input
                value={documentTitle} aria-label={text("journalWidgets.staff.documentName")}
                onChange={(e) => editDocumentTitle(e.target.value)}
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
              />
            </div>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">{text("journalAuditReport.documentDate")}</Label>
                <Input
                  type="date"
                  value={config.documentDate} aria-label={text("journalAuditReport.documentDate")}
                  onChange={(e) => setConfig({ ...config, documentDate: e.target.value })}
                  className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">{text("journalAuditReport.auditType")}</Label>
                <Select value={config.auditType} onValueChange={(value: "planned" | "unplanned") => setConfig({ ...config, auditType: value })}>
                  <SelectTrigger aria-label={text("journalAuditReport.auditType")} className="h-10 rounded-xl border-[#dcdfed] bg-white px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="planned">{text("journalAuditReport.planned")}</SelectItem>
                    <SelectItem value="unplanned">{text("journalAuditReport.unplanned")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">{text("journalAuditReport.auditBasis")}</Label>
              <Input
                value={config.basisTitle} aria-label={text("journalAuditReport.auditBasis")}
                onChange={(e) => setConfig({ ...config, basisTitle: e.target.value })}
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">{text("journalAuditReport.auditedObject")}</Label>
              <Input
                value={config.auditedObject} aria-label={text("journalAuditReport.auditedObject")}
                onChange={(e) => setConfig({ ...config, auditedObject: e.target.value })}
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">{text("journalAuditReport.auditorsComma")}</Label>
              <Input
                value={config.auditors.join(", ")} aria-label={text("journalAuditReport.auditorsComma")}
                onChange={(e) => setConfig({ ...config, auditors: e.target.value.split(",").map((item) => item.trim()).filter(Boolean) })}
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
              />
            </div>
          </div>
        </JournalSettingsModal>
      ) : (
        <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DialogContent closeLabel={text("common.close")} className="max-w-[calc(100vw-1rem)] rounded-[32px] border-0 p-0 sm:max-w-[760px]">
            <DialogHeader className="border-b px-12 py-10">
              <DialogTitle className="text-[22px] font-medium text-black">{text("journalWidgets.staff.settings")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-5 px-12 py-10">
              <div className="space-y-3">
                <Label className="text-[14px] text-[#73738a]">{text("journalWidgets.staff.documentName")}</Label>
                <Input value={documentTitle} aria-label={text("journalWidgets.staff.documentName")} onChange={(e) => editDocumentTitle(e.target.value)} className="h-10 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]" />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5">
                <Input type="date" value={config.documentDate} aria-label={text("journalAuditReport.documentDate")} onChange={(e) => setConfig({ ...config, documentDate: e.target.value })} className="h-10 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]" />
                <Select value={config.auditType} onValueChange={(value: "planned" | "unplanned") => setConfig({ ...config, auditType: value })}>
                  <SelectTrigger aria-label={text("journalAuditReport.auditType")} className="h-10 rounded-xl border-[#dfe1ec] bg-[#f5f6fb] px-3.5 text-[13.5px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="planned">{text("journalAuditReport.planned")}</SelectItem>
                    <SelectItem value="unplanned">{text("journalAuditReport.unplanned")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Input value={config.basisTitle} aria-label={text("journalAuditReport.auditBasis")} onChange={(e) => setConfig({ ...config, basisTitle: e.target.value })} placeholder={text("journalAuditReport.auditBasis")} className="h-10 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]" />
              <Input value={config.auditedObject} aria-label={text("journalAuditReport.auditedObject")} onChange={(e) => setConfig({ ...config, auditedObject: e.target.value })} placeholder={text("journalAuditReport.auditedObject")} className="h-10 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]" />
              <Input value={config.auditors.join(", ")} aria-label={text("journalAuditReport.auditorsComma")} onChange={(e) => setConfig({ ...config, auditors: e.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} placeholder={text("journalAuditReport.auditorsPlaceholder")} className="h-10 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]" />
              <div className="flex justify-end">
                <Button type="button" onClick={async () => { await persist(documentTitle.trim() || AUDIT_REPORT_DOCUMENT_TITLE, config); setSettingsOpen(false); }} className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] text-white hover:bg-[#4b57ff]">
                  {text("common.save")}
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
