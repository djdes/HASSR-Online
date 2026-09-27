/**
 * «Длинные» входы печати журналов — без базы, в памяти.
 *
 * То же, что `journal-pdf-qr-2026-09/seed-overlap-docs.ts` делал через базу
 * (раздутые документы всех журналов каталога): массивы строк в `config`
 * дотянуты до 70, у гигиены и здоровья — 45 сотрудников × 14 дней записей.
 * Рендер тот же (`renderJournalDocumentPdf`), базы не нужно — поэтому одни и
 * те же входы можно напечатать кодом master и кодом ветки и сравнить число
 * страниц.
 */
import { SAMPLE_USERS, buildJournalSampleInput } from "@/lib/journal-sample-fixtures";
import type { JournalDocumentPdfInput } from "@/lib/document-pdf";

export const LONG_USERS = 45;
export const LONG_ROW_TARGET = 70;

function inflateArrays(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) {
    const items = value.map((item) => inflateArrays(item, depth + 1));
    const objects = items.filter((item) => item && typeof item === "object" && !Array.isArray(item));
    if (objects.length === items.length && items.length > 0 && items.length < LONG_ROW_TARGET && depth <= 2) {
      const out = [...items];
      let copy = 1;
      while (out.length < LONG_ROW_TARGET) {
        for (const item of items) {
          if (out.length >= LONG_ROW_TARGET) break;
          const clone = JSON.parse(JSON.stringify(item)) as Record<string, unknown>;
          if (typeof clone.id === "string") clone.id = `${clone.id}-c${copy}`;
          out.push(clone);
        }
        copy += 1;
      }
      return out;
    }
    return items;
  }
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, inflateArrays(v, depth + 1)]));
  }
  return value;
}

/** 45 сотрудников: первые 5 — образцовые (их id уже стоят в config), дальше — копии. */
export function longUsers(): JournalDocumentPdfInput["users"] {
  const users: JournalDocumentPdfInput["users"] = [];
  for (let i = 0; i < LONG_USERS; i += 1) {
    const sample = SAMPLE_USERS[i % SAMPLE_USERS.length];
    if (i < SAMPLE_USERS.length) {
      users.push({ ...sample } as JournalDocumentPdfInput["users"][number]);
      continue;
    }
    const [last, ...rest] = sample.name.split(" ");
    users.push({
      ...sample,
      id: `long-user-${i + 1}`,
      name: `${last}-${i + 1} ${rest.join(" ")}`,
      email: `long${i + 1}@example.com`,
    } as JournalDocumentPdfInput["users"][number]);
  }
  return users;
}

export function buildLongJournalInput(code: string): JournalDocumentPdfInput {
  const sample = buildJournalSampleInput(code);
  const users = longUsers();
  const document = sample.document as unknown as Record<string, unknown> & {
    config: unknown;
    entries: Array<{ employeeId: string; date: Date; data: unknown }>;
  };
  const config = inflateArrays(JSON.parse(JSON.stringify(document.config ?? {})));
  let entries = document.entries;
  if (code === "hygiene" || code === "health_check") {
    // Каждому из 45 сотрудников — записи «его» образцового сотрудника.
    entries = [];
    users.forEach((user, index) => {
      const sampleId = SAMPLE_USERS[index % SAMPLE_USERS.length].id;
      for (const entry of document.entries) {
        if (entry.employeeId !== sampleId) continue;
        entries.push({ ...entry, employeeId: user.id });
      }
    });
  }
  return {
    ...sample,
    users,
    document: { ...document, config, entries } as unknown as JournalDocumentPdfInput["document"],
  };
}
