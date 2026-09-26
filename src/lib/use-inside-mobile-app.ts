"use client";

import { useSyncExternalStore } from "react";

import { isInsideMobileApp } from "@/lib/mobile-app";

function subscribe(): () => void {
  // User-Agent не меняется за жизнь страницы — подписываться не на что.
  return () => {};
}

/**
 * Страница открыта в приложении WeSetup. На сервере и при гидратации —
 * false (как у сайта), сразу после неё — настоящее значение. Годится
 * для того, что не видно на первом кадре: пункты меню, тосты. Кнопки
 * оплаты на странице прячьте серверной проверкой
 * (`isMobileAppRequest` из `@/lib/mobile-app-payments`).
 */
export function useInsideMobileApp(): boolean {
  return useSyncExternalStore(subscribe, isInsideMobileApp, () => false);
}
