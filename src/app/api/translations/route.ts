import { NextResponse } from "next/server";
import { z } from "zod";
import { getTranslationActor, listEntries, saveOverride } from "@/lib/translations/editor.server";
import { MAX_SEARCH_LENGTH } from "@/lib/translations/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Редактор переводов интерфейса (ROOT и переводчики).
 *   GET  ?category=&q=&filter=all|modified|untranslated&offset=&limit= — страница строк
 *        каталога (по умолчанию 100); без `category` — по всему каталогу (глобальный поиск);
 *   PUT  { key, locale, value } — правка; пустое или равное файлу значение — сброс.
 */

const ListQuery = z.object({
  category: z.string().max(120).optional(),
  q: z.string().max(MAX_SEARCH_LENGTH).optional(),
  filter: z.enum(["all", "modified", "untranslated"]).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const SaveBody = z.object({
  key: z.string().min(1).max(300),
  locale: z.string().min(2).max(8),
  value: z.string().max(20_000).nullable(),
});

export async function GET(request: Request) {
  const actor = await getTranslationActor();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const url = new URL(request.url);
  const parsed = ListQuery.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const result = await listEntries({ ...parsed.data, category: parsed.data.category || undefined });
  if (!result) return NextResponse.json({ error: "unknown_category" }, { status: 404 });
  return NextResponse.json(result);
}

export async function PUT(request: Request) {
  const actor = await getTranslationActor();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = SaveBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const result = await saveOverride(actor, parsed.data);
  if (!result.ok) return NextResponse.json(result, { status: result.error === "unknown_key" ? 404 : 422 });
  return NextResponse.json({ entry: result.entry });
}
