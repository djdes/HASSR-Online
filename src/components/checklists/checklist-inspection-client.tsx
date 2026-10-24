"use client";

import { formatChecklistTimestamp } from "@/lib/custom-checklist-display";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Printer, Save, CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { ChecklistQuestionForm } from "./checklist-question-form";
import { ChecklistDescription } from "./checklist-evidence-form";
import type { ChecklistDefinition, ChecklistAnswers } from "@/lib/custom-checklists";
import type { ChecklistEvidence, ChecklistInstances } from "@/lib/custom-checklist-rules";
import { expandChecklistDefinition, evaluateChecklistRun, resolveChecklistResult, validateChecklistRun } from "@/lib/custom-checklist-runtime";

type Inspection = { id: string; title: string; status: string; templateVersion: number; snapshot: ChecklistDefinition; answers: ChecklistAnswers; evidence: ChecklistEvidence; categoryInstances: ChecklistInstances; result?:unknown; updatedAt: string; createdAt: string; createdByName: string; completedAt: string | null; completedByName: string | null };
export function ChecklistInspectionClient({ id }: { id: string }) {
  const t = useTranslations("checklistsUi.checklistInspectionClient");
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [answers, setAnswers] = useState<ChecklistAnswers>({});
  const [evidence, setEvidence] = useState<ChecklistEvidence>({});
  const [instances, setInstances] = useState<ChecklistInstances>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploads, setUploads] = useState(0);
  const [conflict, setConflict] = useState(false);
  const saved = useRef("");
  const current = useRef(""); current.current = JSON.stringify({answers,evidence,categoryInstances:instances});
  const completed = inspection?.status === "completed";
  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch(`/api/checklists/inspections/${id}`, { cache: "no-store" });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || t("loadFailed"));
      const item = body.inspection;
      setInspection(item); setAnswers(item.answers); setEvidence(item.evidence ?? {}); setInstances(item.categoryInstances ?? {}); setErrors({}); setConflict(false);
      saved.current = JSON.stringify({answers:item.answers,evidence:item.evidence ?? {},categoryInstances:item.categoryInstances ?? {}});
    } catch (err) { setError(err instanceof Error ? err.message : t("loadFailed")); }
  }, [id, t]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (!completed && (uploads>0 || current.current !== saved.current)) event.preventDefault(); };
    window.addEventListener("beforeunload",warn); return () => window.removeEventListener("beforeunload",warn);
  }, [completed,uploads]);
  async function save(complete: boolean) {
    if (!inspection || busy || uploads || conflict) return;
    const expanded = expandChecklistDefinition(inspection.snapshot,instances);
    const result = evaluateChecklistRun(expanded,answers);
    const problems = validateChecklistRun(expanded, answers,evidence, complete || result.stopped); setErrors(problems);
    if (Object.keys(problems).length) { toast.error(t("checkAnswers")); return; }
    setBusy(true);
    try {
      const response = await fetch(`/api/checklists/inspections/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers,evidence,categoryInstances:instances, complete, updatedAt: inspection.updatedAt }) });
      const body = await response.json(); if (!response.ok) { if (body.errors) setErrors(body.errors); if(response.status === 409) setConflict(true); throw new Error(body.error || t("saveInspectionFailed")); }
      const item = body.inspection; setInspection(item); setAnswers(item.answers); setEvidence(item.evidence ?? {}); setInstances(item.categoryInstances ?? {});
      saved.current = JSON.stringify({answers:item.answers,evidence:item.evidence ?? {},categoryInstances:item.categoryInstances ?? {}});
      toast.success(item.status === "completed" ? result.stopped ? t("completedCritical") : t("completed") : t("draftSaved"));
    } catch (err) { toast.error(err instanceof Error ? err.message : t("saveFailed")); }
    finally { setBusy(false); }
  }
  if (error) return <div role="alert" className="rounded-2xl bg-[#fff4f2] p-4 text-[#a13a32]">{error}<Button variant="outline" onClick={() => void load()}>{t("retry")}</Button></div>;
  if (!inspection) return <p>{t("loading")}</p>;
  const definition = expandChecklistDefinition(inspection.snapshot,instances);
  const result = resolveChecklistResult(definition,answers,completed?inspection.result:undefined);
  const score = result.score;
  const repeatable = inspection.snapshot.sections.filter(s => s.active).flatMap(s => s.categories.filter(c => c.active && c.repeatable));
  return <div className="space-y-5"><PageHeader title={inspection.title} description={t("subtitle", { version: inspection.templateVersion, status: completed ? t("statusCompleted") : t("statusDraft") })} actions={<div className="flex flex-wrap gap-2 print:hidden"><Button variant="outline" onClick={() => window.print()}><Printer className="size-4" />{t("print")}</Button><Button variant="outline" asChild><a href={`/api/checklists/inspections/${id}/pdf`} target="_blank" rel="noopener noreferrer">{t("downloadPdf")}</a></Button>{!completed ? <><Button variant="outline" disabled={busy || !!uploads || conflict} onClick={() => void save(false)}><Save className="size-4" />{t("saveDraft")}</Button><Button disabled={busy || !!uploads || conflict} onClick={() => void save(true)}><CheckCircle2 className="size-4" />{t("complete")}</Button></> : null}</div>} />
    <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4 text-sm text-[#3c4053]"><p>{t("startedBy", { name: inspection.createdByName, time: formatChecklistTimestamp(inspection.createdAt) })}</p>{inspection.completedAt ? <p>{t("completedBy", { name: inspection.completedByName ?? "", time: formatChecklistTimestamp(inspection.completedAt) })}</p> : null}<p className="mt-2 font-medium">{t("resultLine", { earned: score.earned, possible: score.possible, percent: score.possible > 0 ? ` (${Math.round(score.earned / score.possible * 100)}%)` : "", zeroed: score.possible > 0 ? "" : result.zeroScore ? t("zeroedSuffix") : "", violations: result.violations.length })}</p>{!completed ? <p className="mt-2 text-xs text-muted-foreground">{t("saveBeforeLeaving")}</p> : null}</div>
    {conflict ? <div role="alert" className="rounded-xl bg-amber-50 p-4"><p>{t("conflictText")}</p><Button variant="outline" onClick={() => { if(window.confirm(t("reloadConfirm"))) void load(); }}>{t("reload")}</Button></div> : null}
    {result.stopped ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><p className="font-medium">{t("criticalTitle")}</p><p>{result.critical.map(item => item.title).join(", ")}</p>{!completed ? <p>{t("criticalHint")}</p> : null}</div> : null}
    {inspection.snapshot.description ? <ChecklistDescription text={inspection.snapshot.description} /> : null}
    {!completed && repeatable.length ? <section className="space-y-3 rounded-2xl border p-4 print:hidden"><h2 className="font-medium">{t("repeatableTitle")}</h2>{repeatable.map(category => <div key={category.id} className="flex flex-wrap items-center gap-2 text-sm"><span>{t("instancesCount", { title: category.title, count: (instances[category.id]?.length ?? 0)+1 })}</span><Button variant="outline" disabled={busy || !!uploads || (instances[category.id]?.length ?? 0) >= 20} onClick={() => {
      const next = {...instances,[category.id]:[...(instances[category.id] ?? []),crypto.randomUUID()]};
      try { expandChecklistDefinition(inspection.snapshot,next); setInstances(next); } catch(error) {toast.error(error instanceof Error ? error.message : t("questionLimit"));}
    }}>{t("addInstance")}</Button>{(instances[category.id] ?? []).map((key,index) => <Button key={key} variant="ghost" disabled={busy || !!uploads} onClick={() => {
      if (!window.confirm(t("removeInstanceConfirm", { number: index+2 }))) return;
      const ids = new Set(category.questions.map(q => `${q.id}@${key}`));
      setAnswers(previous => Object.fromEntries(Object.entries(previous).filter(([qid]) => !ids.has(qid))));
      setEvidence(previous => Object.fromEntries(Object.entries(previous).filter(([qid]) => !ids.has(qid))));
      setInstances(previous => ({...previous,[category.id]:previous[category.id].filter(item => item !== key)}));
    }}>{t("removeInstance", { number: index+2 })}</Button>)}</div>)}</section> : null}
    <ChecklistQuestionForm definition={definition} answers={answers} onChange={setAnswers} evidence={evidence} onEvidenceChange={setEvidence} visibleIds={completed?result.questions.map(q=>q.questionId):undefined} readOnly={completed || busy} errors={errors} upload={async (questionId,purpose,file) => {
      if (file.size > 10*1024*1024) throw new Error(t("fileTooBig"));
      setUploads(value => value+1);
      try { const form = new FormData(); form.set("file",file); form.set("inspectionId",id); form.set("questionId",questionId); form.set("purpose",purpose); form.set("instances",JSON.stringify(instances)); const response = await fetch("/api/checklists/attachments",{method:"POST",body:form}); const body = await response.json(); if(!response.ok) throw new Error(body.error || t("uploadFailed")); return body.attachment.ref as string; }
      finally {setUploads(value => value-1);}
    }} />
  </div>;
}
