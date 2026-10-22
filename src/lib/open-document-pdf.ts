"use client";

import type { Locale } from "@/i18n/locales";

import { downloadFileName, getNativeBridge, saveBlob } from "@/lib/native-bridge";

type OpenDocumentPdfFailure = "apiFallback" | "popupBlocked";
const ownedFailures = new WeakMap<object, OpenDocumentPdfFailure>();

export function getOpenDocumentPdfFailure(error: unknown): OpenDocumentPdfFailure | undefined {
  return typeof error === "object" && error !== null ? ownedFailures.get(error) : undefined;
}

export async function openDocumentPdf(documentId: string, locale: Locale | undefined = undefined) {
  const response = await fetch(`/api/journal-documents/${documentId}/pdf${locale === undefined ? "" : `?locale=${locale}`}`, {
    method: "GET",
    credentials: "include",
  });

  const contentType = response.headers.get("content-type") || "";
  if (!response.ok || !contentType.includes("application/pdf")) {
    const payload = await response.json().catch(() => null);
    const failure = payload?.error;
    const error = new Error(failure || "Не удалось открыть PDF");
    if (!failure) ownedFailures.set(error, "apiFallback");
    throw error;
  }

  const blob = await response.blob();
  // В приложении WeSetup новых вкладок нет — файл и лист «Поделиться».
  if (getNativeBridge()) {
    await saveBlob(
      blob,
      downloadFileName({
        contentDisposition: response.headers.get("content-disposition"),
        downloadAttr: null,
        url: `/api/journal-documents/${documentId}/pdf${locale === undefined ? "" : `?locale=${locale}`}`,
        contentType: contentType,
      })
    );
    return;
  }
  const blobUrl = URL.createObjectURL(blob);
  const nextWindow = window.open(blobUrl, "_blank", "noopener,noreferrer");

  if (!nextWindow) {
    URL.revokeObjectURL(blobUrl);
    const error = new Error("Браузер заблокировал открытие PDF");
    ownedFailures.set(error, "popupBlocked");
    throw error;
  }

  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}
