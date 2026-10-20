"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Copy, Play, Plus, Pencil, Archive, Eye, ClipboardCheck, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ChecklistBuilder, type ChecklistTemplateItem } from "@/components/checklists/checklist-builder";
import { ChecklistQuestionForm } from "@/components/checklists/checklist-question-form";
import type { ChecklistAnswers } from "@/lib/custom-checklists";

export function ChecklistsClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations("checklistPages.builder");
  const [templates, setTemplates] = useState<ChecklistTemplateItem[]>([]);
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
      // История проверок — на странице «Результаты» (`/checklists/results`).
      const response = await fetch("/api/checklists/templates", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Не удалось загрузить чек-листы");
      setTemplates(body.templates); setCanManage(body.canManage);
    } catch (err) { setError(err instanceof Error ? err.message : "Не удалось загрузить чек-листы"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  // «Изменить в конструкторе» со страницы «Шаблоны»: `?edit=<id>` или `?edit=new`.
  const editParam = searchParams.get("edit");
  useEffect(() => {
    if (!editParam || loading || !canManage) return;
    const target = editParam === "new" ? null : templates.find((template) => template.id === editParam);
    if (target === undefined) return;
    setEditing(target);
    router.replace("/checklists", { scroll: false });
  }, [editParam, loading, canManage, templates, router]);
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
    <Link href="/checklists/results" data-all-results className="group flex flex-wrap items-center gap-3 rounded-3xl border border-[#ececf4] bg-white p-5 transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"><span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]"><ClipboardCheck className="size-5" /></span><span className="min-w-0 flex-1"><span className="block text-[16px] font-semibold text-[#0b1024]">{t("allResults")}</span><span className="block text-[13px] text-[#6f7282]">{t("allResultsHint")}</span></span><ArrowRight className="size-5 text-[#5566f6] transition-transform duration-150 group-hover:translate-x-0.5" /></Link>
    {editing !== undefined ? <ChecklistBuilder template={editing} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); void load(); }} /> : null}
    <Dialog open={!!previewing} onOpenChange={(open) => { if (!open) setPreviewing(null); }}><DialogContent className="flex max-h-[90dvh] flex-col overflow-hidden rounded-3xl sm:max-w-[800px]"><DialogHeader><DialogTitle>Предпросмотр: {previewing?.title}</DialogTitle></DialogHeader><div className="overflow-y-auto">{previewing ? <ChecklistQuestionForm definition={previewing.definition} answers={previewAnswers} onChange={setPreviewAnswers} /> : null}</div></DialogContent></Dialog>
    <ConfirmDialog open={!!archiving} onClose={() => setArchiving(null)} onConfirm={async () => { if (archiving) await action(archiving, "archive"); }} title="Архивировать шаблон?" description="Созданные по нему проверки останутся в истории." confirmLabel="Архивировать" />
  </div>;
}
