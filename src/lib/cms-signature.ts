import { createHash } from "node:crypto";

/**
 * Разбор откреплённой подписи CMS (CAdES-BES) — для подписи журнала УКЭП
 * (спека journal-ukep-signing-2026-11-21). Свой маленький разбор DER/BER, без
 * зависимостей: достаём сертификат подписанта и подписанные атрибуты, чтобы
 * данные о подписанте брать из самой подписи, а не со слов браузера.
 *
 * Математику подписи ГОСТ Р 34.10-2012 сервер не проверяет — ГОСТ-криптографии
 * в Node нет. Для SHA-2 сверяем хэш PDF с подписанным (messageDigest); для ГОСТ —
 * только структура и сертификат, подлинность проверяют на Госуслугах или в
 * КриптоАРМ по паре «PDF + .sig».
 */

export class CmsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CmsError";
  }
}

type Tlv = {
  /** Класс: 0 — universal, 1 — application, 2 — context-specific, 3 — private. */
  cls: number;
  constructed: boolean;
  tagNumber: number;
  /** Начало и конец содержимого (без маркера конца у неопределённой длины). */
  contentStart: number;
  contentEnd: number;
  /** Начало и конец всего элемента — для сравнения «как есть» (имя издателя). */
  start: number;
  end: number;
};

const MAX_DEPTH = 64;

function readTlv(bytes: Uint8Array, offset: number, depth = 0): Tlv {
  if (depth > MAX_DEPTH) throw new CmsError("Подпись повреждена: слишком глубокая вложенность");
  if (offset + 2 > bytes.length) throw new CmsError("Подпись повреждена: файл обрывается");
  const first = bytes[offset];
  const cls = first >> 6;
  const constructed = (first & 0x20) !== 0;
  let tagNumber = first & 0x1f;
  let pos = offset + 1;
  if (tagNumber === 0x1f) {
    tagNumber = 0;
    let byte: number;
    do {
      if (pos >= bytes.length) throw new CmsError("Подпись повреждена: файл обрывается");
      byte = bytes[pos++];
      tagNumber = tagNumber * 128 + (byte & 0x7f);
    } while (byte & 0x80);
  }
  if (pos >= bytes.length) throw new CmsError("Подпись повреждена: файл обрывается");
  const lengthByte = bytes[pos++];
  if (lengthByte === 0x80) {
    // Неопределённая длина (BER): элементы до маркера конца 00 00.
    if (!constructed) throw new CmsError("Подпись повреждена: неверная кодировка длины");
    let cursor = pos;
    for (;;) {
      if (cursor + 2 > bytes.length) throw new CmsError("Подпись повреждена: нет маркера конца");
      if (bytes[cursor] === 0 && bytes[cursor + 1] === 0) break;
      cursor = readTlv(bytes, cursor, depth + 1).end;
    }
    return { cls, constructed, tagNumber, contentStart: pos, contentEnd: cursor, start: offset, end: cursor + 2 };
  }
  let length = lengthByte;
  if (lengthByte & 0x80) {
    const count = lengthByte & 0x7f;
    if (count > 4) throw new CmsError("Подпись повреждена: слишком большая длина");
    length = 0;
    for (let i = 0; i < count; i += 1) {
      if (pos >= bytes.length) throw new CmsError("Подпись повреждена: файл обрывается");
      length = length * 256 + bytes[pos++];
    }
  }
  const end = pos + length;
  if (end > bytes.length) throw new CmsError("Подпись повреждена: файл обрывается");
  return { cls, constructed, tagNumber, contentStart: pos, contentEnd: end, start: offset, end };
}

function children(bytes: Uint8Array, tlv: Tlv, depth = 0): Tlv[] {
  const out: Tlv[] = [];
  let cursor = tlv.contentStart;
  while (cursor < tlv.contentEnd) {
    const child = readTlv(bytes, cursor, depth + 1);
    out.push(child);
    cursor = child.end;
  }
  return out;
}

const content = (bytes: Uint8Array, tlv: Tlv) => bytes.subarray(tlv.contentStart, tlv.contentEnd);
const raw = (bytes: Uint8Array, tlv: Tlv) => bytes.subarray(tlv.start, tlv.end);
const isUniversal = (tlv: Tlv, tag: number) => tlv.cls === 0 && tlv.tagNumber === tag;
const isContext = (tlv: Tlv, tag: number) => tlv.cls === 2 && tlv.tagNumber === tag;

const SEQUENCE = 16;
const SET = 17;
const INTEGER = 2;
const OCTET_STRING = 4;
const OID = 6;

