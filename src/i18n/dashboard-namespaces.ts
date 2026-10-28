import type { MessageNamespace } from "./messages";

/**
 * Пространства сообщений для страниц кабинета: их получают и страницы на
 * сайте, и те же страницы в оболочке Mini App (`(dashboard)/layout.tsx`,
 * П-3). Раньше у оболочки был свой список без `dashboardUi` — и в Telegram
 * на «Сегодня» вместо подписей стояли ключи `dashboardUi.closeDayCard.qrCodes`.
 */
export const DASHBOARD_SITE_NAMESPACES = [
  "dashboardUi",
  "billingUi",
  "organizationsUi",
  "cleaningUi",
] as const satisfies readonly MessageNamespace[];
