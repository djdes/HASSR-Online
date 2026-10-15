"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { useBillingError } from "@/lib/billing-limit-toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/**
 * Выгрузка и загрузка сотрудников файлом.
 *
 * Шаблон скачивается тем же эндпоинтом, что и выгрузка, — разъехавшиеся
 * шаблон и импорт означают «файл не подходит» на файле, который выдали
 * мы сами.
 *
 * Перед загрузкой спрашиваем режим: пропускать уже заведённых или
 * обновлять их. По умолчанию — пропускать: это безопасный вариант, при
 * котором повторная загрузка того же файла ничего не портит.
 */
export function StaffImportExport() {
  const { toastApiError } = useBillingError();
  const t = useTranslations("staffManagement.importExport");
  const locale = useLocale();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<File | null>(null);
  const [mode, setMode] = useState<"skip" | "update">("skip");

  async function upload(file: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("mode", mode);

      const response = await fetch("/api/staff/import", {
        method: "POST",
        body: form,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        if (data?.errorCode === "missingColumns") throw new Error(t("errors.missingColumns"));
        if (data?.errorCode === "emptyRows") throw new Error(t("errors.emptyRows"));
        if (data?.errorCode === "tooManyRows") throw new Error(t("errors.tooManyRows", { maxRows: data.maxRows }));
        throw new Error(t("uploadFailed"));
      }

      toast.success(t("importSummary", { created: data.created, updated: data.updated, skipped: data.skipped }));

      const errors: Array<{ line: number; message: string; code?: string; params?: Record<string, string> }> = data.errors ?? [];
      const listFormat = new Intl.ListFormat(locale, { style: "long", type: "conjunction" });
      const translateError = (item: (typeof errors)[number]) => {
        const params = item.params ?? {};
        switch (item.code) {
          case "missingColumns": return t("errors.missingColumns");
          case "missingName": return t("errors.missingName");
          case "missingPosition": return t("errors.missingPosition", { name: params.name ?? "" });
          case "positionNotFound": return t("errors.positionNotFound", { position: params.position ?? "" });
          case "invalidPhone": return t("errors.invalidPhone", { name: params.name ?? "", phone: params.phone ?? "" });
          case "unknownJournals": return t("errors.unknownJournals", { name: params.name ?? "", journals: listFormat.format((params.journals ?? "").split(", ").filter(Boolean)) });
          case "seatLimit": return t("errors.seatLimit", { name: params.name ?? "" });
          default: return t("errors.unknown");
        }
      };
      if (errors.length > 0) {
        // Ошибки показываем построчно и с номером строки файла: «не
        // загрузилось 3 строки» без указания каких — это задача найти
        // их самому, а файл может быть на сто человек.
        toast.error(
          `${t("rowErrors", { count: errors.length })}\n` +
            errors
              .slice(0, 5)
              .map((item) => `${t("row", { line: item.line })}: ${translateError(item)}`)
              .join("\n") +
            (errors.length > 5 ? `\n${t("moreErrors", { count: errors.length - 5 })}` : ""),
          { duration: 12_000 }
        );
      }
      if (data.planUpgraded) {
        toast.info(t("planUpgraded"));
      }
      if (data.billingLimit) toastApiError(data.billingLimit, t("billingLimit"));
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("genericError"));
    } finally {
      setBusy(false);
      setPending(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const buttonClass =
    "inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-60";

  return (
    <>
      {/* Обычная ссылка, а не <Link>: это не переход по приложению, а
          скачивание файла. Router перехватил бы навигацию и попытался
          отрендерить .xlsx как страницу. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/api/staff/export?template=1" className={buttonClass}>
        <FileSpreadsheet className="size-4 text-[#5566f6]" />
        {t("template")}
      </a>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/api/staff/export" className={buttonClass}>
        <Download className="size-4 text-[#5566f6]" />
        {t("export")}
      </a>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className={buttonClass}
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Upload className="size-4 text-[#5566f6]" />
        )}
        {t("upload")}
      </button>

      <input
        ref={inputRef}
        type="file"
        accept=".xlsx"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) setPending(file);
        }}
      />

      <ConfirmDialog
        open={pending !== null}
        onClose={() => {
          setPending(null);
          if (inputRef.current) inputRef.current.value = "";
        }}
        onConfirm={() => {
          if (pending) void upload(pending);
        }}
        variant="info"
        title={t("confirmTitle")}
        description={
          pending
            ? t("confirmDescription", { fileName: pending.name })
            : ""
        }
        bullets={[
          {
            label:
              mode === "skip"
                ? t("skipEffect")
                : t("updateEffect"),
            tone: "info" as const,
          },
          { label: t("matchingRule") },
        ]}
        confirmLabel={t("upload")}
      >
        <div className="space-y-2">
          {(
            [
              ["skip", t("skipMode"), t("skipHint")],
              ["update", t("updateMode"), t("updateHint")],
            ] as const
          ).map(([value, label, hint]) => (
            <label
              key={value}
              className={
                "flex cursor-pointer items-start gap-2.5 rounded-xl border px-3.5 py-2.5 transition-colors " +
                (mode === value
                  ? "border-[#5566f6] bg-[#f5f6ff]"
                  : "border-[#dcdfed] bg-white hover:bg-[#fafbff]")
              }
            >
              <input
                type="radio"
                name="staff-import-mode"
                checked={mode === value}
                onChange={() => setMode(value)}
                className="mt-0.5 size-4 accent-[#5566f6]"
              />
              <span className="min-w-0">
                <span className="block text-[13.5px] font-medium text-[#0b1024]">
                  {label}
                </span>
                <span className="block text-[12px] text-[#6f7282]">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </ConfirmDialog>
    </>
  );
}
