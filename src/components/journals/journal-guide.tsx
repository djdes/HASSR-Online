import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  BookOpenText,
  CheckCircle2,
  ListChecks,
  Package,
  ScrollText,
} from "lucide-react";
import { getFillingGuide } from "@/lib/journal-filling-guides";
import { getJournalSpec } from "@/lib/journal-specs";

type CustomGuideNode = {
  title: string;
  detail: string | null;
  photoUrl: string | null;
};

type Props = {
  journalCode: string;
  /// Если true — рендер сразу раскрытым (для standalone-страницы).
  /// Если false (default) — внутри <details> для inline-collapsible.
  expanded?: boolean;
  /**
   * P1.5 wave-c — кастомный гайд из БД (`JournalGuideNode[]` в порядке
   * tree-flatten). Если передан и непустой — заменяет legacy
   * `guide.steps` секцию. Остальные секции (materials, mistakes,
   * regulationRef) остаются из legacy.
   *
   * Загружается на server'е через `loadGuideTree(orgId, code)`. В
   * client-компонентах прокидывается prop'ом из page.tsx.
   */
  customNodes?: CustomGuideNode[];
};

/**
 * Гайд «Как правильно заполнить журнал» — для нового сотрудника.
 * Server-component (нет client-state). Используется:
 *   • inline в DynamicForm (collapsible сверху формы)
 *   • standalone /journals/<code>/guide (всегда открыто)
 */
export function JournalGuide({
  journalCode,
  expanded = false,
  customNodes,
}: Props) {
  const t = useTranslations("journalControls.guideSections");
  const tGuide = useTranslations("journalFillingGuides");
  const tWalkthrough = useTranslations("journalControls.walkthroughs");
  const guide = getFillingGuide(journalCode, { guide: tGuide, walkthrough: tWalkthrough });
  const spec = getJournalSpec(journalCode);
  const hasCustomNodes = (customNodes?.length ?? 0) > 0;
  if (!guide && !hasCustomNodes) {
    // Fallback — хоть что-то показать.
    return (
      <div className="rounded-2xl border border-[#5566f6]/15 bg-[#f5f6ff]/50 p-3 text-[12.5px] leading-snug text-[#3848c7]">
        <strong>{spec.shortDescription}</strong>
        <div className="mt-1 text-[11.5px] text-[#6f7282]">
          {spec.regulation}
        </div>
      </div>
    );
  }

  const summaryText = guide?.summary ?? spec.shortDescription;
  const body = (
    <div className="space-y-4 p-4 sm:p-5">
      <div>
        <div className="flex items-start gap-2 text-[13px] leading-snug text-[#3c4053]">
          <BookOpenText className="mt-0.5 size-4 shrink-0 text-[#5566f6]" />
          <span>{summaryText}</span>
        </div>
        {hasCustomNodes ? (
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[#f5f0ff] px-2.5 py-0.5 text-[11px] font-medium text-[#7a5cff]">
            {t("custom")}
          </div>
        ) : null}
      </div>

      {guide && guide.materials.length > 0 ? (
        <div>
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#3848c7]">
            <Package className="size-3.5" />
            {t("materials")}
          </div>
          <ul className="space-y-1 text-[12.5px] text-[#3c4053]">
            {guide.materials.map((m, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-[#5566f6]" />
                <span>{m}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#3848c7]">
          <ListChecks className="size-3.5" />
          {t("orderedSteps")}
        </div>
        <ol className="space-y-2.5">
          {hasCustomNodes
            ? customNodes!.map((node, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-[#7a5cff] text-[11px] font-semibold text-white">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold leading-tight text-[#0b1024]">
                      {node.title}
                    </div>
                    {node.detail ? (
                      <div className="mt-0.5 whitespace-pre-line text-[12.5px] leading-snug text-[#3c4053]">
                        {node.detail}
                      </div>
                    ) : null}
                    {node.photoUrl ? (
                      <a
                        href={node.photoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-1 rounded-lg bg-[#f5f6ff] px-2.5 py-1 text-[11px] text-[#3848c7] hover:bg-[#eef1ff]"
                      >
                        {t("photo")}
                      </a>
                    ) : null}
                  </div>
                </li>
              ))
            : (guide?.steps ?? []).map((step, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-[#5566f6] text-[11px] font-semibold text-white">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold leading-tight text-[#0b1024]">
                      {step.title}
                    </div>
                    <div className="mt-0.5 text-[12.5px] leading-snug text-[#3c4053]">
                      {step.detail}
                    </div>
                  </div>
                </li>
              ))}
        </ol>
      </div>

      {guide ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <div className="flex items-start gap-2 text-[12.5px]">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-700" />
            <div>
              <div className="font-semibold text-emerald-800">
                {t("completion")}
              </div>
              <div className="mt-0.5 text-emerald-900/80">
                {guide.completionCriteria}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {guide && guide.commonMistakes.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <div className="flex items-start gap-2 text-[12.5px]">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700" />
            <div className="min-w-0">
              <div className="font-semibold text-amber-800">
                {t("beginnerMistakes")}
              </div>
              <ul className="mt-1 space-y-1 text-amber-900/80">
                {guide.commonMistakes.map((m, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <span className="mt-1 inline-block size-1.5 shrink-0 rounded-full bg-amber-600" />
                    <span>{m}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : null}

      {guide ? (
        <div className="rounded-xl bg-[#fafbff] p-3 text-[11.5px] text-[#6f7282]">
          <div className="flex items-start gap-1.5">
            <ScrollText className="mt-0.5 size-3.5 shrink-0" />
            <div>
              <div className="font-semibold text-[#3c4053]">{t("regulation")}</div>
              <div className="mt-0.5">{guide.regulationRef}</div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );

  if (expanded) {
    return (
      <div className="overflow-hidden rounded-3xl border border-[#5566f6]/30 bg-white shadow-[0_0_0_1px_rgba(85,102,246,0.1)]">
        <div className="border-b border-[#ececf4] bg-gradient-to-br from-[#f5f6ff] to-white p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <BookOpenText className="size-5 text-[#5566f6]" />
            <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-[#0b1024]">
              {t("title")}
            </h2>
          </div>
        </div>
        {body}
      </div>
    );
  }

  return (
    <details className="group overflow-hidden rounded-2xl border border-[#5566f6]/20 bg-gradient-to-br from-[#f5f6ff]/50 to-white">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-3 transition-colors hover:bg-[#f5f6ff]/80 sm:p-4">
        <div className="flex items-center gap-2">
          <BookOpenText className="size-4 text-[#5566f6]" />
          <span className="text-[13px] font-semibold text-[#3848c7]">
            {t("firstTime")}
          </span>
        </div>
        <span className="text-[11px] text-[#9b9fb3] group-open:hidden">
          {t("expand")}
        </span>
        <span className="hidden text-[11px] text-[#9b9fb3] group-open:inline">
          {t("collapse")}
        </span>
      </summary>
      <div className="border-t border-[#ececf4]">{body}</div>
    </details>
  );
}
