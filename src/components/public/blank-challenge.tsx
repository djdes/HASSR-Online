"use client";

import { useTranslations } from "next-intl";
import { useSiteLocale } from "@/components/i18n/site-locale-provider";
import type { SiteLocale } from "@/i18n/site-locale";
import { CHALLENGE_MAX_AGE_MS, CHALLENGE_MIN_AGE_MS } from "@/lib/registration-challenge-timing";

import { useCallback, useEffect, useRef, useState } from "react";

type Recaptcha = {
  render: (container: HTMLElement, options: {
    sitekey: string;
    size: "compact";
    theme: "light" | "dark";
    callback: (token: string) => void;
    "expired-callback": () => void;
    "error-callback": () => void;
  }) => number;
  reset: (id: number) => void;
};

declare global {
  interface Window { grecaptcha?: Recaptcha; wesetupRecaptchaReady?: () => void }
}

/** Высота compact-виджета reCAPTCHA v2 (164×144) — резервируется до его прихода. */
const CHALLENGE_RESERVED_CLASS = "min-h-[144px]";

let scriptPromise: Promise<Recaptcha> | undefined;

function loadRecaptcha(locale: SiteLocale): Promise<Recaptcha> {
  if (window.grecaptcha?.render) return Promise.resolve(window.grecaptcha);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<Recaptcha>((resolve, reject) => {
    const script = document.createElement("script");
    const fail = () => {
      clearTimeout(timer);
      delete window.wesetupRecaptchaReady;
      script.remove();
      reject(new Error("Challenge script unavailable"));
    };
    const timer = setTimeout(fail, 15_000);
    script.src = `https://www.recaptcha.net/recaptcha/api.js?render=explicit&onload=wesetupRecaptchaReady&hl=${locale}`;
    script.async = true;
    window.wesetupRecaptchaReady = () => {
      clearTimeout(timer);
      delete window.wesetupRecaptchaReady;
      if (window.grecaptcha?.render) resolve(window.grecaptcha);
      else fail();
    };
    script.onerror = fail;
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    scriptPromise = undefined;
    throw error;
  });
  return scriptPromise;
}

function BlankChallenge({ onToken, onRetry, tone }: {
  onToken: (token: string) => void;
  onRetry: () => void;
  tone: "light" | "dark";
}) {
  const t = useTranslations("publicBlankDownload.challenge");
  const locale = useSiteLocale();
  const container = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    let api: Recaptcha | undefined;
    let widgetId: number | undefined;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const fail = () => {
      if (!active) return;
      onToken("");
      setLoading(false);
      setError(true);
    };

    async function init() {
      try {
        const response = await fetch("/api/public/blank-download/challenge", {
          cache: "no-store", signal: controller.signal,
        });
        if (!response.ok) throw new Error("Challenge configuration unavailable");
        const config: unknown = await response.json();
        if (!config || typeof config !== "object" || !("siteKey" in config) ||
            typeof config.siteKey !== "string" || !config.siteKey) {
          throw new Error("Invalid challenge configuration");
        }
        clearTimeout(timeout);
        if (!active) return;
        api = await loadRecaptcha(locale);
        if (!active || !container.current) return;
        widgetId = api.render(container.current, {
          sitekey: config.siteKey,
          size: "compact",
          theme: tone,
          callback: (token) => {
            if (!active) return;
            setError(false);
            onToken(token);
          },
          "expired-callback": () => {
            if (!active) return;
            onToken("");
            if (widgetId !== undefined) api?.reset(widgetId);
          },
          "error-callback": fail,
        });
        setLoading(false);
      } catch {
        fail();
      } finally {
        clearTimeout(timeout);
      }
    }
    void init();
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
      // v2 exposes reset, not destroy. React removes the widget container;
      // late provider callbacks are ignored through the active flag above.
      if (widgetId !== undefined) {
        try { api?.reset(widgetId); } catch { /* The iframe may already be detached. */ }
      }
    };
  }, [onToken, tone, locale]);

  return (
    <div className="mt-3 w-full min-w-0" data-download-challenge>
      {/* Виджет приходит только по просьбе сервера — подсказка, зачем он. */}
      <p className={"mb-2 text-[13px] leading-[1.5] " + (tone === "dark" ? "text-white/80" : "text-[#3c4053]")}>
        {t("required")}
      </p>
      {/* Место под compact-виджет (164×144) держим с первой отрисовки: виджет
          приходит через секунды, и без этого форма вырастала на 124 px и
          сдвигала первый экран (CLS 0,17 на телефоне). Надпись «загружается»
          лежит поверх зарезервированного места и не влияет на высоту. */}
      <div className={error ? "" : `relative ${CHALLENGE_RESERVED_CLASS}`}>
        <div ref={container} />
        {loading && (
          <p
            role="status"
            className={
              "absolute left-0 top-0 flex h-[144px] w-[164px] items-center justify-center rounded-[6px] border border-dashed px-3 text-center text-[13px] leading-snug " +
              (tone === "dark" ? "border-white/25 text-white/70" : "border-[#dcdfed] text-[#6f7282]")
            }
          >
            {t("loading")}</p>
        )}
      </div>
      {error && (
        <div role="alert" className={"text-[13px] " + (tone === "dark" ? "text-[#ffb4ab]" : "text-[#a13a32]")}>
          {t("failed")}<button type="button" onClick={onRetry} className="ml-2 underline underline-offset-4">
            {t("retry")}</button>
        </div>
      )}
    </div>
  );
}

