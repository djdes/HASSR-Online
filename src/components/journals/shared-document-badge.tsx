/**
 * Точки (2026-09-05): бейдж «Общий» у документа без точки в списке журнала,
 * когда рядом есть документы точек. См. src/lib/journal-document-shared.ts.
 */
export function SharedDocumentBadge({ shared, copy }: { shared?: boolean; copy?: { label: string; title: string } }) {
  if (!shared) return null;
  return (
    <span
      title={copy?.title ?? "Документ без точки: виден на каждой точке организации"}
      className="ml-2 inline-flex shrink-0 items-center rounded-full bg-[#f5f6ff] px-2 py-0.5 align-middle text-[11px] font-medium text-[#3848c7]"
    >
      {copy?.label ?? "Общий"}
    </span>
  );
}
