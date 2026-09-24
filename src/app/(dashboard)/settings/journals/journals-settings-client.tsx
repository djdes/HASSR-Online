"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Download,
  ExternalLink,
  EyeOff,
  Loader2,
  Printer,
  Save,
  Settings2,
  ShieldAlert,
  Search,
  ShieldCheck,
  UserRound,
  Users,
  X,
  Wifi,
  ZoomIn,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { confirmAsync } from "@/components/ui/confirm-async";
import { cn } from "@/lib/utils";
import { journalMatchesQuery, normalizeJournalSearch } from "@/lib/journal-search";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PhotoLightbox } from "@/components/shared/photo-lightbox";
import { Switch } from "@/components/ui/switch";
import { pluralRu } from "@/lib/plural-ru";
import { toast } from "sonner";
import type { FillMode } from "@/lib/journal-routing";
import { ORG_SPHERES, sphereLabel, type OrgSphere } from "@/lib/org-profile";
import {
  requiredCodesFor,
  rulesFor,
  type ElectronicRule,
  type PaperJournal,
} from "@/lib/sphere-journal-rules";

type Position = { id: string; name: string; categoryKey: string };
type StaffUser = { id: string; name: string; jobPositionId: string | null };

type Item = {
  id: string;
  code: string;
  name: string;
  /** Снимок реального документа организации; null — показать образец. */
  previewUrl?: string | null;
  description: string | null;
  isMandatorySanpin: boolean;
  isMandatoryHaccp: boolean;
  enabled: boolean;
  fillMode: FillMode;
  defaultAssigneeId: string | null;
  allowedPositionIds: string[];
  bonusAmountKopecks: number;
  /** Активные документы журнала — их прячет выключение тумблера. */
  activeDocumentCount?: number;
};

/** Бумажный бланк с тем же тумблером вкл/выкл, что у электронных. */
type PaperItem = PaperJournal & { enabled: boolean };

const FILL_MODE_LABELS: Record<FillMode, { label: string; hint: string; icon: typeof Users }> = {
  "per-employee": {
    label: "Каждый сотрудник",
    hint: "Все подходящие — отдельная задача каждому",
    icon: Users,
  },
  single: {
    label: "Один исполнитель",
    hint: "Один человек заполняет за всю смену",
    icon: UserRound,
  },
  sensor: {
    label: "Датчик",
    hint: "Заполнит IoT — людям не приходит",
    icon: Wifi,
  },
};

