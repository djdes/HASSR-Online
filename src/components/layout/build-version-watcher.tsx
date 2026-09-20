"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";

const POLL_MS = 5 * 60 * 1000; // 5 минут — баланс «свежесть vs нагрузка на API»

/**
 * Полли-вотчер для версии билда.
 *
 * Каждые 5 минут дёргает /api/build-info. Если buildId отличается от
 * того, что был при загрузке страницы — показывает persistent toast
 * «Доступно обновление, нажмите чтобы перезагрузить». Пользователь
 * сам выбирает удобный момент перезагрузки (а не теряет данные при
 * автоматическом reload).
 *
 * Дополняет ServiceWorkerRegister: тот делает hard reload только при
 * первом mount страницы. Этот вотчер реагирует на новые деплои внутри
 * уже открытой вкладки.
 *
 * В кабинете (`/mini`) НЕ работает. Компонент висит в корневом layout, а
 * у кабинета есть свой сообщатель об обновлении
 * (`app/mini/_components/mini-sw-register.tsx`), и вместе они показывали
 * ДВА одинаковых несъезжающих тоста «Доступно обновление» вверху экрана
 * телефона — один поверх другого.
 *
 * Побеждает тот, что в кабинете: он не только перезагружает страницу, но
 * и применяет ожидающий service worker. Простая перезагрузка воркер не
 * меняет, поэтому этот вотчер отрапортовал бы «обновлено», а приложение
 * осталось бы на прежней версии.
 */
export function BuildVersionWatcher() {
  const pathname = usePathname();
  const initialBuildId = useRef<string | null>(null);
  const notified = useRef(false);
  const inMiniApp = pathname === "/mini" || pathname.startsWith("/mini/");
  // На публичных QR-формах опрос сборки не нужен: форму открывают на минуту.
  const inFillRoute = /^\/(journal-fill|equipment-fill|room-fill|task-fill)(\/|$)/.test(pathname);

  useEffect(() => {
    if (inMiniApp || inFillRoute) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function fetchBuildId(): Promise<string | null> {
      try {
        const r = await fetch("/api/build-info", { cache: "no-store" });
        if (!r.ok) return null;
        const data = await r.json();
        return typeof data?.buildId === "string" ? data.buildId : null;
      } catch {
        return null;
      }
    }

    async function tick() {
      if (cancelled) return;
      const id = await fetchBuildId();
      if (cancelled || !id) return;
      if (initialBuildId.current === null) {
        initialBuildId.current = id;
        return;
      }
      if (id !== initialBuildId.current && !notified.current) {
        notified.current = true;
        toast.message("Доступно обновление", {
          description: "Перезагрузите страницу, чтобы получить последние фиксы.",
          duration: Infinity,
          action: {
            label: "Перезагрузить",
            onClick: () => window.location.reload(),
          },
        });
      }
    }

    // Первый pull сразу — фиксируем baseline.
    tick();
    timer = setInterval(tick, POLL_MS);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [inMiniApp]);

  return null;
}
