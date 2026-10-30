"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";

/**
 * Смена точки или организации — один переход на весь кабинет (2026-10-29).
 *
 * Раньше переключатель делал `fetch` → тост «Точка: …» → `router.refresh()`
 * без перехода: крутилка гасла сразу, тост опережал данные, а страница
 * секунды стояла со старой точкой — «странная задержка». Теперь запрос и
 * `router.refresh()` идут в одном `useTransition`: `isPending` держится, пока
 * не придёт новая страница. Пока он держится, `SectionFrame` показывает скелет
 * вместо контента, переключатель — крутилку, а тост об успехе — после.
 *
 * Провайдер живёт в макете кабинета (сайт и оболочка Mini App), поэтому
 * переход переживает закрытие меню или листа, из которого его начали.
 * Вне провайдера (экран «Профиль» мини-приложения) хук работает сам по себе.
 */

type RefreshAfter = (
  /** Что меняем (id точки) — переключатель держит крутилку на этом пункте. */
  tag: string,
  /** Запрос на смену; `false` — не вышло (ошибку показывает сам запрос). */
  request: () => Promise<boolean>,
  /** После того как новая страница пришла: тост об успехе. */
  onDone?: () => void,
) => void;

export type ContentTransition = {
  isPending: boolean;
  pendingTag: string | null;
  refreshAfter: RefreshAfter;
};

const ContentTransitionContext = createContext<ContentTransition | null>(null);

function useContentTransitionState(): ContentTransition {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [tag, setTag] = useState<string | null>(null);
  const doneRef = useRef<(() => void) | null>(null);
  // Второе нажатие до перерисовки не должно начать второй переход.
  const busyRef = useRef(false);

  useEffect(() => {
    if (isPending) return;
    busyRef.current = false;
    const done = doneRef.current;
    doneRef.current = null;
    done?.();
  }, [isPending]);

  const refreshAfter = useCallback<RefreshAfter>(
    (nextTag, request, onDone) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setTag(nextTag);
      startTransition(async () => {
        const ok = await request().catch(() => false);
        if (!ok) {
          busyRef.current = false;
          return;
        }
        doneRef.current = onDone ?? null;
        // После `await` обновления нужно снова обернуть в переход — тогда
        // `isPending` держится до прихода новой страницы.
        startTransition(() => router.refresh());
      });
    },
    [router],
  );

  return useMemo(
    () => ({ isPending, pendingTag: isPending ? tag : null, refreshAfter }),
    [isPending, tag, refreshAfter],
  );
}

export function ContentTransitionProvider({ children }: { children: React.ReactNode }) {
  const value = useContentTransitionState();
  return <ContentTransitionContext.Provider value={value}>{children}</ContentTransitionContext.Provider>;
}

/** Общий переход кабинета; вне провайдера — свой, на один компонент. */
export function useContentTransition(): ContentTransition {
  const shared = useContext(ContentTransitionContext);
  const local = useContentTransitionState();
  return shared ?? local;
}

/** Идёт ли смена точки/организации — для скелета в области контента. */
export function useContentPending(): boolean {
  return useContext(ContentTransitionContext)?.isPending ?? false;
}
