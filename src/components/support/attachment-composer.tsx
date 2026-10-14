"use client";

import { useCallback, useRef, useState } from "react";
import { FileText, ImageIcon, Loader2, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { useSiteLocale } from "@/components/i18n/site-locale-provider";
import {
  formatBytes,
  isImageAttachment,
  SUPPORT_ATTACHMENT_MAX_BYTES,
  SUPPORT_ATTACHMENT_MAX_COUNT,
  type SignedAttachment,
  type SupportAttachmentMeta,
} from "@/lib/support-attachments-shared";

/**
 * Прикрепление файлов к чату с оператором и обратной связи.
 *
 * Файл уходит на сервер сразу при выборе/вставке (Ctrl+V) — к моменту
 * «Отправить» всё уже загружено, и сообщение уходит мгновенно с
 * подписанными метами. Правила (50 МБ, без исполняемых) проверяет сервер;
 * здесь только быстрый отсев по размеру, чтобы не гонять 200 МБ зря.
 */

export type UploadItem = {
  key: string;
  filename: string;
  sizeBytes: number;
  mimeType: string;
  status: "uploading" | "ready";
  attachment?: SignedAttachment;
};

export function useAttachmentUploads(options?: { guestId?: string | null }) {
  const locale = useSiteLocale();
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const guestId = options?.guestId ?? null;

  const addFiles = useCallback(
    (files: Iterable<File>) => {
      const list = [...files];
      if (list.length === 0) return;
      setUploads((current) => {
        const room = SUPPORT_ATTACHMENT_MAX_COUNT - current.length;
        if (room <= 0) {
          toast.error(locale === "en" ? `Up to ${SUPPORT_ATTACHMENT_MAX_COUNT} files` : `Не больше ${SUPPORT_ATTACHMENT_MAX_COUNT} файлов`);
          return current;
        }
        const accepted = list.slice(0, room);
        if (accepted.length < list.length) {
          toast.error(locale === "en" ? `Up to ${SUPPORT_ATTACHMENT_MAX_COUNT} files` : `Не больше ${SUPPORT_ATTACHMENT_MAX_COUNT} файлов`);
        }
        const items: UploadItem[] = [];
        for (const file of accepted) {
          if (file.size > SUPPORT_ATTACHMENT_MAX_BYTES) {
            toast.error(locale === "en" ? `“${file.name}” exceeds 50 MB` : `«${file.name}» больше 50 МБ`);
            continue;
          }
          const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
          items.push({
            key,
            filename: file.name || (locale === "en" ? "file" : "файл"),
            sizeBytes: file.size,
            mimeType: file.type || "application/octet-stream",
            status: "uploading",
          });
          void (async () => {
            try {
              const form = new FormData();
              form.append("file", file);
              if (guestId) form.append("guestId", guestId);
              const response = await fetch("/api/support/attachments", {
                method: "POST",
                body: form,
              });
              const data = await response.json().catch(() => null);
              if (!response.ok || !data?.attachment) {
                throw new Error(data?.error ?? "Не удалось загрузить файл");
              }
              setUploads((cur) =>
                cur.map((u) =>
                  u.key === key
                    ? { ...u, status: "ready", attachment: data.attachment }
                    : u
                )
              );
            } catch (error) {
              toast.error(
                locale === "en" ? "Could not upload the file. Check its format and try again." : error instanceof Error ? error.message : "Не удалось загрузить файл"
              );
              setUploads((cur) => cur.filter((u) => u.key !== key));
            }
          })();
        }
        return [...current, ...items];
      });
    },
    [guestId, locale]
  );

  const remove = useCallback((key: string) => {
    setUploads((cur) => cur.filter((u) => u.key !== key));
  }, []);

  const clear = useCallback(() => setUploads([]), []);

  const handlePaste = useCallback(
    (event: React.ClipboardEvent) => {
      const files = event.clipboardData?.files;
      if (files && files.length > 0) {
        event.preventDefault();
        addFiles(files);
      }
    },
    [addFiles]
  );

  const readyAttachments = uploads
    .filter((u): u is UploadItem & { attachment: SignedAttachment } =>
      Boolean(u.status === "ready" && u.attachment)
    )
    .map((u) => u.attachment);

  return {
    uploads,
    addFiles,
    remove,
    clear,
    handlePaste,
    readyAttachments,
    uploading: uploads.some((u) => u.status === "uploading"),
  };
}

/** Кнопка-скрепка со скрытым file-input. */
export function AttachButton({
  onFiles,
  disabled,
  className,
}: {
  onFiles: (files: FileList) => void;
  disabled?: boolean;
  className?: string;
}) {
  const locale = useSiteLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files?.length) onFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className={
          className ??
          "flex size-11 shrink-0 items-center justify-center rounded-2xl border border-[#dcdfed] bg-white text-[#6f7282] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] hover:text-[#5566f6] disabled:opacity-50"
        }
        aria-label={locale === "en" ? "Attach a file" : "Прикрепить файл"}
        title={locale === "en" ? "Attach a file (or paste with Ctrl+V)" : "Прикрепить файл (или вставьте из буфера Ctrl+V)"}
      >
        <Paperclip className="size-4" />
      </button>
    </>
  );
}

