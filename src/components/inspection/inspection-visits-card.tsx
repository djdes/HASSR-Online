"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Eye, EyeOff, FileText, ImageIcon, Loader2, NotebookPen, Paperclip, Plus, QrCode, RotateCcw, X } from "lucide-react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  INSPECTION_VISIT_ACCEPT,
  INSPECTION_VISIT_FILE_MAX_BYTES,
  INSPECTION_VISIT_HIDE_REASON_MAX,
  INSPECTION_VISIT_KINDS,
  INSPECTION_VISIT_MAX_FILES,
  INSPECTION_VISIT_MAX_TOTAL_BYTES,
  type InspectionVisitKind,
} from "@/lib/inspection-visits";
import type { InspectionVisitListItem } from "@/lib/inspection-visits.server";
import { prepareVisitUpload } from "@/lib/inspection-visit-upload";

const PRIMARY =
  "inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-60";
const OUTLINE =
  "inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-60";
const INPUT =
  "h-11 w-full min-w-0 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] transition-[border-color,box-shadow] duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";
const LABEL = "text-[13px] font-medium text-[#3c4053]";

function fileHref(id: string): string {
  return `/api/inspection/visit-files/${encodeURIComponent(id)}`;
}

/** Сейчас по часам устройства — для `datetime-local`. */
function nowLocalInput(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

async function readError(response: Response, fallback: string): Promise<{ message: string; field: string | null }> {
  const body = (await response.json().catch(() => null)) as { error?: string; field?: string } | null;
  return { message: body?.error || fallback, field: body?.field ?? null };
}

/**
 * Журнал посещений (скан 83: «отметка в журнале посещения ⇒ отсылка к
 * документу проверки „Посещение“»). Проверяющий вносит запись сам по QR;
 * здесь руководство видит записи, открывает сканы, добавляет запись само и
 * прикладывает скан к записи без него. Записи не удаляются — как в бумажном
 * журнале; ошибочную (мусор, дубль) руководитель скрывает с причиной.
 */
export function InspectionVisitsCard({
  visits,
  timeZone,
  canHide = false,
}: {
  visits: InspectionVisitListItem[];
  timeZone: string;
  /** Руководитель (`admin.full`): «Скрыть как ошибочную» и «Вернуть». */
  canHide?: boolean;
}) {
  const t = useTranslations("inspectionDay.visits");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [dialogKey, setDialogKey] = useState(0);
  const [attaching, setAttaching] = useState<string | null>(null);
  const attachInput = useRef<HTMLInputElement>(null);
  const attachTarget = useRef<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [hideTarget, setHideTarget] = useState<InspectionVisitListItem | null>(null);
  const [hideReason, setHideReason] = useState("");
  const [restoring, setRestoring] = useState<string | null>(null);

  const hiddenCount = visits.filter((visit) => visit.hiddenAt).length;
  const shown = showHidden ? visits : visits.filter((visit) => !visit.hiddenAt);

  async function setHidden(visit: InspectionVisitListItem, hidden: boolean, reason = ""): Promise<boolean> {
    const response = await fetch(`/api/inspection/visits/${encodeURIComponent(visit.id)}/hidden`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hidden, reason }),
    });
    if (!response.ok) {
      toast.error((await readError(response, t("hideFailed"))).message);
      return false;
    }
    toast.success(hidden ? t("hiddenDone") : t("restored"));
    router.refresh();
    return true;
  }

  const dateTime = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
  const basisDate = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });

  async function attach(list: FileList | null) {
    const visitId = attachTarget.current;
    // Копия до сброса поля: после `value = ""` список файлов может опустеть.
    const picked = list ? Array.from(list) : [];
    if (attachInput.current) attachInput.current.value = "";
    if (!visitId || picked.length === 0) return;
    setAttaching(visitId);
    try {
      const data = new FormData();
      let total = 0;
      for (const original of picked) {
        const file = await prepareVisitUpload(original);
        if (file.size > INSPECTION_VISIT_FILE_MAX_BYTES) throw new Error(t("tooBig", { name: original.name }));
        total += file.size;
        if (total > INSPECTION_VISIT_MAX_TOTAL_BYTES) throw new Error(t("tooLarge"));
        data.append("file", file);
      }
      const response = await fetch(`/api/inspection/visits/${encodeURIComponent(visitId)}/files`, { method: "POST", body: data });
      if (!response.ok) throw new Error((await readError(response, t("attachFailed"))).message);
      toast.success(t("attached"));
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("attachFailed"));
    } finally {
      setAttaching(null);
    }
  }

  return (
    <div data-inspection-visits-journal>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="max-w-[640px] text-[14px] leading-[1.55] text-[#6f7282]">{t("lead")}</p>
        <button
          type="button"
          className={`${PRIMARY} shrink-0`}
          onClick={() => {
            setDialogKey((key) => key + 1);
            setOpen(true);
          }}
          data-add-visit
        >
          <Plus className="size-4" aria-hidden />
          {t("add")}
        </button>
      </div>

      {hiddenCount > 0 ? (
        <button
          type="button"
          onClick={() => setShowHidden((value) => !value)}
          aria-pressed={showHidden}
          className="mt-3 inline-flex h-9 items-center gap-2 rounded-full border border-[#dcdfed] bg-white px-3.5 text-[13px] font-medium text-[#3c4053] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
          data-toggle-hidden
        >
          {showHidden ? <EyeOff className="size-4 text-[#5566f6]" aria-hidden /> : <Eye className="size-4 text-[#5566f6]" aria-hidden />}
          {showHidden ? t("hideHidden") : t("showHidden", { count: String(hiddenCount) })}
        </button>
      ) : null}

      {shown.length === 0 ? (
        <div className="mt-4 rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-10 text-center">
          <NotebookPen className="mx-auto size-6 text-[#9b9fb3]" aria-hidden />
          <p className="mx-auto mt-2 max-w-[420px] text-[13.5px] text-[#6f7282]">{hiddenCount > 0 ? t("allHidden") : t("empty")}</p>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-[#ececf4] rounded-2xl border border-[#ececf4]">
          {shown.map((visit) => {
            const isHidden = visit.hiddenAt !== null;
            const canAttach = !isHidden && visit.files.length < INSPECTION_VISIT_MAX_FILES;
            return (
              <li
                key={visit.id}
                className={`grid gap-2 p-4 md:grid-cols-[1fr_auto] md:items-start ${isHidden ? "bg-[#fafbff]" : ""}`}
                data-visit-row={visit.id}
                data-visit-hidden={isHidden ? "true" : undefined}
              >
                <div className={`min-w-0 ${isHidden ? "opacity-60" : ""}`}>
                  {isHidden ? (
                    <div className="mb-2 inline-flex max-w-full items-start gap-1.5 rounded-2xl bg-[#fff4f2] px-3 py-1.5 text-[12.5px] text-[#a13a32]">
                      <EyeOff className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                      <span className="[overflow-wrap:anywhere]">
                        {t("hiddenNote", {
                          reason: visit.hiddenReason ?? "—",
                          name: visit.hiddenByName ?? "—",
                          date: dateTime.format(new Date(visit.hiddenAt as string)),
                        })}
                      </span>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                    <span className="text-[15px] font-semibold text-[#0b1024] [overflow-wrap:anywhere]">{visit.inspectorName}</span>
                    {visit.inspectorPosition ? (
                      <span className="text-[13.5px] text-[#6f7282] [overflow-wrap:anywhere]">{visit.inspectorPosition}</span>
                    ) : null}
                  </div>
                  <div className="mt-1 text-[13.5px] text-[#3c4053] [overflow-wrap:anywhere]">
                    {visit.authority}
                    <span className="mx-1.5 text-[#9b9fb3]">·</span>
                    {isKind(visit.kind) ? t(`kinds.${visit.kind}`) : visit.kind}
                    {visit.kind === "other" && visit.kindNote ? `: ${visit.kindNote}` : ""}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-[#6f7282]">
                    <span className="tabular-nums">{dateTime.format(new Date(visit.visitedAt))}</span>
                    <span>
                      {t("basis", {
                        basis:
                          [
                            visit.basisNumber ? `№ ${visit.basisNumber}` : null,
                            visit.basisDate ? basisDate.format(new Date(`${visit.basisDate}T00:00:00Z`)) : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || t("noBasis"),
                      })}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      {visit.source === "inspector" ? <QrCode className="size-3.5 text-[#5566f6]" aria-hidden /> : null}
                      {visit.source === "inspector"
                        ? t("byInspector")
                        : visit.createdByName
                          ? t("byManager", { name: visit.createdByName })
                          : t("byCabinet")}
                    </span>
                  </div>
                  {visit.files.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {visit.files.map((file, index) => (
                        <a
                          key={file.id}
                          href={fileHref(file.id)}
                          target="_blank"
                          rel="noopener"
                          className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-[#f5f6ff] px-3 py-1 text-[12.5px] font-medium text-[#3848c7] transition-colors duration-150 hover:bg-[#eef1ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                          title={file.fileName}
                          data-visit-file
                        >
                          {file.mimeType === "application/pdf" ? (
                            <FileText className="size-3.5 shrink-0" aria-hidden />
                          ) : (
                            <ImageIcon className="size-3.5 shrink-0" aria-hidden />
                          )}
                          <span className="truncate">{t("scan", { n: String(index + 1) })}</span>
                        </a>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-2 text-[12.5px] text-[#a13a32]">{t("noScan")}</div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 justify-self-start md:flex-col md:items-end md:justify-self-end">
                  {canAttach ? (
                    <button
                      type="button"
                      className={`${OUTLINE} h-10 text-[13.5px]`}
                      disabled={attaching !== null}
                      onClick={() => {
                        attachTarget.current = visit.id;
                        attachInput.current?.click();
                      }}
                      data-attach-visit={visit.id}
                    >
                      {attaching === visit.id ? (
                        <Loader2 className="size-4 animate-spin text-[#5566f6]" aria-hidden />
                      ) : (
                        <Paperclip className="size-4 text-[#5566f6]" aria-hidden />
                      )}
                      {attaching === visit.id ? t("attaching") : t("attach")}
                    </button>
                  ) : null}
                  {canHide && !isHidden ? (
                    <button
                      type="button"
                      className="inline-flex h-10 items-center gap-2 rounded-2xl px-3 text-[13px] font-medium text-[#6f7282] transition-colors duration-150 hover:bg-[#fff4f2] hover:text-[#a13a32] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                      onClick={() => {
                        setHideReason("");
                        setHideTarget(visit);
                      }}
                      data-hide-visit={visit.id}
                    >
                      <EyeOff className="size-4" aria-hidden />
                      {t("hide")}
                    </button>
                  ) : null}
                  {canHide && isHidden ? (
                    <button
                      type="button"
                      className={`${OUTLINE} h-10 text-[13.5px]`}
                      disabled={restoring !== null}
                      onClick={async () => {
                        setRestoring(visit.id);
                        try {
                          await setHidden(visit, false);
                        } finally {
                          setRestoring(null);
                        }
                      }}
                      data-restore-visit={visit.id}
                    >
                      {restoring === visit.id ? (
                        <Loader2 className="size-4 animate-spin text-[#5566f6]" aria-hidden />
                      ) : (
                        <RotateCcw className="size-4 text-[#5566f6]" aria-hidden />
                      )}
                      {t("restore")}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <input
        ref={attachInput}
        type="file"
        multiple
        accept={INSPECTION_VISIT_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => void attach(event.target.files)}
      />

      <ConfirmDialog
        open={hideTarget !== null}
        onClose={() => setHideTarget(null)}
        onConfirm={async () => {
          if (!hideTarget) return;
          if (await setHidden(hideTarget, true, hideReason)) setHideTarget(null);
        }}
        variant="warn"
        icon={EyeOff}
        title={t("hideTitle")}
        description={hideTarget ? t("hideLead", { name: hideTarget.inspectorName }) : undefined}
        bullets={[{ label: t("hideBullet1") }, { label: t("hideBullet2") }, { label: t("hideBullet3"), tone: "info" }]}
        confirmLabel={t("hideConfirm")}
        confirmDisabled={hideReason.trim().length < 3}
      >
        <label className="grid gap-1.5">
          <span className={LABEL}>{t("hideReason")}</span>
          <textarea
            value={hideReason}
            onChange={(event) => setHideReason(event.target.value)}
            maxLength={INSPECTION_VISIT_HIDE_REASON_MAX}
            rows={2}
            placeholder={t("hideReasonPlaceholder")}
            className="w-full resize-none rounded-2xl border border-[#dcdfed] bg-white px-4 py-2.5 text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] transition-[border-color,box-shadow] duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
            data-hide-reason
          />
        </label>
      </ConfirmDialog>

      <AddVisitDialog
        key={dialogKey}
        open={open}
        onOpenChange={setOpen}
        onSaved={() => {
          setOpen(false);
          toast.success(t("saved"));
          router.refresh();
        }}
      />
    </div>
  );
}

function isKind(value: string): value is InspectionVisitKind {
  return (INSPECTION_VISIT_KINDS as readonly string[]).includes(value);
}

function AddVisitDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const t = useTranslations("inspectionDay.visits");
  const fileInput = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<InspectionVisitKind>("planned");
  const [files, setFiles] = useState<File[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ message: string; field: string | null } | null>(null);
  // Диалог монтируется заново при каждом открытии (`key` у родителя) — «сейчас» берётся в момент открытия.
  const [visitedAt, setVisitedAt] = useState(nowLocalInput);

  async function addFiles(list: FileList | null) {
    // Копия до сброса поля: после `value = ""` список файлов может опустеть.
    const picked = list ? Array.from(list) : [];
    if (fileInput.current) fileInput.current.value = "";
    if (picked.length === 0) return;
    setPreparing(true);
    setError(null);
    const next = [...files];
    try {
      for (const original of picked) {
        if (next.length >= INSPECTION_VISIT_MAX_FILES) {
          setError({ message: t("tooMany", { max: String(INSPECTION_VISIT_MAX_FILES) }), field: "file" });
          break;
        }
        const file = await prepareVisitUpload(original);
        if (file.size > INSPECTION_VISIT_FILE_MAX_BYTES) {
          setError({ message: t("tooBig", { name: original.name }), field: "file" });
          continue;
        }
        if (next.reduce((sum, item) => sum + item.size, 0) + file.size > INSPECTION_VISIT_MAX_TOTAL_BYTES) {
          setError({ message: t("tooLarge"), field: "file" });
          continue;
        }
        next.push(file);
      }
    } finally {
      setFiles(next);
      setPreparing(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    data.delete("file");
    for (const file of files) data.append("file", file);
    const local = String(data.get("visitedAt") ?? "");
    data.set("visitedAt", local ? new Date(local).toISOString() : "");
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/inspection/visits", { method: "POST", body: data });
      if (!response.ok) {
        setError(await readError(response, t("saveFailed")));
        return;
      }
      onSaved();
    } catch {
      setError({ message: t("saveFailed"), field: null });
    } finally {
      setSaving(false);
    }
  }

  const invalid = (field: string) => (error?.field === field ? " border-[#a13a32] focus:border-[#a13a32]" : "");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] flex-col overflow-hidden rounded-3xl p-0 sm:max-w-[640px]" data-add-visit-dialog>
        <DialogHeader className="shrink-0 border-b border-[#ececf4] px-6 pb-4 pt-6 pr-14 text-left">
          <DialogTitle className="text-[20px] font-semibold tracking-[-0.01em] text-[#0b1024]">{t("addTitle")}</DialogTitle>
          <DialogDescription className="text-[13.5px] leading-[1.55] text-[#6f7282]">{t("addLead")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-6 py-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1.5">
                <span className={LABEL}>{t("name")}</span>
                <input name="inspectorName" maxLength={160} required placeholder={t("namePlaceholder")} className={INPUT + invalid("inspectorName")} />
              </label>
              <label className="grid gap-1.5">
                <span className={LABEL}>{t("position")}</span>
                <input name="inspectorPosition" maxLength={160} required placeholder={t("positionPlaceholder")} className={INPUT + invalid("inspectorPosition")} />
              </label>
            </div>
            <label className="grid gap-1.5">
              <span className={LABEL}>{t("authority")}</span>
              <input name="authority" maxLength={300} required placeholder={t("authorityPlaceholder")} className={INPUT + invalid("authority")} />
            </label>
            <fieldset className="grid gap-2">
              <legend className={`${LABEL} mb-1.5`}>{t("kind")}</legend>
              <div className="grid grid-cols-2 gap-2">
                {INSPECTION_VISIT_KINDS.map((value) => (
                  <label
                    key={value}
                    className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-2xl border px-3.5 py-2 text-[14px] transition-colors duration-150 ${
                      kind === value
                        ? "border-[#5566f6] bg-[#f5f6ff] font-medium text-[#3848c7]"
                        : "border-[#dcdfed] bg-white text-[#3c4053] hover:border-[#5566f6]/40"
                    }`}
                  >
                    <input type="radio" name="kind" value={value} checked={kind === value} onChange={() => setKind(value)} className="size-4 accent-[#5566f6]" />
                    {t(`kinds.${value}`)}
                  </label>
                ))}
              </div>
              {kind === "other" ? (
                <input name="kindNote" maxLength={200} placeholder={t("kindNotePlaceholder")} aria-label={t("kindNote")} className={INPUT + invalid("kindNote")} />
              ) : null}
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-[1fr_11rem]">
              <label className="grid gap-1.5">
                <span className={LABEL}>{t("basisNumber")}</span>
                <input name="basisNumber" maxLength={80} className={INPUT + invalid("basisNumber")} />
              </label>
              <label className="grid gap-1.5">
                <span className={LABEL}>{t("basisDate")}</span>
                <input name="basisDate" type="date" className={INPUT + invalid("basisDate")} />
              </label>
            </div>
            <label className="grid gap-1.5 sm:max-w-[16rem]">
              <span className={LABEL}>{t("visitedAt")}</span>
              <input
                name="visitedAt"
                type="datetime-local"
                value={visitedAt}
                onChange={(event) => setVisitedAt(event.target.value)}
                className={INPUT + invalid("visitedAt")}
              />
            </label>
            <div className="grid gap-2">
              <span className={LABEL}>{t("files")}</span>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className={`${OUTLINE}${error?.field === "file" ? " border-[#a13a32]" : ""}`}
                  disabled={preparing || files.length >= INSPECTION_VISIT_MAX_FILES}
                  onClick={() => fileInput.current?.click()}
                >
                  {preparing ? <Loader2 className="size-4 animate-spin text-[#5566f6]" aria-hidden /> : <Paperclip className="size-4 text-[#5566f6]" aria-hidden />}
                  {preparing ? t("preparing") : t("pickFiles")}
                </button>
                <span className="text-[12.5px] text-[#6f7282]">{t("filesHint", { max: String(INSPECTION_VISIT_MAX_FILES) })}</span>
              </div>
              <input
                ref={fileInput}
                type="file"
                multiple
                accept={INSPECTION_VISIT_ACCEPT}
                className="sr-only"
                tabIndex={-1}
                aria-hidden
                onChange={(event) => void addFiles(event.target.files)}
              />
              {files.length > 0 ? (
                <ul className="divide-y divide-[#ececf4] rounded-2xl border border-[#ececf4]">
                  {files.map((file, index) => (
                    <li key={`${file.name}-${index}`} className="flex items-center gap-2 px-3.5 py-2 text-[13.5px] text-[#0b1024]">
                      {file.type === "application/pdf" ? <FileText className="size-4 shrink-0 text-[#5566f6]" aria-hidden /> : <ImageIcon className="size-4 shrink-0 text-[#5566f6]" aria-hidden />}
                      <span className="min-w-0 flex-1 truncate">{file.name}</span>
                      <button
                        type="button"
                        onClick={() => setFiles(files.filter((_, i) => i !== index))}
                        className="flex size-8 shrink-0 items-center justify-center rounded-full text-[#6f7282] transition-colors duration-150 hover:bg-[#fff4f2] hover:text-[#a13a32] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                        aria-label={t("remove")}
                      >
                        <X className="size-4" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            {error ? (
              <p role="alert" className="rounded-2xl bg-[#fff4f2] px-4 py-3 text-[13.5px] text-[#a13a32]">
                {error.message}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-[#ececf4] px-6 py-4 sm:flex-row sm:justify-end">
            <button type="button" className={OUTLINE} onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </button>
            <button type="submit" className={PRIMARY} disabled={saving || preparing}>
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {saving ? t("saving") : t("save")}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
