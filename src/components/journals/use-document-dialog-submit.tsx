"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { JOURNAL_DIALOG_ERROR_CLASS } from "@/components/journals/journal-responsive";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";

/**
 * Одно поведение на все окна создания и настроек документа.
 *
 * ЧТО БЫЛО: у двух десятков журналов обработчик кнопки выглядел как
 * `try { await onSubmit(); onOpenChange(false) } finally { setSubmitting(false) }`
 * — без `catch`. Отсюда две разные беды на одном и том же коде:
 *
 *   • где `onOpenChange(false)` стоял ВНУТРИ `try` — окно просто не
 *     реагировало на нажатие, текста ошибки не было нигде;
 *   • где он стоял в `finally`/после — окно закрывалось, хотя создание
 *     упало, и всё введённое пропадало.
 *
 * ЧТО СТАЛО: окно при ошибке НЕ закрывается, введённое остаётся,
 * текст ошибки виден прямо в окне. Ответ сервера 409 «за этот период
 * уже есть документ» — не ошибка ввода, а развилка: «Открыть
 * существующий» или «Всё равно создать» (повтор запроса с `force`,
 * который принимает `POST /api/journal-documents`). Эталон поведения —
 * общий `create-document-dialog.tsx`.
 */

export type ExistingDocumentRef = { id: string; title: string };

/** Сервер ответил 409 «за этот период уже есть документ». */
export class DuplicatePeriodError extends Error {
  existing: ExistingDocumentRef;

  constructor(existing: ExistingDocumentRef) {
    super("За этот период уже есть документ");
    this.name = "DuplicatePeriodError";
    this.existing = existing;
  }
}

/**
 * Разбор ответа `POST /api/journal-documents` в одном месте.
 * Возвращает id созданного документа, либо бросает
 * `DuplicatePeriodError` / обычную ошибку с текстом сервера.
 */
export async function readCreatedDocument(
  response: Response,
  fallbackError = "Не удалось создать документ"
): Promise<{ id: string }> {
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const existing = (result as { existing?: { id?: unknown; title?: unknown } } | null)
      ?.existing;
    if (response.status === 409 && existing?.id) {
      throw new DuplicatePeriodError({
        id: String(existing.id),
        title: String(existing.title || ""),
      });
    }
    throw new Error(
      (result as { error?: unknown } | null)?.error
        ? String((result as { error?: unknown }).error)
        : fallbackError
    );
  }
  const id = (result as { document?: { id?: unknown } } | null)?.document?.id;
  if (!id) throw new Error(fallbackError);
  return { id: String(id) };
}

export type DocumentDialogSubmit = {
  /** Идёт запрос — кнопку блокируем и подписываем «Создание…». */
  submitting: boolean;
  /** Текст ошибки сервера. Пусто — ошибки нет. */
  error: string;
  /** Документ на этот период уже есть — показываем развилку. */
  duplicate: ExistingDocumentRef | null;
  /** Сбросить ошибку/развилку (например, когда человек правит поля). */
  reset: () => void;
  /**
   * Выполнить отправку. Окно закрывается ТОЛЬКО при успехе.
   * `force` приходит в колбэк: `true` — «всё равно создать».
   */
  run: (action: (force: boolean) => Promise<void>, force?: boolean) => Promise<void>;
};

export function useDocumentDialogSubmit(params: {
  onOpenChange: (open: boolean) => void;
  /** Текст ошибки по умолчанию: «Не удалось создать документ» и т.п. */
  fallbackError?: string;
}): DocumentDialogSubmit {
  const { onOpenChange } = params;
  const fallbackError = params.fallbackError ?? "Не удалось создать документ";
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [duplicate, setDuplicate] = useState<ExistingDocumentRef | null>(null);

  const reset = useCallback(() => {
    setError("");
    setDuplicate(null);
  }, []);

  const run = useCallback(
    async (action: (force: boolean) => Promise<void>, force = false) => {
      setSubmitting(true);
      setError("");
      setDuplicate(null);
      try {
        await action(force);
        onOpenChange(false);
      } catch (err) {
        if (err instanceof DuplicatePeriodError) {
          setDuplicate(err.existing);
          return;
        }
        setError(humanizeFetchError(err, fallbackError));
      } finally {
        setSubmitting(false);
      }
    },
    [fallbackError, onOpenChange]
  );

  return { submitting, error, duplicate, reset, run };
}

/**
 * Блок «что пошло не так» внутри окна: строка ошибки и — при 409 —
 * развилка «Открыть существующий / Всё равно создать».
 */
export function DocumentDialogFeedback(props: {
  state: DocumentDialogSubmit;
  /** Код журнала для ссылки на существующий документ. */
  routeCode?: string;
  /** Повтор отправки с `force = true`. */
  onForce?: () => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const { state, routeCode, onForce, onOpenChange } = props;

  // Развилку рисуем, только если есть хотя бы один выход. Иначе —
  // обычная строка ошибки: оранжевая карточка без кнопок выглядела бы
  // тупиком, а не подсказкой.
  if (state.duplicate && (routeCode || onForce)) {
    return (
      <div className="rounded-2xl border border-[#ffd8a8] bg-[#fff8ed] p-4">
        <div className="text-[14px] font-medium text-[#0b1024]">
          За этот период уже есть документ
        </div>
        <div className="mt-1 text-[13px] leading-[1.45] text-[#6f7282]">
          {state.duplicate.title ? `«${state.duplicate.title}». ` : ""}
          Записи за одни и те же дни попадут в разные документы, и ни один не
          будет выглядеть заполненным.
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {routeCode ? (
            <Button
              type="button"
              className="h-10 rounded-xl bg-[#5566f6] px-4 text-[14px] font-semibold text-white transition-colors duration-150 hover:bg-[#4a5bf0]"
              onClick={() => {
                onOpenChange?.(false);
                router.push(
                  `/journals/${routeCode}/documents/${state.duplicate?.id}`
                );
              }}
            >
              Открыть существующий
            </Button>
          ) : null}
          {onForce ? (
            <Button
              type="button"
              variant="outline"
              disabled={state.submitting}
              className="h-10 rounded-xl border-[#dcdfed] px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
              onClick={onForce}
            >
              Всё равно создать
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  const message = state.duplicate
    ? `За этот период уже есть документ${
        state.duplicate.title ? ` «${state.duplicate.title}»` : ""
      }. Откройте его или выберите другой период.`
    : state.error;
  if (!message) return null;
  return (
    <p role="alert" className={JOURNAL_DIALOG_ERROR_CLASS}>
      {message}
    </p>
  );
}
