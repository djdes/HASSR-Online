"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Copy, Play, Plus, Pencil, Archive, Eye } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ChecklistBuilder, type ChecklistTemplateItem } from "@/components/checklists/checklist-builder";
import { ChecklistQuestionForm } from "@/components/checklists/checklist-question-form";
import type { ChecklistAnswers } from "@/lib/custom-checklists";

type Inspection = { id: string; title: string; status: string; templateVersion: number; createdAt: string; createdByName: string; completedByName: string | null };
export function ChecklistsClient() {
  const router = useRouter();
  const [templates, setTemplates] = useState<ChecklistTemplateItem[]>([]);
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<ChecklistTemplateItem | null | undefined>(undefined);
  const [previewing, setPreviewing] = useState<ChecklistTemplateItem | null>(null);
  const [previewAnswers, setPreviewAnswers] = useState<ChecklistAnswers>({});
  const [archiving, setArchiving] = useState<ChecklistTemplateItem | null>(null);
  const load = useCallback(async () => {
    setError("");
    try {
      const responses = await Promise.all([fetch("/api/checklists/templates", { cache: "no-store" }), fetch("/api/checklists/inspections", { cache: "no-store" })]);
      const bodies = await Promise.all(responses.map((response) => response.json()));
      if (!responses.every((response) => response.ok)) throw new Error(bodies.find((body) => body.error)?.error || "Не удалось загрузить чек-листы");
      setTemplates(bodies[0].templates); setCanManage(bodies[0].canManage); setInspections(bodies[1].inspections);
    } catch (err) { setError(err instanceof Error ? err.message : "Не удалось загрузить чек-листы"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function action(template: ChecklistTemplateItem, operation: "start" | "copy" | "archive") {
    setBusy(true);
    try {
      const response = await fetch(operation === "start" ? "/api/checklists/inspections" : operation === "copy" ? "/api/checklists/templates" : `/api/checklists/templates/${template.id}`, { method: operation === "archive" ? "DELETE" : "POST", headers: { "Content-Type": "application/json" }, ...(operation === "archive" ? {} : { body: JSON.stringify(operation === "start" ? { templateId: template.id } : { title: `${template.title} — копия`, definition: template.definition }) }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "Не удалось выполнить действие");
      if (operation === "start") router.push(`/checklists/inspections/${body.id}`);
      else { toast.success(operation === "copy" ? "Шаблон скопирован" : "Шаблон перенесён в архив; проверки сохранены"); setArchiving(null); await load(); }
    } catch (err) { toast.error(err instanceof Error ? err.message : "Не удалось выполнить действие"); }
    finally { setBusy(false); }
  }
  return <div className="space-y-6">
    {loading ? <p>Загрузка…</p> : null}
    {error ? <p role="alert" className="rounded-2xl bg-[#fff4f2] p-4 text-[#a13a32]">{error} <Button variant="outline" onClick={() => void load()}>Повторить</Button></p> : null}
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-[18px] font-semibold text-[#0b1024]">Шаблоны проверок</h2>{canManage ? <Button onClick={() => setEditing(null)}><Plus className="size-4" />Создать чек-лист</Button> : null}</div>
    {!templates.length && !loading && !error ? <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] p-8 text-[#6f7282]">Создайте шаблон с вопросами, затем начните проверку по нему.</div> : null}
    <div className="grid gap-4 md:grid-cols-2">{templates.map((template) => <article key={template.id} className="space-y-4 rounded-3xl border border-[#ececf4] bg-white p-5"><div><h3 className="text-[16px] font-semibold text-[#0b1024]">{template.title}</h3><p className="mt-1 text-[13px] text-[#6f7282]">Версия {template.version} · {template.definition.sections.length} разделов</p></div>
      <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => void action(template, "start")}><Play className="size-4" />Начать проверку</Button><Button variant="outline" onClick={() => { setPreviewing(template); setPreviewAnswers({}); }}><Eye className="size-4" />Превью</Button>{canManage ? <><Button variant="outline" aria-label={`Редактировать ${template.title}`} onClick={() => setEditing(template)}><Pencil className="size-4" /></Button><Button variant="outline" aria-label={`Скопировать ${template.title}`} disabled={busy} onClick={() => void action(template, "copy")}><Copy className="size-4" /></Button><Button variant="outline" aria-label={`Архивировать ${template.title}`} disabled={busy} onClick={() => setArchiving(template)}><Archive className="size-4" /></Button></> : null}</div>
    </article>)}</div>
    <section className="space-y-3"><h2 className="text-[18px] font-semibold text-[#0b1024]">История проверок</h2>{inspections.map((inspection) => <Link key={inspection.id} href={`/checklists/inspections/${inspection.id}`} className="flex flex-wrap justify-between gap-2 rounded-2xl border border-[#ececf4] bg-white p-4 text-[14px] transition-colors hover:bg-[#f5f6ff]"><span>{inspection.title} · версия {inspection.templateVersion}<span className="mt-1 block text-[12px] text-[#6f7282]">{new Date(inspection.createdAt).toLocaleString("ru-RU")} · {inspection.createdByName}{inspection.completedByName ? ` · Завершил: ${inspection.completedByName}` : ""}</span></span><span className="text-[#3848c7]">{inspection.status === "completed" ? "Завершена" : "Черновик"}</span></Link>)}{!inspections.length && !loading ? <p className="text-[14px] text-[#6f7282]">Проверок пока нет.</p> : null}</section>
    {editing !== undefined ? <ChecklistBuilder template={editing} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); void load(); }} /> : null}
    <Dialog open={!!previewing} onOpenChange={(open) => { if (!open) setPreviewing(null); }}><DialogContent className="flex max-h-[90dvh] flex-col overflow-hidden rounded-3xl sm:max-w-[800px]"><DialogHeader><DialogTitle>Предпросмотр: {previewing?.title}</DialogTitle></DialogHeader><div className="overflow-y-auto">{previewing ? <ChecklistQuestionForm definition={previewing.definition} answers={previewAnswers} onChange={setPreviewAnswers} /> : null}</div></DialogContent></Dialog>
    <ConfirmDialog open={!!archiving} onClose={() => setArchiving(null)} onConfirm={async () => { if (archiving) await action(archiving, "archive"); }} title="Архивировать шаблон?" description="Созданные по нему проверки останутся в истории." confirmLabel="Архивировать" />
  </div>;
}
