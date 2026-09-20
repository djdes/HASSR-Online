"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { ScanLine } from "lucide-react";

import { JournalActionsSheet } from "../_components/journal-actions-sheet";
import { MiniCard } from "../_components/mini-card";
import { MiniListSkeleton } from "../_components/mini-list-skeleton";
import { MiniSearchField } from "../_components/mini-search-field";
import { filterAndRank } from "../_lib/list-search";
import { useRegisterRefresh } from "../_components/refresh-provider";
import { journalSubtitle } from "./_journal-subtitle";

/**
 * Указатель журналов.
 *
 * Экран появился не ради полноты меню. На него ведёт сканер
 * (`qr-scanner.tsx`), когда на наклейке незнакомый код: лучше показать
 * список и сказать, что именно не разобрано, чем молча проглотить
 * сканирование. До этой страницы такой переход упирался в 404 —
 * то есть выглядел как поломка приложения ровно в тот момент, когда
 * человек сделал всё правильно.
 *
 * Второй сценарий — тридцать пять журналов на главной одним столбцом.
 * Здесь тот же список, но с поиском.
 */

type Journal = {
  code: string;
  name: string;
  description: string | null;
  filled?: boolean;
};

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; journals: Journal[] };

export default function MiniJournalsIndexPage() {
  const { status } = useSession();
  const searchParams = useSearchParams();
  const unknownQr = searchParams.get("qr");
  const [state, setState] = useState<State>({ kind: "loading" });
  const [query, setQuery] = useState("");
  // Удержание карточки — быстрые действия без захода в журнал.
  const [actionsFor, setActionsFor] = useState<Journal | null>(null);

  const load = useCallback(async () => {
    try {
      const resp = await fetch("/api/mini/home", { cache: "no-store" });
      // «HTTP 500» ничего не говорит повару и не подсказывает,
      // что делать дальше. Говорим причину и следующий шаг.
      if (resp.status === 401) {
        setState({
          kind: "error",
          message:
            "Приложение вышло из вашей учётной записи. Закройте и откройте его снова.",
        });
        return;
      }
      if (!resp.ok) {
        setState({
          kind: "error",
          message:
            "Сервер не ответил. Проверьте связь и нажмите «Попробовать снова».",
        });
        return;
      }
      const data = await resp.json();
      setState({ kind: "ready", journals: data.all ?? [] });
    } catch {
      setState({
        kind: "error",
        message: "Нет связи. Проверьте интернет и нажмите «Попробовать снова».",
      });
    }
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;
    void load();
  }, [status, load]);

  useRegisterRefresh(load);

  if (state.kind === "loading") {
    return <MiniListSkeleton rows={5} label="Загружаем журналы" />;
  }

  if (state.kind === "error") {
    return (
      <div
        className="rounded-3xl px-4 py-5 text-center"
        style={{
          background: "var(--mini-crimson-soft)",
          border: "1px solid rgba(255, 82, 104, 0.24)",
        }}
      >
        <h1 className="text-lg font-semibold" style={{ color: "var(--mini-text)" }}>
          Не удалось загрузить
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--mini-text-muted)" }}>
          {state.message}
        </p>
        <button
          type="button"
          onClick={() => {
            setState({ kind: "loading" });
            void load();
          }}
          className="mini-press mt-3 inline-flex h-10 items-center rounded-2xl px-4 text-[14px] font-semibold"
          style={{
            background: "var(--mini-surface-2)",
            color: "var(--mini-text)",
          }}
        >
          Попробовать снова
        </button>
      </div>
    );
  }

  // Ищем и по исходному описанию тоже: человек мог запомнить слово из
  // него, даже если под названием оно больше не печатается.
  const shown = filterAndRank(state.journals, query, (journal) => [
    journal.name,
    journal.description,
    journal.code,
  ]);

  return (
    <div className="flex flex-1 flex-col gap-4 pb-24">
      <header className="mini-card px-5 py-5">
        <p className="mini-eyebrow">Указатель</p>
        <h1
          className="mt-1 text-[22px] font-semibold tracking-[-0.02em]"
          style={{ color: "var(--mini-text)" }}
        >
          Все журналы
        </h1>
        <p
          className="mt-2 text-[13px] leading-5"
          style={{ color: "var(--mini-text-muted)" }}
        >
          Доступно {state.journals.length}. Откройте журнал, чтобы посмотреть
          записи или добавить новую.
        </p>
      </header>

      {/* Сканер привёл сюда с кодом, который не разобрался. Молчать
          нельзя: человек уверен, что отсканировал правильно. */}
      {unknownQr ? (
        <div
          className="flex items-start gap-3 rounded-2xl px-4 py-3"
          style={{
            background: "var(--mini-amber-soft)",
            border: "1px solid rgba(255, 144, 64, 0.24)",
          }}
        >
          <ScanLine
            className="mt-0.5 size-4 shrink-0"
            style={{ color: "var(--mini-amber)" }}
          />
          <p className="text-[13px] leading-5" style={{ color: "var(--mini-text)" }}>
            Код «{unknownQr}» не привязан ни к одному журналу. Выберите журнал
            из списка — или покажите наклейку управляющей, чтобы её завели.
          </p>
        </div>
      ) : null}

      {state.journals.length > 0 ? (
        <MiniSearchField
          value={query}
          onChange={setQuery}
          placeholder="Название журнала"
          resultLabel={
            query.trim()
              ? `Найдено ${shown.length} из ${state.journals.length}`
              : undefined
          }
        />
      ) : null}

      <section className="space-y-2">
        {state.journals.length === 0 ? (
          <div
            className="rounded-3xl px-4 py-7 text-center text-[14px] leading-5"
            style={{
              background: "var(--mini-surface-1)",
              border: "1px dashed var(--mini-divider-strong)",
              color: "var(--mini-text-muted)",
            }}
          >
            Руководитель ещё не дал доступ ни к одному журналу.
          </div>
        ) : shown.length === 0 ? (
          <div
            className="rounded-3xl px-4 py-7 text-center text-[14px]"
            style={{
              background: "var(--mini-surface-1)",
              border: "1px dashed var(--mini-divider-strong)",
              color: "var(--mini-text-muted)",
            }}
          >
            <p style={{ color: "var(--mini-text)" }}>
              Ничего не нашлось по «{query.trim()}».
            </p>
            <button
              type="button"
              onClick={() => setQuery("")}
              className="mini-press mt-3 inline-flex h-10 items-center rounded-2xl px-4 text-[14px] font-semibold"
              style={{
                background: "var(--mini-surface-2)",
                color: "var(--mini-text)",
              }}
            >
              Показать все журналы
            </button>
          </div>
        ) : (
          shown.map((journal, idx) => (
            <MiniCard
              key={journal.code}
              href={`/mini/journals/${journal.code}`}
              title={journal.name}
              subtitle={journalSubtitle(journal.name, journal.description)}
              index={idx + 1}
              prefetch={idx < 5}
              onLongPress={() => setActionsFor(journal)}
            />
          ))
        )}
      </section>

      <JournalActionsSheet
        journal={actionsFor}
        onClose={() => setActionsFor(null)}
      />
    </div>
  );
}
