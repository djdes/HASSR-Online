"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { toastApiError } from "@/lib/billing-limit-toast";
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
      if (!response.ok) throw new Error(data?.error ?? "Не удалось загрузить");

      const parts = [
        `Добавлено: ${data.created}`,
        data.updated > 0 ? `обновлено: ${data.updated}` : null,
        data.skipped > 0 ? `пропущено: ${data.skipped}` : null,
      ].filter(Boolean);
      toast.success(parts.join(" · "));

      const errors: Array<{ line: number; message: string }> = data.errors ?? [];
      if (errors.length > 0) {
        // Ошибки показываем построчно и с номером строки файла: «не
        // загрузилось 3 строки» без указания каких — это задача найти
        // их самому, а файл может быть на сто человек.
        toast.error(
          `Не прошло строк: ${errors.length}\n` +
            errors
              .slice(0, 5)
              .map((item) => `Строка ${item.line}: ${item.message}`)
              .join("\n") +
            (errors.length > 5 ? `\n…и ещё ${errors.length - 5}` : ""),
          { duration: 12_000 }
        );
      }
      if (data.planUpgraded) {
        toast.info("Сотрудников стало больше бесплатного лимита — тариф обновлён");
      }
      if (data.billingLimit) toastApiError(data.billingLimit, "Лимит тарифа");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка");
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
        Шаблон
      </a>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/api/staff/export" className={buttonClass}>
        <Download className="size-4 text-[#5566f6]" />
        Выгрузить
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
        Загрузить
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
        title="Загрузить сотрудников из файла?"
        description={
          pending
            ? `Файл «${pending.name}». Должности должны уже существовать в организации — новые из файла не создаются.`
            : ""
        }
        bullets={[
          {
            label:
              mode === "skip"
                ? "Уже заведённые сотрудники будут пропущены"
                : "У уже заведённых обновим телефон, почту, выходные и доступ",
            tone: "info" as const,
          },
          { label: "Совпадение ищем по телефону, а без него — по ФИО и должности" },
        ]}
        confirmLabel="Загрузить"
      >
        <div className="space-y-2">
          {(
            [
              ["skip", "Пропускать уже заведённых", "Безопасно: повторная загрузка ничего не изменит"],
              ["update", "Обновлять уже заведённых", "Перезапишет телефон, почту, выходные и доступ к журналам"],
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
