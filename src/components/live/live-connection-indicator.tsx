"use client";

import { Unplug } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { shouldShowLiveDown } from "@/lib/live-connection";
import { useLiveConnection, useLiveEvents } from "@/lib/use-live-events";

/**
 * «Нет связи с сервером» — плашка в шапке сайта и полоса в Mini App.
 *
 * Появляется только после минуты обрыва потока при видимой вкладке и
 * при `navigator.onLine` — офлайн показывает свой индикатор, а короткие
 * разрывы (деплой) переживаются молча. Когда поток снова открылся —
 * тост «Связь восстановлена»; сами данные перечитывают подписчики по
 * событию `reconnect`, здесь ничего перезагружать не нужно.
 *
 * Держит поток открытым, пока смонтирован: на экранах без колокольчика
 * (Mini App) состоянию соединения иначе неоткуда взяться.
 */
const CHECK_MS = 5_000;

export function LiveConnectionIndicator({ variant = "site" }: { variant?: "site" | "mini" }) {
  const t = useTranslations("sharedUi.liveConnectionIndicator");
  useLiveEvents(() => {});
  const connection = useLiveConnection();
  const [shown, setShown] = useState(false);
  const announced = useRef(false);

  useEffect(() => {
    const check = () =>
      setShown(
        shouldShowLiveDown({
          status: connection.status,
          downSince: connection.downSince,
          now: Date.now(),
          online: typeof navigator === "undefined" || navigator.onLine !== false,
          visible: typeof document === "undefined" || document.visibilityState === "visible",
        })
      );
    check();
    if (connection.status !== "down") return;
    const id = window.setInterval(check, CHECK_MS);
    return () => window.clearInterval(id);
  }, [connection.status, connection.downSince]);

  useEffect(() => {
    if (shown) {
      announced.current = true;
      return;
    }
    if (announced.current && connection.status === "open") {
      announced.current = false;
      toast.success(t("restoredTitle"), { description: t("restoredDescription") });
    }
  }, [shown, connection.status, t]);

  if (!shown) return null;

  const title = t("tooltip");

  if (variant === "mini") {
    // В body, а не в .mini-root: правило `.mini-root > *` в mini-theme.css
    // делает прямых детей position: relative, и «fixed» полоса уезжала
    // в конец потока, за экран. Здесь мы уже на клиенте (shown === true).
    return createPortal(
      <div
        role="status"
        title={title}
        className="fixed left-1/2 top-2 z-[60] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-1.5 rounded-full bg-amber-500 px-4 py-1.5 text-center text-[12px] font-medium text-white shadow-lg"
      >
        <Unplug className="size-3.5" />
        {t("noConnection")}
      </div>,
      document.body
    );
  }

  return (
    <div
      role="status"
      title={title}
      className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#fff8eb] px-3 text-[13px] font-semibold text-[#b25f00]"
    >
      <Unplug className="size-4" />
      {t("noConnection")}
    </div>
  );
}
