"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Copy, Eye, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ChecklistQuestionForm } from "./checklist-question-form";
import { ChecklistConditionEditor, ChecklistQuestionSettings } from "./checklist-question-settings";
import { allChecklistQuestions, checklistDefinitionSchema, newChecklistQuestion, QUESTION_LABELS, QUESTION_TYPES, type ChecklistQuestion, type ChecklistDefinition, type ChecklistAnswers } from "@/lib/custom-checklists";
import { editChecklistStructure, moveChecklistNode, type ChecklistNodeKind } from "@/lib/custom-checklist-structure";
import { checklistPortableJson, checklistTypeSummary, checklistXlsxSample, parseChecklistJson, parseChecklistXlsx } from "@/lib/custom-checklist-transfer";

export type ChecklistTemplateItem = { id: string; title: string; version: number; definition: ChecklistDefinition };
const uid = () => crypto.randomUUID();
const initialDefinition = (): ChecklistDefinition => ({ description: "", sections: [{ id: uid(), title: "Раздел 1", active: true, categories: [{ id: uid(), title: "Категория 1", active: true, questions: [newChecklistQuestion(uid())] }] }] });
const selectClass = "h-10 min-w-0 max-w-full rounded-xl border bg-white px-2 text-sm";
function download(content: BlobPart, fileName: string, type: string) { const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement("a"); a.href = url; a.download = fileName; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }

