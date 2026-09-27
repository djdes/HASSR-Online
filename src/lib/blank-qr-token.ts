import crypto from "node:crypto";

import {
  BLANK_COPYRIGHT,
  BLANK_QR_CAPTION,
  blankTargetKey,
  type BlankTarget,
} from "@/lib/blank-download";
import { deriveBlankKey } from "@/lib/blank-download-token";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { JOURNAL_QR_MAX_MODULES, journalQrMatrix, type JournalPdfQr } from "@/lib/pdf-journal-qr";
import { PAPER_JOURNALS } from "@/lib/sphere-journal-rules";

/**
 * QR в скачанном шаблоне → короткая страница `/qb/<токен>`.
 *
 * Токен — AES-256-GCM (ключ из серверного секрета) над `{ почта, журнал,
 * момент выдачи }`: из QR на бумаге почту не прочитать, а подделать токен
 * под чужую почту нельзя — GCM проверяет целостность. У образца без почты
 * (встроенный просмотр) токен несёт только журнал.
 *
 * Главное ограничение — плотность. QR — фирменная плитка в шапке бланка
 * (коррекция H, модуль не меньше 0,35 мм, шапка растёт не больше чем на
 * 4 мм), то есть не больше `JOURNAL_QR_MAX_MODULES` = 53 модулей (версия 9,
 * уровень H — 800 бит). Поэтому токен компактный:
 *   • двоичный заголовок: версия+флаги (1 байт), момент выдачи в секундах
 *     (4 байта), журнал — 3 байта SHA-256 от ключа цели (обратно
 *     восстанавливается перебором известных журналов и бланков);
 *   • почта — байтами UTF-8 за заголовком;
 *   • base32 ЗАГЛАВНЫМИ: библиотека qrcode кодирует такой хвост адреса
 *     алфавитно-цифровым режимом (5,5 бита на символ вместо 8).
 * На адресе https://wesetup.ru в QR помещается почта до 32 байт (до
 * 2026-09-27, с маленьким QR в углу бланка, — до 39). Длиннее —
 * `blankQrUrl` отдаёт токен без почты: страница /qb тогда не подставит
 * адрес, но всё остальное работает.
 */

export const BLANK_QR_PATH = "/qb/";
export const BLANK_QR_LINES = [BLANK_QR_CAPTION, BLANK_COPYRIGHT];

const VERSION = 1;
const FLAG_EMAIL = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HASH_BYTES = 3;
const HEADER_BYTES = 1 + 4 + HASH_BYTES;
const MAX_TOKEN_CHARS = 400;

// ---------------------------------------------------------------------------
// base32 (RFC 4648, заглавные, без «=»). Декодер принимает любой регистр:
// сканер или мессенджер могли привести адрес к строчным.
// ---------------------------------------------------------------------------

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let out = "";
  let value = 0;
  let bits = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer | null {
  const clean = text.trim().toUpperCase();
  if (!clean || !/^[A-Z2-7]+$/.test(clean)) return null;
  const out: number[] = [];
  let value = 0;
  let bits = 0;
  for (const char of clean) {
    value = (value << 5) | B32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
    value &= (1 << bits) - 1;
  }
  // Хвост — только нулевое выравнивание короче символа, иначе строка
  // не из нашего кодировщика.
  if (bits >= 5 || value !== 0) return null;
  return Buffer.from(out);
}

// ---------------------------------------------------------------------------
// Журнал ↔ 3 байта.
// ---------------------------------------------------------------------------

function targetHash(target: BlankTarget): Buffer {
  return crypto
    .createHash("sha256")
    .update(`wesetup-blank:${blankTargetKey(target)}`)
    .digest()
    .subarray(0, HASH_BYTES);
}

/** Все цели, которые может нести QR: журналы каталога и бумажные бланки. */
export function knownBlankTargets(): BlankTarget[] {
  return [
    ...ACTIVE_JOURNAL_CATALOG.map((item): BlankTarget => ({ kind: "code", code: item.code })),
    ...PAPER_JOURNALS.map((item): BlankTarget => ({ kind: "paper", paperId: item.id })),
  ];
}

let targetsByHash: Map<string, BlankTarget> | null = null;

