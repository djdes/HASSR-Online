"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Copy, Eye, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ChecklistQuestionForm } from "./checklist-question-form";
import { ChecklistConditionEditor, ChecklistQuestionSettings } from "./checklist-question-settings";
import { allChecklistQuestions, checklistDefinitionSchema, defaultChecklistCondition, newChecklistQuestion, QUESTION_TYPES, type ChecklistQuestion, type ChecklistDefinition, type ChecklistAnswers } from "@/lib/custom-checklists";
import { editChecklistStructure, moveChecklistNode, removedChecklistConditions, type ChecklistNodeKind } from "@/lib/custom-checklist-structure";
import { checklistPortableJson, checklistXlsxSample, parseChecklistJson, parseChecklistXlsx } from "@/lib/custom-checklist-transfer";

export type ChecklistTemplateItem = { id: string; title: string; version: number; definition: ChecklistDefinition };
const uid = () => crypto.randomUUID();
const selectClass = "h-10 min-w-0 max-w-full rounded-xl border bg-white px-2 text-sm";
function download(content: BlobPart, fileName: string, type: string) { const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement("a"); a.href = url; a.download = fileName; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }

export function ChecklistBuilder({ template, onSaved }: { template: ChecklistTemplateItem | null; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations("checklistsUi.checklistBuilder");
  const newQuestion = () => ({ ...newChecklistQuestion(uid()), title: t("newQuestion") });
  const initialDefinition = (): ChecklistDefinition => ({ description: "", sections: [{ id: uid(), title: t("defaultSection"), active: true, categories: [{ id: uid(), title: t("defaultCategory"), active: true, questions: [newQuestion()] }] }] });
  const typeLabel = (type: ChecklistQuestion["type"]) => {
    switch (type) {
      case "yes_no": return t("typeYesNo");
      case "scale": return t("typeScale");
      case "choice": return t("typeChoice");
      case "multi": return t("typeMulti");
      case "number": return t("typeNumber");
      case "checkbox": return t("typeCheckbox");
      case "datetime": return t("typeDatetime");
      case "photo": return t("typePhoto");
      case "text": return t("typeText");
      case "info": return t("typeInfo");
      case "signature": return t("typeSignature");
    }
  };
  const [title, setTitle] = useState(template?.title ?? t("newChecklist"));
  const [definition, setDefinition] = useState<ChecklistDefinition>(() => structuredClone(template?.definition ?? initialDefinition()));
  const [busy, setBusy] = useState(false);
  const [pendingUploads,setPendingUploads]=useState(0);
  const uploadingRef=useRef(0);uploadingRef.current=pendingUploads;
  const [status, setStatus] = useState("");
  const [conflict, setConflict] = useState(false);
  const [preview, setPreview] = useState(false);
  const [mobilePreview, setMobilePreview] = useState(false);
  const [previewAnswers, setPreviewAnswers] = useState<ChecklistAnswers>({});
  const [imported, setImported] = useState<{title: string; definition: ChecklistDefinition} | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const identity = useRef({ id: template?.id, version: template?.version ?? 1 });
  const saving = useRef(false);
  const mounted = useRef(true);
  const current = useRef({ title, definition }); current.current = { title, definition };
  const saved = useRef(JSON.stringify({ title, definition }));
  const saveRef = useRef<(close?: boolean) => Promise<boolean>>(async () => false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (conflict || pendingUploads || saved.current === JSON.stringify({ title, definition })) return;
    const timer = setTimeout(() => { void saveRef.current(); }, 1800);
    return () => clearTimeout(timer);
  }, [title, definition, conflict,pendingUploads]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (uploadingRef.current || saved.current !== JSON.stringify(current.current)) event.preventDefault(); };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const all = allChecklistQuestions(definition);
  const categories = definition.sections.flatMap(section => section.categories);
  function changeQuestion(id: string, patch: Partial<ChecklistQuestion>) { setDefinition(value => ({ ...value, sections: value.sections.map(section => ({ ...section, categories: section.categories.map(category => ({ ...category, questions: category.questions.map(question => question.id === id ? { ...question, ...patch } : question) })) })) })); }
  function changeCategory(id: string, patch: Partial<typeof categories[number]>) { setDefinition(value => ({ ...value, sections: value.sections.map(section => ({ ...section, categories: section.categories.map(category => category.id === id ? { ...category, ...patch } : category) })) })); }
  function changeSection(id: string, patch: Partial<ChecklistDefinition["sections"][number]>) { setDefinition(value => ({ ...value, sections: value.sections.map(section => section.id === id ? { ...section, ...patch } : section) })); }
  function applyStructure(next:ChecklistDefinition) {
    const changed=removedChecklistConditions(definition,next);
    if(changed.length&&!window.confirm(t("conditionsReset", { titles: `${changed.slice(0,3).map(q=>q.title).join(", ")}${changed.length>3?` ${t("andMore", { count: changed.length-3 })}`:""}` })))return;
    setDefinition(next);
  }
  function close() { if (uploadingRef.current) {toast.error(t("waitUploads"));return;} if (saving.current) return; if (saved.current !== JSON.stringify(current.current) && !window.confirm(t("unsavedConfirm"))) return; onSaved(); }
  async function save(closeAfter = false): Promise<boolean> {
    if (saving.current || conflict || uploadingRef.current) return false;
    const snapshot = structuredClone(current.current);
    const parsed = checklistDefinitionSchema.safeParse(snapshot.definition);
    if (!parsed.success || !snapshot.title.trim()) { setStatus(parsed.success ? t("enterTitle") : parsed.error.issues[0]?.message ?? t("checkSettings")); if (closeAfter) toast.error(t("checkTitleAndSettings")); return false; }
    if (saved.current === JSON.stringify(snapshot) && identity.current.id) { if (closeAfter) onSaved(); return true; }
    saving.current = true; setBusy(true); setStatus(t("saving"));
    let success = false;
    try {
      const response = await fetch(identity.current.id ? `/api/checklists/templates/${identity.current.id}` : "/api/checklists/templates", { method: identity.current.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: snapshot.title, definition: parsed.data, ...(identity.current.id ? { version: identity.current.version } : {}) }) });
      const body = await response.json();
      if (!response.ok) { if (response.status === 409) setConflict(true); throw new Error(body.error || t("saveTemplateFailed")); }
      identity.current = { id: body.template?.id ?? body.id ?? identity.current.id, version: body.template?.version ?? (identity.current.id ? identity.current.version + 1 : 1) };
      saved.current = JSON.stringify(snapshot); success = true;
      const unchanged = saved.current === JSON.stringify(current.current);
      if (mounted.current) { setStatus(unchanged ? t("allSaved") : t("savingNew")); if (closeAfter && unchanged) { toast.success(t("templateSaved")); onSaved(); } }
      return unchanged;
    } catch (error) { if (mounted.current) { setStatus(error instanceof Error ? error.message : t("saveFailed")); if (closeAfter) toast.error(error instanceof Error ? error.message : t("saveFailed")); } return false; }
    finally { saving.current = false; if (mounted.current) { setBusy(false); if (success && saved.current !== JSON.stringify(current.current)) setTimeout(() => { if (mounted.current) void saveRef.current(); }, 2000); } }
  }
  saveRef.current = save;
  function controls(kind: ChecklistNodeKind, id: string, index: number, length: number) { return <div className="flex gap-1">{(["up", "down", "copy", "delete"] as const).map(action => <Button type="button" key={action} variant="outline" size="icon" aria-label={t("controlLabel", { kind: kind === "section" ? t("kindSection") : kind === "category" ? t("kindCategory") : t("kindQuestion"), action: action === "up" ? t("actionUp") : action === "down" ? t("actionDown") : action === "copy" ? t("actionCopy") : t("actionDelete") })} disabled={(action === "up" && index === 0) || (action === "down" && index === length - 1)} onClick={() => applyStructure(editChecklistStructure(definition, kind, id, action, uid))}>{action === "up" ? <ArrowUp className="size-4" /> : action === "down" ? <ArrowDown className="size-4" /> : action === "copy" ? <Copy className="size-4" /> : <Trash2 className="size-4" />}</Button>)}</div>; }
  function collapse(id: string) { setCollapsed(value => { const next = new Set(value); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  async function importFile(file?: File) {
    if (!file) return;
    try { if (file.size > 2_000_000) throw new Error(t("fileTooBig")); const result = file.name.toLowerCase().endsWith(".json") ? parseChecklistJson(await file.text()) : { title: title, definition: await parseChecklistXlsx(await file.arrayBuffer(), uid) }; setImported(result); }
    catch (error) { toast.error(error instanceof Error ? error.message : t("readFailed")); }
  }
  return <Dialog open onOpenChange={open => { if (!open) close(); }}><DialogContent className="flex max-h-[94dvh] flex-col overflow-hidden rounded-3xl sm:max-w-[1100px]" style={{maxWidth:"min(1100px, calc(100vw - 2rem))"}} onEscapeKeyDown={event => { event.preventDefault(); close(); }}>
    <DialogHeader><DialogTitle>{t("title")}</DialogTitle><DialogDescription>{t("description")}</DialogDescription></DialogHeader>
    <div className="min-h-0 space-y-4 overflow-y-auto px-1">
      <Input aria-label={t("titleLabel")} value={title} maxLength={200} onChange={e => setTitle(e.target.value)} />
      <Textarea aria-label={t("descriptionLabel")} placeholder={t("descriptionPlaceholder")} value={definition.description} maxLength={3000} onChange={e => setDefinition({ ...definition, description: e.target.value })} />
      <div className="flex flex-wrap items-center gap-2"><Button variant="outline" onClick={() => setPreview(!preview)}><Eye className="size-4" />{preview ? t("edit") : t("previewForm")}</Button><label className="flex items-center gap-2 text-sm"><Checkbox checked={definition.numbering !== false} onCheckedChange={checked => setDefinition({ ...definition, numbering: checked === true })} />{t("numbering")}</label>
        <Button variant="outline" onClick={() => download(checklistPortableJson(title, definition), "checklist.json", "application/json")}>{t("exportJson")}</Button>
        <Button variant="outline" onClick={async () => { try { download(await checklistXlsxSample(), "checklist-sample.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"); } catch { toast.error(t("sampleFailed")); } }}>{t("sampleExcel")}</Button>
        <label className="cursor-pointer rounded-xl border px-3 py-2 text-sm">{t("importLabel")}<input className="sr-only" aria-label={t("importAria")} type="file" accept=".xlsx,.json" onChange={e => { void importFile(e.target.files?.[0]); e.target.value = ""; }} /></label>
        <Button variant="outline" disabled={busy || !!pendingUploads} onClick={async () => { if (await save()) window.open(`/api/checklists/templates/${identity.current.id}/pdf`, "_blank", "noopener,noreferrer"); }}>{t("templatePdf")}</Button>
      </div>
      {conflict ? <div role="alert" className="space-y-2 rounded-xl bg-amber-50 p-3 text-sm"><p>{t("conflictText")}</p><Button variant="outline" onClick={async () => { if (!identity.current.id || !window.confirm(t("reloadConfirm"))) return; const response = await fetch(`/api/checklists/templates/${identity.current.id}`); const body = await response.json(); if (!response.ok) { toast.error(body.error); return; } identity.current.version = body.template.version; saved.current = JSON.stringify({title:body.template.title,definition:body.template.definition}); setTitle(body.template.title); setDefinition(body.template.definition); setConflict(false); setStatus(t("reloaded")); }}>{t("reload")}</Button></div> : null}
      {preview ? <><label className="flex items-center gap-2 text-sm"><Checkbox checked={mobilePreview} onCheckedChange={checked => setMobilePreview(checked === true)} />{t("phoneScreen")}</label><div data-testid="checklist-preview" className={mobilePreview ? "mx-auto w-full" : ""} style={mobilePreview ? {maxWidth:390} : undefined}><ChecklistQuestionForm definition={definition} answers={previewAnswers} onChange={setPreviewAnswers} /></div></> : <>
        {definition.sections.map((section, si) => <section key={section.id} className="space-y-3 rounded-3xl border border-[#ececf4] bg-[#fafbff] p-3 sm:p-4">
          <div className="flex flex-wrap items-center gap-2"><Button variant="ghost" onClick={() => collapse(section.id)} aria-expanded={!collapsed.has(section.id)}>{collapsed.has(section.id) ? "+" : "−"}</Button><Input aria-label={t("sectionName")} className="min-w-[140px] flex-1" value={section.title} maxLength={200} onChange={e => changeSection(section.id, { title: e.target.value })} /><label className="flex items-center gap-2 text-xs"><Checkbox checked={section.active} onCheckedChange={checked => changeSection(section.id, { active: checked === true })} />{t("active")}</label>{controls("section", section.id, si, definition.sections.length)}</div>
          {!collapsed.has(section.id) ? <>{section.categories.map((category, ci) => <div key={category.id} className="space-y-3 rounded-2xl border border-[#ececf4] bg-white p-3">
            <div className="flex flex-wrap items-center gap-2"><Button variant="ghost" aria-expanded={!collapsed.has(category.id)} onClick={() => collapse(category.id)}>{collapsed.has(category.id) ? "+" : "−"}</Button><Input aria-label={t("categoryName")} className="min-w-[140px] flex-1" value={category.title} maxLength={200} onChange={e => changeCategory(category.id, { title: e.target.value })} />{controls("category", category.id, ci, section.categories.length)}</div>
            <div className="flex flex-wrap items-center gap-3 text-sm"><label className="flex gap-2"><Checkbox checked={category.active} onCheckedChange={checked => changeCategory(category.id, { active: checked === true })} />{t("activeFeminine")}</label><label className="flex gap-2"><Checkbox checked={category.repeatable === true} onCheckedChange={checked => changeCategory(category.id, { repeatable: checked === true })} />{t("repeatable")}</label><select className={selectClass} aria-label={t("moveCategory")} value={section.id} onChange={e => applyStructure(moveChecklistNode(definition, "category", category.id, e.target.value))}>{definition.sections.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></div>
            {!collapsed.has(category.id) ? <>{category.questions.map((q, qi) => <article key={q.id} className="space-y-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-3">
              <div className="flex flex-wrap gap-2"><Input aria-label={t("questionName")} className="min-w-[150px] flex-1" value={q.title} maxLength={300} onChange={e => changeQuestion(q.id, { title: e.target.value })} />{controls("question", q.id, qi, category.questions.length)}</div>
              <Textarea aria-label={t("questionDescription")} placeholder={t("questionDescriptionPlaceholder")} value={q.description} maxLength={3000} onChange={e => changeQuestion(q.id, { description: e.target.value })} />
              <div className="flex flex-wrap items-center gap-3"><select aria-label={t("questionType")} className={selectClass} value={q.type} onChange={e => changeQuestion(q.id, { type: e.target.value as ChecklistQuestion["type"], logic: undefined, violation: undefined, options: ["choice", "multi"].includes(e.target.value) && !q.options.length ? [{ value: "1", label: t("option1"), score: 1 }, { value: "2", label: t("option2"), score: 0 }] : q.options })}>{QUESTION_TYPES.map(type => <option value={type} key={type}>{typeLabel(type)}</option>)}</select><label className="flex gap-2 text-sm"><Checkbox checked={q.required} onCheckedChange={checked => changeQuestion(q.id, { required: checked === true })} />{t("required")}</label><label className="flex gap-2 text-sm"><Checkbox checked={q.active} onCheckedChange={checked => changeQuestion(q.id, { active: checked === true })} />{t("active")}</label><label className="flex items-center gap-2 text-sm">{t("weight")}<Input aria-label={t("weightLabel")} className="w-24" type="number" min={0} max={1000} value={q.weight} onChange={e => changeQuestion(q.id, { weight: Number(e.target.value) })} /></label></div>
              <select className={selectClass} aria-label={t("moveQuestion")} value={category.id} onChange={e => applyStructure(moveChecklistNode(definition, "question", q.id, e.target.value))}>{categories.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select>
              {["number", "scale"].includes(q.type) ? <div className="flex gap-3">{(["min", "max"] as const).map(key => <label key={key} className="text-sm">{key === "min" ? t("minimum") : t("maximum")}<Input aria-label={key === "min" ? t("minimum") : t("maximum")} type="number" value={q[key]} onChange={e => changeQuestion(q.id, { [key]: Number(e.target.value) })} /></label>)}</div> : null}
              {["choice", "multi"].includes(q.type) ? <div className="space-y-2">{q.options.map((option, oi) => <div key={option.value} className="flex gap-2"><Input aria-label={t("optionAnswer")} value={option.label} maxLength={200} onChange={e => changeQuestion(q.id, { options: q.options.map((o, i) => i === oi ? { ...o, label: e.target.value } : o) })} /><Input aria-label={t("optionScore")} className="w-24" type="number" min={0} max={1} step={0.1} value={option.score} onChange={e => changeQuestion(q.id, { options: q.options.map((o, i) => i === oi ? { ...o, score: Number(e.target.value) } : o) })} /><Button variant="outline" aria-label={t("removeOption")} onClick={() => changeQuestion(q.id, { options: q.options.filter(o => o.value !== option.value) })}><Trash2 className="size-4" /></Button></div>)}<Button variant="outline" onClick={() => changeQuestion(q.id, { options: [...q.options, { value: uid(), label: t("newOption"), score: 1 }] })}>{t("addOption")}</Button></div> : null}
              <div className="space-y-2"><select aria-label={t("showIfLabel")} className={selectClass} value={q.showIf?.questionId ?? ""} onChange={e => { const parent = all.find(p => p.id === e.target.value); changeQuestion(q.id, { showIf: parent ? { questionId: parent.id, ...defaultChecklistCondition(parent) } : undefined }); }}><option value="">{t("showAlways")}</option>{all.slice(0, all.findIndex(p => p.id === q.id)).filter(p => !["info", "photo", "signature"].includes(p.type)).map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select>{q.showIf ? <ChecklistConditionEditor type={all.find(p => p.id === q.showIf?.questionId)?.type ?? "text"} options={all.find(p=>p.id===q.showIf?.questionId)?.options} labels={all.find(p=>p.id===q.showIf?.questionId)?.labels} value={{ operator: q.showIf.operator ?? "eq", value: q.showIf.value, upper: q.showIf.upper }} onChange={condition => changeQuestion(q.id, { showIf: { questionId: q.showIf!.questionId, ...condition } })} /> : null}</div>
              <ChecklistQuestionSettings question={q} templateId={identity.current.id} onChange={patch => changeQuestion(q.id, patch)} onUploadState={uploading=>setPendingUploads(count=>Math.max(0,count+(uploading?1:-1)))} />
            </article>)}<Button variant="outline" onClick={() => changeCategory(category.id, { questions: [...category.questions, newQuestion()] })}><Plus className="size-4" />{t("addQuestion")}</Button></> : null}
          </div>)}<Button variant="outline" onClick={() => changeSection(section.id, { categories: [...section.categories, { id: uid(), title: t("newCategory"), active: true, questions: [newQuestion()] }] })}><Plus className="size-4" />{t("addCategory")}</Button></> : null}
        </section>)}<Button variant="outline" onClick={() => setDefinition({ ...definition, sections: [...definition.sections, { id: uid(), title: t("newSection"), active: true, categories: [{ id: uid(), title: t("defaultCategory"), active: true, questions: [newQuestion()] }] }] })}><Plus className="size-4" />{t("addSection")}</Button>
      </>}
    </div><div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3"><p role="status" className="text-xs text-muted-foreground">{pendingUploads?t("loadingFiles"):status}</p><div className="flex gap-2"><Button variant="outline" disabled={busy || !!pendingUploads} onClick={close}>{t("close")}</Button><Button disabled={busy || conflict || !!pendingUploads} onClick={() => void save(true)}>{t("saveTemplate")}</Button></div></div>
    <Dialog open={!!imported} onOpenChange={open => { if (!open) setImported(null); }}><DialogContent className="max-h-[85dvh] overflow-y-auto rounded-3xl"><DialogHeader><DialogTitle>{t("importCheck")}</DialogTitle><DialogDescription>{t("importLead")}</DialogDescription></DialogHeader>{imported ? <><p>{t("importSummary", { sections: imported.definition.sections.length, questions: allChecklistQuestions(imported.definition).length, types: [...new Set(allChecklistQuestions(imported.definition).map(q => typeLabel(q.type)))].join(", ") })}</p>{allChecklistQuestions(imported.definition).some(q => q.references?.length) ? <p className="text-sm text-amber-700">{t("importFilesNote")}</p> : null}<ol className="max-h-[40dvh] list-decimal overflow-y-auto pl-6 text-sm">{allChecklistQuestions(imported.definition).map(q => <li key={q.id}>{q.title} · {typeLabel(q.type)}</li>)}</ol><Button onClick={() => { setTitle(imported.title); setDefinition(imported.definition); setImported(null); setPreviewAnswers({}); }}>{t("applyImport")}</Button></> : null}</DialogContent></Dialog>
  </DialogContent></Dialog>;
}
