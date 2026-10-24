"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import {
  INSPECTION_VISIT_ACCEPT,
  INSPECTION_VISIT_FILE_MAX_BYTES,
  INSPECTION_VISIT_KINDS,
  INSPECTION_VISIT_MAX_FILES,
  INSPECTION_VISIT_MAX_TOTAL_BYTES,
  type InspectionVisitKind,
} from "@/lib/inspection-visits";
import { prepareVisitUpload } from "@/lib/inspection-visit-upload";

const INPUT =
  "h-11 w-full min-w-0 rounded-[4px] border border-[#c9cdd5] bg-white px-3 text-[15px] text-[#141821] placeholder:text-[#a3a8b3] transition-[border-color,box-shadow] duration-150 focus:border-[#1f3a8a] focus:outline-none focus:ring-2 focus:ring-[#1f3a8a]/15";
const LABEL = "text-[13px] text-[#5b6170]";

type Translate = ReturnType<typeof useTranslations<"inspectorUi.visitForm">>;

function sizeLabel(bytes: number, t: Translate): string {
  return bytes >= 1024 * 1024
    ? t("sizeMb", { value: (bytes / 1024 / 1024).toFixed(1) })
    : t("sizeKb", { value: Math.max(1, Math.round(bytes / 1024)) });
}

function kindLabel(kind: InspectionVisitKind, t: Translate): string {
  switch (kind) {
    case "planned": return t("kindPlanned");
    case "unplanned": return t("kindUnplanned");
    case "complaint": return t("kindComplaint");
    default: return t("kindOther");
  }
}

/**
 * Запись проверяющего в журнал посещений организации: кто, от какого
 * органа, вид проверки, основание и скан или фото решения (распоряжения).
 * Отправляется по токену QR без входа; данные журналов не меняются.
 */
