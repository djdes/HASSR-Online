"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { LogOut, TabletSmartphone } from "lucide-react";

import { KIOSK_LOCK_URL, signOutAndOpen } from "@/lib/sign-out";

/** Не чаще раза в 25 с — при idle 90 с по умолчанию окно продлевается с запасом. */
const HEARTBEAT_MIN_MS = 25_000;

/**
 * Страж киоск-сессии на общем планшете.
 *
 * Пока сотрудник работает (тапы, клавиатура, прокрутка), шлём heartbeat —
 * сервер продлевает `lockAt`. Как только сервер отвечает 401 (сессия
 * заблокирована по бездействию или отозвана), возвращаем на список
 * сотрудников `/mini/kiosk`, чтобы следующий ввёл свой ПИН. Плюс постоянная
 * кнопка «Выйти» — закончил, отдал планшет.
 *
 * Для обычных сессий (нет `kioskDeviceId`) компонент ничего не рендерит и
 * ничего не делает.
 */
export function KioskSessionGuard() {
  const { data: session } = useSession();
  const kioskDeviceId = session?.user?.kioskDeviceId ?? null;
  const [leaving, setLeaving] = useState(false);
  const lastBeat = useRef(0);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!kioskDeviceId) return;

    async function beat(force = false) {
      const now = Date.now();
      if (!force && now - lastBeat.current < HEARTBEAT_MIN_MS) return;
      if (inFlight.current) return;
      inFlight.current = true;
      lastBeat.current = now;
      try {
        const res = await fetch("/api/kiosk/heartbeat", { method: "POST" });
        if (res.status === 401) {
          window.location.href = "/mini/kiosk";
        }
      } catch {
        // сеть моргнула — следующая активность повторит
      } finally {
        inFlight.current = false;
      }
    }

    const onActivity = () => void beat(false);
    const events: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "touchstart", "scroll"];
    for (const ev of events) window.addEventListener(ev, onActivity, { passive: true });
    // Периодическая проверка: даже без активности узнаём о локе и уводим на киоск.
    const timer = window.setInterval(() => void beat(true), 30_000);
    void beat(true);
    return () => {
      for (const ev of events) window.removeEventListener(ev, onActivity);
      window.clearInterval(timer);
    };
  }, [kioskDeviceId]);

  if (!kioskDeviceId) return null;

  async function leave() {
    setLeaving(true);
    try {
      // Общий выход (`lib/sign-out.ts`) с киоск-адресом: гаснут все куки
      // сессии, планшет остаётся киоском (его кука не трогается).
      await signOutAndOpen("/mini/kiosk", { logoutUrl: KIOSK_LOCK_URL });
    } catch {
      // Как раньше: к списку сотрудников в любом случае — киоск-сессия
      // сама заблокируется по бездействию.
      window.location.href = "/mini/kiosk";
    }
  }

  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] -translate-x-1/2">
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-[#dcdfed] bg-white/95 px-3 py-1.5 text-[13px] text-[#0b1024] shadow-[0_12px_36px_-12px_rgba(11,16,36,0.35)] backdrop-blur">
        <TabletSmartphone className="size-4 text-[#5566f6]" />
        <span className="max-w-[180px] truncate font-medium">{session?.user?.name ?? "Сотрудник"}</span>
        <button
          onClick={leave}
          disabled={leaving}
          className="inline-flex items-center gap-1 rounded-full bg-[#f5f6ff] px-2.5 py-1 text-[12px] font-medium text-[#3848c7] transition-colors hover:bg-[#eef1ff] disabled:opacity-60"
        >
          <LogOut className="size-3.5" /> Выйти
        </button>
      </div>
    </div>
  );
}