export function JournalsSettingsClient({
  items,
  paperItems,
  positions,
  users,
  sphere,
  sampleCodes,
}: {
  items: Item[];
  paperItems: PaperItem[];
  positions: Position[];
  users: StaffUser[];
  sphere: OrgSphere;
  /** Коды журналов, у которых на диске есть PNG-превью бланка. */
  sampleCodes: string[];
}) {
  const router = useRouter();
  const [state, setState] = useState<Record<string, boolean>>(
    Object.fromEntries(items.map((item) => [item.code, item.enabled]))
  );
  // Бумажные тумблеры живут отдельным словарём: у них своё поле в БД
  // и свои id, пересечься с кодами электронных они не должны.
  const [paperState, setPaperState] = useState<Record<string, boolean>>(
    Object.fromEntries(paperItems.map((journal) => [journal.id, journal.enabled]))
  );
  const [saving, setSaving] = useState(false);
  /**
   * Поиск по набору. Ищет и по отключённым: именно их обычно и приходят
   * включать, а листать тридцать пять карточек глазами — это и есть
   * причина, по которой набор не настраивают.
   */
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = normalizeJournalSearch(deferredQuery);
  const [highlightCode, setHighlightCode] = useState<string | null>(null);
  /** Код журнала, для которого открыта модалка распределения. */
  const [distDialogCode, setDistDialogCode] = useState<string | null>(null);
  /** Открытое превью бланка во весь экран. */
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(
    null
  );
  /** Бумажный бланк, который пытаются выключить. */
  const [paperOffId, setPaperOffId] = useState<string | null>(null);
  const sampleSet = useMemo(() => new Set(sampleCodes), [sampleCodes]);
  const [distState, setDistState] = useState<
    Record<
      string,
      {
        fillMode: FillMode;
        defaultAssigneeId: string | null;
        allowedPositionIds: string[];
        bonusAmountKopecks: number;
      }
    >
  >(
    Object.fromEntries(
      items.map((item) => [
        item.code,
        {
          fillMode: item.fillMode,
          defaultAssigneeId: item.defaultAssigneeId,
          allowedPositionIds: item.allowedPositionIds,
          bonusAmountKopecks: item.bonusAmountKopecks,
        },
      ])
    )
  );
  const [distSavingCode, setDistSavingCode] = useState<string | null>(null);
  // Сфера в селекте живёт отдельно от сохранённой: пока человек не
  // подтвердил смену, показываем прогноз, а не переписываем набор.
  const [sphereDraft, setSphereDraft] = useState<OrgSphere>(sphere);
  const [sphereConfirmOpen, setSphereConfirmOpen] = useState(false);
  const [switchingSphere, setSwitchingSphere] = useState(false);
  const [applyConfirmOpen, setApplyConfirmOpen] = useState(false);
  const [disableRestConfirmOpen, setDisableRestConfirmOpen] = useState(false);
  /** Код обязательного журнала, который пытаются выключить. */
  const [requiredOffCode, setRequiredOffCode] = useState<string | null>(null);
  const requiredOffDocCount = requiredOffCode
    ? (items.find((item) => item.code === requiredOffCode)
        ?.activeDocumentCount ?? 0)
    : 0;

  // Anchor-deep-link from disabled-card "Включить" buttons:
  //   /settings/journals#journal-<code>
  // Scrolls the matching card into view and flashes a ring around it so
  // the user immediately sees which switch to flip on small screens where
  // the list is long.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (!hash.startsWith("#journal-")) return;
    const code = hash.slice("#journal-".length);
    if (!code) return;
    const target = document.getElementById(`journal-${code}`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightCode(code);
    const t = window.setTimeout(() => setHighlightCode(null), 2400);
    return () => window.clearTimeout(t);
  }, []);

  // Счётчик единый: после объединения секций делить «включено» на
  // электронные и бумажные было бы враньём — человек видит один список.
  const enabledCount = useMemo(
    () =>
      Object.values(state).filter(Boolean).length +
      paperItems.filter((journal) => paperState[journal.id]).length,
    [state, paperItems, paperState]
  );
  const totalCount = items.length + paperItems.length;
  /** Сколько из включённых — бумажные: их нет в счётчике на главной. */
  const enabledPaperCount = useMemo(
    () => paperItems.filter((journal) => paperState[journal.id]).length,
    [paperItems, paperState]
  );

  const dirty = useMemo(
    () =>
      items.some((item) => state[item.code] !== item.enabled) ||
      paperItems.some((journal) => paperState[journal.id] !== journal.enabled),
    [items, state, paperItems, paperState]
  );

  function forceToggle(code: string) {
    setState((prev) => ({ ...prev, [code]: !prev[code] }));
  }

  async function toggle(code: string) {
    // Выключение обязательного журнала — через подтверждение: человек
    // должен увидеть, чем это грозит на проверке. Условные («нужен при
    // наличии фритюра») выключаются молча: оборудования может не быть.
    const rule = requiredMap.get(code);
    if (rule && !rule.condition && state[code]) {
      setRequiredOffCode(code);
      return;
    }
    // Раньше журнал с заполненными документами выключался молча, и они
    // просто пропадали из всех списков — выглядело как потеря данных.
    const activeDocs =
      items.find((item) => item.code === code)?.activeDocumentCount ?? 0;
    if (state[code] && activeDocs > 0) {
      const ok = await confirmAsync({
        title: "Выключить журнал?",
        description: "Данные останутся в базе, но журнал пропадёт из интерфейса.",
        bullets: [
          {
            label: `Активных документов: ${activeDocs} — они скроются из списка журналов, дашборда и задач`,
            tone: "warn",
          },
          {
            label: "Ничего не удаляется: включите журнал обратно — документы вернутся",
            tone: "info",
          },
        ],
        variant: "warn",
        confirmLabel: "Выключить журнал",
      });
      if (!ok) return;
    }
    forceToggle(code);
  }

  function forcePaperToggle(id: string) {
    setPaperState((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function togglePaper(id: string) {
    // Выключение бумажного — всегда через подтверждение: штрафы по
    // охране труда и пожарной безопасности выше санитарных, и человек
    // должен понимать, что скрывается карточка, а не обязанность.
    if (paperState[id]) {
      setPaperOffId(id);
      return;
    }
    forcePaperToggle(id);
  }

  function setItemFillMode(code: string, mode: FillMode) {
    setDistState((prev) => ({
      ...prev,
      [code]: {
        ...prev[code],
        fillMode: mode,
        // sensor + per-employee режимы не используют defaultAssigneeId —
        // обнуляем чтобы не сохранять stale значение.
        defaultAssigneeId:
          mode === "single" ? prev[code].defaultAssigneeId : null,
      },
    }));
  }

  function setItemAssignee(code: string, userId: string | null) {
    setDistState((prev) => ({
      ...prev,
      [code]: { ...prev[code], defaultAssigneeId: userId },
    }));
  }

  function setItemBonus(code: string, kopecks: number) {
    const safe = Math.max(0, Math.round(kopecks));
    setDistState((prev) => ({
      ...prev,
      [code]: { ...prev[code], bonusAmountKopecks: safe },
    }));
  }

  function togglePosition(code: string, positionId: string) {
    setDistState((prev) => {
      const current = prev[code];
      const has = current.allowedPositionIds.includes(positionId);
      return {
        ...prev,
        [code]: {
          ...current,
          allowedPositionIds: has
            ? current.allowedPositionIds.filter((id) => id !== positionId)
            : [...current.allowedPositionIds, positionId],
        },
      };
    });
  }

  async function saveDistribution(code: string) {
    setDistSavingCode(code);
    try {
      const item = distState[code];
      const response = await fetch(
        `/api/settings/journals/${encodeURIComponent(code)}/distribution`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item),
        }
      );
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Не удалось сохранить распределение");
      }
      toast.success("Распределение обновлено");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Ошибка сохранения"
      );
    } finally {
      setDistSavingCode(null);
    }
  }

  // Пачка кликов подряд (включили пять журналов) должна уйти одним
  // запросом, а не пятью: иначе последний ответ может прийти раньше
  // предыдущего и вернуть старое состояние.
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => void handleSave(), 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, state, paperState]);

  async function handleSave() {
    setSaving(true);
    try {
      const disabledCodes = items
        .filter((item) => !state[item.code])
        .map((item) => item.code);
      const disabledPaperIds = paperItems
        .filter((journal) => !paperState[journal.id])
        .map((journal) => journal.id);
      const response = await fetch("/api/settings/journals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disabledCodes, disabledPaperIds }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Не удалось сохранить настройки");
      }
      toast.success(
        enabledCount === totalCount
          ? "Все журналы включены"
          : `Включено ${enabledCount} из ${totalCount} журналов`
      );
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  }

  /**
   * Превью бланка. Отдельная кнопка, а не часть toggle-области: по
   * названию вроде «Чек-лист санитарного дня» невозможно вспомнить, что
   * там за форма, а клик по картинке не должен переключать тумблер.
   */
  function renderPreview(src: string, name: string, accent: "green" | "amber") {
    return (
      <button
        type="button"
        onClick={() => setLightbox({ url: src, name })}
        title="Увеличить бланк"
        className="group/preview relative block w-full overflow-hidden border-b border-[#ececf4] bg-white"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          fetchPriority="low"
          width={768}
          height={539}
          className="aspect-[1228/862] w-full object-cover object-top transition-transform duration-200 group-hover/preview:scale-[1.03]"
        />
        <span className="absolute inset-0 flex items-center justify-center bg-[#0b1024]/0 opacity-0 transition-all duration-200 group-hover/preview:bg-[#0b1024]/35 group-hover/preview:opacity-100 focus-visible:opacity-100">
          <span className="inline-flex h-11 items-center gap-1.5 rounded-full bg-white/95 px-3.5 text-[12px] font-medium text-[#0b1024] shadow-[0_8px_24px_-12px_rgba(11,16,36,0.6)]">
            <ZoomIn
              className={
                accent === "green"
                  ? "size-4 text-[#136b2a]"
                  : "size-4 text-[#b45309]"
              }
            />
            Увеличить
          </span>
        </span>
      </button>
    );
  }

  function renderCard(item: Item) {
    const enabled = state[item.code];
    const isHighlighted = highlightCode === item.code;
    const dist = distState[item.code];
    const ModeIcon = FILL_MODE_LABELS[dist.fillMode].icon;
    const basis = basisNote(requiredMap.get(item.code));
    return (
      <div
        key={item.code}
        id={`journal-${item.code}`}
        className={`flex h-full flex-col overflow-hidden scroll-mt-24 rounded-2xl border bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)] transition-all hover:shadow-[0_8px_24px_-12px_rgba(85,102,246,0.18)] ${
          enabled
            ? "border-[#ececf4] hover:border-[#d6d9ee]"
            : "border-[#ececf4] opacity-60 hover:opacity-90"
        } ${
          isHighlighted
            ? "ring-2 ring-[#5566f6] ring-offset-2 ring-offset-white"
            : ""
        }`}
      >
        {/* Тонкая полоска-маркер вместо заливки всей карточки: зелёная —
            «ведём в системе». Заливкой сетка из нескольких десятков карточек пестрит. */}
        <span
          aria-hidden
          className={`h-1 w-full shrink-0 ${
            enabled ? "bg-[#7cf5c0]" : "bg-[#ececf4]"
          }`}
        />
        {item.previewUrl
          ? renderPreview(item.previewUrl, item.name, "green")
          : sampleSet.has(item.code)
            ? renderPreview(`/journal-samples/${item.code}.webp`, item.name, "green")
            : null}

        <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
          <div className="flex items-start gap-2">
            {/* Переключатель — один кружок без подписи: без aria-label
                скринридер читал его как безымянный. */}
            <Switch
              checked={enabled}
              onCheckedChange={() => toggle(item.code)}
              aria-label={`Вести журнал «${item.name}»`}
              className="mt-0.5 shrink-0"
            />
            <button
              type="button"
              onClick={() => toggle(item.code)}
              className="min-w-0 flex-1 text-left"
            >
              <span className="line-clamp-3 text-[13px] font-semibold leading-snug text-[#0b1024]">
                {item.name}
              </span>
            </button>
          </div>

          {/* Основание — разными словами, а не одинаковым «обязателен»:
              требование санитарных правил, обязанность вести записи по
              ХАССП и «спрашивают при проверках» — три разные вещи, и
              человек имеет право знать, чем рискует. */}
          {basis ? (
            <div
              className="line-clamp-3 text-[11px] leading-snug text-[#6f7282]"
              title={basis}
            >
              {basis}
            </div>
          ) : null}

          <div className="mt-auto flex flex-wrap items-center gap-1 pt-1">
            {item.isMandatorySanpin ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#fff4f2] px-1.5 py-0.5 text-[10px] font-medium text-[#d2453d]">
                <ShieldCheck className="size-3" />
                СанПиН
              </span>
            ) : null}
            {item.isMandatoryHaccp ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#eef1ff] px-1.5 py-0.5 text-[10px] font-medium text-[#5566f6]">
                <ShieldAlert className="size-3" />
                ХАССП
              </span>
            ) : null}
            {dist.bonusAmountKopecks > 0 ? (
              <span className="rounded-full bg-[#ecfdf5] px-1.5 py-0.5 text-[10px] font-medium text-[#116b2a]">
                +{(dist.bonusAmountKopecks / 100).toFixed(0)} ₽
              </span>
            ) : null}
          </div>

          {/* В карточке шириной 1/5 экрана широкие кнопки-строки не
              помещаются: оставляем ряд из двух компактных с подписью в
              одну строку, а редактор распределения открываем модалкой. */}
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setDistDialogCode(item.code)}
              title={`Распределение: ${FILL_MODE_LABELS[dist.fillMode].label}`}
              aria-label={`Кому заполнять журнал «${item.name}»`}
              className="inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-1 rounded-xl border border-[#ececf4] bg-[#fafbff] px-2 text-[11px] font-medium text-[#3848c7] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              <Settings2 className="size-3.5 shrink-0" />
              <ModeIcon className="size-3.5 shrink-0 text-[#6f7282]" />
              <span className="truncate">Кому</span>
            </button>
            <Link
              href={`/settings/journals/${item.code}/scope`}
              title="Тип задачи и кнопки"
              aria-label={`Задачи журнала «${item.name}»`}
              className="inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-1 rounded-xl border border-[#ececf4] bg-[#fafbff] px-2 text-[11px] font-medium text-[#3848c7] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              <ClipboardList className="size-3.5 shrink-0" />
              <span className="truncate">Задачи</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  /**
   * Бумажный бланк в общей сетке. Тот же каркас, что у электронной
   * карточки, но янтарный маркер («печать и подпись ручкой») и вместо
   * настроек распределения — скачивание бланка.
   */
  function renderPaperCard(journal: PaperItem, first: boolean) {
    const enabled = paperState[journal.id];
    return (
      <div
        key={journal.id}
        // Хлебная крошка со страницы заполнения ведёт на #paper —
        // якорь вешаем на первую бумажную карточку в сетке.
        id={first ? "paper" : undefined}
        className={`flex h-full flex-col overflow-hidden scroll-mt-24 rounded-2xl border bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)] transition-all hover:shadow-[0_8px_24px_-12px_rgba(180,83,9,0.18)] ${
          enabled
            ? "border-[#ffe9b0] hover:border-[#f5c451]"
            : "border-[#ececf4] opacity-60 hover:opacity-90"
        }`}
      >
        <span
          aria-hidden
          className={`h-1 w-full shrink-0 ${
            enabled ? "bg-[#f5c451]" : "bg-[#ececf4]"
          }`}
        />
        {renderPreview(
          `/journal-samples/paper_${journal.id}.webp`,
          journal.name,
          "amber"
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-2 bg-[#fffaf0] p-3">
          <div className="flex items-start gap-2">
            <Switch
              checked={enabled}
              onCheckedChange={() => togglePaper(journal.id)}
              aria-label={`Вести бумажный журнал «${journal.name}»`}
              className="mt-0.5 shrink-0"
            />
            <button
              type="button"
              onClick={() => togglePaper(journal.id)}
              className="min-w-0 flex-1 text-left"
            >
              <span className="line-clamp-3 text-[13px] font-semibold leading-snug text-[#0b1024]">
                {journal.name}
              </span>
            </button>
          </div>

          <div
            className="line-clamp-3 text-[11px] leading-snug text-[#6f7282]"
            title={`${journal.why} Штраф ${journal.fineHint}.`}
          >
            {journal.why}
          </div>

          <div className="mt-auto flex flex-wrap items-center gap-1 pt-1">
            {/* «Только на бумаге» — не про все бланки: у пожарных
                журналов электронная форма законна, и обещать обратное
                нельзя. */}
            <span
              className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                journal.paperOnly
                  ? "bg-[#fff4f2] text-[#a13a32]"
                  : "bg-[#fff1d6] text-[#b45309]"
              }`}
            >
              <Printer className="size-3" />
              {journal.paperOnly ? "Только на бумаге" : "Бланк для печати"}
            </span>
            <a
              href={journal.law.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-[10px] font-medium text-[#5566f6] hover:underline"
            >
              {journal.law.label}
              <ExternalLink className="size-2.5" />
            </a>
          </div>

          <div className="flex gap-1.5">
            <a
              href={`/api/settings/journals/paper/${journal.id}/pdf`}
              title="Скачать пустой бланк в PDF"
              className="inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-1 rounded-xl border border-[#f0e2c6] bg-white px-2 text-[11px] font-medium text-[#8a4a08] transition-colors hover:border-[#f5c451] hover:bg-[#fff8ec]"
            >
              <Download className="size-3.5 shrink-0" />
              <span className="truncate">Бланк</span>
            </a>
            <Link
              href={`/settings/journals/paper/${journal.id}`}
              title="Заполнить и распечатать"
              className="inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-1 rounded-xl bg-[#b45309] px-2 text-[11px] font-medium text-white transition-colors hover:bg-[#9a460a]"
            >
              <Printer className="size-3.5 shrink-0" />
              <span className="truncate">Заполнить</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Группы: обязательные по сфере, рекомендованные, всё остальное.
  // Порядок внутри группы — как в каталоге, чтобы список не «прыгал»
  // при переключении тумблеров.
  const rules = rulesFor(sphere);
  const requiredMap = useMemo(
    () => new Map(rules.electronicRequired.map((rule) => [rule.code, rule])),
    [rules],
  );
  const recommendedSet = useMemo(
    () => new Set(rules.electronicRecommended),
    [rules],
  );
  const foundItems = useMemo(
    () =>
      items.filter((item) =>
        journalMatchesQuery([item.name, item.description, item.code], normalizedQuery),
      ),
    [items, normalizedQuery],
  );
  const foundPaper = useMemo(
    () =>
      paperItems.filter((journal) =>
        journalMatchesQuery([journal.name, journal.id], normalizedQuery),
      ),
    [paperItems, normalizedQuery],
  );
  const foundCount = foundItems.length + foundPaper.length;

  const groups = useMemo(() => {
    const required: Item[] = [];
    const recommended: Item[] = [];
    const rest: Item[] = [];
    for (const item of foundItems) {
      if (requiredMap.has(item.code)) required.push(item);
      else if (recommendedSet.has(item.code)) recommended.push(item);
      else rest.push(item);
    }
    return { required, recommended, rest };
  }, [foundItems, requiredMap, recommendedSet]);

  /** Сколько журналов включим/выключим, если применить набор сферы. */
  function diffFor(nextSphere: OrgSphere) {
    const nextRequired = new Set(requiredCodesFor(nextSphere));
    let willEnable = 0;
    let willDisable = 0;
    let manual = 0;
    for (const item of items) {
      const on = state[item.code];
      if (nextRequired.has(item.code)) {
        if (!on) willEnable += 1;
      } else if (on) {
        // Ручные включения вне обязательного набора сохраняем — человек
        // сам их поставил, наш пересчёт не должен их сносить.
        manual += 1;
      }
      if (requiredMap.has(item.code) && !nextRequired.has(item.code) && on) {
        willDisable += 1;
      }
    }
    return { willEnable, willDisable, manual };
  }

  function applyRequired(nextSphere: OrgSphere) {
    const nextRequired = new Set(requiredCodesFor(nextSphere));
    setState((prev) => {
      const next = { ...prev };
      for (const code of nextRequired) next[code] = true;
      return next;
    });
  }

  async function confirmSphereChange() {
    const next = sphereDraft;
    setSwitchingSphere(true);
    try {
      const response = await fetch("/api/settings/organization", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: next }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Не удалось сменить сферу");
      }
      applyRequired(next);
      toast.success(`Сфера: ${sphereLabel(next)}. Не забудьте сохранить набор.`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка");
      setSphereDraft(sphere);
    } finally {
      setSwitchingSphere(false);
      setSphereConfirmOpen(false);
    }
  }

  const sphereDiff = diffFor(sphereDraft);
  const distDialogItem =
    items.find((item) => item.code === distDialogCode) ?? null;
  const paperOffTarget =
    paperItems.find((journal) => journal.id === paperOffId) ?? null;
  // Текст подтверждения разный: у охраны труда бумага — требование
  // закона, у пожарных журналов электронная форма законна, и обещать
  // «только на бумаге» там нельзя.
  const paperOffBullets: Array<{
    label: string;
    tone?: "default" | "warn" | "info";
  }> = [
    { label: "Карточка исчезнет с дашборда", tone: "warn" },
    ...(paperOffTarget
      ? [
          {
            label: paperOffTarget.paperOnly
              ? `Вести журнал всё равно обязаны на бумаге — штраф ${paperOffTarget.fineHint} (${paperOffTarget.law.label})`
              : `Требование не отменяется — штраф ${paperOffTarget.fineHint} (${paperOffTarget.law.label})`,
            tone: "warn" as const,
          },
        ]
      : []),
    { label: "Бланк останется доступен по прямой ссылке", tone: "default" },
  ];

  return (
    <div className="space-y-6">
      {/* Шапка страницы настроек — карточка, а не тёмный hero: hero здесь
          занимал экран и ничего не сообщал, кроме счётчика. */}
      <section className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
              <ClipboardList className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-[#0b1024]">
                  Набор журналов
                </h1>
                <span className="inline-flex items-center gap-1 rounded-full bg-[#f5f6ff] px-2.5 py-1 text-[12px] font-medium text-[#5566f6]">
                  <CheckCircle2 className="size-3.5" />
                  Включено {enabledCount} из {totalCount}
                  {/* На главной и в «Режимах задач» стоит другая цифра:
                      там только электронные журналы. Разницу называем
                      прямо, иначе она читается как ошибка. */}
                  {enabledPaperCount > 0
                    ? `, из них ${enabledPaperCount} ${pluralRu(
                        enabledPaperCount,
                        "бумажный",
                        "бумажных",
                        "бумажных"
                      )}`
                    : ""}
                </span>
              </div>
              <p className="mt-2 max-w-[640px] text-[14px] leading-relaxed text-[#6f7282]">
                {rules.intro}{" "}
                <a
                  href={rules.introLaw.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-[#5566f6] hover:underline"
                >
                  {rules.introLaw.label}
                  <ExternalLink className="size-3" />
                </a>
              </p>
            </div>
          </div>

          <div className="w-full sm:w-[280px]">
            <label className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">
              Сфера деятельности
            </label>
            <span className="relative block">
              <select
                value={sphereDraft}
                onChange={(e) => setSphereDraft(e.target.value as OrgSphere)}
                className="h-11 w-full appearance-none rounded-2xl border border-[#dcdfed] bg-white pl-4 pr-10 text-[15px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
              >
                {ORG_SPHERES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-[#9b9fb3]" />
            </span>
            {sphereDraft !== sphere ? (
              <div className="mt-2 rounded-xl bg-[#f5f6ff] p-2.5 text-[12px] leading-relaxed text-[#3c4053]">
                Включим: {sphereDiff.willEnable} · Выключим:{" "}
                {sphereDiff.willDisable} · Ваши ручные останутся:{" "}
                {sphereDiff.manual}
                <button
                  type="button"
                  onClick={() => setSphereConfirmOpen(true)}
                  className="mt-2 inline-flex h-9 w-full items-center justify-center rounded-xl bg-[#5566f6] text-[13px] font-medium text-white transition-colors hover:bg-[#4a5bf0]"
                >
                  Сменить сферу
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setApplyConfirmOpen(true)}
                className="mt-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white text-[13px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
              >
                <ShieldCheck className="size-4 text-[#5566f6]" />
                Включить обязательные
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Кнопки «Сохранить» нет: переключатель журнала — это уже
          законченное действие, и требовать после него второе нажатие
          значит терять изменения тех, кто ушёл со страницы. Осталась
          тихая строка состояния — человек должен видеть, что записалось. */}
      <div className="flex justify-end">
        <span
          className={cn(
            "inline-flex items-center gap-2 text-[13px] transition-colors",
            saving ? "text-[#6f7282]" : "text-[#116b2a]"
          )}
        >
          {saving ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              Сохраняю…
            </>
          ) : (
            <>
              <Check className="size-3.5" />
              Изменения сохраняются сами
            </>
          )}
        </span>
      </div>

      {/* Поиск стоит над списком, а не в шапке: шапка про сферу и
          счётчик, а это инструмент для самого набора. Ищет и по
          отключённым — их чаще всего и приходят включать. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-[420px]">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#9b9fb3]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Название, описание или код"
            aria-label="Поиск по набору журналов"
            className="h-12 w-full rounded-2xl border border-[#dcdfed] bg-white pl-11 pr-11 text-[15px] text-[#0b1024] placeholder:text-[#c1c5d6] shadow-[0_0_0_1px_rgba(240,240,250,0.45)] transition-[border-color,box-shadow] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Очистить поиск"
              className="absolute right-2 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-[#9b9fb3] transition-colors hover:bg-[#f5f6ff] hover:text-[#5566f6]"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        <div className="text-[13px] text-[#6f7282] sm:whitespace-nowrap">
          {normalizedQuery
            ? `Найдено ${foundCount} из ${totalCount}`
            : `Всего журналов: ${totalCount}`}
        </div>
      </div>

      {normalizedQuery && foundCount === 0 ? (
        <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-14 text-center">
          <div className="text-[15px] font-medium text-[#0b1024]">Ничего не нашли</div>
          <p className="mx-auto mt-1.5 max-w-[360px] text-[13px] text-[#6f7282]">
            Попробуйте другое слово — поиск идёт по названию, описанию и коду
            журнала, включая отключённые.
          </p>
        </div>
      ) : null}

      {groups.required.length + foundPaper.length > 0 ? (
        <>
      <GroupHeading
        title="Обязательные"
        hint="электронные — зелёные, бумажные бланки — жёлтые, в конце"
        count={groups.required.length + foundPaper.length}
        tone="required"
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {groups.required.map((item) => renderCard(item))}
        {/* Бумажные идут в конце той же сетки: набор у заведения один,
            и делить его на «наши» и «не наши» журналы бессмысленно —
            инспектор спросит и те, и другие. */}
        {foundPaper.map((journal, index) =>
          renderPaperCard(journal, index === 0)
        )}
      </div>
        </>
      ) : null}

      {groups.recommended.length > 0 ? (
        <>
          <GroupHeading
            title={`Рекомендуем для сферы «${sphereLabel(sphere)}»`}
            count={groups.recommended.length}
            tone="recommended"
          />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {groups.recommended.map((item) => renderCard(item))}
          </div>
        </>
      ) : null}

      {/* open по умолчанию: свёрнутый список читался как «тут ничего
          нет», и половина набора журналов оставалась незамеченной. */}
      {groups.rest.length > 0 ? (
      <details open className="group rounded-2xl border border-[#ececf4] bg-white">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4">
          <span className="text-[15px] font-semibold text-[#0b1024]">
            Остальные журналы
            <span className="ml-2 rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[12px] font-medium text-[#6f7282]">
              {groups.rest.length}
            </span>
          </span>
          <ChevronDown className="size-4 text-[#9b9fb3] transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t border-[#eef0f6] p-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {groups.rest.map((item) => renderCard(item))}
          </div>
          <button
            type="button"
            onClick={() => setDisableRestConfirmOpen(true)}
            className="mt-4 inline-flex items-center gap-2 text-[13px] font-medium text-[#6f7282] transition-colors hover:text-[#d2453d]"
          >
            <EyeOff className="size-4" />
            Отключить все, кроме обязательных
          </button>
        </div>
      </details>
      ) : null}

      <ConfirmDialog
        open={requiredOffCode !== null}
        onClose={() => setRequiredOffCode(null)}
        onConfirm={() => {
          if (requiredOffCode) forceToggle(requiredOffCode);
          setRequiredOffCode(null);
        }}
        variant="warn"
        title={`Выключить обязательный журнал?`}
        description={`Журнал обязателен для сферы «${sphereLabel(sphere)}».`}
        bullets={[
          ...(requiredOffDocCount > 0
            ? [
                {
                  // Число прячущихся документов — то, о чём спрашивают чаще
                  // всего: «а заполненное куда делось?».
                  label: `Скроется активных документов: ${requiredOffDocCount} (данные останутся, вернутся при включении)`,
                  tone: "warn" as const,
                },
              ]
            : []),
          { label: "Исчезнет из дашборда и из задач сотрудникам", tone: "warn" },
          { label: "Перестанет учитываться в готовности", tone: "default" },
          { label: `Проверка Роспотребнадзора — ${rules.introLaw.label}, до 50 000 ₽`, tone: "warn" },
        ]}
        confirmLabel="Всё равно выключить"
      />

      <ConfirmDialog
        open={sphereConfirmOpen}
        onClose={() => {
          setSphereConfirmOpen(false);
          setSphereDraft(sphere);
        }}
        onConfirm={confirmSphereChange}
        variant="info"
        title={`Сменить сферу на «${sphereLabel(sphereDraft)}»?`}
        description="Пересчитаем обязательный набор журналов. Всё, что вы включили руками, останется."
        bullets={[
          { label: `Включим: ${sphereDiff.willEnable}`, tone: "info" },
          { label: `Выключим: ${sphereDiff.willDisable}`, tone: "default" },
          { label: `Ваши ручные останутся: ${sphereDiff.manual}`, tone: "default" },
        ]}
        confirmLabel={switchingSphere ? "Меняю…" : "Сменить"}
      />

      <ConfirmDialog
        open={applyConfirmOpen}
        onClose={() => setApplyConfirmOpen(false)}
        onConfirm={() => {
          applyRequired(sphere);
          setApplyConfirmOpen(false);
        }}
        variant="info"
        title="Включить обязательные журналы?"
        description={`Минимум для сферы «${sphereLabel(sphere)}». Остальное не трогаем.`}
        bullets={[{ label: `Включим: ${diffFor(sphere).willEnable}`, tone: "info" }]}
        confirmLabel="Включить"
      />

      <ConfirmDialog
        open={disableRestConfirmOpen}
        onClose={() => setDisableRestConfirmOpen(false)}
        onConfirm={() => {
          setState(
            Object.fromEntries(
              items.map((item) => [item.code, requiredMap.has(item.code)]),
            ),
          );
          setDisableRestConfirmOpen(false);
        }}
        variant="warn"
        title="Отключить все, кроме обязательных?"
        description="Останется только минимум для вашей сферы."
        bullets={[
          { label: "Отключённые журналы исчезнут из дашборда", tone: "warn" },
          { label: "Записи останутся в архиве — ничего не удаляем", tone: "default" },
        ]}
        confirmLabel="Отключить"
      />

      <ConfirmDialog
        open={paperOffId !== null}
        onClose={() => setPaperOffId(null)}
        onConfirm={() => {
          if (paperOffId) forcePaperToggle(paperOffId);
          setPaperOffId(null);
        }}
        variant="warn"
        title="Убрать бумажный журнал из набора?"
        description={
          paperOffTarget
            ? `${paperOffTarget.name}. Мы только перестанем напоминать о нём — обязанность вести журнал остаётся.`
            : ""
        }
        bullets={paperOffBullets}
        confirmLabel="Всё равно убрать"
      />

      {/* Редактор распределения — модалкой: в карточке шириной 1/5
          экрана раскрытый inline-блок ломал ряд по высоте и был
          нечитаем. Содержимое то же самое. */}
      <Dialog
        open={distDialogCode !== null}
        onOpenChange={(open) => {
          if (!open) setDistDialogCode(null);
        }}
      >
        <DialogContent className="max-h-[90vh] supports-[height:100dvh]:max-h-[90dvh] gap-0 overflow-hidden rounded-3xl p-0 sm:max-w-[520px]">
          {distDialogItem ? (
            <>
              <DialogHeader className="shrink-0 border-b border-[#ececf4] px-5 py-4">
                <DialogTitle className="text-[16px] font-semibold text-[#0b1024]">
                  Кому отправлять журнал
                </DialogTitle>
                <DialogDescription className="text-[13px] text-[#6f7282]">
                  {distDialogItem.name}
                </DialogDescription>
              </DialogHeader>
              <div className="max-h-[calc(90vh-84px)] overflow-y-auto">
                <DistributionEditor
                  item={distDialogItem}
                  dist={distState[distDialogItem.code]}
                  positions={positions}
                  users={users}
                  onModeChange={(mode) =>
                    setItemFillMode(distDialogItem.code, mode)
                  }
                  onAssigneeChange={(id) =>
                    setItemAssignee(distDialogItem.code, id)
                  }
                  onPositionToggle={(id) =>
                    togglePosition(distDialogItem.code, id)
                  }
                  onBonusChange={(rub) =>
                    setItemBonus(distDialogItem.code, Math.round(rub * 100))
                  }
                  onSave={() => saveDistribution(distDialogItem.code)}
                  saving={distSavingCode === distDialogItem.code}
                />
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {lightbox ? (
        <PhotoLightbox
          url={lightbox.url}
          filename={lightbox.name}
          caption={lightbox.name}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </div>
  );
}

/** Человеческая подпись основания под названием журнала. */
function basisNote(rule: ElectronicRule | undefined): string | null {
  if (!rule) return null;
  const parts: string[] = [];
  if (rule.basis === "sanpin") parts.push(rule.note ?? "Требует СанПиН");
  else if (rule.basis === "haccp") parts.push("Обязательная запись ХАССП");
  else if (rule.basis === "practice") {
    parts.push(
      `Закон не обязывает, но спрашивают при проверках${
        rule.law ? ` (${rule.law.label})` : ""
      }`,
    );
  }
  if (rule.condition) parts.push(rule.condition);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function GroupHeading({
  title,
  hint,
  count,
  tone,
}: {
  title: string;
  hint?: string;
  count: number;
  tone: "required" | "recommended" | "paper";
}) {
  const dot =
    tone === "required"
      ? "bg-[#5566f6]"
      : tone === "paper"
        ? "bg-[#d2453d]"
        : "bg-[#9b9fb3]";
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <span className={`size-2 rounded-full ${dot}`} aria-hidden />
      <h2 className="text-[15px] font-semibold text-[#0b1024]">{title}</h2>
      {hint ? <span className="text-[13px] text-[#9b9fb3]">· {hint}</span> : null}
      <span className="rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[12px] font-medium text-[#6f7282]">
        {count}
      </span>
    </div>
  );
}

function DistributionEditor({
  item,
  dist,
  positions,
  users,
  onModeChange,
  onAssigneeChange,
  onPositionToggle,
  onBonusChange,
  onSave,
  saving,
}: {
  item: Item;
  dist: {
    fillMode: FillMode;
    defaultAssigneeId: string | null;
    allowedPositionIds: string[];
    bonusAmountKopecks: number;
  };
  positions: Position[];
  users: StaffUser[];
  onModeChange: (mode: FillMode) => void;
  onAssigneeChange: (id: string | null) => void;
  onPositionToggle: (id: string) => void;
  /// rub — значение в рублях из инпута; преобразуется в копейки в state.
  onBonusChange: (rub: number) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const dirty =
    dist.fillMode !== item.fillMode ||
    dist.defaultAssigneeId !== item.defaultAssigneeId ||
    dist.bonusAmountKopecks !== item.bonusAmountKopecks ||
    dist.allowedPositionIds.slice().sort().join(",") !==
      item.allowedPositionIds.slice().sort().join(",");
  const bonusRub = (dist.bonusAmountKopecks / 100).toFixed(2);

  // Фильтруем сотрудников по white-list-у должностей если он задан —
  // в селекте «исполнитель по умолчанию» показываем только тех, кто
  // в принципе eligible.
  const eligibleUsers =
    dist.allowedPositionIds.length === 0
      ? users
      : users.filter(
          (u) => u.jobPositionId && dist.allowedPositionIds.includes(u.jobPositionId)
        );

  return (
    <div className="border-t border-[#ececf4] bg-[#fafbff] px-5 py-4 text-[13px]">
      {/* Fill mode selector */}
      <div className="mb-3">
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">
          Режим распределения
        </div>
        <div className="grid grid-cols-1 gap-1.5">
          {(Object.keys(FILL_MODE_LABELS) as FillMode[]).map((mode) => {
            const meta = FILL_MODE_LABELS[mode];
            const Icon = meta.icon;
            const active = dist.fillMode === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => onModeChange(mode)}
                className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
                  active
                    ? "border-[#5566f6] bg-[#eef1ff]"
                    : "border-[#ececf4] bg-white hover:border-[#dcdfed]"
                }`}
              >
                <Icon
                  className={`mt-0.5 size-4 shrink-0 ${
                    active ? "text-[#5566f6]" : "text-[#6f7282]"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div
                    className={`text-[13px] font-medium ${
                      active ? "text-[#3848c7]" : "text-[#0b1024]"
                    }`}
                  >
                    {meta.label}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[#6f7282]">
                    {meta.hint}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Default assignee — только для single */}
      {dist.fillMode === "single" ? (
        <div className="mb-3">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">
            Исполнитель по умолчанию
          </div>
          <select
            value={dist.defaultAssigneeId ?? ""}
            onChange={(e) =>
              onAssigneeChange(e.target.value === "" ? null : e.target.value)
            }
            className="h-9 w-full rounded-lg border border-[#dcdfed] bg-white px-3 text-[13px] text-[#0b1024]"
          >
            <option value="">— Авто (round-robin) —</option>
            {eligibleUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <div className="mt-1 text-[11px] text-[#9b9fb3]">
            Если не указан — система чередует подходящих сотрудников
            по последним 7 дням.
          </div>
        </div>
      ) : null}

      {/* Position whitelist — для всех режимов кроме sensor */}
      {dist.fillMode !== "sensor" ? (
        <div className="mb-3">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">
            Кому можно отправлять
          </div>
          {positions.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[#dcdfed] bg-white px-3 py-2 text-[12px] text-[#6f7282]">
              Должности ещё не созданы. Добавьте на странице «Сотрудники».
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {positions.map((pos) => {
                const checked = dist.allowedPositionIds.includes(pos.id);
                return (
                  <button
                    key={pos.id}
                    type="button"
                    onClick={() => onPositionToggle(pos.id)}
                    className={`rounded-full border px-3 py-1 text-[12px] font-medium transition-colors ${
                      checked
                        ? "border-[#5566f6] bg-[#eef1ff] text-[#3848c7]"
                        : "border-[#ececf4] bg-white text-[#6f7282] hover:border-[#dcdfed]"
                    }`}
                  >
                    {pos.name}
                  </button>
                );
              })}
            </div>
          )}
          <div className="mt-1 text-[11px] text-[#9b9fb3]">
            Пусто — разрешено всем должностям.
          </div>
        </div>
      ) : null}

      {/* Bonus — для всех режимов кроме sensor */}
      {dist.fillMode !== "sensor" ? (
        <div className="mb-3">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">
            Премия за выполнение
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={bonusRub}
              onChange={(e) => {
                const parsed = Number(e.target.value);
                onBonusChange(Number.isFinite(parsed) ? parsed : 0);
              }}
              className="h-9 w-28 rounded-lg border border-[#dcdfed] bg-white px-3 text-[13px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none"
            />
            <span className="text-[13px] text-[#6f7282]">₽</span>
            {dist.bonusAmountKopecks > 0 ? (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-[#ecfdf5] px-2 py-0.5 text-[11px] font-medium text-[#116b2a]">
                Премиальный журнал
              </span>
            ) : null}
          </div>
          <div className="mt-1 text-[11px] text-[#9b9fb3]">
            0 ₽ — обычное обязательство. Если &gt; 0 — у сотрудника
            появится кнопка «Взять с бонусом» с фото-доказательством;
            бонус начисляется первому, кто выполнил.
          </div>
        </div>
      ) : null}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onSave}
          disabled={!dirty || saving}
          className="inline-flex h-9 items-center gap-2 rounded-xl bg-[#5566f6] px-4 text-[13px] font-medium text-white shadow-[0_8px_20px_-10px_rgba(85,102,246,0.6)] transition-colors hover:bg-[#4a5bf0] disabled:opacity-50"
        >
          <Save className="size-3.5" />
          {saving ? "Сохраняю…" : dirty ? "Сохранить" : "Сохранено"}
        </button>
      </div>
    </div>
  );
}
