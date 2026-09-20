"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CopyPlus, ListChecks, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { hasDocumentFillUi } from "@/lib/journal-document-helpers";

import {
  MINI_SHEET_ROW_CLASS,
  MiniSheet,
} from "./mini-sheet";
import { haptic } from "./use-haptic";

/**
 * Быстрые действия по журналу — из удержания карточки.
 *
 * Путь «заполнить как вчера» сейчас такой: открыть журнал, найти
 * кнопку, нажать, дождаться. Три касания и два перехода ради того, что
 * повар делает каждую смену. Удержание сокращает это до одного
 * движения и одного касания, не уводя со списка.
 *
 * Отдельным компонентом, а не внутри карточки: лист должен пережить
 * перерисовку списка (обновление по событию, поиск), а карточка —
 * нет.
 */
export function JournalActionsSheet({
  journal,
  onClose,
}: {
  journal: { code: string; name: string } | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [copying, setCopying] = useState(false);

  const go = (href: string) => {
    haptic("light");
    onClose();
    router.push(href);
  };

  const copyYesterday = async () => {
    if (!journal || copying) return;
    setCopying(true);
    try {
      const resp = await fetch(
        `/api/mini/journals/${encodeURIComponent(journal.code)}/bulk-copy-yesterday`,
        { method: "POST" }
      );
      const data = (await resp.json().catch(() => ({}))) as {
        error?: string;
        copied?: number;
      };
      if (!resp.ok) {
        haptic("error");
        toast.error(data.error ?? "Не удалось скопировать");
        return;
      }
      haptic("success");
      // Число в ответе важнее слова «готово»: «создано 0» — это не успех,
      // а «вчера заполнять было нечего», и человек должен это увидеть.
      toast.success(
        data.copied
          ? `Записей создано: ${data.copied}`
          : "Копировать нечего — вчера записей не было"
      );
      onClose();
      router.refresh();
    } catch {
      haptic("error");
      toast.error("Нет связи — попробуйте позже");
    } finally {
      setCopying(false);
    }
  };

  return (
    <MiniSheet
      open={journal !== null}
      onClose={onClose}
      title={journal?.name ?? ""}
      subtitle="Быстрые действия"
    >
      <div className="space-y-1 pb-2">
        {/* «Новая запись» есть только там, где запись действительно
            заводится формой. У табличных журналов этот пункт вёл на
            форму из одного поля «Участок» (а у журнала жалоб — на
            «Страница не найдена») и создавал записи, которых потом
            никто не видел в таблице. */}
        {journal && !hasDocumentFillUi(journal.code) ? (
        <button
          type="button"
          className={MINI_SHEET_ROW_CLASS}
          style={{ color: "var(--mini-text)" }}
          onClick={() => journal && go(`/mini/journals/${journal.code}/new`)}
        >
          <Plus className="size-5" style={{ color: "var(--mini-lime)" }} />
          Новая запись
        </button>
        ) : null}

        {/* У табличных журналов этого действия нет вовсе: там день
            копируется внутри самой таблицы. Показать и ответить отказом
            хуже, чем не показывать. */}
        {journal && !hasDocumentFillUi(journal.code) ? (
        <button
          type="button"
          className={MINI_SHEET_ROW_CLASS}
          style={{ color: "var(--mini-text)" }}
          disabled={copying}
          onClick={() => void copyYesterday()}
        >
          {copying ? (
            <Loader2 className="size-5 animate-spin" style={{ color: "var(--mini-lime)" }} />
          ) : (
            <CopyPlus className="size-5" style={{ color: "var(--mini-lime)" }} />
          )}
          {copying ? "Копируем…" : "Заполнить как вчера"}
        </button>
        ) : null}

        <button
          type="button"
          className={MINI_SHEET_ROW_CLASS}
          style={{ color: "var(--mini-text)" }}
          onClick={() => journal && go(`/mini/journals/${journal.code}`)}
        >
          <ListChecks className="size-5" style={{ color: "var(--mini-text-muted)" }} />
          {journal && hasDocumentFillUi(journal.code)
            ? "Открыть таблицы журнала"
            : "Открыть записи"}
        </button>
      </div>
    </MiniSheet>
  );
}
