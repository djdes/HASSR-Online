/**
 * Картинки кабинета, установленного на домашний экран (PWA).
 *
 * Рисует их `scripts/make-pwa-assets.ts` из того же векторного знака, что
 * иконки приложений Android и iOS (`mobile/scripts/brand-mark.mjs`): кабинет
 * с сайта и приложение из магазина выглядят на телефоне одинаково.
 *
 * Имена файлов новые (`app-*`), а не прежние `icon-*`: `/icons/*` кешируются
 * браузером и service worker'ом кабинета без версии в адресе, и замена
 * картинки под старым именем держалась бы у людей неделями. Старые
 * `icon-192/512.png` остаются — это логотип в разметке schema.org.
 */

export const PWA_ICON_ANY_192 = "/icons/app-192.png";
export const PWA_ICON_ANY_512 = "/icons/app-512.png";
export const PWA_ICON_MASKABLE_192 = "/icons/app-maskable-192.png";
export const PWA_ICON_MASKABLE_512 = "/icons/app-maskable-512.png";

/** Крупная картинка уведомления (рядом с текстом). */
export const NOTIFICATION_ICON = PWA_ICON_ANY_192;
/**
 * Значок уведомления в строке состояния Android: белый силуэт на
 * прозрачном. Система берёт только прозрачность, поэтому полноцветная
 * иконка превращалась в белый квадрат.
 */
export const NOTIFICATION_BADGE = "/icons/push-badge.png";

export const PWA_SHORTCUT_TODAY_ICON = "/icons/shortcut-today.png";
export const PWA_SHORTCUT_JOURNALS_ICON = "/icons/shortcut-journals.png";

/**
 * Экран iPhone в портретной ориентации: размер в точках CSS и плотность.
 * Картинка заставки должна совпадать с экраном до пикселя — иначе iOS её
 * не показывает и запускает кабинет с белого экрана.
 */
export type IosScreen = { width: number; height: number; ratio: 2 | 3; devices: string };

export const IOS_STARTUP_SCREENS: readonly IosScreen[] = [
  { width: 440, height: 956, ratio: 3, devices: "iPhone 16 Pro Max, 17 Pro Max" },
  { width: 430, height: 932, ratio: 3, devices: "iPhone 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus" },
  { width: 428, height: 926, ratio: 3, devices: "iPhone 12 Pro Max, 13 Pro Max, 14 Plus" },
  { width: 420, height: 912, ratio: 3, devices: "iPhone Air" },
  { width: 414, height: 896, ratio: 3, devices: "iPhone XS Max, 11 Pro Max" },
  { width: 414, height: 896, ratio: 2, devices: "iPhone XR, 11" },
  { width: 414, height: 736, ratio: 3, devices: "iPhone 6s Plus, 7 Plus, 8 Plus" },
  { width: 402, height: 874, ratio: 3, devices: "iPhone 16 Pro, 17, 17 Pro" },
  { width: 393, height: 852, ratio: 3, devices: "iPhone 14 Pro, 15, 15 Pro, 16" },
  { width: 390, height: 844, ratio: 3, devices: "iPhone 12, 12 Pro, 13, 13 Pro, 14, 16e" },
  { width: 375, height: 812, ratio: 3, devices: "iPhone X, XS, 11 Pro, 12 mini, 13 mini" },
  { width: 375, height: 667, ratio: 2, devices: "iPhone 6s, 7, 8, SE (2-го и 3-го поколения)" },
  { width: 320, height: 568, ratio: 2, devices: "iPhone SE (1-го поколения)" },
];

export function iosStartupImageSize(screen: IosScreen): { width: number; height: number } {
  return { width: screen.width * screen.ratio, height: screen.height * screen.ratio };
}

export function iosStartupImageUrl(screen: IosScreen): string {
  const { width, height } = iosStartupImageSize(screen);
  return `/icons/splash/iphone-${width}x${height}.png`;
}

/** Для `appleWebApp.startupImage` в `src/app/mini/layout.tsx`. */
export function iosStartupImages(): Array<{ url: string; media: string }> {
  return IOS_STARTUP_SCREENS.map((screen) => ({
    url: iosStartupImageUrl(screen),
    media:
      `(device-width: ${screen.width}px) and (device-height: ${screen.height}px) and ` +
      `(-webkit-device-pixel-ratio: ${screen.ratio}) and (orientation: portrait)`,
  }));
}

/**
 * Скриншоты в манифесте: Chrome на Android показывает их в окне установки
 * («расширенное» окно вместо маленькой плашки). Берутся из скриншотов для
 * Google Play (docs/mobile/screenshots/android) — один интерфейс везде.
 * Подписи — для экранного диктора; переводы — в manifest-en/uz.json.
 */
export const PWA_SCREENSHOTS: ReadonlyArray<{ src: string; from: string; label: string }> = [
  { src: "/icons/screens/today.webp", from: "02-today.png", label: "Задачи смены на сегодня" },
  { src: "/icons/screens/control-board.webp", from: "01-control-board.png", label: "Панель контроля: кто что взял и что ждёт проверки" },
  { src: "/icons/screens/fridges.webp", from: "04-fridges.png", label: "Температура холодильников с телефона" },
];

/** Размер скриншота в манифесте (из 1080×1920 Google Play, 9:16). */
export const PWA_SCREENSHOT_SIZE = { width: 720, height: 1280 } as const;
