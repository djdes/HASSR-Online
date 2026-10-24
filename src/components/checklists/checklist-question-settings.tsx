"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { CHECKLIST_OPERATORS, type ChecklistCondition, type ChecklistRule } from "@/lib/custom-checklist-rules";
import { defaultChecklistCondition, type ChecklistQuestion } from "@/lib/custom-checklists";

const selectClass = "h-10 max-w-full rounded-xl border bg-white px-2 text-sm";
export function ChecklistConditionEditor({ value, type, onChange, options = [], labels }: { value: ChecklistCondition; type: string; onChange: (value: ChecklistCondition) => void; options?: {value:string;label:string}[]; labels?:ChecklistQuestion["labels"] }) {
  const t = useTranslations("checklistsUi.checklistQuestionSettings");
  const operatorLabel = (operator: (typeof CHECKLIST_OPERATORS)[number]) => {
    switch (operator) {
      case "eq": return t("opEq");
      case "neq": return t("opNeq");
      case "gt": return t("opGt");
      case "gte": return t("opGte");
      case "lt": return t("opLt");
      case "lte": return t("opLte");
      case "between": return t("opBetween");
      case "not_between": return t("opNotBetween");
      case "any": return t("opAny");
      case "checked": return t("opChecked");
      case "unchecked": return t("opUnchecked");
    }
  };
  const numeric = ["number", "scale", "multi"].includes(type);
  const operand = (raw: string) => type === "checkbox" ? raw === "true" : numeric ? Number(raw) : raw;
  const choices = type === "yes_no" ? [{value:"yes",label:labels?.yes??t("answerYes")},{value:"no",label:labels?.no??t("answerNo")},{value:"na",label:labels?.na??t("answerNaDefault")}].filter(option=>option.label) : type === "checkbox" ? [{value:"true",label:t("answerYes")},{value:"false",label:t("answerNo")}] : type === "choice" ? options : [];
  return <div className="flex flex-wrap gap-2"><select aria-label={t("operatorLabel")} className={selectClass} value={value.operator} onChange={e => onChange({ ...value, operator: e.target.value as ChecklistCondition["operator"], value: value.value ?? (type === "checkbox" ? true : numeric ? 0 : type === "yes_no" ? "no" : ""), upper: value.upper ?? (numeric ? 10 : "") })}>{CHECKLIST_OPERATORS.map(key => [key, operatorLabel(key)] as const).filter(([key]) => (["any","eq","neq"].includes(key)) || (["checked", "unchecked"].includes(key) ? type === "checkbox" : ["number","scale","datetime","multi"].includes(type))).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
    {!["any", "checked", "unchecked"].includes(value.operator) ? choices.length ? <select aria-label={t("valueLabel")} className={selectClass} value={String(value.value ?? "")} onChange={e => onChange({...value,value:operand(e.target.value)})}><option value="">{t("chooseAnswer")}</option>{choices.map(choice=><option key={choice.value} value={choice.value}>{choice.label}</option>)}</select> : <Input aria-label={t("valueLabel")} className="w-44" type={type === "datetime" ? "datetime-local" : numeric ? "number" : "text"} value={String(value.value ?? "")} onChange={e => onChange({ ...value, value: operand(e.target.value) })} /> : null}
    {["between", "not_between"].includes(value.operator) ? <Input aria-label={t("upperLabel")} className="w-44" type={type === "datetime" ? "datetime-local" : "number"} value={String(value.upper ?? "")} onChange={e => onChange({ ...value, upper: operand(e.target.value) })} /> : null}
  </div>;
}

export function ChecklistQuestionSettings({ question: q, onChange, templateId, onUploadState }: { question: ChecklistQuestion; onChange: (patch: Partial<ChecklistQuestion>) => void; templateId?: string;onUploadState?:(uploading:boolean)=>void }) {
  const t = useTranslations("checklistsUi.checklistQuestionSettings");
  const [uploading, setUploading] = useState(false);
  const latest=useRef(q);latest.current=q;
  function ruleChange(index: number, patch: Partial<ChecklistRule>) { onChange({ logic: q.logic?.map((rule, i) => i === index ? { ...rule, ...patch } : rule) }); }
  return <details className="rounded-xl border bg-white p-3"><summary className="cursor-pointer text-sm font-medium">{t("summary")}</summary><div className="mt-3 space-y-4">
    {q.type === "yes_no" ? <div className="space-y-2">{(["yes", "no", "na"] as const).map(key => <div className="flex flex-wrap items-center gap-2" key={key}><span className="w-16 text-sm">{key === "yes" ? t("answerYes") : key === "no" ? t("answerNo") : t("answerNaShort")}</span><Input aria-label={t("labelAria", { answer: key === "yes" ? t("answerYes") : key === "no" ? t("answerNo") : t("answerNaShort") })} className="w-40" placeholder={key === "na" ? t("labelHide") : t("labelName")} value={q.labels?.[key] ?? (key === "yes" ? t("answerYes") : key === "no" ? t("answerNo") : t("answerNaDefault"))} onChange={e => onChange({ labels: { yes: t("answerYes"), no: t("answerNo"), na: t("answerNaDefault"), ...q.labels, [key]: e.target.value } })} /><Input aria-label={t("pointsAria", { answer: key === "yes" ? t("answerYes") : key === "no" ? t("answerNo") : t("answerNaShort") })} className="w-24" type="number" min={0} max={1000} value={q.answerPoints?.[key] ?? (key === "yes" ? q.weight : 0)} onChange={e => onChange({ answerPoints: { yes: q.weight, no: 0, na: 0, ...q.answerPoints, [key]: Number(e.target.value) } })} /><label className="flex gap-2 text-sm"><Checkbox checked={(q.excludedAnswers ?? ["na"]).includes(key)} onCheckedChange={checked => onChange({ excludedAnswers: checked ? [...new Set([...(q.excludedAnswers ?? ["na"]), key])] : (q.excludedAnswers ?? ["na"]).filter(item => item !== key) })} />{t("excludeFromTotal")}</label></div>)}</div> : null}
    {["number", "scale"].includes(q.type) ? <div className="flex flex-wrap gap-3"><label className="text-sm">{t("unit")}<Input value={q.unit ?? ""} maxLength={40} onChange={e => onChange({ unit: e.target.value })} /></label><label className="text-sm">{t("step")}<Input aria-label={t("stepAria")} type="number" min={0.001} step="any" value={q.step ?? ""} onChange={e => onChange({ step: e.target.value ? Number(e.target.value) : undefined })} /></label>{q.type === "scale" ? <select aria-label={t("scaleScoringAria")} className={selectClass} value={q.scaleScoring ?? "range"} onChange={e => onChange({ scaleScoring: e.target.value as "range" | "value" })}><option value="range">{t("scaleRange")}</option><option value="value">{t("scaleValue")}</option></select> : null}</div> : null}
    {q.type === "photo" ? <label className="block text-sm">{t("minPhotos")}<Input aria-label={t("minPhotos")} className="w-24" type="number" min={1} max={10} value={q.minPhotos ?? 1} onChange={e => onChange({ minPhotos: Number(e.target.value) })} /></label> : null}
    {["choice", "multi"].includes(q.type) ? <div className="space-y-2">{q.type === "multi" ? <select aria-label={t("multiScoringAria")} className={selectClass} value={q.multiScoring ?? "average"} onChange={e => onChange({ multiScoring: e.target.value as "average" | "sum" })}><option value="average">{t("multiAverage")}</option><option value="sum">{t("multiSum")}</option></select> : null}{q.options.map((option, index) => <div className="flex flex-wrap items-center gap-3 text-sm" key={option.value}><span>{option.label}</span><Input aria-label={t("optionPointsAria", { label: option.label })} className="w-24" type="number" min={0} max={1000} placeholder={t("points")} value={option.points ?? ""} onChange={e => onChange({ options: q.options.map((o, i) => i === index ? { ...o, points: e.target.value ? Number(e.target.value) : undefined } : o) })} />{(["excluded", "violation"] as const).map(key => <label key={key} className="flex items-center gap-2"><Checkbox checked={option[key] === true} onCheckedChange={checked => onChange({ options: q.options.map((o, i) => i === index ? { ...o, [key]: checked === true } : o) })} />{key === "excluded" ? t("exclude") : t("violation")}</label>)}</div>)}</div> : null}
    {!["photo", "signature", "info", "text"].includes(q.type) ? <>
      <label className="flex items-center gap-2 text-sm"><Checkbox checked={!!q.violation} onCheckedChange={checked => onChange({ violation: checked ? defaultChecklistCondition(q) : undefined })} />{t("customViolation")}</label>
      {q.violation ? <ChecklistConditionEditor value={q.violation} type={q.type} options={q.options} labels={q.labels} onChange={violation => onChange({ violation })} /> : null}
      {(q.logic ?? []).map((rule, index) => <div key={rule.id} className="space-y-2 rounded-xl border p-3"><p className="text-sm font-medium">{t("ifAnswer")}</p><ChecklistConditionEditor value={rule.condition} type={q.type} options={q.options} labels={q.labels} onChange={condition => ruleChange(index, { condition })} />
        <div className="flex flex-wrap gap-3">{(["comment", "barcode", "location", "violation", "critical", "stop", "zeroScore"] as const).map(key => <label key={key} className="flex items-center gap-2 text-sm"><Checkbox checked={rule.actions[key] === true} onCheckedChange={checked => {
          const actions = { ...rule.actions, [key]: checked === true };
          if (checked && key === "zeroScore") { actions.stop = true; actions.critical = true; }
          if (checked && key === "stop") actions.critical = true;
          if (!checked && key === "critical") { actions.stop = false; actions.zeroScore = false; }
          if (!checked && key === "stop") actions.zeroScore = false;
          ruleChange(index, { actions });
        }} />{key === "comment" ? t("actionComment") : key === "barcode" ? t("actionBarcode") : key === "location" ? t("actionLocation") : key === "violation" ? t("actionViolation") : key === "critical" ? t("actionCritical") : key === "stop" ? t("actionStop") : t("actionZeroScore")}</label>)}</div>
        <div className="flex flex-wrap gap-3">{(["photos", "videos", "audios"] as const).map(key => <label key={key} className="text-sm">{key === "photos" ? t("photosMin") : key === "videos" ? t("videosMin") : t("audiosMin")}<Input className="w-24" type="number" min={0} max={key === "photos" ? 10 : 3} value={rule.actions[key] ?? 0} onChange={e => ruleChange(index, { actions: { ...rule.actions, [key]: Number(e.target.value) } })} /></label>)}</div>
        <Button variant="outline" onClick={() => onChange({ logic: q.logic?.filter((_, i) => i !== index) })}>{t("removeCondition")}</Button></div>)}
      <Button variant="outline" disabled={(q.logic?.length ?? 0) >= 10} onClick={() => onChange({ logic: [...(q.logic ?? []), { id: crypto.randomUUID(), condition: defaultChecklistCondition(q), actions: { comment: true } }] })}>{t("addCondition")}</Button>
    </> : null}
    <div className="space-y-2"><p className="text-sm font-medium">{t("references")}</p>{q.references?.map(ref => <div key={ref} className="flex gap-2"><a className="text-sm text-indigo-600 underline" href={`/api/checklists/attachments/${ref.slice(5)}`} target="_blank" rel="noopener noreferrer">{t("openFile")}</a><Button variant="ghost" size="sm" onClick={() => onChange({ references: q.references?.filter(item => item !== ref) })}>{t("remove")}</Button></div>)}
      <Input aria-label={t("uploadReference")} type="file" disabled={uploading || (q.references?.length ?? 0) >= 10} onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
        setUploading(true);onUploadState?.(true);
        try { const form = new FormData(); form.set("file", file); form.set("purpose", "reference"); form.set("questionId", q.id); if (templateId) form.set("templateId", templateId); const response = await fetch("/api/checklists/attachments", { method: "POST", body: form }); const body = await response.json(); if (!response.ok) throw new Error(body.error); onChange({ references: [...(latest.current.references ?? []), body.attachment.ref] }); }
        catch (error) { toast.error(error instanceof Error ? error.message : t("uploadFailed")); } finally { setUploading(false);onUploadState?.(false); }
      }} /><p className="text-xs text-muted-foreground">{t("uploadHint")}</p></div>
  </div></details>;
}