function expect(tlv: Tlv | undefined, tag: number, what: string): Tlv {
  if (!tlv || !isUniversal(tlv, tag)) throw new CmsError(`Подпись повреждена: нет поля «${what}»`);
  return tlv;
}

function decodeOid(value: Uint8Array): string {
  if (value.length === 0) throw new CmsError("Подпись повреждена: пустой OID");
  const parts: number[] = [];
  let acc = 0;
  for (const byte of value) {
    acc = acc * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) {
      parts.push(acc);
      acc = 0;
    }
  }
  const [head, ...tail] = parts;
  const first = head < 80 ? Math.floor(head / 40) : 2;
  return [first, head - first * 40, ...tail].join(".");
}

function decodeString(bytes: Uint8Array, tlv: Tlv): string {
  const value = content(bytes, tlv);
  switch (tlv.tagNumber) {
    case 30: {
      // BMPString — UTF-16BE.
      let text = "";
      for (let i = 0; i + 1 < value.length; i += 2) text += String.fromCharCode((value[i] << 8) | value[i + 1]);
      return text;
    }
    case 28: {
      // UniversalString — UTF-32BE.
      let text = "";
      for (let i = 0; i + 3 < value.length; i += 4) {
        text += String.fromCodePoint(((value[i] << 24) | (value[i + 1] << 16) | (value[i + 2] << 8) | value[i + 3]) >>> 0);
      }
      return text;
    }
    case 20:
      // TeletexString — на практике latin1.
      return Array.from(value, (byte) => String.fromCharCode(byte)).join("");
    default:
      // UTF8String, PrintableString, NumericString, IA5String.
      return new TextDecoder("utf-8").decode(value);
  }
}

function decodeTime(bytes: Uint8Array, tlv: Tlv): Date {
  const text = new TextDecoder("ascii").decode(content(bytes, tlv));
  let match: RegExpExecArray | null;
  if (tlv.tagNumber === 23 && (match = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z$/.exec(text))) {
    const year = Number(match[1]) >= 50 ? 1900 + Number(match[1]) : 2000 + Number(match[1]);
    return new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] ?? 0)));
  }
  if (tlv.tagNumber === 24 && (match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:\.\d+)?Z$/.exec(text))) {
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] ?? 0)));
  }
  throw new CmsError("Подпись повреждена: неверная дата");
}

const hex = (value: Uint8Array) => Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();

/** Поля имени X.500: стандартные и российские (ИНН, СНИЛС, ОГРН). */
const NAME_FIELDS: Readonly<Record<string, string>> = {
  "2.5.4.3": "CN",
  "2.5.4.4": "SN",
  "2.5.4.42": "GN",
  "2.5.4.12": "T",
  "2.5.4.10": "O",
  "2.5.4.11": "OU",
  "2.5.4.6": "C",
  "2.5.4.7": "L",
  "2.5.4.8": "ST",
  "1.2.840.113549.1.9.1": "E",
  "1.2.643.3.131.1.1": "INN",
  "1.2.643.100.4": "INNLE",
  "1.2.643.100.1": "OGRN",
  "1.2.643.100.5": "OGRNIP",
  "1.2.643.100.3": "SNILS",
};

type NameFields = Record<string, string>;

function parseName(bytes: Uint8Array, tlv: Tlv): NameFields {
  const fields: NameFields = {};
  for (const rdn of children(bytes, expect(tlv, SEQUENCE, "имя"))) {
    if (!isUniversal(rdn, SET)) continue;
    for (const attribute of children(bytes, rdn)) {
      const [type, value] = children(bytes, attribute);
      if (!type || !value || !isUniversal(type, OID)) continue;
      const key = NAME_FIELDS[decodeOid(content(bytes, type))];
      if (key && !fields[key]) fields[key] = decodeString(bytes, value).trim();
    }
  }
  return fields;
}

export type CertificateInfo = {
  /** «Фамилия Имя Отчество»: SN + GN, иначе CN. */
  subjectName: string;
  organization: string | null;
  title: string | null;
  inn: string | null;
  snils: string | null;
  ogrn: string | null;
  /** Удостоверяющий центр — CN (или O) издателя. */
  issuerName: string;
  serialHex: string;
  validFrom: Date;
  validTo: Date;
};

type ParsedCertificate = CertificateInfo & { issuerRaw: Uint8Array; serialRaw: Uint8Array; subjectKeyId: string | null };

function trimSerial(value: Uint8Array): Uint8Array {
  let start = 0;
  while (start < value.length - 1 && value[start] === 0) start += 1;
  return value.subarray(start);
}

