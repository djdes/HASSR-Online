import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { isMobileAppUserAgent } from "@/lib/mobile-app";

/**
 * Оплата в приложении WeSetup (App Store 3.1.1 / 3.1.3(b), правила
 * Google Play о платежах): внутри приложения нельзя купить, оплатить,
 * пополнить или продлить подписку, и нельзя звать к оплате на сайте —
 * ни кнопкой, ни ссылкой. Страницы тарифа и баланса в приложении
 * показывают только состояние, страницы оплаты уводят на главный экран.
 *
 * Серверная проверка — по User-Agent запроса (`WeSetupApp/…`), чтобы
 * кнопка оплаты не мелькнула даже на первом кадре. В клиентских
 * компонентах — `useInsideMobileApp` из `@/lib/use-inside-mobile-app`.
 */
export async function isMobileAppRequest(): Promise<boolean> {
  const list = await headers();
  return isMobileAppUserAgent(list.get("user-agent"));
}

/** Куда уводить со страницы оплаты внутри приложения. */
export const MOBILE_APP_HOME = "/mini";

/**
 * Обработчики оплаты: запрос из приложения отклоняем. Кнопок оплаты в
 * приложении нет, это страховка на случай старой открытой страницы.
 */
export function refuseMobileAppPayment(request: Request): NextResponse | null {
  if (!isMobileAppUserAgent(request.headers.get("user-agent"))) return null;
  return NextResponse.json(
    { error: "Оплата в приложении недоступна", code: "mobile_app_payment" },
    { status: 403 }
  );
}
