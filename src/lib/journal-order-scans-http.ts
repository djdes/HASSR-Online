/**
 * Ответ с файлом скана приказа: inline (просмотр в браузере) или
 * скачивание. `private, no-store` — файл не кэшируют прокси и браузер,
 * отзыв доступа действует сразу.
 */
export function orderScanFileResponse(
  scan: { title: string; mimeType: string; content: Uint8Array },
  download = false
): Response {
  const body = new Uint8Array(scan.content);
  const ext = scan.mimeType === "application/pdf" ? "pdf" : scan.mimeType === "image/png" ? "png" : "jpg";
  const name = `${scan.title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "prikaz"}.${ext}`;
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": scan.mimeType,
      "Content-Length": String(body.byteLength),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
