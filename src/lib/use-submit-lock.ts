"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Защита формы от двойного нажатия «Создать».
 *
 * ПОЧЕМУ мало одного `useState`: `setIsSubmitting(true)` применяется не
 * сразу — React обновляет состояние к следующему рендеру. Два тапа в один
 * кадр (а на телефоне это обычное дело: палец «отскакивает», кнопка ещё
 * не перерисовалась) успевают войти в обработчик оба, и на сервер уходит
 * два одинаковых POST — в списке появляется дубль записи.
 *
 * `useRef` меняется синхронно, поэтому второй вход отсекается мгновенно.
 * `busy` остаётся для интерфейса — им гасят кнопку и меняют подпись.
 *
 *   const { busy, acquire, release } = useSubmitLock();
 *   async function submit() {
 *     if (!acquire()) return;   // второй тап — молча выходим
 *     try { ... } finally { release(); }
 *   }
 */
export function useSubmitLock() {
  const lockedRef = useRef(false);
  const [busy, setBusy] = useState(false);

  /** true — замок взят, можно отправлять; false — уже отправляем. */
  const acquire = useCallback(() => {
    if (lockedRef.current) return false;
    lockedRef.current = true;
    setBusy(true);
    return true;
  }, []);

  const release = useCallback(() => {
    lockedRef.current = false;
    setBusy(false);
  }, []);

  return { busy, acquire, release };
}
