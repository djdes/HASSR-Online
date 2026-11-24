/** Скелет содержимого пункта: пока сервер читает данные, окно уже открыто. */
export function PpkItemSkeleton() {
  return (
    <div className="space-y-3 py-1" aria-busy="true" data-ppk-item-skeleton>
      <div className="h-11 w-48 animate-pulse rounded-2xl bg-[#f1f2f8]" />
      <div className="h-20 animate-pulse rounded-2xl bg-[#f4f5fa]" />
      <div className="h-20 animate-pulse rounded-2xl bg-[#f4f5fa]" />
      <div className="h-20 animate-pulse rounded-2xl bg-[#f4f5fa]" />
    </div>
  );
}
