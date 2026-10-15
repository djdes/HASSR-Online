"use client";

import { useSyncExternalStore } from "react";
import { emergencyLocale, emergencyTranslator } from "@/i18n/emergency-messages";
import { localizedHref } from "@/i18n/site-locale";

const subscribe = () => () => {};
const serverLocale = () => "ru" as const;
const browserLocale = () => emergencyLocale(window.location.pathname, document.cookie, document.documentElement.lang);

/**
 * Глобальный error boundary, ловит ошибки которые произошли ВЫШЕ
 * RootLayout — например, в самом layout'е, в metadata, в next/font,
 * или ошибки React Client Manifest при stale deployment'е.
 *
 * Без этого файла Next.js пытается отрендерить `pages/500.html` из
 * legacy-pages-router, которого в нашем App-Router-only build нет —
 * результат: ENOENT в pm2 logs и nginx отдаёт 502.
 *
 * Должен содержать собственные `<html>` и `<body>` теги — он заменяет
 * RootLayout полностью, не оборачивается им.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Server fallback is deterministic; browser preference applies after hydration.
  const locale = useSyncExternalStore(subscribe, browserLocale, serverLocale);
  const t = emergencyTranslator(locale);
  return (
    <html lang={locale}>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          background: "#fafbff",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          color: "#0b1024",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "40px 16px",
        }}
      >
        <div
          style={{
            maxWidth: 448,
            width: "100%",
            background: "#fff",
            border: "1px solid #ececf4",
            borderRadius: 24,
            padding: 32,
            textAlign: "center",
            boxShadow: "0 0 0 1px rgba(240,240,250,0.45)",
          }}
        >
          <div
            style={{
              margin: "0 auto",
              width: 56,
              height: 56,
              borderRadius: 16,
              background: "#fff4f2",
              color: "#a13a32",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 28,
            }}
          >
            !
          </div>
          <h1
            style={{
              marginTop: 24,
              fontSize: 24,
              fontWeight: 600,
              letterSpacing: "-0.02em",
            }}
          >
            {t("globalTitle")}
          </h1>
          <p
            style={{
              marginTop: 12,
              fontSize: 14,
              lineHeight: 1.55,
              color: "#6f7282",
            }}
          >
            {t("globalDescription")}
          </p>
          {error.digest ? (
            <p
              style={{
                marginTop: 8,
                fontFamily: "monospace",
                fontSize: 11,
                color: "#9b9fb3",
              }}
            >
              {t("code", { code: error.digest })}
            </p>
          ) : null}
          <div
            style={{
              marginTop: 28,
              display: "flex",
              gap: 8,
              flexDirection: "column",
              alignItems: "stretch",
            }}
          >
            <button
              type="button"
              onClick={() => reset()}
              style={{
                height: 44,
                borderRadius: 16,
                background: "#5566f6",
                color: "#fff",
                fontSize: 14,
                fontWeight: 500,
                border: "none",
                cursor: "pointer",
                boxShadow: "0 10px 30px -12px rgba(85,102,246,0.55)",
              }}
            >
              {t("retry")}
            </button>
            {/* Намеренно <a>, не <Link>: global-error срабатывает когда
                root layout упал, в этой ситуации клиентская гидратация
                могла не пройти и Link.prefetch может не работать. Полный
                page reload через <a> гарантирует выход из сломанного
                состояния. eslint-rule next/no-html-link-for-pages здесь
                нужно явно отключить. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href={localizedHref("/", locale)}
              style={{
                height: 44,
                lineHeight: "44px",
                borderRadius: 16,
                background: "#fff",
                border: "1px solid #dcdfed",
                color: "#0b1024",
                fontSize: 14,
                fontWeight: 500,
                textDecoration: "none",
                display: "block",
              }}
            >
              {t("home")}
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
