"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { journalMatchesQuery, normalizeJournalSearch } from "@/lib/journal-search";
import { customJournalName } from "@/lib/custom-names";
import { sortJournalsByName } from "@/lib/journal-sort";
import { useCustomNames } from "@/components/shared/custom-names-provider";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ALL_DAILY_JOURNAL_CODES } from "@/lib/daily-journal-codes";
import { SAMPLE_JOURNAL_CODES } from "@/lib/journal-sample-fixtures";
import {
  AlertCircle,
  ArrowRight,
  EyeOff,
  BookHeart,
  Brush,
  Bug,
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Droplets,
  Eye,
  Fan,
  FileText,
  Flame,
  Gauge,
  GraduationCap,
  HandHeart,
  HardHat,
  HeartPulse,
  Lightbulb,
  Magnet,
  MessageSquareWarning,
  NotebookPen,
  Package,
  PackageCheck,
  PackageX,
  Route,
  Search,
  SearchX,
  ShieldAlert,
  ShieldCheck,
  Snowflake,
  Sparkles,
  SprayCan,
  Thermometer,
  TriangleAlert,
  Truck,
  Wine,
  Wrench,
  X,
  TestTube,
  Pill,
  Scale,
  GlassWater,
  Waves,
  UtensilsCrossed,
  Scissors,
  Biohazard,
} from "lucide-react";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";

type JournalTemplateListItem = {
  id: string;
  code: string;
  name: string;
  /**
   * Официальное название, если организация назвала журнал по-своему
   * (`name` тогда — своё). Поиск находит журнал по обоим.
   */
  officialName?: string;
  description: string | null;
  isMandatorySanpin: boolean;
  isMandatoryHaccp: boolean;
  filledToday: boolean;
  disabled: boolean;
  hasActiveDocumentToday?: boolean;
  /** Снимок реального документа организации; null — показать образец. */
  previewUrl?: string | null;
};

type JournalsBrowserProps = {
  templates: JournalTemplateListItem[];
  canBulkCreate?: boolean;
  /**
   * Менеджер может скрыть журнал с дашборда и включить обратно прямо
   * из списка — тем же PATCH /api/settings/journals, что и настройки.
   */
  canToggle?: boolean;
};

// Коды, для которых в public/journal-samples лежит PNG бланка.
const SAMPLE_CODES = new Set<string>(SAMPLE_JOURNAL_CODES);

const JOURNAL_ICONS: Record<string, LucideIcon> = {
  hygiene: HandHeart,
  health_check: HeartPulse,
  climate_control: Thermometer,
  cold_equipment_control: Snowflake,
  cleaning_ventilation_checklist: Fan,
  cleaning: Brush,
  general_cleaning: Sparkles,
  uv_lamp_runtime: Lightbulb,
  finished_product: Package,
  perishable_rejection: PackageX,
  incoming_control: PackageCheck,
  fryer_oil: Flame,
  med_books: BookHeart,
  training_plan: CalendarCheck,
  staff_training: GraduationCap,
  disinfectant_usage: SprayCan,
  sanitary_day_control: CalendarClock,
  equipment_maintenance: Wrench,
  breakdown_history: TriangleAlert,
  equipment_calibration: Gauge,
  incoming_raw_materials_control: Truck,
  ppe_issuance: HardHat,
  accident_journal: ShieldAlert,
  complaint_register: MessageSquareWarning,
  product_writeoff: PackageX,
  audit_plan: ClipboardList,
  audit_protocol: ClipboardCheck,
  audit_report: FileText,
  traceability_test: Route,
  metal_impurity: Magnet,
  equipment_cleaning: Droplets,
  intensive_cooling: Snowflake,
  glass_items_list: Wine,
  glass_control: Eye,
  pest_control: Bug,
  daily_samples: TestTube,
  vitaminization: Pill,
  ration_control: Scale,
  transport_temperature: Truck,
  tableware_breakage: GlassWater,
  pool_water_control: Waves,
  inventory_condition: UtensilsCrossed,
  instrument_sterilization: Scissors,
  medical_waste_b: Biohazard,
  batch_release: PackageCheck,
};

