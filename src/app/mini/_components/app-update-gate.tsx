import { ArrowUpRight, Smartphone } from "lucide-react";

import type { MobileAppPlatform } from "@/lib/mobile-app";

/**
 * Экран «Обновите приложение».
 *
 * Показывается вместо любого экрана (и `/mini/*`, и страниц кабинета в
 * оболочке), когда версия приложения WeSetup из User-Agent меньше
 * `MOBILE_APP_MIN_VERSION`. Решает сервер (`MiniAppShell`), поэтому
 * компонент серверный и без состояния. Ссылка — обычный переход в том
 * же окне, без `target="_blank"`: переход на чужой домен приложение
 * (Capacitor) отдаёт системе, и открывается Google Play / App Store.
 */
export function AppUpdateGate({
  platform,
  version,
  storeUrl,
}: {
  platform: MobileAppPlatform;
  /** Установленная версия — для строки «у вас версия …». */
  version: string;
  storeUrl: string;
}) {
  const storeName = platform === "ios" ? "App Store" : "Google Play";
  return (
    <div
      className="flex min-h-dvh items-center justify-center bg-[#fafbff] px-4"
      style={{
        paddingTop: "max(24px, var(--safe-area-inset-top, env(safe-area-inset-top, 0px)))",
        paddingBottom: "max(24px, var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))",
      }}
      data-testid="app-update-gate"
    >
      <div className="w-full max-w-[420px] rounded-3xl border border-[#ececf4] bg-white p-6 text-center shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-8">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
          <Smartphone className="size-7" aria-hidden />
        </div>
        <h1 className="mt-5 text-[22px] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024]">
          Обновите приложение
        </h1>
        <p className="mt-2 text-[15px] leading-[1.55] text-[#3c4053]">
          Эта версия устарела. Обновите WeSetup в {storeName} — это займёт минуту.
        </p>
        <ol className="mt-5 space-y-2 rounded-2xl bg-[#fafbff] p-4 text-left text-[14px] leading-[1.5] text-[#3c4053]">
          <li>1. Нажмите кнопку ниже — откроется {storeName}.</li>
          <li>2. Нажмите «Обновить».</li>
          <li>3. Откройте WeSetup снова — все данные на месте.</li>
        </ol>
        <a
          href={storeUrl}
          rel="noopener noreferrer"
          className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-6 text-[15px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
        >
          Обновить в {storeName}
          <ArrowUpRight className="size-4" aria-hidden />
        </a>
        <p className="mt-4 text-[12px] text-[#9b9fb3]">У вас версия {version}</p>
      </div>
    </div>
  );
}
