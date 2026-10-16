"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ExternalLink, FileCheck2, FilePlus2, Loader2, Sparkles, Trash2, Upload } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { PRODUCTION_DOC_ACCEPT, type ProductionDocKind } from "@/lib/production-control-docs";

const PRIMARY =
  "inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-60";
const OUTLINE =
  "inline-flex h-11 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-60";

/**
 * Слот одного документа: есть файл — открыть или заменить; нет — загрузить
 * свой или заказать разработку. Других состояний нет — человеку не нужно
 * гадать, что здесь делать.
 */
export function DocumentSlot({
  kind,
  document,
  canManage,
  orderHref,
}: {
  kind: ProductionDocKind;
  document: { fileName: string; sizeBytes: number; updatedAt: string } | null;
  canManage: boolean;
  orderHref: string;
}) {
  const t = useTranslations("productionControl");
  const locale = useLocale();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.set("kind", kind);
      form.set("file", file, file.name);
      const response = await fetch("/api/production-control/documents", { method: "POST", body: form });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? t("uploadFailed"));
      }
      toast.success(t("uploadedToast"));
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("uploadFailed"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    const response = await fetch(`/api/production-control/documents?kind=${kind}`, { method: "DELETE" });
    if (!response.ok) {
      toast.error(t("removeFailed"));
      return;
    }
    toast.success(t("removedToast"));
    setConfirmRemove(false);
    router.refresh();
  }

  const uploadedDate = document
    ? new Date(document.updatedAt).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" })
    : null;

  return (
    <section
      data-production-doc={kind}
      data-state={document ? "filled" : "empty"}
      className={cn(
        "rounded-3xl border p-5 md:p-6",
        document
          ? "border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]"
          : "border-dashed border-[#dcdfed] bg-[#fafbff]",
      )}
    >
      <div className="flex items-start gap-4">
        <span
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-2xl",
            document ? "bg-[#ecfdf5] text-[#116b2a]" : "bg-[#eef1ff] text-[#5566f6]",
          )}
        >
          {document ? <FileCheck2 className="size-5" /> : <FilePlus2 className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-semibold leading-snug tracking-[-0.01em] text-[#0b1024]">
            {t(`kinds.${kind}`)}
          </h2>
          <p className="mt-1 text-[13.5px] text-[#6f7282] [overflow-wrap:anywhere]">
            {document ? (
              <>
                <span className="text-[#3c4053]">{document.fileName}</span>
                {" · "}
                {t("uploaded", { date: uploadedDate ?? "" })}
              </>
            ) : canManage ? (
              t("empty")
            ) : (
              t("askManager")
            )}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {document ? (
              <a
                href={`/api/production-control/documents/${kind}/file`}
                className={PRIMARY}
              >
                <ExternalLink className="size-4" />
                {t("open")}
              </a>
            ) : null}
            {canManage ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => input.current?.click()}
                className={document ? OUTLINE : PRIMARY}
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Upload className={cn("size-4", document && "text-[#5566f6]")} />
                )}
                {busy ? t("uploading") : document ? t("replace") : t("upload")}
              </button>
            ) : null}
            {canManage && !document ? (
              <Link href={orderHref} className={OUTLINE}>
                <Sparkles className="size-4 text-[#5566f6]" />
                {t("order")}
              </Link>
            ) : null}
            {canManage && document ? (
              <button
                type="button"
                onClick={() => setConfirmRemove(true)}
                aria-label={t("remove")}
                title={t("remove")}
                className="ml-auto inline-flex size-11 items-center justify-center rounded-2xl text-[#9b9fb3] transition-colors duration-150 hover:bg-[#fff4f2] hover:text-[#a13a32] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
              >
                <Trash2 className="size-4" />
              </button>
            ) : null}
          </div>
          {canManage && !document ? (
            <p className="mt-2 text-[12px] text-[#9b9fb3]">{t("formats")}</p>
          ) : null}
        </div>
      </div>

      <input
        ref={input}
        type="file"
        accept={PRODUCTION_DOC_ACCEPT}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <ConfirmDialog
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        onConfirm={remove}
        title={t("removeTitle")}
        description={t("removeBody", { name: document?.fileName ?? "" })}
        confirmLabel={t("remove")}
        variant="danger"
      />
    </section>
  );
}