export function InspectorVisitForm({ token }: { token: string }) {
  const t = useTranslations("inspectorUi.visitForm");
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<InspectionVisitKind>("planned");
  const [files, setFiles] = useState<File[]>([]);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<string | null>(null);

  const [preparing, setPreparing] = useState(false);

  async function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const picked = Array.from(list);
    if (fileInput.current) fileInput.current.value = "";
    setPreparing(true);
    setError(null);
    setErrorField(null);
    const next = [...files];
    try {
      for (const original of picked) {
        if (next.length >= INSPECTION_VISIT_MAX_FILES) {
          setError(t("tooManyFiles", { max: INSPECTION_VISIT_MAX_FILES }));
          setErrorField("file");
          break;
        }
        const file = await prepareVisitUpload(original);
        if (file.size > INSPECTION_VISIT_FILE_MAX_BYTES) {
          setError(t("fileTooLarge", { name: original.name }));
          setErrorField("file");
          continue;
        }
        if (next.reduce((sum, item) => sum + item.size, 0) + file.size > INSPECTION_VISIT_MAX_TOTAL_BYTES) {
          setError(t("totalTooLarge", { name: original.name }));
          setErrorField("file");
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
    const formElement = event.currentTarget;
    const data = new FormData(formElement);
    data.delete("file");
    for (const file of files) data.append("file", file);
    setState("saving");
    setError(null);
    setErrorField(null);
    try {
      const response = await fetch(`/api/inspector/${encodeURIComponent(token)}/visits`, { method: "POST", body: data });
      const body = (await response.json().catch(() => null)) as { error?: string; field?: string } | null;
      if (!response.ok) {
        setErrorField(body?.field ?? null);
        throw new Error(body?.error ?? t("submitFailedRetry"));
      }
      setState("saved");
      setFiles([]);
      formElement.reset();
      setKind("planned");
      router.refresh();
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : t("submitFailed"));
    }
  }

  const invalid = (field: string) => (errorField === field ? " border-[#a13a32]" : "");

  return (
    <form onSubmit={submit} className="grid gap-4" data-visit-form noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className={LABEL}>{t("fullName")}</span>
          <input
            name="inspectorName"
            required
            maxLength={160}
            autoComplete="name"
            placeholder={t("fullNamePlaceholder")}
            className={INPUT + invalid("inspectorName")}
          />
        </label>
        <label className="grid gap-1.5">
          <span className={LABEL}>{t("position")}</span>
          <input
            name="inspectorPosition"
            required
            maxLength={160}
            autoComplete="organization-title"
            placeholder={t("positionPlaceholder")}
            className={INPUT + invalid("inspectorPosition")}
          />
        </label>
      </div>

      <label className="grid gap-1.5">
        <span className={LABEL}>{t("authority")}</span>
        <input
          name="authority"
          required
          maxLength={300}
          autoComplete="organization"
          placeholder={t("authorityPlaceholder")}
          className={INPUT + invalid("authority")}
        />
      </label>

      <fieldset className="grid gap-2">
        <legend className={`${LABEL} mb-1.5`}>{t("kind")}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {INSPECTION_VISIT_KINDS.map((value) => (
            <label
              key={value}
              className={`flex min-h-11 cursor-pointer items-center gap-2.5 rounded-[4px] border px-3 py-2 text-[14.5px] transition-colors duration-150 ${
                kind === value ? "border-[#1f3a8a] bg-[#f3f5fb] text-[#141821]" : "border-[#c9cdd5] bg-white text-[#3a3f4c] hover:border-[#8a8f9c]"
              }`}
            >
              <input
                type="radio"
                name="kind"
                value={value}
                checked={kind === value}
                onChange={() => setKind(value)}
                className="size-4 accent-[#1f3a8a]"
              />
              {kindLabel(value, t)}
            </label>
          ))}
        </div>
        {kind === "other" ? (
          <input
            name="kindNote"
            maxLength={200}
            placeholder={t("kindNotePlaceholder")}
            aria-label={t("kindNoteLabel")}
            className={INPUT + invalid("kindNote")}
          />
        ) : null}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
        <label className="grid gap-1.5">
          <span className={LABEL}>{t("basisNumber")}</span>
          <input name="basisNumber" maxLength={80} placeholder={t("basisNumberPlaceholder")} className={INPUT + invalid("basisNumber")} />
        </label>
        <label className="grid gap-1.5">
          <span className={LABEL}>{t("basisDate")}</span>
          <input name="basisDate" type="date" className={INPUT + invalid("basisDate")} />
        </label>
      </div>

      <div className="grid gap-2">
        <span className={LABEL}>{t("scanLabel")}</span>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={preparing || files.length >= INSPECTION_VISIT_MAX_FILES}
            className={`inline-flex h-11 items-center rounded-[4px] border bg-white px-4 text-[14px] font-medium text-[#141821] transition-colors duration-150 hover:bg-[#f5f6f8] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1f3a8a]/35 ${
              errorField === "file" ? "border-[#a13a32]" : "border-[#141821]"
            }`}
          >
            {preparing ? t("preparingFile") : t("pickFile")}
          </button>
          <span className="text-[12.5px] text-[#8a8f9c]">{t("fileLimits", { max: INSPECTION_VISIT_MAX_FILES })}</span>
        </div>
        <input
          ref={fileInput}
          type="file"
          name="file"
          multiple
          accept={INSPECTION_VISIT_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => void addFiles(event.target.files)}
        />
        {files.length > 0 ? (
          <ul className="divide-y divide-[#e3e5ea] border-y border-[#e3e5ea]" data-visit-files>
            {files.map((file, index) => (
              <li key={`${file.name}-${index}`} className="flex items-center gap-3 py-2 text-[14px]">
                <span className="min-w-0 flex-1 truncate">{file.name}</span>
                <span className="shrink-0 tabular-nums text-[12.5px] text-[#8a8f9c]">{sizeLabel(file.size, t)}</span>
                <button
                  type="button"
                  onClick={() => setFiles(files.filter((_, i) => i !== index))}
                  className="shrink-0 text-[13px] text-[#1f3a8a] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1f3a8a]/35"
                >
                  {t("remove")}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <button
          type="submit"
          disabled={state === "saving" || preparing}
          className="h-11 shrink-0 rounded-[4px] border border-[#141821] bg-[#141821] px-5 text-[14.5px] font-medium text-white transition-colors duration-150 hover:bg-[#2a3040] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1f3a8a]/40"
        >
          {state === "saving" ? t("saving") : t("submit")}
        </button>
        <p
          className={`text-[12.5px] ${state === "error" ? "text-[#a13a32]" : state === "saved" ? "text-[#1f3a8a]" : "text-[#8a8f9c]"}`}
          aria-live="polite"
          data-visit-status={state}
        >
          {state === "saved"
            ? t("saved")
            : state === "error"
              ? error
              : error ?? t("hint")}
        </p>
      </div>
    </form>
  );
}
