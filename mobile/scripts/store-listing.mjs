// Тексты карточек App Store и Google Play: источник — docs/mobile/store-listing.md
// (блоки ```text под заголовками «### Поле (до N)»), отсюда же собирается
// docs/mobile/listing-values.json для копирования одним файлом.
//
// Лимиты магазинов: у ключевых слов App Store — байты UTF-8 (русская буква —
// 2 байта), у остальных полей — символы. Проверяет store-assets.test.mjs.
//
// Запуск: node scripts/store-listing.mjs — пересобрать listing-values.json.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const LISTING_MD = path.resolve(here, "../../docs/mobile/store-listing.md");
export const LISTING_JSON = path.resolve(here, "../../docs/mobile/listing-values.json");

/** Все поля карточек: заголовок, текст, длина в единицах лимита, лимит. */
export function parseStoreListing(md) {
  const fields = [];
  const re = /^### (.+?) \(до (\d+)( байт UTF-8)?\)\s*$[\s\S]*?^```text\n([\s\S]*?)\n```/gm;
  for (const m of md.matchAll(re)) {
    const [, title, limit, bytes, text] = m;
    const unit = bytes ? "bytes" : "chars";
    const size = unit === "bytes" ? Buffer.byteLength(text, "utf8") : [...text].length;
    fields.push({ heading: `${title} (до ${limit}${bytes ?? ""})`, text, size, limit: Number(limit), unit });
  }
  return fields;
}

export function listingValues(md = readFileSync(LISTING_MD, "utf8")) {
  return { locale: "ru-RU", source: "docs/mobile/store-listing.md", fields: parseStoreListing(md) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const values = listingValues();
  writeFileSync(LISTING_JSON, JSON.stringify(values, null, 2) + "\n");
  for (const f of values.fields) {
    console.log(`${f.size <= f.limit ? "ok " : "ПРЕВЫШЕН"} ${f.size}/${f.limit} ${f.unit === "bytes" ? "байт" : "симв."} — ${f.heading}`);
  }
}
