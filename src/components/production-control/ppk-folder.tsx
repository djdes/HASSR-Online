"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { FileText, Loader2, Trash2, Upload } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { PpkFolderKey } from "@/lib/ppk/folders";
import { useTariffLimitToast } from "@/lib/billing-limit-toast";

type FolderFile = {
  id: string;
  fileName: string;
  sizeBytes: number;
  uploadedByName: string;
  createdAt: string;
};

const PRIMARY =
  "inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-60";

function formatSize(bytes: number, locale: string): string {
  const megabytes = bytes >= 1024 * 1024;
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: megabytes ? "megabyte" : "kilobyte",
    maximumFractionDigits: 1,
  }).format(megabytes ? bytes / 1024 / 1024 : Math.max(1, Math.round(bytes / 1024)));
}

/** Папка файлов блока: список, загрузка нескольких файлов, удаление с подтверждением. */
export function PpkFolder({ folder, canManage }: { folder: PpkFolderKey; canManage: boolean }) {
  const t = useTranslations("productionControl");
  const locale = useLocale();
  const tariffLimit = useTariffLimitToast();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<FolderFile[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<FolderFile | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/production-control/files?folder=${folder}`, { cache: "no-store" });
      if (!response.ok) throw new Error("load failed");
      const data = (await response.json()) as { files: FolderFile[] };
      setFiles(data.files);
      setLoadError(false);
    } catch {
      // Не удалось загрузить — показываем ошибку с повтором, а не пустую папку.
      setLoadError(true);
    }
  }, [folder]);

  useEffect(() => {
    void load();
  }, [load]);

  async function upload(list: FileList) {
    setBusy(true);
    let uploaded = 0;
    try {
      for (const file of Array.from(list)) {
        const form = new FormData();
        form.set("folder", folder);
        form.set("file", file, file.name);
        const response = await fetch("/api/production-control/files", { method: "POST", body: form });
        if (response.ok) {
          uploaded += 1;
        } else {
          const data = await response.json().catch(() => null);
          // Хранилище тарифа заполнено — toast с кнопкой «Выбрать тариф», остальные не шлём.
          if (tariffLimit(data)) break;
          toast.error(data?.error ?? t("folder.failed", { name: file.name }));
        }
      }
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
    if (uploaded > 0) toast.success(t("folder.uploaded", { count: String(uploaded) }));
    await load();
    window.dispatchEvent(new Event("ppk:changed"));
  }

  async function remove() {
    if (!removing) return;
    const response = await fetch(`/api/production-control/files?id=${encodeURIComponent(removing.id)}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      toast.error(data?.error ?? t("removeFailed"));
      return;
    }
    toast.success(t("folder.removed"));
    setRemoving(null);
    await load();
    window.dispatchEvent(new Event("ppk:changed"));
  }

  const uploadButton = canManage ? (
    <button type="button" disabled={busy} onClick={() => input.current?.click()} className={PRIMARY}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
      {busy ? t("folder.uploading") : t("folder.upload")}
    </button>
  ) : null;

  return (
    <section data-ppk-folder={folder} className="space-y-4">
      {files && files.length > 0 ? <div className="flex">{uploadButton}</div> : null}

      {loadError && files === null ? (
        <div className="rounded-3xl border border-[#f3d3cf] bg-[#fff4f2] px-6 py-10 text-center">
          <h2 className="text-[16px] font-semibold text-[#a13a32]">{t("folder.loadFailed")}</h2>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-4 inline-flex h-11 items-center rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#3848c7] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
          >
            {t("folder.retry")}
          </button>
        </div>
      ) : files === null ? (
        <div className="flex justify-center py-12 text-[#9b9fb3]">
          <Loader2 className="size-5 animate-spin" aria-hidden />
        </div>
      ) : files.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-12 text-center">
          <h2 className="text-[16px] font-semibold text-[#0b1024]">{t("folder.emptyTitle")}</h2>
          <p className="mx-auto mt-1.5 max-w-[420px] text-[13.5px] text-[#6f7282]">{t("folder.emptyHint")}</p>
          {uploadButton ? <div className="mt-5 flex justify-center">{uploadButton}</div> : null}
        </div>
      ) : (
        <ul className="divide-y divide-[#ececf4] overflow-hidden rounded-3xl border border-[#ececf4] bg-white">
          {files.map((file) => (
            <li key={file.id} className="flex items-center gap-3.5 px-4 py-3.5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#eef1ff] text-[#3848c7]">
                <FileText className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <a
                  href={`/api/production-control/files/${file.id}`}
                  className="block rounded-md text-[14.5px] font-medium text-[#0b1024] transition-colors duration-150 [overflow-wrap:anywhere] hover:text-[#3848c7] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                >
                  {file.fileName}
                </a>
                <p className="mt-0.5 text-[12.5px] text-[#9b9fb3] [overflow-wrap:anywhere]">
                  {[
                    formatSize(file.sizeBytes, locale),
                    new Date(file.createdAt).toLocaleDateString(locale, {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    }),
                    file.uploadedByName,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              {canManage ? (
                <button
                  type="button"
                  onClick={() => setRemoving(file)}
                  aria-label={t("folder.remove")}
                  title={t("folder.remove")}
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl text-[#9b9fb3] transition-colors duration-150 hover:bg-[#fff4f2] hover:text-[#a13a32] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                >
                  <Trash2 className="size-4" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <input
        ref={input}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          if (event.target.files?.length) void upload(event.target.files);
        }}
      />
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
        title={t("folder.removeTitle")}
        description={t("folder.removeBody", { name: removing?.fileName ?? "" })}
        confirmLabel={t("folder.remove")}
        variant="danger"
      />
    </section>
  );
}
