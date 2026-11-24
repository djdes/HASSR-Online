import { useSyncExternalStore } from "react";

const subscribeNever = () => () => {};

/**
 * Страница ожила: React подключил обработчики (после гидрации). На сервере и
 * во время гидрации — false. Входные формы держат кнопку отправки выключенной,
 * пока здесь false: до загрузки скриптов браузер отправил бы форму сам, без
 * нашего обработчика (утечка пароля в адрес, 2026-11-24).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribeNever, () => true, () => false);
}
