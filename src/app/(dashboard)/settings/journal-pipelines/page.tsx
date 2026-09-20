import { redirect } from "next/navigation";
import Link from "next/link";
import { BookOpen } from "lucide-react";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasCapability } from "@/lib/permission-presets";
import { getDefaultPipeline } from "@/lib/journal-pipelines";
import { PIPELINE_EXEMPT_JOURNALS } from "@/lib/journal-default-pipelines";
import { PageHeader } from "@/components/ui/page-header";
import { SeedAllPipelinesButton } from "./seed-all-button";

/**
 * Один primary-бейдж на журнал — отвечает на вопрос «настроен или нет».
 *
 * Иерархия (приоритет сверху вниз):
 *   1. exempt (кастомный адаптер) — pipeline-tree не нужен в принципе.
 *   2. tree-pinned + tree-custom > 0 → «Шаблон + свои шаги»
 *   3. tree-pinned > 0 → «Шаблон» (был seed, шаги дефолтные)
 *   4. tree-custom > 0 (без pinned) → «Свои шаги»
 *   5. legacy (старый JSON pipeline через journalPipelinesJson) → «Legacy»
 *   6. ничего → «Не настроен»
 *
 * Если есть И tree, И legacy одновременно — это «Гибрид» (warn).
 */
type PipelineStatus =
  | { kind: "exempt"; pinned: number; custom: number }
  | { kind: "template_only"; pinned: number }
  | { kind: "template_with_custom"; pinned: number; custom: number }
  | { kind: "custom_only"; custom: number }
  | { kind: "hybrid_legacy_tree"; pinned: number; custom: number }
  | { kind: "legacy_only" }
  | { kind: "not_configured" };

