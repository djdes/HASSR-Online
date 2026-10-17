"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle, ArrowLeft, CheckCircle2, ClipboardList, ExternalLink, XCircle, FileText, Pencil, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StaffPicker, type StaffPickerOption } from "@/components/shared/staff-picker";
import { cn } from "@/lib/utils";
import {
  decisionSuggestion,
  hazardRisk,
  isSignificantHazard,
  nextControlNumber,
  type ControlKind,
  type DecisionAnswers,
} from "@/lib/ppk/haccp";
import {
  limitText,
  matchesCcp,
  summarizeCcp,
  type CcpJournalEntry,
} from "@/lib/ppk/ccp-monitoring";
import type { ControlPointData, HazardData } from "@/lib/ppk/records";
import { usePpkRecords, type PpkRecordRow } from "@/components/production-control/use-ppk-records";
import {
  PPK_BUTTON_OUTLINE_CLASS,
  PPK_BUTTON_PRIMARY_CLASS,
  PPK_BUTTON_TEXT_CLASS,
  PPK_BUTTON_TEXT_DANGER_CLASS,
  PPK_FIELD_CLASS,
  PPK_LABEL_CLASS,
  PPK_SELECT_CLASS,
  PPK_TEXTAREA_CLASS,
  PpkEmptyState,
} from "@/components/production-control/ppk-ui";

type PointRow = PpkRecordRow<ControlPointData>;
type HazardRow = PpkRecordRow<HazardData>;
type Journal = { code: string; name: string };

const KINDS: ControlKind[] = ["ccp", "oprp", "prp", "none"];
const KIND_ORDER: Record<ControlKind, number> = { ccp: 0, oprp: 1, prp: 2, none: 3 };
const KIND_PILL: Record<ControlKind, string> = {
  ccp: "bg-[#fff4f2] text-[#a13a32]",
  oprp: "bg-[#fff7e6] text-[#8a5a00]",
  prp: "bg-[#f5f6ff] text-[#3848c7]",
  none: "bg-[#f5f6ff] text-[#3848c7]",
};
const FREQUENCIES = ["batch", "load", "twiceShift", "daily", "weekly"] as const;
const QUESTIONS = ["q1", "q2", "q3", "q4"] as const;
const EMPTY_ANSWERS: DecisionAnswers = { q1: null, q2: null, q3: null, q4: null };
const NO_JOURNAL = "__none__";

/** Пилюля типа точки: ККТ красная, ОПП жёлтая, ПП и «не требуется» — индиго. */
function KindPill({ kind }: { kind: ControlKind }) {
  const t = useTranslations("productionControl.controlPoints");
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-[12.5px] font-medium", KIND_PILL[kind])}>
      {t(`kinds.${kind}`)}
    </span>
  );
}

function RiskPill({ hazard }: { hazard: HazardData }) {
  const risk = hazardRisk(hazard.probability, hazard.severity);
  return (
    <span className="inline-flex items-center rounded-full bg-[#fff4f2] px-2.5 py-1 text-[12.5px] font-medium tabular-nums text-[#a13a32]">
      {`${hazard.probability} × ${hazard.severity} = ${risk}`}
    </span>
  );
}

/** Что открыто в мастере: новая точка по опасности или правка существующей. */
type Wizard = { hazardId: string | null; row: PointRow | null };

/**
 * ККТ (ХАССП, шаг 6): сверху — значимые опасности без решения, мастер дерева
 * решений из 4 вопросов, ниже — список контрольных точек (ККТ, ОПП, потом остальные).
 */
