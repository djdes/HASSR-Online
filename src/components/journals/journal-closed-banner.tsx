"use client";

import { Lock } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { confirmAsync } from "@/components/ui/confirm-async";
import { useCanManageJournalDocument } from "@/components/journals/journal-header-edit";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";

/**
 * Баннер «журнал закрыт — только просмотр».
 *
 * Раньше закрытый документ просто молча отключал контролы, и
 * пользователь не понимал, почему ничего не нажимается (принцип UX №2 —
 * «каждый раз должно быть абсолютно понятно»). Показываем янтарную
 * карточку с замком над таблицей.
 *
 * Подсказка «Откройте журнал заново…» при этом не говорила, КАК это
 * сделать: открыть заново можно было только из списка документов на
 * вкладке «Закрытые». Теперь прямо в баннере есть кнопка «Открыть
 * заново» — тот же запрос `PATCH { status: "active" }`, что и в списке.
 *
 * `print:hidden` — в бумажной версии баннер не нужен: инспектор смотрит
 * на данные, а не на состояние UI.
 *
 * Использование:
 *   {status !== "active"
 *     ? <JournalClosedBanner documentId={id} canReopen={canManage} />
 *     : null}
 */
export function JournalClosedBanner({
  /** Чем именно нельзя управлять — уточнение во второй строке. */
  hint = "Откройте журнал заново, чтобы редактировать отметки и записи.",
  className = "",
  documentId,
}: {
  hint?: string;
  className?: string;
  /** Без id кнопка «Открыть заново» не рисуется — нечего открывать. */
  documentId?: string;
} = {}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // Открыть журнал заново может только тот, кто управляет документами —
  // ровно как пункт «Вернуть в активные» в списке закрытых.
  const canReopen = useCanManageJournalDocument();

  async function reopen() {
    if (!documentId || busy) return;
    const confirmed = await confirmAsync({
      title: "Открыть журнал заново?",
      description: "Документ снова станет активным.",
      bullets: [
        { label: "Его можно будет дозаполнить и исправить", tone: "info" },
        { label: "Он вернётся на вкладку «Активные»", tone: "default" },
      ],
      variant: "info",
      confirmLabel: "Открыть заново",
    });
    if (!confirmed) return;

    setBusy(true);
    try {
      const response = await fetch(`/api/journal-documents/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      });
      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(failure?.error || "Не удалось открыть журнал заново");
      }
      toast.success("Журнал снова активен");
      router.refresh();
    } catch (error) {
      toast.error(humanizeFetchError(error, "Не удалось открыть журнал заново"));
    } finally {
      setBusy(false);
    }
  }

  const showButton = Boolean(documentId && canReopen);

  return (
    <div
      className={`flex items-start gap-3 rounded-2xl border border-[#ffe9b0] bg-[#fff8eb] px-4 py-3 print:hidden ${className}`}
    >
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-white/70 text-[#b25f00]">
        <Lock className="size-4" />
      </span>
      <div className="min-w-0 text-[13px] leading-[1.55] text-[#7a4a00]">
        <div className="text-[14px] font-semibold text-[#5c3800]">
          Журнал закрыт — только просмотр
        </div>
        {hint}
        {showButton ? (
          <div className="mt-2.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => void reopen()}
              className="inline-flex h-9 items-center rounded-xl bg-[#5566f6] px-3.5 text-[13px] font-semibold text-white transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-50"
            >
              {busy ? "Открываем…" : "Открыть заново"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
