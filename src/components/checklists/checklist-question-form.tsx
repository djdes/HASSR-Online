"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { visibleChecklistQuestions, type ChecklistDefinition, type ChecklistAnswers, type ChecklistAnswer } from "@/lib/custom-checklists";
import { checklistQuestionResult } from "@/lib/custom-checklist-runtime";
import type { ChecklistEvidence } from "@/lib/custom-checklist-rules";
import { ChecklistDescription, ChecklistEvidenceForm, ChecklistMedia, type ChecklistUpload } from "./checklist-evidence-form";

function SignatureInput({ value, onChange, readOnly }: { value?: string; onChange: (value: string) => void; readOnly: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const emitted = useRef("");
  useEffect(() => {
    if (!canvas.current || value === emitted.current) return;
    const context = canvas.current.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, 600, 180);
    if (value) {
      const image = new window.Image();
      image.onload = () => context.drawImage(image, 0, 0, 600, 180);
      image.src = value;
    }
  }, [value]);
  return <div className="space-y-2"><canvas ref={canvas} width={600} height={180} aria-label="Нарисуйте подпись" className="h-[150px] w-full touch-none rounded-2xl border border-[#dcdfed] bg-white" onPointerDown={(event) => {
    if (readOnly) return;
    const element = event.currentTarget;
    const context = element.getContext("2d");
    if (!context) return;
    element.setPointerCapture(event.pointerId); drawing.current = true;
    const rect = element.getBoundingClientRect();
    context.strokeStyle = "#0b1024"; context.lineWidth = 2; context.lineCap = "round"; context.beginPath();
    context.moveTo((event.clientX - rect.left) * 600 / rect.width, (event.clientY - rect.top) * 180 / rect.height);
  }} onPointerMove={(event) => {
    if (!drawing.current || readOnly) return;
    const context = event.currentTarget.getContext("2d"); if (!context) return;
    const rect = event.currentTarget.getBoundingClientRect();
    context.lineTo((event.clientX - rect.left) * 600 / rect.width, (event.clientY - rect.top) * 180 / rect.height); context.stroke();
  }} onPointerUp={(event) => {
    if (!drawing.current || readOnly) return;
    drawing.current = false; emitted.current = event.currentTarget.toDataURL("image/png"); onChange(emitted.current);
  }} onPointerCancel={() => { drawing.current = false; }} />
  {!readOnly ? <Button type="button" variant="outline" onClick={() => { canvas.current?.getContext("2d")?.clearRect(0, 0, 600, 180); emitted.current = ""; onChange(""); }}>Очистить подпись</Button> : null}</div>;
}