export function ControlPointsClient({
  initial,
  hazards,
  staff,
  journals,
  ccpEntries,
  nowIso,
  focusHazardId,
  header,
}: {
  initial: PointRow[];
  hazards: HazardRow[];
  staff: StaffPickerOption[];
  journals: Journal[];
  ccpEntries: CcpJournalEntry[];
  nowIso: string;
  focusHazardId: string | null;
  header: ReactNode;
}) {
  const t = useTranslations("productionControl.controlPoints");
  const { records, create, update, remove } = usePpkRecords<ControlPointData>("control-points", initial);

  const hazardById = useMemo(() => new Map(hazards.map((row) => [row.id, row.data])), [hazards]);
  const decided = useMemo(() => new Set(records.map((row) => row.data.hazardId).filter(Boolean)), [records]);
  const needDecision = useMemo(
    () =>
      hazards.filter(
        (row) => isSignificantHazard(row.data.probability, row.data.severity) && !decided.has(row.id),
      ),
    [hazards, decided],
  );
  const sorted = useMemo(
    () => [...records].sort((a, b) => KIND_ORDER[a.data.kind] - KIND_ORDER[b.data.kind]),
    [records],
  );

  // С ?hazard=<id> мастер для этой опасности открывается сразу — если решения по ней ещё нет.
  const [wizard, setWizard] = useState<Wizard | null>(() =>
    focusHazardId &&
    hazards.some(
      (row) =>
        row.id === focusHazardId &&
        isSignificantHazard(row.data.probability, row.data.severity) &&
        !initial.some((point) => point.data.hazardId === row.id),
    )
      ? { hazardId: focusHazardId, row: null }
      : null,
  );
  const [pendingRemove, setPendingRemove] = useState<PointRow | null>(null);

  const pointLabel = (data: ControlPointData) => data.number || t(`kinds.${data.kind}`);

  return (
    <div className="space-y-6">
      {header}

      {hazards.length === 0 ? (
        <PpkEmptyState title={t("noHazards")} hint={t("emptyHint")}>
          <Link href="/production-control/haccp/hazards" className={PPK_BUTTON_PRIMARY_CLASS}>
            {t("toHazards")}
          </Link>
        </PpkEmptyState>
      ) : null}

      {needDecision.length > 0 ? (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-[16px] font-semibold text-[#0b1024]">
            <AlertTriangle className="size-4 text-[#a13a32]" />
            {t("needDecision")}
          </h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {needDecision.map((row) => (
              <li
                key={row.id}
                className="flex flex-col gap-3 rounded-2xl border border-[#ececf4] bg-white p-4 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[12.5px] text-[#6f7282]">{row.data.step}</span>
                  <RiskPill hazard={row.data} />
                </div>
                <div className="text-[14px] font-medium text-[#0b1024]">{row.data.hazard}</div>
                <div>
                  <button
                    type="button"
                    onClick={() => setWizard({ hazardId: row.id, row: null })}
                    className={PPK_BUTTON_PRIMARY_CLASS}
                  >
                    {t("runTree")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {sorted.length === 0 && hazards.length > 0 && needDecision.length === 0 ? (
        <PpkEmptyState title={t("empty")} hint={t("emptyHint")} />
      ) : null}

      {sorted.length > 0 ? (
        <ul className="grid gap-3">
          {sorted.map((row) => {
            const { data } = row;
            const hazard = data.hazardId ? hazardById.get(data.hazardId) : undefined;
            const person = data.responsibleId ? staff.find((item) => item.id === data.responsibleId) : undefined;
            const important = data.kind === "ccp" || data.kind === "oprp";
            const capaTitle = t("capaTitle", {
              number: pointLabel(data),
              hazard: hazard?.hazard ?? t("hazardDeleted"),
            }).slice(0, 200);
            return (
              <li key={row.id} className="rounded-2xl border border-[#ececf4] bg-white p-4 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
                <div className="flex flex-wrap items-center gap-3">
                  {data.number ? (
                    <span className="text-[17px] font-semibold text-[#0b1024]">{data.number}</span>
                  ) : null}
                  <KindPill kind={data.kind} />
                  <div className="min-w-0 text-[13px] text-[#6f7282]">
                    {hazard ? (
                      <>
                        <span>{hazard.step}</span>
                        <span> · </span>
                        <span className="text-[#3c4053]">{hazard.hazard}</span>
                      </>
                    ) : (
                      <span className="text-[#9b9fb3]">{t("hazardDeleted")}</span>
                    )}
                  </div>
                </div>

                {important && !person ? (
                  <div className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-[#fff7e6] px-3 py-1.5 text-[13px] text-[#8a5a00]">
                    <AlertTriangle className="size-4" />
                    {t("noResponsible")}
                  </div>
                ) : null}

                {important ? (
                  <dl className="mt-3 grid gap-x-6 gap-y-2 text-[13.5px] md:grid-cols-2">
                    <Field label={t("limitsShort")} value={data.limits} />
                    <Field label={t("monitoringShort")} value={data.monitoring} />
                    <Field label={t("frequency")} value={data.frequency} />
                    <Field label={t("responsible")} value={person?.name ?? ""} />
                  </dl>
                ) : data.limits ? (
                  <p className="mt-3 text-[13.5px] text-[#3c4053]">{data.limits}</p>
                ) : null}
                {important ? (
                  <CcpMonitoring
                    data={data}
                    step={hazard?.step ?? ""}
                    entries={ccpEntries}
                    nowIso={nowIso}
                    label={pointLabel(data)}
                  />
                ) : null}
                {important && data.corrective ? (
                  <p className="mt-2 text-[13.5px] text-[#3c4053]">
                    <span className="text-[#9b9fb3]">{t("corrective")}: </span>
                    {data.corrective}
                  </p>
                ) : null}

                <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-[#ececf4] pt-3">
                  {data.journalCode ? (
                    <Link href={`/journals/${data.journalCode}`} className={PPK_BUTTON_TEXT_CLASS}>
                      <ExternalLink className="size-4" />
                      {t("openJournal")}
                    </Link>
                  ) : null}
                  {important ? (
                    <Link
                      href={`/production-control/haccp/control-points/worksheets?id=${row.id}`}
                      className={PPK_BUTTON_TEXT_CLASS}
                    >
                      <FileText className="size-4" />
                      {t("worksheet")}
                    </Link>
                  ) : null}
                  {important ? (
                    <Link href={`/capa/new?title=${encodeURIComponent(capaTitle)}`} className={PPK_BUTTON_TEXT_CLASS}>
                      <ClipboardList className="size-4" />
                      {t("createCapa")}
                    </Link>
                  ) : null}
                  <button type="button" onClick={() => setWizard({ hazardId: data.hazardId, row })} className={PPK_BUTTON_TEXT_CLASS}>
                    <Pencil className="size-4" />
                    {t("edit")}
                  </button>
                  <button type="button" onClick={() => setPendingRemove(row)} className={PPK_BUTTON_TEXT_DANGER_CLASS}>
                    <Trash2 className="size-4" />
                    {t("remove")}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {wizard ? (
        <PointWizard
          key={wizard.row?.id ?? wizard.hazardId ?? "new"}
          wizard={wizard}
          hazard={wizard.hazardId ? hazardById.get(wizard.hazardId) ?? null : null}
          existing={records}
          staff={staff}
          journals={journals}
          onClose={() => setWizard(null)}
          onSave={(data) => (wizard.row ? update(wizard.row.id, data) : create(data))}
        />
      ) : null}

      <ConfirmDialog
        open={pendingRemove !== null}
        onClose={() => setPendingRemove(null)}
        onConfirm={async () => {
          if (pendingRemove) await remove(pendingRemove.id);
        }}
        title={t("removeTitle", { number: pendingRemove ? pointLabel(pendingRemove.data) : "" })}
        description={t("removeBody")}
        variant="danger"
        confirmLabel={t("remove")}
        cancelLabel={t("cancel")}
      />
    </div>
  );
}

/** «dd.MM HH:mm» в часовом поясе браузера; сервер и клиент могут отличаться — предупреждение гидратации гасим на месте. */
function formatWhen(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Сверка точки с журналом «Мониторинг ККТ»: последнее измерение, отклонения, ссылка на создание нарушения. */
function CcpMonitoring({
  data,
  step,
  entries,
  nowIso,
  label,
}: {
  data: ControlPointData;
  step: string;
  entries: CcpJournalEntry[];
  nowIso: string;
  label: string;
}) {
  const t = useTranslations("productionControl.controlPoints");
  const summary = useMemo(
    () =>
      summarizeCcp(
        data,
        entries.filter((item) => matchesCcp({ number: data.number, step }, item.ccpName)),
        nowIso,
      ),
    [data, step, entries, nowIso],
  );
  const { last, lastDeviation, lastOkAt, deviations30 } = summary;
  const limit = limitText(data);
  const freshDeviation = lastDeviation !== null && (lastOkAt === null || lastDeviation.createdAt > lastOkAt);

  if (!last) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-[#fff7e6] px-3 py-2 text-[13px] text-[#8a5a00]">
        <span className="inline-flex items-center gap-1.5">
          <AlertTriangle className="size-4 shrink-0" />
          {t("noRecords30")}
        </span>
        <Link
          href="/journals/ccp_monitoring"
          className="font-medium underline underline-offset-2 transition-colors duration-150 hover:text-[#5c3d00]"
        >
          {t("openJournal")}
        </Link>
      </div>
    );
  }

  const details = [last.actualValue, formatWhen(last.createdAt), last.filledByName].filter(Boolean).join(" · ");
  const deviationValue = lastDeviation
    ? lastDeviation.actualValue || (lastDeviation.value !== null ? String(lastDeviation.value) : "—")
    : "";
  const deviationWhen = lastDeviation ? formatWhen(lastDeviation.createdAt) : "";
  const capaParams = lastDeviation
    ? new URLSearchParams({
        title: t("capaDeviationTitle", { number: label, value: deviationValue }).slice(0, 200),
        description: [
          t("capaDescMeasured", { number: label, value: deviationValue, when: deviationWhen }),
          limit ? t("capaDescLimit", { limit }) : "",
          lastDeviation.correctiveAction ? t("capaDescJournalAction", { action: lastDeviation.correctiveAction }) : "",
          data.corrective ? t("capaDescCorrective", { corrective: data.corrective }) : "",
        ]
          .filter(Boolean)
          .join("\n")
          .slice(0, 2000),
      })
    : null;

  return (
    <div className="mt-3 space-y-2">
      <p className="flex flex-wrap items-center gap-1.5 text-[13.5px] text-[#3c4053]" suppressHydrationWarning>
        {last.ok === true ? <CheckCircle2 className="size-4 shrink-0 text-[#1f9d55]" aria-label={t("withinLimit")} /> : null}
        {last.ok === false ? <XCircle className="size-4 shrink-0 text-[#a13a32]" aria-label={t("outOfLimit")} /> : null}
        <span>
          <span className="text-[#9b9fb3]">{t("lastMeasurement")}: </span>
          {details}
        </span>
      </p>
      {freshDeviation && lastDeviation && capaParams ? (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-[#fff4f2] px-4 py-3 text-[13.5px] text-[#a13a32]"
          suppressHydrationWarning
        >
          <span className="font-medium">
            {limit
              ? t("deviationBanner", { when: deviationWhen, value: deviationValue, limit })
              : t("deviationBannerNoLimit", { when: deviationWhen, value: deviationValue })}
          </span>
          <Link href={`/capa/new?${capaParams.toString()}`} className={PPK_BUTTON_TEXT_DANGER_CLASS}>
            <ClipboardList className="size-4" />
            {t("createCapa")}
          </Link>
        </div>
      ) : null}
      <p className="text-[12px] text-[#9b9fb3]">{t("deviations30", { n: String(deviations30) })}</p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-[#9b9fb3]">{label}</dt>
      <dd className="whitespace-pre-line text-[#0b1024]">{value || "—"}</dd>
    </div>
  );
}

type Step = "question" | "result" | "form";

/** Мастер: 4 вопроса → итог с переключателем типа → поля точки. */
function PointWizard({
  wizard,
  hazard,
  existing,
  staff,
  journals,
  onClose,
  onSave,
}: {
  wizard: Wizard;
  hazard: HazardData | null;
  existing: PointRow[];
  staff: StaffPickerOption[];
  journals: Journal[];
  onClose: () => void;
  onSave: (data: ControlPointData) => Promise<boolean>;
}) {
  const t = useTranslations("productionControl.controlPoints");
  const row = wizard.row;
  const [step, setStep] = useState<Step>(row ? "form" : "question");
  const [qIndex, setQIndex] = useState(0);
  const [answers, setAnswers] = useState<DecisionAnswers>(row?.data.answers ?? EMPTY_ANSWERS);
  const [kind, setKind] = useState<ControlKind>(row?.data.kind ?? "none");
  const [saving, setSaving] = useState(false);

  // Номера остальных точек: свой номер при правке не считаем занятым.
  const otherNumbers = useMemo(
    () => existing.filter((item) => item.id !== row?.id).map((item) => item.data.number),
    [existing, row],
  );
  const numberFor = (next: ControlKind) =>
    next === "ccp" || next === "oprp" ? nextControlNumber(otherNumbers, next) : "";

  const [number, setNumber] = useState(row?.data.number ?? "");
  const [numberTouched, setNumberTouched] = useState(Boolean(row?.data.number));
  const [limits, setLimits] = useState(row?.data.limits ?? "");
  const [monitoring, setMonitoring] = useState(row?.data.monitoring ?? "");
  const [frequency, setFrequency] = useState(row?.data.frequency ?? "");
  const [responsibleId, setResponsibleId] = useState<string | null>(row?.data.responsibleId ?? null);
  const [corrective, setCorrective] = useState(row?.data.corrective ?? "");
  const [limitMinText, setLimitMinText] = useState(row?.data.limitMin != null ? String(row.data.limitMin) : "");
  const [limitMaxText, setLimitMaxText] = useState(row?.data.limitMax != null ? String(row.data.limitMax) : "");
  const [unit, setUnit] = useState(row ? row.data.unit : "°C");
  const [journalCode, setJournalCode] = useState<string | null>(
    row ? row.data.journalCode : journals.some((j) => j.code === "ccp_monitoring") ? "ccp_monitoring" : null,
  );

  const chooseKind = (next: ControlKind) => {
    setKind(next);
    // Номер подставляем сами, пока человек его не правил; у правки — если префикс чужой.
    const prefixOk = number.startsWith(next === "ccp" ? "ККТ-" : "ОПП-");
    if (!numberTouched || (!prefixOk && (next === "ccp" || next === "oprp"))) {
      setNumber(numberFor(next));
      setNumberTouched(false);
    }
  };

  const answer = (value: boolean) => {
    const key = QUESTIONS[qIndex];
    const next: DecisionAnswers = { ...answers, [key]: value };
    // Ответы на более поздние вопросы после смены ответа больше не действуют.
    QUESTIONS.slice(qIndex + 1).forEach((later) => {
      next[later] = null;
    });
    setAnswers(next);
    const suggestion = decisionSuggestion(next);
    if (suggestion === null) {
      setQIndex(qIndex + 1);
      return;
    }
    chooseKind(suggestion);
    setStep("result");
  };

  const back = () => {
    if (step === "form") {
      setStep("result");
    } else if (step === "result") {
      const last = QUESTIONS.reduce((acc, key, i) => (answers[key] !== null ? i : acc), 0);
      setQIndex(last);
      setStep("question");
    } else if (qIndex > 0) {
      setQIndex(qIndex - 1);
    } else {
      onClose();
    }
  };

  const important = kind === "ccp" || kind === "oprp";
  // Числовой предел: пустое поле — «не задано»; «от» не больше «до».
  const toNumber = (text: string): number | null | "bad" => {
    const clean = text.trim().replace(",", ".");
    if (!clean) return null;
    const value = Number(clean);
    return Number.isFinite(value) ? value : "bad";
  };
  const minValue = toNumber(limitMinText);
  const maxValue = toNumber(limitMaxText);
  const limitsInvalid =
    minValue === "bad" || maxValue === "bad" || (minValue !== null && maxValue !== null && minValue > maxValue);
  const canSave = !saving && !(important && limitsInvalid) && (!important || number.trim().length > 0);

  const submit = async () => {
    if (!canSave) return;
    setSaving(true);
    const saved = await onSave({
      hazardId: wizard.hazardId,
      kind,
      answers,
      number: important ? number.trim() : "",
      limits: limits.trim(),
      monitoring: important ? monitoring.trim() : "",
      frequency: important ? frequency.trim() : "",
      responsibleId: important ? responsibleId : null,
      corrective: important ? corrective.trim() : "",
      journalCode: important ? journalCode : null,
      limitMin: important && minValue !== "bad" ? minValue : null,
      limitMax: important && maxValue !== "bad" ? maxValue : null,
      unit: important && (minValue !== null || maxValue !== null) ? unit.trim().slice(0, 16) : "",
    });
    setSaving(false);
    if (saved) onClose();
  };

  const recommendedIds = staff.filter((person) => person.isManager).map((person) => person.id);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-[640px] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 gap-1 border-b border-[#ececf4] px-6 py-4 pr-14 text-left">
          <DialogTitle className="text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">
            {t("dialogTitle")}
          </DialogTitle>
          {hazard ? (
            <p className="text-[13px] text-[#6f7282]">
              {hazard.step} · {hazard.hazard}
            </p>
          ) : null}
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {step === "question" ? (
            <div className="space-y-4">
              <div className="text-[12.5px] font-medium uppercase tracking-[0.12em] text-[#9b9fb3]">
                {t("questionOf", { n: String(qIndex + 1) })}
              </div>
              <div className="text-[17px] font-semibold leading-snug text-[#0b1024]">{t(QUESTIONS[qIndex])}</div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => answer(true)}
                  className="min-h-14 rounded-2xl bg-[#5566f6] text-[16px] font-semibold text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                >
                  {t("yes")}
                </button>
                <button
                  type="button"
                  onClick={() => answer(false)}
                  className="min-h-14 rounded-2xl border border-[#dcdfed] bg-white text-[16px] font-semibold text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                >
                  {t("no")}
                </button>
              </div>
              <p className="text-[12.5px] text-[#6f7282]">{t(`${QUESTIONS[qIndex]}hint`)}</p>
            </div>
          ) : null}

          {step === "result" ? (
            <div className="space-y-4">
              <div className="text-[12.5px] font-medium uppercase tracking-[0.12em] text-[#9b9fb3]">{t("result")}</div>
              <div className="flex items-center gap-3">
                <KindPill kind={kind} />
              </div>
              <p className="text-[14px] leading-[1.55] text-[#3c4053]">{t(`explain.${kind}`)}</p>
              <fieldset>
                <legend className={PPK_LABEL_CLASS}>{t("changeKind")}</legend>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {KINDS.map((item) => (
                    <button
                      key={item}
                      type="button"
                      aria-pressed={kind === item}
                      onClick={() => chooseKind(item)}
                      className={cn(
                        "min-h-11 rounded-2xl border px-3 py-2 text-[13.5px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
                        kind === item
                          ? "border-[#5566f6] bg-[#5566f6] text-white"
                          : "border-[#dcdfed] bg-white text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]",
                      )}
                    >
                      {t(`kinds.${item}`)}
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>
          ) : null}

          {step === "form" ? (
            <div className="space-y-5">
              <div className="flex items-center justify-between gap-3">
                <KindPill kind={kind} />
                <button type="button" onClick={() => setStep("result")} className={PPK_BUTTON_TEXT_CLASS}>
                  {t("changeKind")}
                </button>
              </div>

              {important ? (
                <>
                  <label className="block">
                    <span className={PPK_LABEL_CLASS}>{t("number")}</span>
                    <input
                      value={number}
                      onChange={(event) => {
                        setNumber(event.target.value);
                        setNumberTouched(true);
                      }}
                      maxLength={20}
                      className={PPK_FIELD_CLASS}
                    />
                  </label>
                  <label className="block">
                    <span className={PPK_LABEL_CLASS}>{t("limits")}</span>
                    <textarea value={limits} onChange={(e) => setLimits(e.target.value)} rows={2} className={PPK_TEXTAREA_CLASS} />
                  </label>
                  <fieldset className="space-y-2">
                    <legend className={PPK_LABEL_CLASS}>{t("numericLimit")}</legend>
                    <div className="grid grid-cols-3 gap-2">
                      <label className="block">
                        <span className="text-[12px] text-[#9b9fb3]">{t("limitFrom")}</span>
                        <input
                          value={limitMinText}
                          onChange={(e) => setLimitMinText(e.target.value)}
                          inputMode="decimal"
                          className={PPK_FIELD_CLASS}
                        />
                      </label>
                      <label className="block">
                        <span className="text-[12px] text-[#9b9fb3]">{t("limitTo")}</span>
                        <input
                          value={limitMaxText}
                          onChange={(e) => setLimitMaxText(e.target.value)}
                          inputMode="decimal"
                          className={PPK_FIELD_CLASS}
                        />
                      </label>
                      <label className="block">
                        <span className="text-[12px] text-[#9b9fb3]">{t("limitUnit")}</span>
                        <input value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={16} className={PPK_FIELD_CLASS} />
                      </label>
                    </div>
                    <p className={cn("text-[12.5px]", limitsInvalid ? "text-[#a13a32]" : "text-[#6f7282]")}>
                      {limitsInvalid ? t("limitError") : t("numericLimitHint")}
                    </p>
                  </fieldset>
                  <label className="block">
                    <span className={PPK_LABEL_CLASS}>{t("monitoring")}</span>
                    <textarea value={monitoring} onChange={(e) => setMonitoring(e.target.value)} rows={2} className={PPK_TEXTAREA_CLASS} />
                  </label>
                  <label className="block">
                    <span className={PPK_LABEL_CLASS}>{t("frequency")}</span>
                    <input
                      value={frequency}
                      onChange={(e) => setFrequency(e.target.value)}
                      list="ppk-control-frequencies"
                      className={PPK_FIELD_CLASS}
                    />
                    <datalist id="ppk-control-frequencies">
                      {FREQUENCIES.map((item) => (
                        <option key={item} value={t(`freq.${item}`)} />
                      ))}
                    </datalist>
                  </label>
                  <div>
                    <span className={PPK_LABEL_CLASS}>{t("responsible")}</span>
                    <StaffPicker
                      value={responsibleId}
                      onChange={setResponsibleId}
                      staff={staff}
                      recommendedIds={recommendedIds}
                      placeholder={t("pickResponsible")}
                    />
                  </div>
                  <label className="block">
                    <span className={PPK_LABEL_CLASS}>{t("corrective")}</span>
                    <textarea value={corrective} onChange={(e) => setCorrective(e.target.value)} rows={3} className={PPK_TEXTAREA_CLASS} />
                  </label>
                  <div>
                    <span className={PPK_LABEL_CLASS}>{t("journal")}</span>
                    <Select
                      value={journalCode ?? NO_JOURNAL}
                      onValueChange={(value) => setJournalCode(value === NO_JOURNAL ? null : value)}
                    >
                      <SelectTrigger className={PPK_SELECT_CLASS}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_JOURNAL}>{t("noJournal")}</SelectItem>
                        {journals.map((journal) => (
                          <SelectItem key={journal.code} value={journal.code}>
                            {journal.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              ) : (
                <label className="block">
                  <span className={PPK_LABEL_CLASS}>{t("comment")}</span>
                  <textarea value={limits} onChange={(e) => setLimits(e.target.value)} rows={4} className={PPK_TEXTAREA_CLASS} />
                </label>
              )}
            </div>
          ) : null}
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t border-[#ececf4] px-6 py-4 sm:justify-between">
          <button type="button" onClick={back} className={PPK_BUTTON_OUTLINE_CLASS}>
            <ArrowLeft className="size-4" />
            {t("back")}
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className={PPK_BUTTON_OUTLINE_CLASS}>
              {t("cancel")}
            </button>
            {step === "result" ? (
              <button type="button" onClick={() => setStep("form")} className={PPK_BUTTON_PRIMARY_CLASS}>
                {t("next")}
              </button>
            ) : null}
            {step === "form" ? (
              <button type="button" onClick={submit} disabled={!canSave} className={PPK_BUTTON_PRIMARY_CLASS}>
                {t("save")}
              </button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
