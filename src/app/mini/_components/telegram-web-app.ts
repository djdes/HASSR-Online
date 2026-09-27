/**
 * Minimal typed surface for `window.Telegram.WebApp`.
 *
 * Not using `@twa-dev/sdk` to keep the dependency graph small for Stage 1;
 * if richer SDK features are needed later (haptics, main button, etc.) we
 * can swap this out for the official wrapper.
 */

export type TelegramWebApp = {
  initData: string;
  initDataUnsafe?: {
    user?: { id: number; first_name?: string; last_name?: string };
  };
  ready(): void;
  expand(): void;
  /**
   * Клиент, в котором открыто приложение: "android", "ios", "tdesktop",
   * "web"… Вне Telegram скрипт telegram-web-app.js всё равно создаёт
   * объект, но кладёт сюда "unknown" — по этому признаку и отличаем
   * настоящий Telegram от обычной вкладки (см. `isInsideTelegram`).
   */
  platform?: string;
  version?: string;
  colorScheme?: "light" | "dark";
  themeParams?: Record<string, string>;
  /**
   * События клиента. `themeChanged` — человек сменил тему Telegram:
   * `colorScheme` к этому моменту уже новый (тема «Как на устройстве»).
   */
  onEvent?: (eventType: string, handler: () => void) => void;
  offEvent?: (eventType: string, handler: () => void) => void;
  close?: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  enableClosingConfirmation?: () => void;
  /**
   * Свайп вниз по полотну сворачивает Mini App. Это поведение Telegram
   * по умолчанию, и оно дерётся с нашим «потянуть, чтобы обновить»:
   * жест перехватывает Telegram, а не страница. Метод с Bot API 7.7 —
   * на старых клиентах его нет, поэтому вызов опциональный.
   */
  disableVerticalSwipes?: () => void;
  enableVerticalSwipes?: () => void;
  showScanQrPopup(params: { text?: string }, callback: (text: string) => void | true): void;
  closeScanQrPopup(): void;
  showPopup(params: {
    title?: string;
    message: string;
    buttons?: Array<{ id?: string; type?: "default" | "ok" | "close" | "cancel" | "destructive"; text: string }>;
  }, callback?: (buttonId: string) => void): void;
  showConfirm(message: string, callback: (confirmed: boolean) => void): void;
  HapticFeedback?: {
    impactOccurred(style: "light" | "medium" | "heavy" | "rigid" | "soft"): void;
    notificationOccurred(type: "error" | "success" | "warning"): void;
  };
  /**
   * Telegram-native верхняя «<» кнопка в шапке. Показываем на всех
   * вложенных экранах /mini/* кроме корня. Пользователь привычно
   * жмёт её на iOS (где нет системной back-кнопки внутри WebApp).
   */
  /**
   * Главная кнопка Telegram внизу окна.
   *
   * Состояние глобальное, на уровне WebApp, а не страницы: не сняв
   * обработчик и не спрятав кнопку при уходе с экрана, мы оставим
   * её на следующем — с чужой надписью и действием в никуда.
   */
  MainButton?: {
    text: string;
    isVisible: boolean;
    isActive: boolean;
    isProgressVisible: boolean;
    setText(text: string): void;
    setParams(params: {
      text?: string;
      color?: string;
      text_color?: string;
      is_active?: boolean;
      is_visible?: boolean;
    }): void;
    show(): void;
    hide(): void;
    enable(): void;
    disable(): void;
    showProgress(leaveActive?: boolean): void;
    hideProgress(): void;
    onClick(callback: () => void): void;
    offClick(callback: () => void): void;
  };
  BackButton?: {
    isVisible: boolean;
    show(): void;
    hide(): void;
    onClick(callback: () => void): void;
    offClick(callback: () => void): void;
  };
};

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

export function getTelegramWebApp(): TelegramWebApp | null {
  if (typeof window === "undefined") return null;
  return window.Telegram?.WebApp ?? null;
}

/**
 * Открыто ли приложение именно внутри Telegram.
 *
 * Наличие `window.Telegram.WebApp` этого НЕ означает: скрипт
 * telegram-web-app.js подключён на всех экранах `/mini`, и объект он
 * создаёт всегда — и в обычной вкладке браузера, и в приложении,
 * установленном на домашний экран. Отличие в том, что вне Telegram
 * подписанных данных нет (`initData` пустая), а клиент не определён
 * (`platform === "unknown"`).
 *
 * Использовать везде, где ответ нужен на вопрос «мы в Telegram?»:
 * рисовать ли свою кнопку «назад», перехватывать ли краевой жест,
 * предлагать ли установку на домашний экран. Если объект нужен просто
 * чтобы вызвать метод — хватает `getTelegramWebApp()`.
 */
export function isInsideTelegram(): boolean {
  const app = getTelegramWebApp();
  if (!app) return false;
  if (typeof app.initData === "string" && app.initData.length > 0) {
    return true;
  }
  const platform = typeof app.platform === "string" ? app.platform.trim() : "";
  return platform.length > 0 && platform !== "unknown";
}