export function ChecklistQuestionForm({ definition, answers, onChange, readOnly = false, errors = {}, evidence, onEvidenceChange, upload }: {
  definition: ChecklistDefinition; answers: ChecklistAnswers; onChange: React.Dispatch<React.SetStateAction<ChecklistAnswers>>; readOnly?: boolean; errors?: Record<string, string>;
  evidence?: ChecklistEvidence; onEvidenceChange?: React.Dispatch<React.SetStateAction<ChecklistEvidence>>; upload?: ChecklistUpload;
}) {
  const [previewEvidence, setPreviewEvidence] = useState<ChecklistEvidence>({});
  const [uploading, setUploading] = useState(false);
  const proof = evidence ?? previewEvidence;
  const changeProof = onEvidenceChange ?? setPreviewEvidence;
  const visible = new Set(visibleChecklistQuestions(definition, answers).map((question) => question.id));
  const numbers = new Map([...visible].map((id, index) => [id,index + 1]));
  const readOnlyRef = useRef(readOnly);
  useEffect(() => { readOnlyRef.current = readOnly; }, [readOnly]);
  const set = (id: string, value: ChecklistAnswer) => onChange((previous) => ({ ...previous, [id]: value }));
  return <div className="space-y-6">{definition.sections.filter((section) => section.active).map((section) => <section key={section.id} className="rounded-3xl border border-[#ececf4] bg-white p-5 print:break-inside-avoid">
    <h2 className="text-[20px] font-semibold text-[#0b1024]">{section.title}</h2>
    {section.categories.filter((category) => category.active && category.questions.some((q) => visible.has(q.id))).map((category) => <div key={category.id} className="mt-4 space-y-4"><h3 className="text-[16px] font-medium text-[#3848c7]">{category.title}</h3>
      {category.questions.filter((question) => visible.has(question.id)).map((question) => {
        const value = answers[question.id];
        const text = typeof value === "string" ? value : "";
        return <div key={question.id} className="space-y-2 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4">
          <p className="text-[14px] font-medium text-[#0b1024]">{definition.numbering !== false ? `${numbers.get(question.id)}. ` : ""}{question.title}{question.required && question.type !== "info" ? <span aria-label="обязательно" className="text-[#a13a32]"> *</span> : null}</p>
          {question.description ? <ChecklistDescription text={question.description} /> : null}
          {question.references?.length ? <div className="flex flex-wrap gap-3 text-sm">{question.references.map((ref, index) => <a key={ref} className="text-indigo-600 underline" href={`/api/checklists/attachments/${ref.slice(5)}`} target="_blank" rel="noopener noreferrer">Инструкция {index + 1}</a>)}</div> : null}
          {question.type === "yes_no" ? <div className="flex flex-wrap gap-2">{[["yes", question.labels?.yes ?? "Да"], ["no", question.labels?.no ?? "Нет"], ["na", question.labels?.na ?? "Не применимо"]].filter(([, label]) => label).map(([code, label]) => <Button type="button" variant={value === code ? "default" : "outline"} aria-pressed={value === code} disabled={readOnly} key={code} onClick={() => set(question.id, code)}>{label}</Button>)}</div> : null}
          {question.type === "checkbox" ? <label className="flex items-center gap-2"><Checkbox aria-label={question.title} checked={value === true} disabled={readOnly} onCheckedChange={(checked) => set(question.id, checked === true)} />Да{value === undefined && !readOnly ? <Button type="button" variant="outline" size="sm" onClick={() => set(question.id, false)}>Нет</Button> : value === false ? <span className="text-[13px] text-[#6f7282]">Нет</span> : null}</label> : null}
          {question.type === "number" || question.type === "scale" ? <div className="flex items-center gap-2"><Input aria-label={question.title} type="number" min={question.min} max={question.max} step={question.step ?? "any"} value={typeof value === "number" ? value : ""} readOnly={readOnly} onChange={(e) => set(question.id, e.target.value === "" ? "" : Number(e.target.value))} />{question.unit ? <span className="text-sm">{question.unit}</span> : null}</div> : null}
          {question.type === "text" ? <Textarea aria-label={question.title} value={text} readOnly={readOnly} maxLength={10000} onChange={(e) => set(question.id, e.target.value)} /> : null}
          {question.type === "datetime" ? <Input aria-label={question.title} type="datetime-local" value={text} readOnly={readOnly} onChange={(e) => set(question.id, e.target.value)} /> : null}
          {question.type === "choice" ? <select aria-label={question.title} value={text} disabled={readOnly} onChange={(e) => set(question.id, e.target.value)} className="h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-3"><option value="">Выберите ответ</option>{question.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : null}
          {question.type === "multi" ? <div className="space-y-2">{question.options.map((option) => <label key={option.value} className="flex items-center gap-2 text-[14px]"><Checkbox disabled={readOnly} checked={Array.isArray(value) && value.includes(option.value)} onCheckedChange={(checked) => { const values = Array.isArray(value) ? value : []; set(question.id, checked ? [...values, option.value] : values.filter((item) => item !== option.value)); }} />{option.label}</label>)}</div> : null}
          {question.type === "photo" ? <div className="space-y-2"><p className="text-xs text-muted-foreground">Минимум фотографий: {question.minPhotos ?? 1}</p>{!readOnly ? <Input type="file" disabled={uploading || (Array.isArray(value) && value.length >= 10)} accept="image/png,image/jpeg,image/webp" capture="environment" aria-label={question.title} onChange={async (event) => {
            const file = event.target.files?.[0]; event.target.value = "";
            if (!file) return;
            if (upload) {
              setUploading(true);
              try { const ref = await upload(question.id, "photo", file); if (!readOnlyRef.current) onChange(previous => ({ ...previous, [question.id]: [...(Array.isArray(previous[question.id]) ? previous[question.id] as string[] : []), ref] })); }
              catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось загрузить фото"); }
              finally { setUploading(false); } return;
            }
            if (file.size > 2 * 1024 * 1024 || !["image/png", "image/jpeg"].includes(file.type)) { toast.error("Подойдёт JPG или PNG до 2 МБ"); return; }
            const reader = new FileReader(); reader.onload = () => { if (!readOnlyRef.current) set(question.id, String(reader.result)); }; reader.readAsDataURL(file);
          }} /> : null}<ChecklistMedia kind="photo" refs={Array.isArray(value) ? value : text ? [text] : []} onRemove={readOnly ? undefined : ref => set(question.id, Array.isArray(value) ? value.filter(item => item !== ref) : "")} /></div> : null}
          {question.type === "signature" ? <SignatureInput value={text} onChange={(next) => set(question.id, next)} readOnly={readOnly} /> : null}
          <ChecklistEvidenceForm questionId={question.id} value={proof[question.id]} requirements={checklistQuestionResult(question,value).requirements} onChange={next => changeProof(previous => ({ ...previous, [question.id]: next }))} upload={upload} readOnly={readOnly} errors={errors} />
          {errors[question.id] ? <p role="alert" className="text-[13px] text-[#a13a32]">{errors[question.id]}</p> : null}
        </div>;
      })}
    </div>)}
  </section>)}</div>;
}
