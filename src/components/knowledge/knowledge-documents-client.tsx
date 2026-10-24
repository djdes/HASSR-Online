"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Eye, FileText, Pencil, Trash2, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ackKnowledgeKey } from "@/lib/ppk/acknowledge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { KNOWLEDGE_ACCEPT, KNOWLEDGE_MAX_BYTES, knowledgeInline, type KnowledgeDocumentItem } from "@/lib/knowledge-documents";

type Preview = { kind: "text"; text: string } | { kind: "spreadsheet"; sheets: Array<{ name: string; rows: string[][] }> } | { kind: "file"; message: string };

export function KnowledgeDocumentsClient({ canManage }: { canManage: boolean }) {
  const [documents, setDocuments] = useState<KnowledgeDocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<KnowledgeDocumentItem | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [renaming, setRenaming] = useState<KnowledgeDocumentItem | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [deleting, setDeleting] = useState<KnowledgeDocumentItem | null>(null);
  const [ack, setAck] = useState<Record<string, { acknowledged: number; total: number }>>({});
  const tAck = useTranslations("productionControl.ack");
  const t = useTranslations("knowledgeUi.knowledgeDocumentsClient");
  const tc = useTranslations("common");
  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/knowledge-documents", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || t("loadFailed"));
      setDocuments(body.documents);
      // Руководителю — сколько сотрудников ознакомились с каждой инструкцией. Ошибка не мешает списку.
      if (canManage && body.documents.length) {
        const keys = (body.documents as KnowledgeDocumentItem[]).map((doc) => ackKnowledgeKey(doc.id)).join(",");
        void fetch(`/api/production-control/acknowledgements?docKeys=${encodeURIComponent(keys)}`, { cache: "no-store" })
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => { if (data?.stats) setAck(data.stats); })
          .catch(() => {});
      }
    } catch (err) { setError(err instanceof Error ? err.message : t("loadFailed")); }
    finally { setLoading(false); }
  }, [canManage, t]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    setPreview(null);
    if (!viewing || knowledgeInline(viewing.mimeType)) return;
    const abort = new AbortController();
    void fetch(`/api/knowledge-documents/${viewing.id}/preview`, { cache: "no-store", signal: abort.signal }).then(async (response) => {
      if (!response.ok) throw new Error(t("previewUnavailable"));
      const body = await response.json();
      if (!abort.signal.aborted) setPreview(body);
    }).catch(() => { if (!abort.signal.aborted) setPreview({ kind: "file", message: t("previewUnavailableDownload") }); });
    return () => abort.abort();
  }, [viewing, t]);
  async function upload(files: File[]) {
    setBusy(true);
    for (const file of files) {
      try {
        if (file.size > KNOWLEDGE_MAX_BYTES) throw new Error(t("fileTooLarge", { name: file.name }));
        const form = new FormData(); form.append("file", file);
        const response = await fetch("/api/knowledge-documents", { method: "POST", body: form });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || t("uploadFailed"));
        toast.success(t("uploaded", { name: file.name }));
      } catch (err) { toast.error(err instanceof Error ? err.message : t("uploadFailed")); }
    }
    await load(); setBusy(false);
  }
  async function mutate(document: KnowledgeDocumentItem, remove: boolean) {
    const response = await fetch(`/api/knowledge-documents/${document.id}`, { method: remove ? "DELETE" : "PATCH", headers: { "Content-Type": "application/json" }, ...(remove ? {} : { body: JSON.stringify({ title: newTitle }) }) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || t("saveFailed"));
    setDeleting(null); setRenaming(null); await load(); toast.success(remove ? t("deleted") : t("titleSaved"));
  }
  return <div className="space-y-5">
    {canManage ? <section className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] p-6">
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-[#5566f6] px-5 py-3 text-[14px] font-medium text-white"><Upload className="size-4" />{busy ? t("uploading") : t("upload")}<input type="file" multiple accept={KNOWLEDGE_ACCEPT} disabled={busy} className="sr-only" onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ""; void upload(files); }} /></label>
      <p className="mt-3 text-[13px] text-[#6f7282]">{t("hint")}</p>
    </section> : null}
    {error ? <div role="alert" className="rounded-2xl bg-[#fff4f2] p-4 text-[#a13a32]">{error}<Button variant="outline" className="ml-3" onClick={() => void load()}>{tc("retry")}</Button></div> : null}
    {loading ? <p>{tc("loading")}</p> : !documents.length && !error ? <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] p-10 text-center text-[#6f7282]">{t("empty")}</div> : null}
    <div className="space-y-3">{documents.map((document) => <article key={document.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#ececf4] bg-white p-4">
      <FileText className="size-6 shrink-0 text-[#5566f6]" /><div className="min-w-0 flex-1"><h2 className="break-words text-[15px] font-medium text-[#0b1024]">{document.title}</h2><p className="mt-1 break-words text-[12px] text-[#6f7282]">{document.fileName} · {t("sizeMb", { size: (document.sizeBytes / 1024 / 1024).toFixed(2) })} · {document.uploadedByName}</p>{ack[ackKnowledgeKey(document.id)] ? <span className="mt-1.5 inline-flex rounded-full bg-[#eef1ff] px-2.5 py-0.5 text-[12px] font-medium text-[#3848c7]">{tAck("pill", { done: String(ack[ackKnowledgeKey(document.id)].acknowledged), total: String(ack[ackKnowledgeKey(document.id)].total) })}</span> : null}</div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" aria-label={t("previewAria", { title: document.title })} onClick={() => setViewing(document)}><Eye className="size-4" />{t("view")}</Button><a className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] px-3 text-[14px]" href={`/api/knowledge-documents/${document.id}/file?download=1`}><Download className="size-4" />{tc("download")}</a>
      {canManage ? <><Button variant="outline" aria-label={t("renameAria", { title: document.title })} onClick={() => { setRenaming(document); setNewTitle(document.title); }}><Pencil className="size-4" /></Button><Button variant="outline" aria-label={t("deleteAria", { title: document.title })} onClick={() => setDeleting(document)}><Trash2 className="size-4" /></Button></> : null}</div>
    </article>)}</div>
    <Dialog open={!!viewing} onOpenChange={(open) => { if (!open) setViewing(null); }}><DialogContent className="flex max-h-[90dvh] flex-col overflow-hidden rounded-3xl sm:max-w-[1000px]"><DialogHeader><DialogTitle>{viewing?.title}</DialogTitle><DialogDescription>{viewing?.fileName}</DialogDescription></DialogHeader><div className="min-h-0 overflow-auto">
      {viewing && knowledgeInline(viewing.mimeType) ? viewing.mimeType === "application/pdf" ? <iframe title={viewing.title} src={`/api/knowledge-documents/${viewing.id}/file`} className="h-[65dvh] w-full rounded-2xl border border-[#ececf4]" /> :
        // Authenticated images cannot use the unauthenticated Next image optimizer.
        // eslint-disable-next-line @next/next/no-img-element
        <img alt={viewing.title} src={`/api/knowledge-documents/${viewing.id}/file`} className="max-h-[65dvh] max-w-full object-contain" /> : preview?.kind === "text" ? <pre className="whitespace-pre-wrap break-words rounded-2xl bg-[#fafbff] p-4 font-sans text-[14px]">{preview.text}</pre> : preview?.kind === "spreadsheet" ? preview.sheets.map((sheet) => <section key={sheet.name} className="mb-5"><h3 className="mb-2 font-medium">{sheet.name}</h3><table className="border-collapse text-[13px]"><tbody>{sheet.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j} className="min-w-[80px] max-w-[300px] break-words border border-[#ececf4] p-2">{cell}</td>)}</tr>)}</tbody></table><p className="mt-2 text-[12px] text-[#6f7282]">{t("spreadsheetNote")}</p></section>) : <p className="rounded-2xl bg-[#fafbff] p-5 text-[#6f7282]">{preview?.kind === "file" ? preview.message : t("loadingPreview")}</p>}
    </div></DialogContent></Dialog>
    <Dialog open={!!renaming} onOpenChange={(open) => { if (!open) setRenaming(null); }}><DialogContent className="rounded-3xl"><DialogHeader><DialogTitle>{t("titleLabel")}</DialogTitle><DialogDescription>{t("fileStays")}</DialogDescription></DialogHeader><Input aria-label={t("titleLabel")} value={newTitle} maxLength={200} onChange={(e) => setNewTitle(e.target.value)} /><Button disabled={busy || !newTitle.trim()} onClick={async () => { if (!renaming) return; setBusy(true); try { await mutate(renaming, false); } catch (err) { toast.error(err instanceof Error ? err.message : t("saveFailed")); } finally { setBusy(false); } }}>{tc("save")}</Button></DialogContent></Dialog>
    <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={async () => { if (deleting) await mutate(deleting, true); }} title={t("deleteTitle")} description={deleting?.title} confirmLabel={tc("delete")} variant="danger" />
  </div>;
}