/**
 * Невидимая отметка времени — та же, что у регистрации
 * (`GET /api/auth/registration-challenge`, спека invisible-antibot-2026-11).
 * Одна на страницу: её берут все кнопки скачивания, сервер принимает её не
 * раньше чем через 1,5 с после выдачи и не позже 12 часов.
 */
type Stamp = { token: string; receivedAt: number };
const STAMP_ENDPOINT = "/api/auth/registration-challenge";
let stampPromise: Promise<Stamp> | null = null;

function loadStamp(): Promise<Stamp> {
  if (stampPromise) return stampPromise;
  const promise = fetch(STAMP_ENDPOINT, { cache: "no-store" }).then(async (response) => {
    if (!response.ok) throw new Error("Stamp unavailable");
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || !("token" in data) || typeof data.token !== "string" || !data.token) {
      throw new Error("Invalid stamp");
    }
    return { token: data.token, receivedAt: Date.now() };
  });
  stampPromise = promise;
  promise.catch(() => {
    if (stampPromise === promise) stampPromise = null;
  });
  return promise;
}

/** Отметка для отправки; сервер её не выдал — пустая строка, и он попросит «Я не робот». */
async function stampToken(): Promise<string> {
  try {
    let stamp = await loadStamp();
    if (Date.now() - stamp.receivedAt > CHALLENGE_MAX_AGE_MS / 2) {
      stampPromise = null;
      stamp = await loadStamp();
    }
    const wait = stamp.receivedAt + CHALLENGE_MIN_AGE_MS + 150 - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    return stamp.token;
  } catch {
    return "";
  }
}

/**
 * Проверка перед скачиванием (спека blank-download-seal-cover-captcha-2026-11-20):
 * обычно невидимая — `stamp()` перед отправкой; виджет reCAPTCHA появляется,
 * только когда сервер ответил `captcha_required` (`requireCaptcha()`), и
 * дальше в этой вкладке показывается сразу. Токен каждой формы свой, любая
 * отправка его гасит.
 */
export function useBlankChallenge(tone: "light" | "dark" = "light") {
  const [token, setToken] = useState("");
  const [revision, setRevision] = useState(0);
  const [required, setRequired] = useState(false);
  const reset = useCallback(() => {
    setToken("");
    setRevision((value) => value + 1);
  }, []);
  const requireCaptcha = useCallback(() => {
    setToken("");
    setRequired(true);
    setRevision((value) => value + 1);
  }, []);
  const prefetch = useCallback(() => {
    loadStamp().catch(() => { /* повторим при отправке */ });
  }, []);
  return {
    token,
    required,
    reset,
    requireCaptcha,
    prefetch,
    stamp: stampToken,
    element: required ? <BlankChallenge key={revision} tone={tone} onToken={setToken} onRetry={reset} /> : null,
  };
}
