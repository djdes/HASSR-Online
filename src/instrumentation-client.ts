import { browserSentryEnabled, loadSentryBrowser } from "@/lib/sentry-lazy";

/**
 * Выполняется в браузере до гидратации (Next.js instrumentation-client). Sentry — ошибки у живых
 * пользователей на wesetup.ru (src/lib/sentry-config.ts) — грузится, когда страница уже открылась и
 * браузер свободен: первый экран не тяжелеет. Ошибки, случившиеся раньше, копятся здесь и уходят
 * сразу после загрузки; дальше их ловит сам Sentry. Ошибки, пойманные error boundary, — useReportError.
 */
if (browserSentryEnabled()) {
  const early: unknown[] = [];
  const onError = (event: ErrorEvent) => {
    // Без event.error — «Script error.» чужого скрипта: ни текста, ни стека.
    if (event.error) early.push(event.error);
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    early.push(event.reason);
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  const start = () => {
    loadSentryBrowser()
      ?.then((sentry) => {
        window.removeEventListener("error", onError);
        window.removeEventListener("unhandledrejection", onRejection);
        for (const error of early.splice(0)) sentry.captureError(error);
      })
      .catch(() => undefined);
  };
  const schedule = () => {
    // requestIdleCallback есть не во всех браузерах (Safari).
    if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(start, { timeout: 4000 });
    else setTimeout(start, 2000);
  };
  if (document.readyState === "complete") schedule();
  else window.addEventListener("load", schedule, { once: true });
}