function parseCertificate(bytes: Uint8Array, cert: Tlv): ParsedCertificate {
  const [tbs] = children(bytes, expect(cert, SEQUENCE, "сертификат"));
  const fields = children(bytes, expect(tbs, SEQUENCE, "данные сертификата"));
  let index = fields[0] && isContext(fields[0], 0) ? 1 : 0; // [0] version
  const serial = expect(fields[index++], INTEGER, "серийный номер");
  index += 1; // signature AlgorithmIdentifier
  const issuer = expect(fields[index++], SEQUENCE, "издатель");
  const validity = children(bytes, expect(fields[index++], SEQUENCE, "срок действия"));
  const subject = expect(fields[index++], SEQUENCE, "владелец");
  index += 1; // subjectPublicKeyInfo
  if (validity.length < 2) throw new CmsError("Подпись повреждена: нет срока действия сертификата");
  let subjectKeyId: string | null = null;
  for (const field of fields.slice(index)) {
    if (!isContext(field, 3)) continue;
    const [extensions] = children(bytes, field);
    for (const extension of extensions ? children(bytes, extensions) : []) {
      const parts = children(bytes, extension);
      if (parts[0] && decodeOid(content(bytes, parts[0])) === "2.5.29.14") {
        const wrapped = parts[parts.length - 1];
        const inner = readTlv(content(bytes, wrapped), 0);
        subjectKeyId = hex(content(content(bytes, wrapped), inner));
      }
    }
  }
  const subjectFields = parseName(bytes, subject);
  const issuerFields = parseName(bytes, issuer);
  const fullName = [subjectFields.SN, subjectFields.GN].filter(Boolean).join(" ");
  const serialRaw = trimSerial(content(bytes, serial));
  return {
    subjectName: fullName || subjectFields.CN || "—",
    organization: subjectFields.O ?? null,
    title: subjectFields.T ?? null,
    inn: subjectFields.INN ?? subjectFields.INNLE ?? null,
    snils: subjectFields.SNILS ?? null,
    ogrn: subjectFields.OGRN ?? subjectFields.OGRNIP ?? null,
    issuerName: issuerFields.CN ?? issuerFields.O ?? "—",
    serialHex: hex(serialRaw),
    validFrom: decodeTime(bytes, validity[0]),
    validTo: decodeTime(bytes, validity[1]),
    issuerRaw: raw(bytes, issuer),
    serialRaw,
    subjectKeyId,
  };
}

const DIGESTS: Readonly<Record<string, DigestName>> = {
  "2.16.840.1.101.3.4.2.1": "sha256",
  "2.16.840.1.101.3.4.2.2": "sha384",
  "2.16.840.1.101.3.4.2.3": "sha512",
  "1.3.14.3.2.26": "sha1",
  "1.2.643.7.1.1.2.2": "gost2012-256",
  "1.2.643.7.1.1.2.3": "gost2012-512",
  "1.2.643.2.2.9": "gost94",
};

export type DigestName = "sha256" | "sha384" | "sha512" | "sha1" | "gost2012-256" | "gost2012-512" | "gost94" | "other";

export type ParsedSignature = {
  signer: CertificateInfo;
  digest: DigestName;
  /** Хэш подписанного содержимого из подписанных атрибутов (CAdES-BES). */
  messageDigest: Uint8Array | null;
  signingTime: Date | null;
  /** true — в подписи нет самого документа (откреплённая). */
  detached: boolean;
};

const equalBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, i) => byte === b[i]);

