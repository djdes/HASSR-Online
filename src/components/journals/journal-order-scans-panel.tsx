"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Camera, Check, ExternalLink, FileText, ImageIcon, Loader2, Pencil, Printer, Trash2, Upload, X } from "lucide-react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PhotoLightbox } from "@/components/shared/photo-lightbox";
import {
  ORDER_SCAN_MAX_BYTES,
  ORDER_SCAN_MAX_FILES,
  ORDER_SCAN_TITLE_MAX,
} from "@/lib/journal-order-scans";
import { ORDER_SCAN_CAMERA_ACCEPT, orderScanPhotoTitle, orderScanPhotoToJpeg } from "@/lib/order-scan-camera";

/**
 * «Приказы к журналу» (пожелание РПН, 2026-09-24): сканы приказа о
 * назначении ответственного, о бракеражной комиссии и т. п. Один набор на
 * журнал организации — идёт со всеми документами журнала, печатается
 * после страниц журнала и виден проверяющему. Руководство загружает,
 * переименовывает и удаляет; остальные смотрят.
 */

export type OrderScanItem = {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  uploadedByName: string | null;
};

type Props = {
  journalCode: string;
  initialScans: OrderScanItem[];
  canManage: boolean;
};

const ACCEPT = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";

type PanelTranslator = ReturnType<typeof useTranslations<"journalUi.orderScans">>;

const DATE_LOCALES: Record<string, string> = { ru: "ru-RU", en: "en-GB", uz: "uz-UZ" };

