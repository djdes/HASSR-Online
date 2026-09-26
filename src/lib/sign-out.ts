import { signOut } from "next-auth/react";

import { signOutOnThisDevice } from "@/app/mini/_lib/signed-out-mark";
import { unregisterPushDevice } from "@/lib/native-bridge";

/** «Выйти на всех устройствах»: версия сессий растёт, куки здесь гаснут. */
export const LOGOUT_ALL_URL = "/api/security/logout-all";
/** Киоск: гаснет сессия сотрудника, планшет остаётся киоском. */
export const KIOSK_LOCK_URL = "/api/kiosk/lock";

let inFlight: Promise<void> | null = null;

/**
 * «Выйти» — один полный выход для каждой кнопки (сайт, мастер-кабинет,
 * партнёрский кабинет, мини-приложение, киоск, «на всех устройствах»):
 *
 *   1. приложение WeSetup отвязывает телефон от push — пока сессия жива,
 *      иначе сервер ответит 401 и уведомления человека приходили бы на
 *      телефон, которым уже пользуется другой;
 *   2. `signOutOnThisDevice`: сервер гасит все куки сессии, пометка
 *      «вышел вручную», `signOut` next-auth для него и соседних вкладок;
 *   3. переход на `target` через `replace` — «назад» не вернёт на страницу
 *      того, кто только что вышел.
 *
 * Бросает, если сервер выход не подтвердил: кнопка показывает ошибку, а
 * человек остаётся в аккаунте. Повторное нажатие во время выхода не
 * запускает второй выход.
 */
export function signOutAndOpen(
  target: string,
  options: { logoutUrl?: string } = {},
): Promise<void> {
  if (inFlight) return inFlight;
  const run = (async () => {
    await unregisterPushDevice();
    await signOutOnThisDevice({
      fetch: (input, init) => fetch(input, init),
      signOut: () => signOut({ redirect: false }),
      logoutUrl: options.logoutUrl,
    });
    window.location.replace(target);
  })();
  inFlight = run;
  // Сбой — можно нажать ещё раз; успех — страница уже уходит.
  run.catch(() => {
    inFlight = null;
  });
  return run;
}
