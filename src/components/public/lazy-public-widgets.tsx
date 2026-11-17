"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, type ReactNode } from "react";

/**
 * Плавающие виджеты подвала (чат поддержки, «Задайте вопрос») — не нужны на
 * первом экране, а их код — сотни строк с формами и порталами. Грузим после
 * того, как браузер освободится (спека seo-speed-pack-2026-11, п. 3): первый
 * экран телефона получает меньше JS, виджет появляется через 1–3 секунды.
 */

const PublicSupportWidget = dynamic(
  () => import("@/components/public/public-support-widget").then((m) => m.PublicSupportWidget),
  { ssr: false },
);
const ContactsDock = dynamic(() => import("@/components/public/contacts-dock").then((m) => m.ContactsDock), { ssr: false });

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

function WhenIdle({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const w = window as IdleWindow;
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => setReady(true), { timeout: 3000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const timer = window.setTimeout(() => setReady(true), 1500);
    return () => window.clearTimeout(timer);
  }, []);
  return ready ? <>{children}</> : null;
}

export function LazyPublicWidgets({ telegramUrl }: { telegramUrl: string | null }) {
  return (
    <WhenIdle>
      <PublicSupportWidget />
      <ContactsDock telegramUrl={telegramUrl} />
    </WhenIdle>
  );
}
