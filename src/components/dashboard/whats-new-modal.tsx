"use client";
import { lockBodyScroll, unlockBodyScroll } from "@/lib/use-body-scroll-lock";

import { useEffect, useState } from "react";
import {
  Library,
  Dumbbell,
  BellRing,
  ChevronDown,
  Camera,
  Coins,
  FileText,
  Gauge,
  Gift,
  Handshake,
  KeyRound,
  ListChecks,
  MicVocal,
  MessageCircle,
  MessageCircleMore,
  Building2,
  Moon,
  Plug,
  QrCode,
  ScrollText,
  Settings2,
  ShieldCheck,
  Sparkles,
  SquarePen,
  Table2,
  Thermometer,
  type LucideIcon,
  UserCheck,
  Users,
  Wand2,
  WifiOff,
  X,
  MapPin,
  Search,
  Smartphone,
  TabletSmartphone,
  Zap,
  CalendarCheck,
  ClipboardCheck,
  Clock3,
  Snowflake,
} from "lucide-react";

const STORAGE_KEY = "wesetup.last-seen-build-sha";

/**
 * Заметка может быть простой строкой (legacy) или категорией с
 * вложенными items'ами. В UI:
 *   • строки рендерятся плоским списком с фиолетовой точкой
 *   • категории — accordion с раскрытием одной за раз
 *
 * NB: icon-component сюда передавать нельзя — Server Components не
 * сериализуют функции в client. Иконку выбираем по category name через
 * CATEGORY_ICONS ниже.
 */
export type WhatsNewNote =
  | string
  | {
      category: string;
      items: string[];
    };

type Props = {
  buildSha: string;
  notes: WhatsNewNote[];
};

function isCategoryNote(
  n: WhatsNewNote,
): n is { category: string; items: string[] } {
  return typeof n === "object" && n !== null && "category" in n;
}

/**
 * Маппинг category name → иконка. Если категории нет в этом списке —
 * fallback на Sparkles. Добавлять новые иконки в whats-new-notes.ts
 * нельзя (server→client serialization), поэтому держим mapping здесь.
 */
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  "Требования Роспотребнадзора": ShieldCheck,
  "Мастер-кабинет справочников": Library,
  "Новые журналы и сферы": Dumbbell,
  "Начальная настройка: приказы и чек-листы": ClipboardCheck,
  "Приказы и инструкции": ScrollText,
  "Услуги специалиста": Handshake,
  "Точки": MapPin,
  "Помещения и уборка": Building2,
  "Отклонения температуры": Thermometer,
  "Уведомления и баланс": Zap,
  "Баланс и бонусы": Coins,
  "Чат и поддержка": MessageCircle,
  "Тёмная тема": Moon,
  "Бесплатный тариф": Gift,
  "AI-помощник": Sparkles,
  Партнёры: Handshake,
  "Распределение задач": Gauge,
  "Умные пресеты": Wand2,
  Интерфейс: Settings2,
  Интеграции: Plug,
  Журналы: ListChecks,
  "Журналы — раньше": ListChecks,
  "Команда и тариф": Users,
  "Команда и организации": Users,
  Поддержка: MessageCircleMore,
  Оформление: FileText,
  "Окна и формы": SquarePen,
  Таблицы: Table2,
  "Раньше — тоже полезное": ListChecks,
  "Соответствие методичке ХАССП — 5 новых журналов + выровненные колонки": ShieldCheck,
  "Документы и конфиденциальность": ShieldCheck,
  "Интерфейс на телефоне": Smartphone,
  "Скорость и отклик": Zap,
  "Замеры и приборы": Thermometer,
  "Вход и установка на телефон": KeyRound,
  "Общий планшет": TabletSmartphone,
  "Заполнение с телефона": Smartphone,
  "Фото в журналах": Camera,
  "Дашборд": Gauge,
  "Работа без интернета": WifiOff,
  "Уведомления": BellRing,
  "Голосовой ввод": MicVocal,
  "Жесты на телефоне": Smartphone,
  "Поиск и навигация": Search,
  "Ответственные в журналах": UserCheck,
  "Шапка журналов": SquarePen,
  "QR-ввод и правка строк": QrCode,
  "Температура по QR": QrCode,
  "Оборудование и QR-коды": QrCode,
  "Время в журналах": Clock3,
  "Наименования и окно строки": ClipboardCheck,
  Автозаполнение: CalendarCheck,
  "Колонки журналов": Table2,
  "Бракераж готовой продукции": ClipboardCheck,
  "Температура холодильников": Snowflake,
  "Бракераж: комиссия и подписи": UserCheck,
  "Бракераж: быстрый ввод по QR": QrCode,
  "Гигиенический журнал (сотрудники)": ShieldCheck,
  "Вход по QR и ПИН": KeyRound,
  "Колонки и шаблоны журналов": Table2,
  "Общий справочник блюд": ClipboardCheck,
  "Холодильники, склады и УФ-лампы": QrCode,
  "Заведующему производством: права и личный QR": KeyRound,
  "График генеральных уборок и БЖГП": ClipboardCheck,
  "QR-точка контроля": QrCode,
  "QR-коды журнала": QrCode,
  "Проверка Роспотребнадзора": ShieldCheck,
  "График генеральных уборок": CalendarCheck,
  "Переход между журналами": Search,
  "Проверка в конце смены": BellRing,
  "Telegram-бот": MessageCircle,
};

