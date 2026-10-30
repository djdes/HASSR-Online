import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Шифрование секретов ЭДО (защищённый ключ приложения Saby и сессия) в БД.
 *
 * AES-256-GCM, ключ = sha256(`<назначение>:` + NEXTAUTH_SECRET): у каждого назначения свой ключ,
 * буквально с секретом подписи сессий он не совпадает. Формат: base64(iv[12] ‖ tag[16] ‖ ct) —
 * как в DocsFlow (`api-secret-crypto.ts`). Смена NEXTAUTH_SECRET делает сохранённые секреты
 * нечитаемыми — тогда ключи кабинета вводят заново (сервис это подсказывает).
 */
const PURPOSE = "saby";

function encKey(purpose: string): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET не задан — нечем шифровать ключи Saby");
  return createHash("sha256").update(`${purpose}:${secret}`).digest();
}

export function encryptEdoSecret(plain: string, purpose: string = PURPOSE): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKey(purpose), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decryptEdoSecret(enc: string, purpose: string = PURPOSE): string {
  const raw = Buffer.from(enc, "base64");
  const decipher = createDecipheriv("aes-256-gcm", encKey(purpose), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}
