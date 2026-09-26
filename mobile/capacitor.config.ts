import type { CapacitorConfig } from "@capacitor/cli";

// Версия приложения живёт в mobile/package.json: из неё берутся приписка к
// User-Agent (сайт по ней узнаёт приложение и его версию) и versionName Android.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require("./package.json") as { version: string };

const config: CapacitorConfig = {
  appId: "ru.wesetup.app",
  appName: "WeSetup",
  // Обязательная для Capacitor папка веб-файлов. Приложение грузит сайт с
  // сервера (server.url), отсюда берётся только экран «Нет связи».
  webDir: "www",
  backgroundColor: "#0b1024",
  server: {
    url: "https://wesetup.ru/mini?src=app",
    // Своя страница вместо белого экрана, если сайт не открылся.
    errorPath: "offline.html",
    // Без этого переходы внутри wesetup.ru (кроме /mini?src=app) на iOS
    // уходили бы в Safari: iOS сверяет адрес с server.url по префиксу.
    allowNavigation: ["wesetup.ru", "www.wesetup.ru"],
  },
  // Платформенные значения перекрывают общее (проверено по исходникам
  // Capacitor 8: CapConfig.java и CAPInstanceDescriptor.swift).
  android: {
    appendUserAgent: `WeSetupApp/${pkg.version} (android)`,
  },
  ios: {
    appendUserAgent: `WeSetupApp/${pkg.version} (ios)`,
    // Отступы под «чёлку» считает сам сайт через env(safe-area-inset-*).
    contentInset: "never",
    // Удержание ссылки показывает системное меню «Открыть в Safari» — в
    // приложении-оболочке это лишнее.
    allowsLinkPreview: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      launchAutoHide: true,
      backgroundColor: "#0b1024",
      showSpinner: false,
    },
    FirebaseMessaging: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