function pluralRu(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
function pluralUzly(n: number) {
  return pluralRu(n, "свой шаг", "своих шага", "своих шагов");
}
function pluralKolonok(n: number) {
  return pluralRu(n, "колонка", "колонки", "колонок");
}
function pluralOwnSteps(n: number) {
  return pluralRu(n, "свой шаг", "своих шага", "своих шагов");
}
function pluralStepsForGuide(n: number) {
  return pluralRu(n, "шаг", "шага", "шагов");
}

function computeStatus(args: {
  code: string;
  pinned: number;
  custom: number;
  hasLegacy: boolean;
}): PipelineStatus {
  const { code, pinned, custom, hasLegacy } = args;
  if (PIPELINE_EXEMPT_JOURNALS.has(code))
    return { kind: "exempt", pinned, custom };
  const hasTree = pinned > 0 || custom > 0;
  if (hasTree && hasLegacy)
    return { kind: "hybrid_legacy_tree", pinned, custom };
  if (pinned > 0 && custom > 0)
    return { kind: "template_with_custom", pinned, custom };
  if (pinned > 0) return { kind: "template_only", pinned };
  if (custom > 0) return { kind: "custom_only", custom };
  if (hasLegacy) return { kind: "legacy_only" };
  return { kind: "not_configured" };
}

export const dynamic = "force-dynamic";

// Список журналов подтягивается из БД (db.journalTemplate.findMany).
// Раньше был хардкодным с короткими лейблами вроде «Скоропорт» вместо
// полного «Журнал бракеража скоропортящейся пищевой продукции», и
// при добавлении нового журнала в seed.ts — нужно было ещё и тут
// дописать. Теперь list = source of truth = JournalTemplate (active).

export default async function JournalPipelinesPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!hasCapability(session.user, "admin.full")) redirect("/journals");

  const organizationId = getActiveOrgId(session);

  const [org, allJournals, treeTemplates, treeNodes, guideTemplates] = await Promise.all([
    db.organization.findUnique({
      where: { id: organizationId },
      select: { journalPipelinesJson: true },
    }),
    db.journalTemplate.findMany({
      where: { isActive: true },
      select: { code: true, name: true },
      orderBy: { sortOrder: "asc" },
    }),
    db.journalPipelineTemplate.findMany({
      where: { organizationId },
      select: { templateCode: true },
    }),
    // Все узлы всех pipeline-шаблонов организации — нужно чтобы посчитать
    // pinned vs custom отдельно. На org с 35 templates × ~10 nodes это
    // ~350 строк, дешевле чем groupBy через Prisma.
    db.journalPipelineNode.findMany({
      where: { template: { organizationId } },
      select: {
        kind: true,
        template: { select: { templateCode: true } },
      },
    }),
    db.journalGuideTemplate.findMany({
      where: { organizationId },
      select: {
        templateCode: true,
        _count: { select: { nodes: true } },
      },
    }),
  ]);

  const overrides = (org?.journalPipelinesJson ?? {}) as Record<
    string,
    { steps: { id: string }[] }
  >;

  // Templates с привязанной orga-копией (даже пустые без узлов) —
  // нужно знать чтобы понимать «orga открывала редактор» vs «никогда».
  const knownTemplateCodes = new Set(treeTemplates.map((t) => t.templateCode));
  void knownTemplateCodes; // зарезервировано на будущее (drift-detect)

  const pinnedByCode = new Map<string, number>();
  const customByCode = new Map<string, number>();
  for (const node of treeNodes) {
    const code = node.template.templateCode;
    if (node.kind === "pinned") {
      pinnedByCode.set(code, (pinnedByCode.get(code) ?? 0) + 1);
    } else {
      customByCode.set(code, (customByCode.get(code) ?? 0) + 1);
    }
  }

  const guideStatus = new Map<string, number>();
  for (const tpl of guideTemplates) {
    guideStatus.set(tpl.templateCode, tpl._count.nodes);
  }

  return (
    <div className="space-y-5">
      {/* Тёмный hero снят: на рабочей странице важнее сразу увидеть список
          журналов, а название раздела уже есть в PageNav. */}
      <PageHeader
        title="Пошаговые инструкции журналов"
        description="Pipeline-инструкции для сотрудников. Кликни на блок чтобы настроить шаги: какие средства взять, куда пойти, что проверить. Чем подробнее — тем понятнее новой уборщице / повару / продавцу."
      />

      <div className="flex flex-col gap-3 rounded-3xl border border-[#dcdfed] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            🚀 Быстрый старт
          </div>
          <h2 className="mt-1 text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">
            Создать pipeline для всех журналов одним кликом
          </h2>
          <p className="mt-1 max-w-[600px] text-[13px] leading-[1.55] text-[#6f7282]">
            Создаёт базовое дерево pinned-узлов на каждый журнал по
            его колонкам. Уже настроенные журналы (
            <strong>{treeTemplates.length}</strong>) не пересоздаются.
            Журналы без описанных колонок придут в уведомления для
            ручной настройки.
          </p>
        </div>
        <SeedAllPipelinesButton
          totalActiveTrees={treeTemplates.length}
          totalJournals={allJournals.length}
        />
      </div>

      <div className="rounded-2xl border border-[#dcdfed] bg-[#fafbff] p-4 text-[13px] leading-[1.55] text-[#3c4053]">
        <strong className="text-[#0b1024]">Расшифровка статусов:</strong>
        <ul className="mt-1.5 space-y-0.5 text-[12px] text-[#3c4053]">
          <li>
            <span className="mr-1 inline-block rounded-full bg-[#10b981] px-1.5 text-[10px] font-medium text-white">
              🌳 Шаблон
            </span>{" "}
            — pipeline создан по колонкам журнала, базовая настройка.
          </li>
          <li>
            <span className="mr-1 inline-block rounded-full bg-[#5566f6] px-1.5 text-[10px] font-medium text-white">
              🌳 Шаблон + N
            </span>{" "}
            — есть и базовый шаблон, и добавленные вручную шаги.
          </li>
          <li>
            <span className="mr-1 inline-block rounded-full bg-[#f5f0ff] px-1.5 text-[10px] font-medium text-[#7a5cff]">
              📦 Свой адаптер
            </span>{" "}
            — журнал работает через специальный адаптер (cleaning,
            hygiene и т.п.), pipeline-tree не нужен.
          </li>
          <li>
            <span className="mr-1 inline-block rounded-full bg-[#fff8e6] px-1.5 text-[10px] font-medium text-[#92561c]">
              Legacy
            </span>{" "}
            — устаревший JSON-формат, лучше пересоздать через 🌳 Pipeline (beta).
          </li>
          <li>
            <span className="mr-1 inline-block rounded-full bg-[#fff4f2] px-1.5 text-[10px] font-medium text-[#a13a32]">
              ⚠️ Гибрид
            </span>{" "}
            — настроены оба формата одновременно, лучше оставить только
            tree-шаблон.
          </li>
          <li>
            <span className="mr-1 inline-block rounded-full bg-[#fafbff] px-1.5 text-[10px] text-[#9b9fb3]">
              Не настроен
            </span>{" "}
            — сотрудник увидит свободную форму, колонки не будут заполняться.
          </li>
        </ul>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {allJournals.map((j) => {
          const hasOverride = Boolean(overrides[j.code]?.steps?.length);
          const hasDefault = Boolean(getDefaultPipeline(j.code));
          void hasDefault; // показываем только status, не «Default» отдельно
          const pinned = pinnedByCode.get(j.code) ?? 0;
          const custom = customByCode.get(j.code) ?? 0;
          const guideNodeCount = guideStatus.get(j.code) ?? 0;
          const status = computeStatus({
            code: j.code,
            pinned,
            custom,
            hasLegacy: hasOverride,
          });

          // primary-бейдж — единый «настроен / не настроен / гибрид».
          const primary = (() => {
            switch (status.kind) {
              case "exempt":
                return {
                  label: "📦 Свой адаптер",
                  bg: "bg-[#f5f0ff]",
                  fg: "text-[#7a5cff]",
                  hint:
                    "Pipeline через src/lib/tasksflow-adapters/" +
                    j.code +
                    ".ts — отдельная настройка не нужна.",
                };
              case "template_with_custom":
                return {
                  label: `🌳 Шаблон + ${status.custom} ${pluralUzly(status.custom)}`,
                  bg: "bg-[#5566f6]",
                  fg: "text-white",
                  hint:
                    "Базовый шаблон + добавленные вручную шаги. Сотрудник видит обе части.",
                };
              case "template_only":
                return {
                  label: `🌳 Шаблон · ${status.pinned} ${pluralKolonok(status.pinned)}`,
                  bg: "bg-[#10b981]",
                  fg: "text-white",
                  hint:
                    "Дефолтный pipeline по колонкам журнала. Можно дополнить своими шагами.",
                };
              case "custom_only":
                return {
                  label: `🌳 ${status.custom} ${pluralOwnSteps(status.custom)}`,
                  bg: "bg-[#5566f6]",
                  fg: "text-white",
                  hint:
                    "Свои шаги без базового шаблона. Колонки журнала не привязаны.",
                };
              case "hybrid_legacy_tree":
                return {
                  label: "⚠️ Гибрид (Legacy + Шаблон)",
                  bg: "bg-[#fff4f2]",
                  fg: "text-[#a13a32]",
                  hint:
                    "Настроены оба формата. Tree-шаблон побеждает в TasksFlow. Legacy лучше удалить.",
                };
              case "legacy_only":
                return {
                  label: "Legacy (старый формат)",
                  bg: "bg-[#fff8e6]",
                  fg: "text-[#92561c]",
                  hint:
                    "Старый JSON-pipeline. Перенеси на 🌳 Pipeline (beta), у него больше возможностей.",
                };
              case "not_configured":
              default:
                return {
                  label: "Не настроен",
                  bg: "bg-[#fafbff]",
                  fg: "text-[#9b9fb3]",
                  hint:
                    "Сотрудник в TasksFlow увидит свободную форму. Создай шаблон — данные будут писаться в колонки.",
                };
            }
          })();

          // Цвет иконки слева — visual signal по статусу.
          const iconStyle =
            status.kind === "not_configured"
              ? "bg-[#fafbff] text-[#9b9fb3]"
              : status.kind === "exempt"
                ? "bg-[#f5f0ff] text-[#7a5cff]"
                : status.kind === "hybrid_legacy_tree" ||
                    status.kind === "legacy_only"
                  ? "bg-[#fff8e6] text-[#92561c]"
                  : "bg-[#5566f6] text-white";

          return (
            <div
              key={j.code}
              className="group rounded-2xl border border-[#ececf4] bg-white p-4 transition-colors hover:border-[#5566f6]/40 hover:bg-[#fafbff]"
            >
              <div className="flex items-start gap-3">
                <span
                  className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${iconStyle}`}
                >
                  <BookOpen className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium leading-tight text-[#0b1024]">
                    {j.name}
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-[#9b9fb3]">
                    {j.code}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span
                      title={primary.hint}
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${primary.bg} ${primary.fg}`}
                    >
                      {primary.label}
                    </span>
                    {guideNodeCount > 0 ? (
                      <span
                        title={`Кастомный гайд «как заполнять» — ${guideNodeCount} ${pluralStepsForGuide(guideNodeCount)}`}
                        className="inline-flex items-center gap-1 rounded-full bg-[#f5f0ff] px-2 py-0.5 font-medium text-[#7a5cff]"
                      >
                        📖 {guideNodeCount}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-[#9b9fb3]">
                    {primary.hint}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[#ececf4] pt-3 text-[12px]">
                <Link
                  href={`/settings/journal-pipelines/${j.code}`}
                  className="rounded-full px-2.5 py-1 text-[#3848c7] hover:bg-[#eef1ff]"
                >
                  Legacy редактор →
                </Link>
                <Link
                  href={`/settings/journal-pipelines-tree/${j.code}`}
                  className="rounded-full px-2.5 py-1 text-[#5566f6] hover:bg-[#f5f6ff]"
                >
                  🌳 Pipeline (beta) →
                </Link>
                <Link
                  href={`/settings/journal-guides-tree/${j.code}`}
                  className="rounded-full px-2.5 py-1 text-[#7a5cff] hover:bg-[#f5f0ff]"
                >
                  📖 Гайд (beta) →
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
