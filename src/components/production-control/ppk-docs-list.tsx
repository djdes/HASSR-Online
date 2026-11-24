"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { FilePlus2, FileText, Loader2, Pencil, RefreshCw, Trash2, Upload } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { KNOWLEDGE_ACCEPT, KNOWLEDGE_MAX_BYTES } from "@/lib/knowledge-documents";
import { isTextDoc, type TextDocSource } from "@/lib/ppk/text-docs";
import { useTariffLimitToast } from "@/lib/billing-limit-toast";
import { RevisionControl, useRevisionStates } from "@/components/production-control/revision-control";
import { TextDocDialog } from "@/components/production-control/text-doc-dialog";
import {
  PPK_BUTTON_OUTLINE_CLASS,
  PPK_BUTTON_PRIMARY_CLASS,
  PPK_ICON_BUTTON_CLASS,
} from "@/components/production-control/ppk-ui";

export type DocRow = { id: string; title: string; fileName: string; mimeType: string; sizeBytes: number; createdAt: string };

const LIST_URL: Record<TextDocSource, string> = {
  knowledge: "/api/knowledge-documents",
  procedures: "/api/production-control/files?folder=procedures",
};

function docDate(iso: string, locale: string, timeZone: string): string {
  const options = { day: "numeric", month: "long", year: "numeric" } as const;
  try {
    return new Date(iso).toLocaleDateString(locale, { ...options, timeZone });
  } catch {
    return new Date(iso).toLocaleDateString(locale, { ...options, timeZone: "Europe/Moscow" });
  }
}

function fileUrl(source: TextDocSource, id: string): string {
  return source === "knowledge" ? `/api/knowledge-documents/${id}/file` : `/api/production-control/files/${id}`;
}

/**
 * Документы приложений № 5 «Документированные процедуры» и № 6 «Рабочие
 * инструкции»: текстом или файлом, у каждого — редакция «ППК NNN». Текст
 * правится, файл заменяется; после изменения утверждённого документа
 * программа спрашивает про новую редакцию.
 */