/** Чипы выбранных файлов над полем ввода. */
export function AttachmentChips({
  uploads,
  onRemove,
}: {
  uploads: UploadItem[];
  onRemove: (key: string) => void;
}) {
  const locale = useSiteLocale();
  if (uploads.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {uploads.map((u) => (
        <span
          key={u.key}
          className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-[#f5f6ff] py-1 pl-2.5 pr-1.5 text-[12px] text-[#3848c7]"
        >
          {u.status === "uploading" ? (
            <Loader2 className="size-3 shrink-0 animate-spin" />
          ) : u.mimeType.startsWith("image/") ? (
            <ImageIcon className="size-3 shrink-0" />
          ) : (
            <FileText className="size-3 shrink-0" />
          )}
          <span className="max-w-[160px] truncate">{u.filename}</span>
          <span className="shrink-0 text-[#9b9fb3]">
            {formatBytes(u.sizeBytes, locale)}
          </span>
          <button
            type="button"
            onClick={() => onRemove(u.key)}
            className="rounded-full p-0.5 text-[#9b9fb3] transition-colors hover:bg-[#eef1ff] hover:text-[#0b1024]"
            aria-label={`${locale === "en" ? "Remove" : "Убрать"} ${u.filename}`}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
    </div>
  );
}

/** Вложения внутри пузыря сообщения: картинки — превью, файлы — ссылкой. */
export function MessageAttachments({
  attachments,
  light,
}: {
  attachments: SupportAttachmentMeta[] | undefined;
  /** true в синем пузыре клиента — ссылки белые. */
  light?: boolean;
}) {
  const locale = useSiteLocale();
  if (!attachments || attachments.length === 0) return null;
  return (
    <div className="mt-1.5 space-y-1.5">
      {attachments.map((a, i) =>
        isImageAttachment(a) ? (
          <a
            key={i}
            href={a.url}
            target="_blank"
            rel="noreferrer"
            className="block overflow-hidden rounded-xl"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={a.url}
              alt={a.filename}
              className="max-h-48 w-auto max-w-full rounded-xl object-cover"
              loading="lazy"
            />
          </a>
        ) : (
          <a
            key={i}
            href={a.url}
            target="_blank"
            rel="noreferrer"
            className={
              light
                ? "flex items-center gap-1.5 rounded-xl bg-white/15 px-2.5 py-1.5 text-[12.5px] text-white underline-offset-2 hover:underline"
                : "flex items-center gap-1.5 rounded-xl bg-white px-2.5 py-1.5 text-[12.5px] text-[#3848c7] underline-offset-2 ring-1 ring-[#ececf4] hover:underline"
            }
          >
            <FileText className="size-3.5 shrink-0" />
            <span className="truncate">{a.filename}</span>
            <span className={light ? "shrink-0 text-white/70" : "shrink-0 text-[#9b9fb3]"}>
              {formatBytes(a.sizeBytes, locale)}
            </span>
          </a>
        )
      )}
    </div>
  );
}
