"use client";

import { useEffect, useState } from "react";

import { ROBOKASSA_IFRAME_SCRIPT_URL } from "@/lib/robokassa-constants";

declare global {
  interface Window {
    Robokassa?: { StartPayment: (params: Record<string, string>) => void };
  }
}

/**
 * Скрипт iFrame-оплаты Робокассы — лениво, один раз на страницу.
 *
 * Та же логика, что у оформления подписки (`/order`): если скрипт не
 * поднялся (блокировщик, офлайн CDN), вызывающий уводит на обычную форму
 * оплаты по `paymentUrl`, чтобы человек не упёрся в неработающую кнопку.
 */
export function useRobokassaScript(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const markReady = () => {
      if (!cancelled) setReady(true);
    };
    if (window.Robokassa) {
      queueMicrotask(markReady);
      return () => {
        cancelled = true;
      };
    }
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${ROBOKASSA_IFRAME_SCRIPT_URL}"]`,
    );
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", markReady);
    if (!existing) {
      script.src = ROBOKASSA_IFRAME_SCRIPT_URL;
      script.async = true;
      document.body.appendChild(script);
    }
    return () => {
      cancelled = true;
      script.removeEventListener("load", markReady);
    };
  }, []);

  return ready;
}