function targetFromHash(hash: Buffer): BlankTarget | null {
  if (!targetsByHash) {
    targetsByHash = new Map();
    for (const target of knownBlankTargets()) {
      targetsByHash.set(targetHash(target).toString("hex"), target);
    }
  }
  return targetsByHash.get(hash.toString("hex")) ?? null;
}

// ---------------------------------------------------------------------------
// Шифрование.
// ---------------------------------------------------------------------------

export type BlankQrPayload = {
  /** `null` — журнал из токена больше не известен сайту (убран из каталога). */
  target: BlankTarget | null;
  email: string | null;
  issuedAt: Date;
};

export function sealBlankQrToken(params: {
  target: BlankTarget;
  email?: string | null;
  issuedAt?: number;
}): string {
  const email = params.email ? Buffer.from(params.email, "utf8") : null;
  const header = Buffer.alloc(HEADER_BYTES);
  header[0] = (VERSION << 4) | (email ? FLAG_EMAIL : 0);
  header.writeUInt32BE(Math.floor((params.issuedAt ?? Date.now()) / 1000) >>> 0, 1);
  targetHash(params.target).copy(header, 5);
  const plain = email ? Buffer.concat([header, email]) : header;

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveBlankKey("qr"), iv);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  return base32Encode(Buffer.concat([iv, encrypted, cipher.getAuthTag()]));
}

/** Расшифровать токен из `/qb/<токен>`. Битый, чужой или подделанный — `null`. */
export function openBlankQrToken(token: string): BlankQrPayload | null {
  if (typeof token !== "string" || token.length > MAX_TOKEN_CHARS) return null;
  const raw = base32Decode(token);
  if (!raw || raw.length < IV_BYTES + HEADER_BYTES + TAG_BYTES) return null;
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(raw.length - TAG_BYTES);
  const encrypted = raw.subarray(IV_BYTES, raw.length - TAG_BYTES);

  let plain: Buffer;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", deriveBlankKey("qr"), iv);
    decipher.setAuthTag(tag);
    plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  } catch {
    return null;
  }
  if (plain.length < HEADER_BYTES || plain[0] >> 4 !== VERSION) return null;
  const hasEmail = (plain[0] & FLAG_EMAIL) === FLAG_EMAIL;
  const email = hasEmail ? plain.subarray(HEADER_BYTES).toString("utf8") : null;
  if (hasEmail && !email) return null;
  return {
    target: targetFromHash(plain.subarray(5, HEADER_BYTES)),
    email,
    issuedAt: new Date(plain.readUInt32BE(1) * 1000),
  };
}

// ---------------------------------------------------------------------------
// Адрес и QR для PDF.
// ---------------------------------------------------------------------------

/** Помещается ли адрес в QR шапки бланка (коррекция H, не больше `JOURNAL_QR_MAX_MODULES` модулей). */
export function fitsJournalQr(url: string): boolean {
  return journalQrMatrix(url).modules.size <= JOURNAL_QR_MAX_MODULES;
}

export function blankQrUrl(
  origin: string,
  params: { target: BlankTarget; email?: string | null },
  issuedAt: number = Date.now(),
): { url: string; withEmail: boolean } {
  const base = `${origin.replace(/\/+$/, "")}${BLANK_QR_PATH}`;
  if (params.email) {
    const url = base + sealBlankQrToken({ target: params.target, email: params.email, issuedAt });
    if (fitsJournalQr(url)) return { url, withEmail: true };
  }
  return { url: base + sealBlankQrToken({ target: params.target, issuedAt }), withEmail: false };
}

/**
 * Строка внизу каждой страницы PDF шаблона: «Заполнять с телефона —
 * wesetup.ru · © WeSetup — …». Раньше это была подпись сбоку от QR в углу;
 * у QR в шапке своя полоса «Отсканировать».
 */
export const BLANK_PDF_FOOTER = BLANK_QR_LINES.join(" · ");

/** QR в шапке (на /qb) + строка копирайта внизу — на каждую страницу PDF. */
export function blankPdfQr(
  origin: string,
  params: { target: BlankTarget; email?: string | null },
): JournalPdfQr {
  return { url: blankQrUrl(origin, params).url, footer: BLANK_PDF_FOOTER };
}
