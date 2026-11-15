import { createHash } from "node:crypto";
import { MAIL_ATTACHMENT_BYTES, mailAttachmentError, mailAttachmentType, type MailAttachmentInfo } from "@/lib/mail-attachments";

export type PreparedMailAttachment = MailAttachmentInfo & { content: Buffer; sha256: string };
export class MailAttachmentError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const REQUEST_BYTES = MAIL_ATTACHMENT_BYTES + 512 * 1024;

/** Bound the actual stream before the multipart parser allocates file buffers. */
export async function readMailRequest(request: Request): Promise<{ content: unknown; attachments: PreparedMailAttachment[] }> {
  if (Number(request.headers.get("content-length")) > REQUEST_BYTES) throw new MailAttachmentError("Общий размер вложений — не более 10 МБ.", 413);
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > REQUEST_BYTES) { await reader.cancel(); throw new MailAttachmentError("Общий размер вложений — не более 10 МБ.", 413); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const body = Buffer.concat(chunks);
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("multipart/form-data")) {
    try { return { content: JSON.parse(body.toString("utf8")), attachments: [] }; }
    catch { throw new MailAttachmentError("Проверьте поля письма."); }
  }
  let form: FormData;
  try { form = await new Response(body, { headers: { "Content-Type": type } }).formData(); }
  catch { throw new MailAttachmentError("Не удалось прочитать вложения. Добавьте файлы заново."); }
  const entries = form.getAll("files");
  if (entries.some(file => typeof file === "string")) throw new MailAttachmentError("Добавьте вложения как файлы.");
  const files = entries as File[];
  const problem = mailAttachmentError(files);
  if (problem) throw new MailAttachmentError(problem === "count" ? "Не более 10 вложений в письме." : problem === "size" ? "Файлы должны быть непустыми, общий размер — не более 10 МБ." : "Этот тип файла не поддерживается. Прикрепите документ, изображение, архив ZIP, аудио или видео.");
  let content: unknown;
  try { content = JSON.parse(String(form.get("content"))); }
  catch { throw new MailAttachmentError("Проверьте поля письма."); }
  const attachments = await Promise.all(files.map(async file => {
    const content = Buffer.from(await file.arrayBuffer());
    return { filename: file.name, size: content.byteLength, contentType: mailAttachmentType(file.name)!, content, sha256: createHash("sha256").update(content).digest("hex") };
  }));
  return { content, attachments };
}
