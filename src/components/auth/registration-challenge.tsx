"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

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

let scriptPromise: Promise<Recaptcha> | undefined;

function loadRecaptcha(): Promise<Recaptcha> {
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
    script.src = "https://www.recaptcha.net/recaptcha/api.js?render=explicit&onload=wesetupRecaptchaReady&hl=ru";
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

function RegistrationChallenge({ onToken, onRetry, tone }: {
  onToken: (token: string) => void;
  onRetry: () => void;
  tone: "light" | "dark";
}) {
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
        const response = await fetch("/api/auth/registration-challenge", {
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
        api = await loadRecaptcha();
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
  }, [onToken, tone]);

  return (
    <div className="mt-3 w-full min-w-0" data-registration-challenge>
      <div ref={container} />
      {loading && (
        <p role="status" className={"text-[13px] " + (tone === "dark" ? "text-white/70" : "text-[#6f7282]")}>
          Загружаем проверку…
        </p>
      )}
      {error && (
        <div role="alert" className={"text-[13px] " + (tone === "dark" ? "text-[#ffb4ab]" : "text-[#a13a32]")}>
          Не удалось пройти проверку. Попробуйте ещё раз.
          <button type="button" onClick={onRetry} className="ml-2 underline underline-offset-4">
            Повторить проверку
          </button>
        </div>
      )}
    </div>
  );
}

/** Independent tokens per form; any completed submission retires its token. */
export function useRegistrationChallenge(tone: "light" | "dark" = "light") {
  const [token, setToken] = useState("");
  const [website, setWebsite] = useState("");
  const [revision, setRevision] = useState(0);
  const id = useId();
  const reset = useCallback(() => {
    setToken("");
    setRevision((value) => value + 1);
  }, []);
  return {
    token,
    website,
    reset,
    element: (
      <>
        <div aria-hidden="true" className="hidden">
          <label htmlFor={id}>Ваш сайт</label>
          <input id={id} name="website" type="text" autoComplete="off" tabIndex={-1}
            value={website} onChange={(event) => setWebsite(event.target.value)} />
        </div>
        <RegistrationChallenge key={revision} tone={tone} onToken={setToken} onRetry={reset} />
      </>
    ),
  };
}