export function ChecklistBuilder({ template, onSaved }: { template: ChecklistTemplateItem | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(template?.title ?? "Новый чек-лист");
  const [definition, setDefinition] = useState<ChecklistDefinition>(() => structuredClone(template?.definition ?? initialDefinition()));
  const [busy, setBusy] = useState(false);
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
    if (conflict || saved.current === JSON.stringify({ title, definition })) return;
    const timer = setTimeout(() => { void saveRef.current(); }, 1800);
    return () => clearTimeout(timer);
  }, [title, definition, conflict]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (saved.current !== JSON.stringify(current.current)) event.preventDefault(); };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const all = allChecklistQuestions(definition);
  const categories = definition.sections.flatMap(section => section.categories);
  function changeQuestion(id: string, patch: Partial<ChecklistQuestion>) { setDefinition(value => ({ ...value, sections: value.sections.map(section => ({ ...section, categories: section.categories.map(category => ({ ...category, questions: category.questions.map(question => question.id === id ? { ...question, ...patch } : question) })) })) })); }
  function changeCategory(id: string, patch: Partial<typeof categories[number]>) { setDefinition(value => ({ ...value, sections: value.sections.map(section => ({ ...section, categories: section.categories.map(category => category.id === id ? { ...category, ...patch } : category) })) })); }
  function changeSection(id: string, patch: Partial<ChecklistDefinition["sections"][number]>) { setDefinition(value => ({ ...value, sections: value.sections.map(section => section.id === id ? { ...section, ...patch } : section) })); }
  function close() { if (saving.current) return; if (saved.current !== JSON.stringify(current.current) && !window.confirm("Есть несохранённые изменения. Закрыть редактор? Для сохранения копии используйте экспорт JSON.")) return; onSaved(); }
  async function save(closeAfter = false): Promise<boolean> {
    if (saving.current || conflict) return false;
    const snapshot = structuredClone(current.current);
    const parsed = checklistDefinitionSchema.safeParse(snapshot.definition);
    if (!parsed.success || !snapshot.title.trim()) { setStatus(parsed.success ? "Введите название" : parsed.error.issues[0]?.message ?? "Проверьте настройки"); if (closeAfter) toast.error("Проверьте название и настройки шаблона"); return false; }
    if (saved.current === JSON.stringify(snapshot) && identity.current.id) { if (closeAfter) onSaved(); return true; }
    saving.current = true; setBusy(true); setStatus("Сохранение…");
    let success = false;
    try {
      const response = await fetch(identity.current.id ? `/api/checklists/templates/${identity.current.id}` : "/api/checklists/templates", { method: identity.current.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: snapshot.title, definition: parsed.data, ...(identity.current.id ? { version: identity.current.version } : {}) }) });
      const body = await response.json();
      if (!response.ok) { if (response.status === 409) setConflict(true); throw new Error(body.error || "Не удалось сохранить шаблон"); }
      identity.current = { id: body.template?.id ?? body.id ?? identity.current.id, version: body.template?.version ?? (identity.current.id ? identity.current.version + 1 : 1) };
      saved.current = JSON.stringify(snapshot); success = true;
      const unchanged = saved.current === JSON.stringify(current.current);
      if (mounted.current) { setStatus(unchanged ? "Все изменения сохранены" : "Сохраняем новые изменения…"); if (closeAfter && unchanged) { toast.success("Шаблон сохранён"); onSaved(); } }
      return unchanged;
    } catch (error) { if (mounted.current) { setStatus(error instanceof Error ? error.message : "Не удалось сохранить"); if (closeAfter) toast.error(error instanceof Error ? error.message : "Не удалось сохранить"); } return false; }
    finally { saving.current = false; if (mounted.current) { setBusy(false); if (success && saved.current !== JSON.stringify(current.current)) setTimeout(() => { if (mounted.current) void saveRef.current(); }, 2000); } }
  }
  saveRef.current = save;
  function controls(kind: ChecklistNodeKind, id: string, index: number, length: number) { return <div className="flex gap-1">{(["up", "down", "copy", "delete"] as const).map(action => <Button type="button" key={action} variant="outline" size="icon" aria-label={`${kind === "section" ? "Раздел" : kind === "category" ? "Категория" : "Вопрос"}: ${{up:"выше",down:"ниже",copy:"дублировать",delete:"удалить"}[action]}`} disabled={(action === "up" && index === 0) || (action === "down" && index === length - 1)} onClick={() => setDefinition(value => editChecklistStructure(value, kind, id, action, uid))}>{action === "up" ? <ArrowUp className="size-4" /> : action === "down" ? <ArrowDown className="size-4" /> : action === "copy" ? <Copy className="size-4" /> : <Trash2 className="size-4" />}</Button>)}</div>; }
  function collapse(id: string) { setCollapsed(value => { const next = new Set(value); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  async function importFile(file?: File) {
    if (!file) return;
    try { if (file.size > 2_000_000) throw new Error("Файл до 2 МБ (Excel — до 1 МБ)"); const result = file.name.toLowerCase().endsWith(".json") ? parseChecklistJson(await file.text()) : { title: title, definition: await parseChecklistXlsx(await file.arrayBuffer(), uid) }; setImported(result); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось прочитать файл"); }
  }
  return <Dialog open onOpenChange={open => { if (!open) close(); }}><DialogContent className="flex max-h-[94dvh] flex-col overflow-hidden rounded-3xl sm:max-w-[1100px]" style={{maxWidth:"min(1100px, calc(100vw - 2rem))"}} onEscapeKeyDown={event => { event.preventDefault(); close(); }}>
    <DialogHeader><DialogTitle>Конструктор чек-листа</DialogTitle><DialogDescription>Изменения сохраняются автоматически и действуют только для новых проверок.</DialogDescription></DialogHeader>
    <div className="min-h-0 space-y-4 overflow-y-auto px-1">
      <Input aria-label="Название чек-листа" value={title} maxLength={200} onChange={e => setTitle(e.target.value)} />
      <Textarea aria-label="Описание чек-листа" placeholder="Описание и инструкция" value={definition.description} maxLength={3000} onChange={e => setDefinition({ ...definition, description: e.target.value })} />
      <div className="flex flex-wrap items-center gap-2"><Button variant="outline" onClick={() => setPreview(!preview)}><Eye className="size-4" />{preview ? "Редактировать" : "Предпросмотр формы"}</Button><label className="flex items-center gap-2 text-sm"><Checkbox checked={definition.numbering !== false} onCheckedChange={checked => setDefinition({ ...definition, numbering: checked === true })} />Нумерация</label>
        <Button variant="outline" onClick={() => download(checklistPortableJson(title, definition), "checklist.json", "application/json")}>Экспорт JSON</Button>
        <Button variant="outline" onClick={async () => { try { download(await checklistXlsxSample(), "checklist-sample.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"); } catch { toast.error("Не удалось создать образец"); } }}>Образец Excel</Button>
        <label className="cursor-pointer rounded-xl border px-3 py-2 text-sm">Импорт Excel / JSON<input className="sr-only" aria-label="Импорт Excel или JSON" type="file" accept=".xlsx,.json" onChange={e => { void importFile(e.target.files?.[0]); e.target.value = ""; }} /></label>
        <Button variant="outline" disabled={busy} onClick={async () => { if (await save()) window.open(`/api/checklists/templates/${identity.current.id}/pdf`, "_blank", "noopener,noreferrer"); }}>PDF шаблона</Button>
      </div>
      {conflict ? <div role="alert" className="space-y-2 rounded-xl bg-amber-50 p-3 text-sm"><p>Шаблон изменён в другом окне. Ваши изменения сохранены в редакторе. Экспортируйте JSON перед загрузкой актуальной версии.</p><Button variant="outline" onClick={async () => { if (!identity.current.id || !window.confirm("Загрузить актуальную версию? Несохранённые изменения редактора будут заменены.")) return; const response = await fetch(`/api/checklists/templates/${identity.current.id}`); const body = await response.json(); if (!response.ok) { toast.error(body.error); return; } identity.current.version = body.template.version; saved.current = JSON.stringify({title:body.template.title,definition:body.template.definition}); setTitle(body.template.title); setDefinition(body.template.definition); setConflict(false); setStatus("Загружена актуальная версия"); }}>Загрузить актуальную версию</Button></div> : null}
      {preview ? <><label className="flex items-center gap-2 text-sm"><Checkbox checked={mobilePreview} onCheckedChange={checked => setMobilePreview(checked === true)} />Экран телефона</label><div data-testid="checklist-preview" className={mobilePreview ? "mx-auto w-full" : ""} style={mobilePreview ? {maxWidth:390} : undefined}><ChecklistQuestionForm definition={definition} answers={previewAnswers} onChange={setPreviewAnswers} /></div></> : <>
        {definition.sections.map((section, si) => <section key={section.id} className="space-y-3 rounded-3xl border border-[#ececf4] bg-[#fafbff] p-3 sm:p-4">
          <div className="flex flex-wrap items-center gap-2"><Button variant="ghost" onClick={() => collapse(section.id)} aria-expanded={!collapsed.has(section.id)}>{collapsed.has(section.id) ? "+" : "−"}</Button><Input aria-label="Название раздела" className="min-w-[140px] flex-1" value={section.title} maxLength={200} onChange={e => changeSection(section.id, { title: e.target.value })} /><label className="flex items-center gap-2 text-xs"><Checkbox checked={section.active} onCheckedChange={checked => changeSection(section.id, { active: checked === true })} />Активен</label>{controls("section", section.id, si, definition.sections.length)}</div>
          {!collapsed.has(section.id) ? <>{section.categories.map((category, ci) => <div key={category.id} className="space-y-3 rounded-2xl border border-[#ececf4] bg-white p-3">
            <div className="flex flex-wrap items-center gap-2"><Button variant="ghost" aria-expanded={!collapsed.has(category.id)} onClick={() => collapse(category.id)}>{collapsed.has(category.id) ? "+" : "−"}</Button><Input aria-label="Название категории" className="min-w-[140px] flex-1" value={category.title} maxLength={200} onChange={e => changeCategory(category.id, { title: e.target.value })} />{controls("category", category.id, ci, section.categories.length)}</div>
            <div className="flex flex-wrap items-center gap-3 text-sm"><label className="flex gap-2"><Checkbox checked={category.active} onCheckedChange={checked => changeCategory(category.id, { active: checked === true })} />Активна</label><label className="flex gap-2"><Checkbox checked={category.repeatable === true} onCheckedChange={checked => changeCategory(category.id, { repeatable: checked === true })} />Можно повторять при проверке</label><select className={selectClass} aria-label="Перенести категорию в раздел" value={section.id} onChange={e => setDefinition(value => moveChecklistNode(value, "category", category.id, e.target.value))}>{definition.sections.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></div>
            {!collapsed.has(category.id) ? <>{category.questions.map((q, qi) => <article key={q.id} className="space-y-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-3">
              <div className="flex flex-wrap gap-2"><Input aria-label="Название вопроса" className="min-w-[150px] flex-1" value={q.title} maxLength={300} onChange={e => changeQuestion(q.id, { title: e.target.value })} />{controls("question", q.id, qi, category.questions.length)}</div>
              <Textarea aria-label="Описание вопроса" placeholder="Инструкция, ссылки https://…" value={q.description} maxLength={3000} onChange={e => changeQuestion(q.id, { description: e.target.value })} />
              <div className="flex flex-wrap items-center gap-3"><select aria-label="Тип вопроса" className={selectClass} value={q.type} onChange={e => changeQuestion(q.id, { type: e.target.value as ChecklistQuestion["type"], logic: undefined, violation: undefined, options: ["choice", "multi"].includes(e.target.value) && !q.options.length ? [{ value: "1", label: "Вариант 1", score: 1 }, { value: "2", label: "Вариант 2", score: 0 }] : q.options })}>{QUESTION_TYPES.map(type => <option value={type} key={type}>{QUESTION_LABELS[type]}</option>)}</select><label className="flex gap-2 text-sm"><Checkbox checked={q.required} onCheckedChange={checked => changeQuestion(q.id, { required: checked === true })} />Обязателен</label><label className="flex gap-2 text-sm"><Checkbox checked={q.active} onCheckedChange={checked => changeQuestion(q.id, { active: checked === true })} />Активен</label><label className="flex items-center gap-2 text-sm">Вес<Input aria-label="Вес вопроса" className="w-24" type="number" min={0} max={1000} value={q.weight} onChange={e => changeQuestion(q.id, { weight: Number(e.target.value) })} /></label></div>
              <select className={selectClass} aria-label="Перенести вопрос в категорию" value={category.id} onChange={e => setDefinition(value => moveChecklistNode(value, "question", q.id, e.target.value))}>{categories.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select>
              {["number", "scale"].includes(q.type) ? <div className="flex gap-3">{(["min", "max"] as const).map(key => <label key={key} className="text-sm">{key === "min" ? "Минимум" : "Максимум"}<Input aria-label={key === "min" ? "Минимум" : "Максимум"} type="number" value={q[key]} onChange={e => changeQuestion(q.id, { [key]: Number(e.target.value) })} /></label>)}</div> : null}
              {["choice", "multi"].includes(q.type) ? <div className="space-y-2">{q.options.map((option, oi) => <div key={option.value} className="flex gap-2"><Input aria-label="Вариант ответа" value={option.label} maxLength={200} onChange={e => changeQuestion(q.id, { options: q.options.map((o, i) => i === oi ? { ...o, label: e.target.value } : o) })} /><Input aria-label="Оценка варианта" className="w-24" type="number" min={0} max={1} step={0.1} value={option.score} onChange={e => changeQuestion(q.id, { options: q.options.map((o, i) => i === oi ? { ...o, score: Number(e.target.value) } : o) })} /><Button variant="outline" aria-label="Удалить вариант" onClick={() => changeQuestion(q.id, { options: q.options.filter(o => o.value !== option.value) })}><Trash2 className="size-4" /></Button></div>)}<Button variant="outline" onClick={() => changeQuestion(q.id, { options: [...q.options, { value: uid(), label: "Новый вариант", score: 1 }] })}>Добавить вариант</Button></div> : null}
              <div className="space-y-2"><select aria-label="Показать вопрос при ответе" className={selectClass} value={q.showIf?.questionId ?? ""} onChange={e => { const parent = all.find(p => p.id === e.target.value); changeQuestion(q.id, { showIf: parent ? { questionId: parent.id, operator: "eq", value: parent.type === "checkbox" ? true : ["number", "scale"].includes(parent.type) ? 0 : parent.type === "yes_no" ? "yes" : "" } : undefined }); }}><option value="">Показывать всегда</option>{all.slice(0, all.findIndex(p => p.id === q.id)).filter(p => !["info", "photo", "signature"].includes(p.type)).map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select>{q.showIf ? <ChecklistConditionEditor type={all.find(p => p.id === q.showIf?.questionId)?.type ?? "text"} value={{ operator: q.showIf.operator ?? "eq", value: q.showIf.value, upper: q.showIf.upper }} onChange={condition => changeQuestion(q.id, { showIf: { questionId: q.showIf!.questionId, ...condition } })} /> : null}</div>
              <ChecklistQuestionSettings question={q} templateId={identity.current.id} onChange={patch => changeQuestion(q.id, patch)} />
            </article>)}<Button variant="outline" onClick={() => changeCategory(category.id, { questions: [...category.questions, newChecklistQuestion(uid())] })}><Plus className="size-4" />Добавить вопрос</Button></> : null}
          </div>)}<Button variant="outline" onClick={() => changeSection(section.id, { categories: [...section.categories, { id: uid(), title: "Новая категория", active: true, questions: [newChecklistQuestion(uid())] }] })}><Plus className="size-4" />Добавить категорию</Button></> : null}
        </section>)}<Button variant="outline" onClick={() => setDefinition({ ...definition, sections: [...definition.sections, { id: uid(), title: "Новый раздел", active: true, categories: [{ id: uid(), title: "Категория 1", active: true, questions: [newChecklistQuestion(uid())] }] }] })}><Plus className="size-4" />Добавить раздел</Button>
      </>}
    </div><div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3"><p role="status" className="text-xs text-muted-foreground">{status}</p><div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={close}>Закрыть</Button><Button disabled={busy || conflict} onClick={() => void save(true)}>Сохранить шаблон</Button></div></div>
    <Dialog open={!!imported} onOpenChange={open => { if (!open) setImported(null); }}><DialogContent className="max-h-[85dvh] overflow-y-auto rounded-3xl"><DialogHeader><DialogTitle>Проверка импорта</DialogTitle><DialogDescription>Импорт заменит структуру в редакторе после подтверждения.</DialogDescription></DialogHeader>{imported ? <><p>{checklistTypeSummary(imported.definition)}</p>{allChecklistQuestions(imported.definition).some(q => q.references?.length) ? <p className="text-sm text-amber-700">Файлы-инструкции доступны только в исходной организации. В другой организации загрузите их заново.</p> : null}<ol className="max-h-[40dvh] list-decimal overflow-y-auto pl-6 text-sm">{allChecklistQuestions(imported.definition).map(q => <li key={q.id}>{q.title} · {QUESTION_LABELS[q.type]}</li>)}</ol><Button onClick={() => { setTitle(imported.title); setDefinition(imported.definition); setImported(null); setPreviewAnswers({}); }}>Применить импорт</Button></> : null}</DialogContent></Dialog>
  </DialogContent></Dialog>;
}
