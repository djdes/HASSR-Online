// Виды документов ЭДО и правила формы «Отправить документ» — чистая часть: без prisma и node-модулей,
// её читают и сервис отправки (src/lib/edo/send.server.ts), и интерфейс ROOT (/root/edo, кнопка
// EdoSendButton). Откуда берутся файлы источников — src/lib/edo/sources.server.ts.

import type { SabyOutgoingType } from "./saby/edo-api";

export const EDO_KINDS = ["contract", "invoice", "upd", "other"] as const;
export type EdoKind = (typeof EDO_KINDS)[number];

export function isEdoKind(value: unknown): value is EdoKind {
  return typeof value === "string" && (EDO_KINDS as readonly string[]).includes(value);
}

/**
 * Тип документа в Saby для вида. Счёт — `СчетИсх`, УПД — `ДокОтгрИсх` («Реализация»: PDF УПД
 * уходит неформализованным вложением — см. evidence задачи), договор — `ДоговорДок`. Прочий файл
 * (акт и т. п.) — тоже «Реализация»: это пакет первичных документов продавца.
 */
export const EDO_SABY_TYPE: Record<EdoKind, SabyOutgoingType> = {
  contract: "ДоговорДок",
  invoice: "СчетИсх",
  upd: "ДокОтгрИсх",
  other: "ДокОтгрИсх",
};

/** Виды, у которых документ берётся из WeSetup по `sourceId` (заказ, договор). */
export const EDO_SOURCE_KINDS: readonly EdoKind[] = ["invoice", "upd", "contract"];
/** Виды, которые можно отправить файлом с компьютера. */
export const EDO_FILE_KINDS: readonly EdoKind[] = ["contract", "other"];

/** Самый большой файл, который принимаем: в Saby он уходит base64 в теле запроса. */
export const EDO_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const EDO_FILE_EXTENSIONS = [".pdf", ".docx", ".odt", ".rtf"] as const;
export const EDO_FILE_ACCEPT = EDO_FILE_EXTENSIONS.join(",");

/** Как форма получит файл: из источника WeSetup или загруженный вручную. */
export type EdoSendPlan = { mode: "source"; sourceId: string } | { mode: "file" };

/** Что отправляем: ошибка — текст для человека. Файл главнее источника у договора (можно поправить руками). */
export function planEdoSend(input: { kind: EdoKind; sourceId?: string | null; hasFile: boolean }): EdoSendPlan | { error: string } {
  const sourceId = input.sourceId?.trim() || "";
  if (input.hasFile) {
    if (!EDO_FILE_KINDS.includes(input.kind)) {
      return { error: "Счёт и УПД берутся из WeSetup — выберите документ из списка, файл не нужен" };
    }
    return { mode: "file" };
  }
  if (sourceId) {
    if (!EDO_SOURCE_KINDS.includes(input.kind)) return { error: "Для прочего документа загрузите файл" };
    return { mode: "source", sourceId };
  }
  if (input.kind === "invoice") return { error: "Выберите счёт клиента" };
  if (input.kind === "upd") return { error: "Выберите УПД клиента" };
  return { error: "Загрузите файл документа (PDF, DOCX, ODT или RTF до 10 МБ)" };
}

/** Имя файла без пути и управляющих символов — так его увидит получатель в Saby. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  return base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200);
}

/** Расширение из белого списка (в нижнем регистре) или null. */
export function edoFileExtension(name: string): (typeof EDO_FILE_EXTENSIONS)[number] | null {
  const m = /\.[^.]+$/.exec(name.trim().toLowerCase());
  const ext = m ? m[0] : "";
  return (EDO_FILE_EXTENSIONS as readonly string[]).includes(ext) ? (ext as (typeof EDO_FILE_EXTENSIONS)[number]) : null;
}

/** Сигнатура содержимого совпадает с расширением: PDF — `%PDF`, DOCX/ODT — zip, RTF — `{\rtf`. */
function magicMatches(ext: string, bytes: Uint8Array): boolean {
  const head = String.fromCharCode(...Array.from(bytes.subarray(0, 5)));
  if (ext === ".pdf") return head.startsWith("%PDF");
  if (ext === ".docx" || ext === ".odt") return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (ext === ".rtf") return head.startsWith("{\\rtf");
  return false;
}

/** Проверка загруженного файла; null — годится, иначе текст для человека. */
export function checkEdoUpload(name: string, bytes: Uint8Array): string | null {
  const fileName = cleanFileName(name);
  if (!fileName) return "У файла нет имени";
  const ext = edoFileExtension(fileName);
  if (!ext) return "Подходят только PDF, DOCX, ODT и RTF";
  if (bytes.byteLength === 0) return "Файл пустой";
  if (bytes.byteLength > EDO_MAX_FILE_BYTES) return "Файл больше 10 МБ";
  if (!magicMatches(ext, bytes)) return "Содержимое файла не похоже на его расширение — сохраните документ заново";
  return null;
}

/**
 * Номер и дата документа из имени файла: «Договор № 2810-1 ООО «БФС» 28.10.2026.docx» →
 * «2810-1» и «2026-10-28». Не нашлось — пустая строка (поле заполнит человек).
 */
export function guessDocMeta(fileName: string): { number: string; date: string } {
  const base = fileName.replace(/\.[^.]+$/, "");
  const num = /№\s*([0-9A-Za-zА-Яа-яЁё][0-9A-Za-zА-Яа-яЁё/_.-]*)/.exec(base);
  const dm = /(?:^|\D)(\d{2})\.(\d{2})\.(\d{4})(?!\d)/.exec(base);
  let date = "";
  if (dm) {
    const [d, mo] = [Number(dm[1]), Number(dm[2])];
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) date = `${dm[3]}-${dm[2]}-${dm[1]}`;
  }
  const number = num ? num[1].replace(/[.]+$/, "") : "";
  return { number: /^\d{2}\.\d{2}\.\d{4}$/.test(number) ? "" : number, date };
}

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Дата `ГГГГ-ММ-ДД` настоящая (без 31 февраля). */
export function isValidDocDate(value: string): boolean {
  const m = YMD.exec(value.trim());
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** Дата по Москве `ГГГГ-ММ-ДД` — так документы WeSetup датируются в PDF. */
export function moscowYmd(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  return parts;
}
