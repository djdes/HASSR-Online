"use client";

import { formatChecklistTimestamp } from "@/lib/custom-checklist-display";
import { useCallback, useEffect, useRef, useState } from "react";
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
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "Не удалось загрузить проверку");
      const item = body.inspection;
      setInspection(item); setAnswers(item.answers); setEvidence(item.evidence ?? {}); setInstances(item.categoryInstances ?? {}); setErrors({}); setConflict(false);
      saved.current = JSON.stringify({answers:item.answers,evidence:item.evidence ?? {},categoryInstances:item.categoryInstances ?? {}});
    } catch (err) { setError(err instanceof Error ? err.message : "Не удалось загрузить проверку"); }
  }, [id]);
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
    if (Object.keys(problems).length) { toast.error("Проверьте ответы и обязательные подтверждения"); return; }
    setBusy(true);
    try {
      const response = await fetch(`/api/checklists/inspections/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers,evidence,categoryInstances:instances, complete, updatedAt: inspection.updatedAt }) });
      const body = await response.json(); if (!response.ok) { if (body.errors) setErrors(body.errors); if(response.status === 409) setConflict(true); throw new Error(body.error || "Не удалось сохранить проверку"); }
      const item = body.inspection; setInspection(item); setAnswers(item.answers); setEvidence(item.evidence ?? {}); setInstances(item.categoryInstances ?? {});
      saved.current = JSON.stringify({answers:item.answers,evidence:item.evidence ?? {},categoryInstances:item.categoryInstances ?? {}});
      toast.success(item.status === "completed" ? result.stopped ? "Проверка завершена по критическому нарушению" : "Проверка завершена" : "Черновик сохранён");
    } catch (err) { toast.error(err instanceof Error ? err.message : "Не удалось сохранить"); }
    finally { setBusy(false); }
  }
  if (error) return <div role="alert" className="rounded-2xl bg-[#fff4f2] p-4 text-[#a13a32]">{error}<Button variant="outline" onClick={() => void load()}>Повторить</Button></div>;
  if (!inspection) return <p>Загрузка проверки…</p>;
  const definition = expandChecklistDefinition(inspection.snapshot,instances);
  const result = resolveChecklistResult(definition,answers,completed?inspection.result:undefined);
  const score = result.score;
  const repeatable = inspection.snapshot.sections.filter(s => s.active).flatMap(s => s.categories.filter(c => c.active && c.repeatable));
  return <div className="space-y-5"><PageHeader title={inspection.title} description={`Версия ${inspection.templateVersion} · ${completed ? "Завершённая проверка" : "Черновик"}`} actions={<div className="flex flex-wrap gap-2 print:hidden"><Button variant="outline" onClick={() => window.print()}><Printer className="size-4" />Печать</Button><Button variant="outline" asChild><a href={`/api/checklists/inspections/${id}/pdf`} target="_blank" rel="noopener noreferrer">Скачать PDF</a></Button>{!completed ? <><Button variant="outline" disabled={busy || !!uploads || conflict} onClick={() => void save(false)}><Save className="size-4" />Сохранить черновик</Button><Button disabled={busy || !!uploads || conflict} onClick={() => void save(true)}><CheckCircle2 className="size-4" />Завершить проверку</Button></> : null}</div>} />
    <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4 text-sm text-[#3c4053]"><p>Начал: {inspection.createdByName} · {formatChecklistTimestamp(inspection.createdAt)}</p>{inspection.completedAt ? <p>Завершил: {inspection.completedByName} · {formatChecklistTimestamp(inspection.completedAt)}</p> : null}<p className="mt-2 font-medium">Результат: {score.earned} / {score.possible} баллов{score.possible > 0 ? ` (${Math.round(score.earned / score.possible * 100)}%)` : result.zeroScore ? " · результат обнулён" : ""} · Нарушений: {result.violations.length}</p>{!completed ? <p className="mt-2 text-xs text-muted-foreground">Перед выходом сохраните черновик. PDF содержит последние сохранённые ответы.</p> : null}</div>
    {conflict ? <div role="alert" className="rounded-xl bg-amber-50 p-4"><p>Проверка изменилась в другом окне. Ваши ответы остаются на экране. Скопируйте нужные данные перед обновлением.</p><Button variant="outline" onClick={() => { if(window.confirm("Загрузить сохранённые ответы вместо текущих изменений?")) void load(); }}>Загрузить сохранённую версию</Button></div> : null}
    {result.stopped ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><p className="font-medium">Критическое нарушение — досрочное завершение</p><p>{result.critical.map(item => item.title).join(", ")}</p>{!completed ? <p>Добавьте обязательные подтверждения к ответу и сохраните проверку. Остальные обязательные вопросы заполнять не нужно.</p> : null}</div> : null}
    {inspection.snapshot.description ? <ChecklistDescription text={inspection.snapshot.description} /> : null}
    {!completed && repeatable.length ? <section className="space-y-3 rounded-2xl border p-4 print:hidden"><h2 className="font-medium">Повторяемые категории</h2>{repeatable.map(category => <div key={category.id} className="flex flex-wrap items-center gap-2 text-sm"><span>{category.title} · {(instances[category.id]?.length ?? 0)+1} экземпляров</span><Button variant="outline" disabled={busy || !!uploads || (instances[category.id]?.length ?? 0) >= 20} onClick={() => {
      const next = {...instances,[category.id]:[...(instances[category.id] ?? []),crypto.randomUUID()]};
      try { expandChecklistDefinition(inspection.snapshot,next); setInstances(next); } catch(error) {toast.error(error instanceof Error ? error.message : "Достигнут лимит вопросов");}
    }}>Добавить экземпляр</Button>{(instances[category.id] ?? []).map((key,index) => <Button key={key} variant="ghost" disabled={busy || !!uploads} onClick={() => {
      if (!window.confirm(`Удалить экземпляр ${index+2} и его ответы?`)) return;
      const ids = new Set(category.questions.map(q => `${q.id}@${key}`));
      setAnswers(previous => Object.fromEntries(Object.entries(previous).filter(([qid]) => !ids.has(qid))));
      setEvidence(previous => Object.fromEntries(Object.entries(previous).filter(([qid]) => !ids.has(qid))));
      setInstances(previous => ({...previous,[category.id]:previous[category.id].filter(item => item !== key)}));
    }}>Убрать № {index+2}</Button>)}</div>)}</section> : null}
    <ChecklistQuestionForm definition={definition} answers={answers} onChange={setAnswers} evidence={evidence} onEvidenceChange={setEvidence} visibleIds={completed?result.questions.map(q=>q.questionId):undefined} readOnly={completed || busy} errors={errors} upload={async (questionId,purpose,file) => {
      if (file.size > 10*1024*1024) throw new Error("Файл до 10 МБ");
      setUploads(value => value+1);
      try { const form = new FormData(); form.set("file",file); form.set("inspectionId",id); form.set("questionId",questionId); form.set("purpose",purpose); form.set("instances",JSON.stringify(instances)); const response = await fetch("/api/checklists/attachments",{method:"POST",body:form}); const body = await response.json(); if(!response.ok) throw new Error(body.error || "Не удалось загрузить файл"); return body.attachment.ref as string; }
      finally {setUploads(value => value-1);}
    }} />
  </div>;
}