function iconForCategory(name: string): LucideIcon {
  return CATEGORY_ICONS[name] ?? Sparkles;
}

/**
 * При первом заходе после новой сборки показываем modal со списком
 * новинок. Юзер видит изменения в lifecycle'е.
 *
 * Логика:
 *   1. На сервере рендерится с props.buildSha (eb52b71 etc).
 *   2. На клиенте useEffect читает localStorage[STORAGE_KEY].
 *   3. Если != currentSha → показываем modal.
 *   4. Закрытие → пишем currentSha в localStorage.
 *
 * Размер: карточка max-w-[480px], общая высота max-h-[90vh] supports-[height:100dvh]:max-h-[90dvh] (даже на
 * мобилке helmet+address bar остаются видимы), внутренняя scroll-зона
 * со списком категорий — overflow-y-auto. На больших экранах
 * accordion'ы помещаются без скролла.
 */
export function WhatsNewModal({ buildSha, notes }: Props) {
  const [open, setOpen] = useState(false);
  // По умолчанию открыта первая категория (если есть). Иначе ничего.
  const [openCategoryIdx, setOpenCategoryIdx] = useState<number | null>(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const seen = window.localStorage.getItem(STORAGE_KEY);
      if (!seen) {
        // Первый визит вообще — не показываем (нет «новинок» для нового
        // юзера). Просто записываем текущий sha.
        window.localStorage.setItem(STORAGE_KEY, buildSha);
        return;
      }
      if (seen !== buildSha) {
        setOpen(true);
      }
    } catch {
      /* localStorage недоступен — skip */
    }
  }, [buildSha]);

  // ESC и body scroll lock пока открыта.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") dismiss();
    }
    lockBodyScroll();
    document.addEventListener("keydown", onKey);
    return () => {
      unlockBodyScroll();
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function dismiss() {
    setOpen(false);
    try {
      window.localStorage.setItem(STORAGE_KEY, buildSha);
    } catch {
      /* ignore */
    }
  }

  if (!open || notes.length === 0) return null;

  // Разделяем notes на категории и плоские строки. Все строки рендерим
  // одной общей секцией «Прочее» в конце (если они есть).
  const categories = notes.filter(isCategoryNote);
  const looseStrings = notes.filter((n): n is string => typeof n === "string");

  const totalCategories = categories.length + (looseStrings.length > 0 ? 1 : 0);

  return (
    <div
      className="fixed inset-0 z-[55] flex items-end justify-center bg-black/40 p-3 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="whats-new-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      <div className="flex max-h-[90vh] supports-[height:100dvh]:max-h-[90dvh] w-full max-w-[480px] flex-col overflow-hidden rounded-3xl border border-[#ececf4] bg-white shadow-[0_30px_80px_-20px_rgba(11,16,36,0.55)]">
        {/* Header — fixed */}
        <div className="relative shrink-0 border-b border-[#ececf4] bg-gradient-to-br from-[#f5f6ff] to-white p-5">
          <div className="pointer-events-none absolute -right-12 -top-12 size-[180px] rounded-full bg-[#5566f6]/10 blur-3xl" />
          <div className="relative flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
                <Sparkles className="size-5" />
              </span>
              <div className="min-w-0">
                <h2
                  id="whats-new-title"
                  className="text-[18px] font-semibold leading-tight tracking-[-0.01em] text-[#0b1024]"
                >
                  Что нового в WeSetup
                </h2>
                <p className="mt-0.5 text-[12px] text-[#6f7282]">
                  Сборка{" "}
                  <span className="font-mono text-[#3848c7]">{buildSha}</span>
                  {" · "}
                  {new Date().toLocaleDateString("ru-RU", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={dismiss}
              className="flex size-7 shrink-0 items-center justify-center rounded-full text-[#9b9fb3] hover:bg-white/60 hover:text-[#0b1024]"
              aria-label="Закрыть"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* Body — scroll */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-2">
            {categories.map((cat, idx) => {
              const isOpen = openCategoryIdx === idx;
              const Icon = iconForCategory(cat.category);
              return (
                <div
                  // Категории в заметках повторяются («Журналы» — в разных релизах),
                  // одного названия для ключа мало.
                  key={`${cat.category}-${idx}`}
                  className={`overflow-hidden rounded-2xl border transition-colors ${
                    isOpen
                      ? "border-[#5566f6]/30 bg-[#f5f6ff]/40"
                      : "border-[#ececf4] bg-white"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() =>
                      setOpenCategoryIdx(isOpen ? null : idx)
                    }
                    className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-[#fafbff]"
                  >
                    <span
                      className={`flex size-8 shrink-0 items-center justify-center rounded-xl transition-colors ${
                        isOpen
                          ? "bg-[#5566f6] text-white"
                          : "bg-[#eef1ff] text-[#3848c7]"
                      }`}
                    >
                      <Icon className="size-4" />
                    </span>
                    <span className="flex-1 text-[13px] font-semibold tracking-[-0.005em] text-[#0b1024]">
                      {cat.category}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span className="rounded-full bg-[#eef1ff] px-1.5 py-0.5 text-[10px] tabular-nums font-semibold text-[#3848c7]">
                        {cat.items.length}
                      </span>
                      <ChevronDown
                        className={`size-4 text-[#9b9fb3] transition-transform ${
                          isOpen ? "rotate-180 text-[#5566f6]" : ""
                        }`}
                      />
                    </span>
                  </button>
                  {isOpen ? (
                    <ul className="space-y-1.5 px-3.5 pb-3">
                      {cat.items.map((item, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-2 rounded-xl border border-[#ececf4] bg-white px-3 py-2 text-[13px] leading-[1.5] text-[#3c4053]"
                        >
                          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[#5566f6]" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              );
            })}

            {looseStrings.length > 0 ? (
              <ul className="space-y-1.5 pt-1">
                {looseStrings.map((note, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 rounded-xl border border-[#ececf4] bg-[#fafbff] px-3 py-2 text-[13px] leading-[1.5] text-[#3c4053]"
                  >
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[#5566f6]" />
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>

        {/* Footer — fixed */}
        <div className="shrink-0 border-t border-[#ececf4] bg-white p-4">
          <button
            type="button"
            onClick={dismiss}
            className="inline-flex h-11 w-full items-center justify-center rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] hover:bg-[#4a5bf0]"
          >
            Спасибо, понял · {totalCategories > 1 ? `${totalCategories} раздела` : "ок"}
          </button>
          <a
            href="/whats-new"
            target="_blank"
            rel="noreferrer"
            className="mt-2 block text-center text-[12.5px] text-[#6f7282] underline-offset-2 hover:underline"
          >
            Вся история изменений — wesetup.ru/whats-new
          </a>
        </div>
      </div>
    </div>
  );
}
