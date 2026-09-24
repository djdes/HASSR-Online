import { NextResponse } from "next/server";

import {
  diffSharedItems,
  isSharedKind,
  listSharedItems,
  parseSharedItemsFromSheet,
  parseSharedItemsFromText,
  SHARED_ITEMS_MAX,
  sharedItemsForKind,
  type SharedItem,
  type SharedKind,
} from "@/lib/master-directory";
import { requireMasterDirectorySession } from "@/lib/master-directory-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_LENGTH = 1_000_000;
const FILE_EXTENSIONS = /\.(xlsx|xls|csv)$/i;

/**
 * Предпросмотр нового списка мастер-кабинета: `multipart/form-data`
 * (`file` xlsx/xls/csv до 5 МБ + `kind`), JSON `{ kind, text }` или
 * JSON `{ kind, items }` — строки таблицы «Наименование | Выход | Время».
 * Ничего не сохраняет — отдаёт нормализованные позиции и различия с
 * текущим списком.
 */
export async function POST(request: Request) {
  const auth = await requireMasterDirectorySession();
  if (!auth.ok) return auth.response;

  let kind: SharedKind;
  let items: SharedItem[];
  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const rawKind = form.get("kind");
      if (!isSharedKind(rawKind)) {
        return NextResponse.json({ error: "Неизвестный список: нужен dish или product" }, { status: 400 });
      }
      kind = rawKind;
      const file = form.get("file");
      if (!(file instanceof File) || file.size === 0) {
        return NextResponse.json({ error: "Выберите файл Excel или CSV" }, { status: 400 });
      }
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: "Файл больше 5 МБ. Разбейте список на части." }, { status: 413 });
      }
      if (!FILE_EXTENSIONS.test(file.name)) {
        return NextResponse.json({ error: "Подойдёт файл .xlsx, .xls или .csv" }, { status: 400 });
      }
      items = parseSharedItemsFromSheet(Buffer.from(await file.arrayBuffer()), file.name);
    } else {
      const body = (await request.json().catch(() => null)) as
        | { kind?: unknown; text?: unknown; items?: unknown }
        | null;
      if (!isSharedKind(body?.kind)) {
        return NextResponse.json({ error: "Неизвестный список: нужен dish или product" }, { status: 400 });
      }
      kind = body.kind;
      if (Array.isArray(body?.items)) {
        if (body.items.length > SHARED_ITEMS_MAX * 2) {
          return NextResponse.json({ error: `Слишком много строк: не больше ${SHARED_ITEMS_MAX}.` }, { status: 413 });
        }
        items = body.items.map((raw) => {
          const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
          const text = (value: unknown) => (typeof value === "string" ? value : null);
          return {
            name: text(row.name) ?? "",
            supplier: text(row.supplier),
            manufacturer: text(row.manufacturer),
            portion: text(row.portion),
            time: text(row.time),
          };
        });
      } else {
        const text = typeof body?.text === "string" ? body.text : "";
        if (text.length > MAX_TEXT_LENGTH) {
          return NextResponse.json({ error: "Слишком длинный текст. Загрузите список файлом." }, { status: 413 });
        }
        items = parseSharedItemsFromText(text, kind);
      }
    }
  } catch (err) {
    console.error("[master-directory] preview parse failed", { masterOrgId: auth.masterOrgId }, err);
    return NextResponse.json({ error: "Не удалось прочитать файл. Проверьте, что это Excel или CSV." }, { status: 400 });
  }

  items = sharedItemsForKind(kind, items);
  if (items.length === 0) {
    return NextResponse.json(
      { error: "Не нашли ни одной позиции. Одна позиция — одна строка, или колонка «Наименование»." },
      { status: 400 }
    );
  }

  const current = await listSharedItems(auth.masterOrgId, kind);
  const diff = diffSharedItems(current, items);
  console.info("[master-directory] preview", {
    masterOrgId: auth.masterOrgId,
    kind,
    items: items.length,
    added: diff.added.length,
    removed: diff.removed.length,
    changed: diff.changed.length,
  });
  return NextResponse.json({ items, diff });
}
