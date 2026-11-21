"use client";

import { useEffect } from "react";

import { reportError } from "@/lib/sentry-lazy";

/**
 * Ошибку, пойманную error boundary, сам браузер в Sentry не передаст — отправляем её сами (пока Sentry
 * выключен, это ничего не делает). Ошибка с `digest` пришла с сервера: её уже отправил onRequestError
 * с настоящим текстом, в браузере у неё только обезличенное сообщение — второй раз не шлём.
 */
export function useReportError(error: (Error & { digest?: string }) | null | undefined): void {
  useEffect(() => {
    if (!error || error.digest) return;
    reportError(error);
  }, [error]);
}