function formatSize(bytes: number, locale: string, t: PanelTranslator): string {
  if (bytes >= 1024 * 1024) {
    const value = (bytes / (1024 * 1024)).toLocaleString(DATE_LOCALES[locale] ?? "ru-RU", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
    return t("sizeMb", { value });
  }
  return t("sizeKb", { value: Math.max(1, Math.round(bytes / 1024)) });
}

function formatDate(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(DATE_LOCALES[locale] ?? "ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fileUrl(id: string): string {
  return `/api/journal-order-scans/${encodeURIComponent(id)}/file`;
}

async function readError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error || fallback;
}

export function JournalOrderScansPanel({ journalCode, initialScans, canManage }: Props) {
  const t = useTranslations("journalUi.orderScans");
  const common = useTranslations("common");
  const locale = useLocale();
  const [scans, setScans] = useState<OrderScanItem[]>(initialScans);
  const [uploading, setUploading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [savingTitle, setSavingTitle] = useState(false);
  const [deleting, setDeleting] = useState<OrderScanItem | null>(null);
  const [viewing, setViewing] = useState<OrderScanItem | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // «Камера» на сенсорном экране (телефон, планшет): снимок сразу с задней камеры, уходит как скан JPG.
  const cameraRef = useRef<HTMLInputElement | null>(null);

  const example =
    journalCode === "hygiene"
      ? t("example.hygiene")
      : journalCode === "finished_product"
        ? t("example.finishedProduct")
        : t("example.default");
  const full = scans.length >= ORDER_SCAN_MAX_FILES;

  // Сотруднику без приказов показывать нечего — блок не занимает место.
  if (!canManage && scans.length === 0) return null;

  async function upload(file: File, title?: string) {
    if (file.size > ORDER_SCAN_MAX_BYTES) {
      toast.error(t("tooBig"));
      return;
    }
    if (/\.hei[cf]$/i.test(file.name) || /^image\/hei[cf]/i.test(file.type)) {
      toast.error(t("heic"));
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.set("code", journalCode);
      form.set("file", file);
      if (title) form.set("title", title);
      const response = await fetch("/api/journal-order-scans", { method: "POST", body: form });
      if (!response.ok) {
        toast.error(await readError(response, t("uploadFailed")));
        return;
      }
      const { scan } = (await response.json()) as { scan: OrderScanItem };
      setScans((current) => [...current, scan]);
      toast.success(t("added", { title: scan.title }));
    } catch {
      toast.error(t("networkError"));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
      if (cameraRef.current) cameraRef.current.value = "";
    }
  }

  async function saveTitle(scan: OrderScanItem) {
    const title = draftTitle.trim();
    if (!title) {
      toast.error(t("titleRequired"));
      return;
    }
    if (title === scan.title) {
      setEditingId(null);
      return;
    }
    setSavingTitle(true);
    try {
      const response = await fetch(`/api/journal-order-scans/${encodeURIComponent(scan.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!response.ok) {
        toast.error(await readError(response, t("renameFailed")));
        return;
      }
      const { scan: updated } = (await response.json()) as { scan: OrderScanItem };
      setScans((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setEditingId(null);
      toast.success(t("titleSaved"));
    } catch {
      toast.error(t("networkError"));
    } finally {
      setSavingTitle(false);
    }
  }

  async function remove(scan: OrderScanItem) {
    const response = await fetch(`/api/journal-order-scans/${encodeURIComponent(scan.id)}`, { method: "DELETE" }).catch(() => null);
    if (!response || !response.ok) {
      toast.error(response ? await readError(response, t("deleteFailed")) : t("networkError"));
      return;
    }
    setScans((current) => current.filter((item) => item.id !== scan.id));
    setDeleting(null);
    toast.success(t("deleted", { title: scan.title }));
  }

  return (
    <section
      className="screen-only mt-6 rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] print:hidden sm:p-6"
      aria-labelledby="order-scans-title"
      data-order-scans
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
            <FileText className="size-5" />
          </div>
          <div className="min-w-0">
            <h2 id="order-scans-title" className="flex flex-wrap items-center gap-2 text-[16px] font-semibold text-[#0b1024]">
              {t("heading")}
              {scans.length > 0 ? (
                <span className="rounded-full bg-[#f5f6ff] px-2.5 py-0.5 text-[12px] font-medium tabular-nums text-[#3848c7]">
                  {scans.length}
                </span>
              ) : null}
            </h2>
            <p className="mt-1 text-[13px] leading-[1.55] text-[#6f7282]">
              {t.rich("intro", {
                example,
                icon: () => <Printer className="mx-1 inline size-3.5 align-[-2px] text-[#9b9fb3]" aria-hidden />,
              })}
            </p>
          </div>
        </div>
        {canManage ? (
          <div className="flex shrink-0 flex-col items-stretch gap-1 sm:items-end">
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              data-order-scan-input
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
            />
            <input
              ref={cameraRef}
              type="file"
              accept={ORDER_SCAN_CAMERA_ACCEPT}
              capture="environment"
              className="hidden"
              data-order-scan-camera-input
              onChange={(event) => {
                const photo = event.target.files?.[0];
                if (!photo) return;
                const at = new Date();
                // Фото телефона уменьшаем и сохраняем JPG: скан читается, лимит 10 МБ не мешает.
                void orderScanPhotoToJpeg(photo, at).then((file) => upload(file, orderScanPhotoTitle(at)));
              }}
            />
            <div className="flex gap-2">
              {/* Камера — на устройствах с сенсорным экраном (телефон, планшет любой
                  ширины: `any-pointer: coarse`); на компьютере с мышью фото приказа
                  загружают файлом. */}
              <button
                type="button"
                disabled={uploading || full}
                onClick={() => cameraRef.current?.click()}
                data-order-scan-camera
                className="hidden h-11 flex-1 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#3848c7] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-50 any-pointer-coarse:inline-flex"
              >
                <Camera className="size-4" />
                {t("camera")}
              </button>
              <button
                type="button"
                disabled={uploading || full}
                onClick={() => inputRef.current?.click()}
                className="inline-flex h-11 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
              >
                {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                {uploading ? (
                  t("uploading")
                ) : (
                  <>
                    {/* На телефоне рядом «Камера» — короче, чтобы обе кнопки в одну строку. */}
                    <span className="sm:hidden">{t("uploadShort")}</span>
                    <span className="hidden sm:inline">{t("uploadLong")}</span>
                  </>
                )}
              </button>
            </div>
            <span className="text-center text-[12px] text-[#9b9fb3] sm:text-right">
              {full ? t("maxFiles", { count: ORDER_SCAN_MAX_FILES }) : (
                <>
                  <span className="hidden any-pointer-coarse:inline">{t("photoPrefix")} </span>{t("formatsLimit")}
                </>
              )}
            </span>
          </div>
        ) : null}
      </div>

      {scans.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-5 py-6 text-center">
          <div className="text-[14px] font-medium text-[#0b1024]">{t("emptyTitle")}</div>
          <p className="mx-auto mt-1 max-w-[420px] text-[13px] text-[#6f7282]">
            {t("emptyDescription")}
          </p>
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {scans.map((scan) => {
            const isPdf = scan.mimeType === "application/pdf";
            const editing = editingId === scan.id;
            return (
              <li
                key={scan.id}
                className="flex flex-col gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-3 sm:flex-row sm:items-center"
                data-order-scan={scan.id}
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white text-[#5566f6] ring-1 ring-[#ececf4]">
                    {isPdf ? <FileText className="size-5" /> : <ImageIcon className="size-5" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    {editing ? (
                      <form
                        className="flex items-center gap-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void saveTitle(scan);
                        }}
                      >
                        <input
                          autoFocus
                          value={draftTitle}
                          maxLength={ORDER_SCAN_TITLE_MAX}
                          onChange={(event) => setDraftTitle(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") setEditingId(null);
                          }}
                          aria-label={t("titleAria")}
                          className="h-10 min-w-0 flex-1 rounded-2xl border border-[#dcdfed] bg-white px-3 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
                        />
                        <button
                          type="submit"
                          disabled={savingTitle}
                          aria-label={t("saveTitleAria")}
                          className="inline-flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#5566f6] text-white transition-colors duration-150 hover:bg-[#4a5bf0] disabled:opacity-50"
                        >
                          {savingTitle ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          aria-label={t("cancelAria")}
                          className="inline-flex size-10 shrink-0 items-center justify-center rounded-2xl border border-[#dcdfed] bg-white text-[#6f7282] transition-colors duration-150 hover:bg-[#f5f6ff]"
                        >
                          <X className="size-4" />
                        </button>
                      </form>
                    ) : (
                      <div className="truncate text-[14px] font-medium text-[#0b1024]" title={scan.title}>
                        {scan.title}
                      </div>
                    )}
                    <div className="mt-0.5 truncate text-[12px] text-[#6f7282]">
                      {isPdf ? "PDF" : scan.mimeType === "image/png" ? "PNG" : "JPG"} · {formatSize(scan.sizeBytes, locale, t)} · {formatDate(scan.createdAt, locale)}
                      {scan.uploadedByName ? ` · ${scan.uploadedByName}` : ""}
                    </div>
                  </div>
                </div>
                {editing ? null : (
                  <div className="flex shrink-0 items-center gap-2">
                    {isPdf ? (
                      <a
                        href={fileUrl(scan.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] sm:flex-none"
                      >
                        <ExternalLink className="size-4 text-[#5566f6]" />
                        {t("open")}
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setViewing(scan)}
                        className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] sm:flex-none"
                      >
                        <ImageIcon className="size-4 text-[#5566f6]" />
                        {t("open")}
                      </button>
                    )}
                    {canManage ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setDraftTitle(scan.title);
                            setEditingId(scan.id);
                          }}
                          aria-label={t("renameAria", { title: scan.title })}
                          title={t("rename")}
                          className="inline-flex size-10 shrink-0 items-center justify-center rounded-2xl border border-[#dcdfed] bg-white text-[#3848c7] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                        >
                          <Pencil className="size-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleting(scan)}
                          aria-label={t("deleteAria", { title: scan.title })}
                          title={common("delete")}
                          className="inline-flex size-10 shrink-0 items-center justify-center rounded-2xl border border-[#f3d4d0] bg-[#fff4f2] text-[#a13a32] transition-colors duration-150 hover:bg-[#ffe9e5]"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </>
                    ) : null}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => (deleting ? remove(deleting) : undefined)}
        variant="danger"
        title={t("deleteTitle")}
        description={deleting ? `«${deleting.title}»` : undefined}
        bullets={[
          { label: t("deleteBullet1"), tone: "warn" },
          { label: t("deleteBullet2"), tone: "warn" },
          { label: t("deleteBullet3") },
        ]}
        confirmLabel={common("delete")}
      />

      {/* В портал: страница документа сдвинута `translate`-ом, и fixed-окно
          внутри неё встало бы не по экрану, а по контейнеру. */}
      {viewing
        ? createPortal(
            <PhotoLightbox url={fileUrl(viewing.id)} filename={viewing.fileName} caption={viewing.title} onClose={() => setViewing(null)} />,
            document.body
          )
        : null}
    </section>
  );
}