export function PpkDocsList({
  source,
  timeZone,
  canManage,
  initial,
}: {
  source: TextDocSource;
  timeZone: string;
  /** Править и утверждать: процедуры — кто ведёт ППК, база знаний — кто ею управляет. Иначе только список. */
  canManage: boolean;
  /** Список с сервера: виден сразу и тем, кому API списка закрыт. */
  initial: DocRow[];
}) {
  const t = useTranslations("productionControl.textDocs");
  const locale = useLocale();
  const tariffLimit = useTariffLimitToast();
  const [docs, setDocs] = useState<DocRow[] | null>(initial);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [removing, setRemoving] = useState<DocRow | null>(null);
  const replaceFor = useRef<DocRow | null>(null);
  const replaceInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(LIST_URL[source], { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as
        | { documents?: DocRow[]; files?: (DocRow & { title?: string })[]; error?: string }
        | null;
      if (!response.ok) throw new Error(body?.error || t("loadFailed"));
      const rows = (body?.documents ?? body?.files ?? []).map((row) => ({ ...row, title: row.title || row.fileName }));
      setDocs(rows);
    } catch (error) {
      // Список с сервера остаётся; ошибка — только у того, кто правит.
      if (canManage) toast.error(error instanceof Error ? error.message : t("loadFailed"));
    }
  }, [source, t, canManage]);

  // Номера редакций видят все, кто открыл пункт; утверждают — только с правом правки (R2-2).
  const keys = useMemo(() => (docs ?? []).map((doc) => `knowledge:${doc.id}`), [docs]);
  const { states, prompt, setPrompt } = useRevisionStates(keys);

  async function upload(files: File[]) {
    setBusy(true);
    try {
      for (const file of files) {
        if (file.size > KNOWLEDGE_MAX_BYTES) {
          toast.error(t("tooLarge", { name: file.name }));
          continue;
        }
        const form = new FormData();
        form.append("file", file);
        if (source === "procedures") form.append("folder", "procedures");
        const response = await fetch(source === "knowledge" ? "/api/knowledge-documents" : "/api/production-control/files", {
          method: "POST",
          body: form,
        });
        const body = await response.json().catch(() => null);
        if (!response.ok && tariffLimit(body)) break;
        if (!response.ok) toast.error(body?.error || t("uploadFailed"));
      }
    } finally {
      setBusy(false);
      await load();
      window.dispatchEvent(new Event("ppk:changed"));
    }
  }

  async function replace(doc: DocRow, file: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`/api/production-control/text-docs/${doc.id}`, { method: "PUT", body: form });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        if (!tariffLimit(body)) toast.error(body?.error || t("uploadFailed"));
        return;
      }
      toast.success(t("replaced", { title: doc.title }));
      await load();
      window.dispatchEvent(new Event("ppk:changed"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(doc: DocRow) {
    const response = await fetch(
      source === "knowledge" ? `/api/knowledge-documents/${doc.id}` : `/api/production-control/files?id=${encodeURIComponent(doc.id)}`,
      { method: "DELETE" },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      toast.error(body?.error || t("deleteFailed"));
      return;
    }
    setRemoving(null);
    toast.success(t("deleted"));
    await load();
    window.dispatchEvent(new Event("ppk:changed"));
  }

  return (
    <div className="space-y-4" data-ppk-docs={source}>
      {canManage ? (
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setEditing({ id: null })} className={PPK_BUTTON_PRIMARY_CLASS} data-ppk-docs-create>
          <FilePlus2 className="size-4" aria-hidden />
          {source === "procedures" ? t("createProcedure") : t("createInstruction")}
        </button>
        <label className={`${PPK_BUTTON_OUTLINE_CLASS} cursor-pointer`}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
          {t("upload")}
          <input
            type="file"
            multiple
            accept={KNOWLEDGE_ACCEPT}
            disabled={busy}
            className="sr-only"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              if (files.length) void upload(files);
            }}
          />
        </label>
        <input
          ref={replaceInput}
          type="file"
          accept={KNOWLEDGE_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            const doc = replaceFor.current;
            replaceFor.current = null;
            if (file && doc) void replace(doc, file);
          }}
        />
      </div>
      ) : null}

      {docs === null ? (
        <div className="flex items-center gap-2 text-[14px] text-[#6f7282]">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {t("loading")}
        </div>
      ) : docs.length === 0 ? (
        <p className="rounded-2xl bg-[var(--app-veil)] px-4 py-6 text-center text-[14px] text-[#6f7282]">
          {source === "procedures" ? t("emptyProcedures") : t("emptyInstructions")}
        </p>
      ) : (
        <ol className="space-y-2">
          {docs.map((doc, index) => {
            const key = `knowledge:${doc.id}`;
            const text = isTextDoc(doc.mimeType);
            return (
              <li key={doc.id} className="rounded-2xl bg-[var(--app-veil)] px-4 py-3" data-ppk-doc={doc.id}>
                <div className="flex flex-wrap items-start gap-3">
                  <span className="w-6 shrink-0 pt-0.5 text-right text-[13px] tabular-nums text-[#6f7282]">{index + 1}.</span>
                  <FileText className="mt-0.5 size-4 shrink-0 text-[#5566f6]" aria-hidden />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <a
                      href={fileUrl(source, doc.id)}
                      target="_blank"
                      rel="noreferrer"
                      className="block text-[14px] font-medium text-[#0b1024] [overflow-wrap:anywhere] hover:text-[#3848c7]"
                    >
                      {doc.title}
                    </a>
                    <span className="block text-[12.5px] text-[#6f7282] [overflow-wrap:anywhere]">
                      {text ? t("textDoc") : doc.fileName} ·{" "}
                      {docDate(doc.createdAt, locale, timeZone)}
                    </span>
                    <RevisionControl
                      state={states[key]}
                      timeZone={timeZone}
                      canApprove={canManage}
                      compact
                      askOpen={prompt === key}
                      onAskClose={() => setPrompt(null)}
                    />
                  </div>
                  {canManage ? (
                  <div className="flex shrink-0 items-center gap-1">
                    {text ? (
                      <button type="button" onClick={() => setEditing({ id: doc.id })} className={PPK_ICON_BUTTON_CLASS} aria-label={t("editAria", { title: doc.title })} title={t("edit")}>
                        <Pencil className="size-4" aria-hidden />
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          replaceFor.current = doc;
                          replaceInput.current?.click();
                        }}
                        className={PPK_ICON_BUTTON_CLASS}
                        aria-label={t("replaceAria", { title: doc.title })}
                        title={t("replace")}
                      >
                        <RefreshCw className="size-4" aria-hidden />
                      </button>
                    )}
                    <button type="button" onClick={() => setRemoving(doc)} className={PPK_ICON_BUTTON_CLASS} aria-label={t("deleteAria", { title: doc.title })} title={t("delete")}>
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <TextDocDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        source={source}
        docId={editing?.id ?? null}
        onSaved={() => void load()}
      />
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (removing) await remove(removing);
        }}
        title={t("deleteTitle")}
        description={removing?.title}
        confirmLabel={t("delete")}
        variant="danger"
      />
    </div>
  );
}
