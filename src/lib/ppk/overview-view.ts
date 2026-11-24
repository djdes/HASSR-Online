/**
 * Вид обзора ППК (2026-11-24): новый (готовность к проверке, фильтр,
 * разделы, номера редакций) или прежний. Новый — по умолчанию; человек
 * возвращает прежний кнопкой (cookie), а `PPK_OVERVIEW_CLASSIC=1` в окружении
 * сервера включает прежний вид у всех — так от нового можно отказаться без
 * выкладки кода.
 */
import { REVISION_TEXT_BLOCKS, type RevisionDocRef, type RevisionTextBlock } from "./revisions";
import { PPK_STRUCTURE_ITEMS, type PpkItemId } from "./structure";

export const PPK_OVERVIEW_COOKIE = "ppk-overview";

export function ppkOverviewClassic(cookieValue: string | null | undefined, env: string | null | undefined): boolean {
  if (env === "1" || env === "true") return true;
  return cookieValue === "classic";
}

/** Пересмотр программы: через год после утверждения версии; «скоро» — за 30 дней. */
export function ppkReviewState(dueYmd: string, todayYmd: string): "ok" | "soon" | "overdue" {
  if (dueYmd < todayYmd) return "overdue";
  const due = Date.UTC(Number(dueYmd.slice(0, 4)), Number(dueYmd.slice(5, 7)) - 1, Number(dueYmd.slice(8, 10)));
  const today = Date.UTC(Number(todayYmd.slice(0, 4)), Number(todayYmd.slice(5, 7)) - 1, Number(todayYmd.slice(8, 10)));
  return (due - today) / 86_400_000 <= 30 ? "soon" : "ok";
}

type StructureRef = Exclude<RevisionDocRef, { kind: "knowledge" }>;

/** Пункты, документ которых ведёт редакции: политика 2.1 и тексты 1.8, 1.9, 2.2, 2.3, 2.9, приложение № 3. */
export function revisionItems(): { id: PpkItemId; ref: StructureRef }[] {
  return PPK_STRUCTURE_ITEMS.flatMap((item): { id: PpkItemId; ref: StructureRef }[] => {
    if (item.panel === "policy") return [{ id: item.id, ref: { kind: "policy" } }];
    const block = item.text?.block;
    if (block && (REVISION_TEXT_BLOCKS as readonly string[]).includes(block)) {
      return [{ id: item.id, ref: { kind: "text", block: block as RevisionTextBlock } }];
    }
    return [];
  });
}
