"use client";

import { downloadFileName, getNativeBridge, saveBlob } from "@/lib/native-bridge";

export async function openDocumentPdf(documentId: string) {
  const response = await fetch(`/api/journal-documents/${documentId}/pdf`, {
    method: "GET",
    credentials: "include",
  });

  const contentType = response.headers.get("content-type") || "";
  if (!response.ok || !contentType.includes("application/pdf")) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || "Не удалось открыть PDF");
  }

  const blob = await response.blob();
  // В приложении WeSetup новых вкладок нет — файл и лист «Поделиться».
  if (getNativeBridge()) {
    await saveBlob(
      blob,
      downloadFileName({
        contentDisposition: response.headers.get("content-disposition"),
        downloadAttr: null,
        url: `/api/journal-documents/${documentId}/pdf`,
        contentType: contentType,
      })
    );
    return;
  }
  const blobUrl = URL.createObjectURL(blob);
  const nextWindow = window.open(blobUrl, "_blank", "noopener,noreferrer");

  if (!nextWindow) {
    URL.revokeObjectURL(blobUrl);
    throw new Error("Браузер заблокировал открытие PDF");
  }

  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}