export function JournalsBrowser({
  templates: rawTemplates,
  canBulkCreate = false,
  canToggle = false,
}: JournalsBrowserProps) {
  const router = useRouter();
  // Свои названия организации («Настройки → Названия»): карточки и
  // подтверждения показывают своё, поиск ищет и по официальному.
  const customNames = useCustomNames();
  // Журналы по алфавиту — по тому названию, которое видит компания.
  const templates = useMemo(
    () =>
      sortJournalsByName(
        rawTemplates.map((template) => {
          const custom = customJournalName(customNames, template.code);
          return custom ? { ...template, name: custom, officialName: template.name } : template;
        }),
        (template) => template.name,
      ),
    [rawTemplates, customNames],
  );
  // Полный список отключённых кодов: PATCH /api/settings/journals ждёт
  // весь набор, а не дельту, поэтому карточка добавляет/убирает свой
  // код к этому списку.
  const disabledCodes = useMemo(
    () => templates.filter((t) => t.disabled).map((t) => t.code),
    [templates],
  );
  const [query, setQuery] = useState("");
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = normalizeJournalSearch(deferredQuery);

  const filteredTemplates = useMemo(() => {
    if (!normalizedQuery) return templates;
    return templates.filter((template) => {
      return journalMatchesQuery(
        [template.name, template.officialName, template.description, template.code],
        normalizedQuery,
      );
    });
  }, [templates, normalizedQuery]);

  const totalCount = templates.length;
  const enabledTemplates = templates.filter((t) => !t.disabled);

  // Сортируем включённые журналы так, чтобы «надо заполнить сегодня»
  // были сверху — сотрудник без опыта работы с PC не должен сканировать
  // 35 карточек чтобы найти что от него хотят. Внутри группы — по
  // алфавиту (templates уже отсортированы).
  const filteredEnabled = filteredTemplates
    .filter((t) => !t.disabled)
    .map((t, i) => ({ t, i }))
    .sort((a, b) => {
      const score = (x: JournalTemplateListItem) => {
        const isMandatory = x.isMandatorySanpin || x.isMandatoryHaccp;
        const isDaily = ALL_DAILY_JOURNAL_CODES.has(x.code);
        if (isMandatory && isDaily && !x.filledToday) return 0; // надо
        if (isMandatory && isDaily && x.filledToday) return 2; // готово
        return 1; // прочие — посередине
      };
      const sa = score(a.t);
      const sb = score(b.t);
      if (sa !== sb) return sa - sb;
      return a.i - b.i;
    })
    .map(({ t }) => t);
  const filteredDisabled = filteredTemplates.filter((t) => t.disabled);
  const hasResults = filteredTemplates.length > 0;

  // Candidate for bulk-create = no active doc covering today AND not
  // disabled. If a template already has an active document, creating
  // again would be a no-op, so we don't offer a checkbox for it.
  const bulkCandidateCodes = useMemo(
    () =>
      enabledTemplates
        .filter((t) => !t.hasActiveDocumentToday)
        .map((t) => t.code),
    [enabledTemplates]
  );
  const bulkCandidateSet = useMemo(
    () => new Set(bulkCandidateCodes),
    [bulkCandidateCodes]
  );
  const selectedCount = selectedCodes.size;
  const canBulkSelectAll = bulkCandidateCodes.length > 0;

  function toggleSelect(code: string) {
    setSelectedCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }
  function selectAllCandidates() {
    setSelectedCodes(new Set(bulkCandidateCodes));
  }
  function clearSelection() {
    setSelectedCodes(new Set());
  }
  async function runBulkCreate() {
    if (bulkBusy || selectedCount === 0) return;
    setBulkBusy(true);
    try {
      const res = await fetch("/api/journal-documents/bulk-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codes: [...selectedCodes] }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error ?? "Не удалось создать документы");
        return;
      }
      toast.success(
        `Создано: ${data.created ?? 0}${
          data.skipped ? ` · пропущено: ${data.skipped}` : ""
        }`
      );
      clearSelection();
      router.refresh();
    } catch (err) {
      toast.error(humanizeFetchError(err, "Ошибка сети"));
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Поиск и панель массового создания — одной строкой на широких
          экранах: два отдельных ряда съедали пол-экрана до первой
          карточки журнала. */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative w-full lg:max-w-[420px]">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#9b9fb3]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Название, описание или код"
            aria-label="Поиск по журналам"
            className="h-12 w-full rounded-2xl border border-[#dcdfed] bg-white pl-11 pr-11 text-[15px] text-[#0b1024] placeholder:text-[#c1c5d6] shadow-[0_0_0_1px_rgba(240,240,250,0.45)] transition-[border-color,box-shadow] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-[#9b9fb3] transition-colors hover:bg-[#f5f6ff] hover:text-[#5566f6]"
              aria-label="Очистить поиск"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        <div className="text-[13px] text-[#6f7282] lg:whitespace-nowrap">
          {normalizedQuery
            ? `Найдено ${filteredTemplates.length} из ${totalCount}`
            : `Всего журналов: ${totalCount}`}
        </div>

        {canBulkCreate && canBulkSelectAll ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#dcdfed] bg-white px-4 py-3 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:px-5 lg:ml-auto">
          <div className="flex items-center gap-2 text-[13px] text-[#3c4053]">
            <Sparkles className="size-4 text-[#5566f6]" />
            <span>
              {selectedCount === 0
                ? `К созданию доступно: ${bulkCandidateCodes.length}`
                : `Выбрано: ${selectedCount} из ${bulkCandidateCodes.length}`}
            </span>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {selectedCount < bulkCandidateCodes.length ? (
              <button
                type="button"
                onClick={selectAllCandidates}
                className="rounded-full border border-[#dcdfed] bg-white px-3 py-1.5 text-[12px] font-medium text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
              >
                Выбрать все
              </button>
            ) : null}
            {selectedCount > 0 ? (
              <button
                type="button"
                onClick={clearSelection}
                className="rounded-full border border-[#dcdfed] bg-white px-3 py-1.5 text-[12px] font-medium text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
              >
                Снять выбор
              </button>
            ) : null}
            <button
              type="button"
              onClick={runBulkCreate}
              disabled={bulkBusy || selectedCount === 0}
              className="inline-flex h-9 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[13px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] disabled:bg-[#c8cbe0] disabled:shadow-none"
              title={
                selectedCount === 0
                  ? "Отметьте хотя бы один журнал"
                  : "Создать документы для выбранных журналов"
              }
            >
              <CheckCircle2 className="size-4" />
              {bulkBusy
                ? "Создаём…"
                : `Создать выбранные${
                    selectedCount > 0 ? ` (${selectedCount})` : ""
                  }`}
            </button>
          </div>
        </div>
        ) : null}
      </div>

      {!hasResults ? (
        <EmptyState onReset={() => setQuery("")} />
      ) : (
        <div className="space-y-8">
          {filteredEnabled.length > 0 ? (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {filteredEnabled.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  bulkSelectable={
                    canBulkCreate && bulkCandidateSet.has(template.code)
                  }
                  bulkSelected={selectedCodes.has(template.code)}
                  onBulkToggle={toggleSelect}
                  canToggle={canToggle}
                  disabledCodes={disabledCodes}
                />
              ))}
            </div>
          ) : null}

          {filteredDisabled.length > 0 ? (
            <section className="space-y-3">
              <div className="flex items-center gap-3">
                <h3 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[#9b9fb3]">
                  Отключённые журналы
                </h3>
                <span className="text-[13px] text-[#9b9fb3]">
                  ({filteredDisabled.length})
                  {canToggle ? (
                    " — не показываются на дашборде и сотрудникам"
                  ) : (
                    <>
                      {" "}— включить в{" "}
                      <Link
                        href="/settings/journals"
                        className="font-medium text-[#5566f6] hover:underline"
                      >
                        настройках
                      </Link>
                    </>
                  )}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
                {filteredDisabled.map((template) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    canToggle={canToggle}
                    disabledCodes={disabledCodes}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

function TemplateCard({
  template,
  bulkSelectable = false,
  bulkSelected = false,
  onBulkToggle,
  canToggle = false,
  disabledCodes = [],
}: {
  template: JournalTemplateListItem;
  bulkSelectable?: boolean;
  bulkSelected?: boolean;
  onBulkToggle?: (code: string) => void;
  canToggle?: boolean;
  disabledCodes?: string[];
}) {
  const router = useRouter();
  const [hideConfirmOpen, setHideConfirmOpen] = useState(false);
  const [toggling, setToggling] = useState(false);
  const Icon = JOURNAL_ICONS[template.code] ?? NotebookPen;

  // Тот же контракт, что у /settings/journals: отправляем полный список
  // отключённых кодов. После ответа — refresh, чтобы карточка переехала
  // между «включёнными» и «отключёнными» по данным сервера, а не по
  // локальной догадке.
  async function patchDisabled(next: string[], successText: string) {
    setToggling(true);
    try {
      const res = await fetch("/api/settings/journals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disabledCodes: next }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || "Не удалось сохранить настройку");
      }
      toast.success(successText);
      router.refresh();
    } catch (error) {
      toast.error(humanizeFetchError(error, "Не удалось сохранить настройку"));
    } finally {
      setToggling(false);
    }
  }

  function hideJournal() {
    const next = Array.from(new Set([...disabledCodes, template.code]));
    return patchDisabled(next, `Журнал скрыт: ${template.name}`);
  }

  function enableJournal() {
    const next = disabledCodes.filter((code) => code !== template.code);
    return patchDisabled(next, `Журнал включён: ${template.name}`);
  }
  const isMandatory = template.isMandatorySanpin || template.isMandatoryHaccp;
  const isDaily = ALL_DAILY_JOURNAL_CODES.has(template.code);
  const needsAttentionToday =
    !template.disabled && isMandatory && isDaily && !template.filledToday;
  const readyToday =
    !template.disabled && isMandatory && isDaily && template.filledToday;
  const hasSample = SAMPLE_CODES.has(template.code);
  const previewSrc =
    template.previewUrl ?? (hasSample ? `/journal-samples/${template.code}.webp` : null);

  // Превью: снимок своего документа (cron journal-previews), а пока его
  // нет — образец бланка. По названию вроде «Чек-лист (памятка)
  // проведения санитарного дня» невозможно вспомнить, что там за форма, —
  // картинка узнаётся мгновенно. Те же файлы, что на дашборде.
  const preview = previewSrc ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={previewSrc}
      alt=""
      loading="lazy"
      decoding="async"
      // Превью — украшение карточки, а не содержимое страницы. Низкий
      // приоритет не даёт трём десяткам картинок занять HTTP/2-канал
      // раньше, чем переход в сам журнал: на телефоне именно из-за
      // этого журнал открывался «через полминуты после превью».
      fetchPriority="low"
      width={768}
      height={539}
      className={cn(
        "aspect-[1228/862] w-full border-b bg-white object-cover object-top transition-transform duration-200",
        template.disabled
          ? "border-[#dcdfed] opacity-60 grayscale"
          : "border-[#ececf4] group-hover:scale-[1.01]",
      )}
    />
  ) : (
    <span
      className={cn(
        "flex aspect-[1228/862] w-full items-center justify-center border-b bg-[#f5f6ff]",
        template.disabled
          ? "border-[#dcdfed] text-[#9b9fb3] grayscale"
          : "border-[#ececf4] text-[#5566f6]",
      )}
    >
      <Icon className="size-8" />
    </span>
  );

  if (template.disabled) {
    return (
      <div
        className="flex h-full flex-col overflow-hidden rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] opacity-70"
        aria-label={`${template.name} — отключён в настройках`}
      >
        {preview}
        <div className="flex min-w-0 flex-1 flex-col gap-2 px-3.5 py-3">
          <div className="line-clamp-2 text-[14px] font-semibold leading-snug text-[#6f7282]">
            {template.name}
          </div>
          <div className="mt-auto flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-[#eef0f6] px-2 py-0.5 text-[11px] font-medium text-[#6f7282]">
              <EyeOff className="size-3" />
              Отключён
            </span>
            {canToggle ? (
              // Включение безопасно (ничего не теряется), поэтому без
              // подтверждения — одно нажатие.
              <button
                type="button"
                onClick={enableJournal}
                disabled={toggling}
                className="inline-flex items-center gap-1 rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[11px] font-medium text-[#5566f6] transition-colors hover:bg-[#eef1ff] disabled:opacity-60"
              >
                <Eye className="size-3" />
                {toggling ? "Включаю…" : "Включить"}
              </button>
            ) : (
              <Link
                href={`/settings/journals#journal-${template.code}`}
                className="inline-flex items-center gap-1 rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[11px] font-medium text-[#5566f6] hover:bg-[#eef1ff]"
              >
                Включить
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group/card relative">
      {canToggle ? (
        <>
          {/* Скрыть с дашборда. На десктопе кнопка проявляется по
              наведению, чтобы не спорить со стрелкой и бейджами; на
              телефоне hover'а нет — видна всегда, но полупрозрачная. */}
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setHideConfirmOpen(true);
            }}
            disabled={toggling}
            title="Скрыть с дашборда"
            aria-label={`Скрыть «${template.name}» с дашборда`}
            className="absolute right-2 top-2 z-10 flex size-7 items-center justify-center rounded-full bg-white/90 text-[#9b9fb3] shadow-[0_0_0_1px_rgba(220,223,237,0.9)] backdrop-blur transition-all duration-150 hover:text-[#5566f6] hover:shadow-[0_0_0_1px_rgba(85,102,246,0.6)] disabled:opacity-60 sm:opacity-0 sm:group-hover/card:opacity-100 sm:focus-visible:opacity-100"
          >
            <EyeOff className="size-3.5" />
          </button>
          <ConfirmDialog
            open={hideConfirmOpen}
            onClose={() => setHideConfirmOpen(false)}
            onConfirm={async () => {
              setHideConfirmOpen(false);
              await hideJournal();
            }}
            variant="warn"
            icon={EyeOff}
            title="Скрыть журнал с дашборда?"
            description={`«${template.name}» перестанет показываться как обязательный.`}
            bullets={[
              { label: "Исчезнет с дашборда и из Mini App у сотрудников", tone: "warn" },
              { label: "Записи и документы сохраняются — ничего не удаляется" },
              { label: "Включить обратно можно здесь же, в блоке «Отключённые журналы»", tone: "info" },
            ]}
            confirmLabel="Скрыть"
          />
        </>
      ) : null}
      {bulkSelectable ? (
        <label
          className="absolute left-2 top-2 z-10 flex size-7 cursor-pointer items-center justify-center rounded-full bg-white/95 shadow-[0_0_0_1px_rgba(220,223,237,0.9)] backdrop-blur hover:shadow-[0_0_0_1px_rgba(85,102,246,0.6)]"
          onClick={(event) => event.stopPropagation()}
          title={
            bulkSelected
              ? "Убрать из bulk-создания"
              : "Добавить в bulk-создание"
          }
        >
          <Checkbox
            checked={bulkSelected}
            onCheckedChange={() => onBulkToggle?.(template.code)}
            aria-label={`Выбрать «${template.name}» для массового создания`}
          />
        </label>
      ) : null}
      <Link
        href={`/journals/${template.code}`}
        className="group block h-full focus:outline-none"
      >
        <div
          className={cn(
            "flex h-full flex-col overflow-hidden rounded-2xl border bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_40px_-24px_rgba(85,102,246,0.35)] group-focus-visible:border-[#5566f6] group-focus-visible:ring-4 group-focus-visible:ring-[#5566f6]/15",
            bulkSelected
              ? "border-[#5566f6] ring-2 ring-[#5566f6]/25"
              : needsAttentionToday
                ? "border-[#ffd2cd] hover:border-[#ff8d7d]"
                : readyToday
                  ? "border-[#c8f0d5] hover:border-[#7cf5c0]"
                  : "border-[#ececf4] hover:border-[#d6d9ee]",
          )}
        >
          {preview}

          <div className="flex min-w-0 flex-1 flex-col gap-2 px-3.5 py-3">
            <div className="flex items-start justify-between gap-2">
              <div
                className="line-clamp-3 min-w-0 flex-1 text-[14px] font-semibold leading-snug tracking-[-0.01em] text-[#0b1024] sm:line-clamp-2"
                title={
                  template.officialName
                    ? `Официальное название: ${template.officialName}`
                    : undefined
                }
              >
                {template.name}
              </div>
              <ArrowRight className="size-4 shrink-0 translate-y-0.5 text-[#c7ccea] transition-transform group-hover:translate-x-0.5 group-hover:text-[#5566f6]" />
            </div>

            <div className="mt-auto flex flex-wrap items-center gap-1.5">
              {needsAttentionToday ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#fff4f2] px-2 py-0.5 text-[11px] font-medium text-[#d2453d]">
                  <AlertCircle className="size-3" />
                  Заполнить сегодня
                </span>
              ) : readyToday ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#ecfdf5] px-2 py-0.5 text-[11px] font-medium text-[#136b2a]">
                  <CheckCircle2 className="size-3" />
                  Сегодня готово
                </span>
              ) : null}
              {template.isMandatorySanpin ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#fff4f2] px-2 py-0.5 text-[11px] font-medium text-[#d2453d]">
                  <ShieldCheck className="size-3" />
                  СанПиН
                </span>
              ) : null}
              {template.isMandatoryHaccp ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#eef1ff] px-2 py-0.5 text-[11px] font-medium text-[#5566f6]">
                  <ShieldAlert className="size-3" />
                  ХАССП
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </Link>
    </div>
  );
}

function EmptyState({ onReset }: { onReset: () => void }) {
  return (
    <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-white px-6 py-16 text-center">
      <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-[#f5f6ff] text-[#5566f6]">
        <SearchX className="size-7" />
      </div>
      <p className="mt-4 text-[17px] font-semibold text-[#0b1024]">
        Ничего не найдено
      </p>
      <p className="mt-2 text-[14px] text-[#6f7282]">
        Попробуйте изменить запрос или очистить поиск.
      </p>
      <button
        type="button"
        onClick={onReset}
        className="mt-6 inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[13px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
      >
        Очистить поиск
        <X className="size-4 text-[#5566f6]" />
      </button>
    </div>
  );
}