/** CMS ContentInfo(SignedData) → подписант, алгоритм хэша, подписанные атрибуты. */
export function parseCmsSignature(input: Uint8Array): ParsedSignature {
  const bytes = input;
  let contentInfo: Tlv;
  try {
    contentInfo = readTlv(bytes, 0);
  } catch {
    throw new CmsError("Это не файл подписи: ожидалась подпись CMS (PKCS#7)");
  }
  if (!isUniversal(contentInfo, SEQUENCE)) throw new CmsError("Это не файл подписи: ожидалась подпись CMS (PKCS#7)");
  const [type, wrapper] = children(bytes, contentInfo);
  if (!type || !isUniversal(type, OID) || decodeOid(content(bytes, type)) !== "1.2.840.113549.1.7.2" || !wrapper) {
    throw new CmsError("Это не подпись: в файле нет данных подписи CMS (SignedData)");
  }
  const [signedData] = children(bytes, wrapper);
  const parts = children(bytes, expect(signedData, SEQUENCE, "SignedData"));
  // version, digestAlgorithms, encapContentInfo, [0] certificates, [1] crls, signerInfos
  const encap = children(bytes, expect(parts[2], SEQUENCE, "содержимое"));
  const detached = !encap.some((item) => isContext(item, 0));
  const certificates: ParsedCertificate[] = [];
  let signerInfos: Tlv | undefined;
  for (const part of parts.slice(3)) {
    if (isContext(part, 0)) {
      for (const cert of children(bytes, part)) if (isUniversal(cert, SEQUENCE)) certificates.push(parseCertificate(bytes, cert));
    } else if (isUniversal(part, SET)) {
      signerInfos = part;
    }
  }
  const signerInfoList = signerInfos ? children(bytes, signerInfos) : [];
  if (signerInfoList.length === 0) throw new CmsError("В подписи нет подписанта");
  const signerParts = children(bytes, expect(signerInfoList[0], SEQUENCE, "подписант"));
  const sid = signerParts[1];
  let signer: ParsedCertificate | undefined;
  if (sid && isUniversal(sid, SEQUENCE)) {
    const [issuer, serial] = children(bytes, sid);
    const issuerRaw = issuer ? raw(bytes, issuer) : new Uint8Array();
    const serialRaw = serial ? trimSerial(content(bytes, serial)) : new Uint8Array();
    signer = certificates.find((cert) => equalBytes(cert.issuerRaw, issuerRaw) && equalBytes(cert.serialRaw, serialRaw));
  } else if (sid && isContext(sid, 0)) {
    const keyId = hex(content(bytes, sid));
    signer = certificates.find((cert) => cert.subjectKeyId === keyId);
  }
  if (!signer) throw new CmsError("В подписи нет сертификата подписанта — подпишите заново, включив сертификат");
  const digestAlgorithm = children(bytes, expect(signerParts[2], SEQUENCE, "алгоритм хэша"))[0];
  const digest = digestAlgorithm ? DIGESTS[decodeOid(content(bytes, digestAlgorithm))] ?? "other" : "other";
  let messageDigest: Uint8Array | null = null;
  let signingTime: Date | null = null;
  const signedAttrs = signerParts[3] && isContext(signerParts[3], 0) ? signerParts[3] : null;
  for (const attribute of signedAttrs ? children(bytes, signedAttrs) : []) {
    const [attrType, values] = children(bytes, attribute);
    if (!attrType || !values) continue;
    const oid = decodeOid(content(bytes, attrType));
    const [value] = children(bytes, values);
    if (!value) continue;
    if (oid === "1.2.840.113549.1.9.4" && isUniversal(value, OCTET_STRING)) messageDigest = new Uint8Array(content(bytes, value));
    if (oid === "1.2.840.113549.1.9.5") signingTime = decodeTime(bytes, value);
  }
  const { issuerRaw: _issuerRaw, serialRaw: _serialRaw, subjectKeyId: _subjectKeyId, ...info } = signer;
  return { signer: info, digest, messageDigest, signingTime, detached };
}

const NODE_DIGESTS: Partial<Record<DigestName, string>> = { sha256: "sha256", sha384: "sha384", sha512: "sha512", sha1: "sha1" };

/**
 * Годится ли подпись для этого PDF: откреплённая, CAdES-BES (есть хэш в
 * подписанных атрибутах), сертификат действует на момент подписания; для SHA-2
 * хэш PDF совпадает с подписанным. `digestChecked: false` — ГОСТ: хэш здесь не
 * посчитать, подлинность проверяют на Госуслугах.
 */
export function checkSignatureForPdf(
  signature: ParsedSignature,
  pdf: Uint8Array,
  now: Date,
): { ok: true; digestChecked: boolean } | { ok: false; error: string } {
  if (!signature.detached) return { ok: false, error: "Нужна откреплённая подпись: файл .sig отдельно от PDF" };
  if (!signature.messageDigest) return { ok: false, error: "Подпись без подписанных атрибутов — нужна CAdES-BES" };
  const at = signature.signingTime ?? now;
  if (at < signature.signer.validFrom || at > signature.signer.validTo) {
    return { ok: false, error: "Сертификат подписанта не действует на момент подписания" };
  }
  const algorithm = NODE_DIGESTS[signature.digest];
  if (!algorithm) return { ok: true, digestChecked: false };
  const actual = createHash(algorithm).update(pdf).digest();
  if (!equalBytes(new Uint8Array(actual), signature.messageDigest)) return { ok: false, error: "Подпись сделана не для этого PDF" };
  return { ok: true, digestChecked: true };
}
