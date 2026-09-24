/**
 * Single source of truth for "в каком периоде создавать документ журнала"
 * — используется bulk-create, auto-create и UI-кнопкой «Создать
 * документ». Без этого bulk-create создавал ВСЕ документы месячными,
 * даже если по семантике журнал годовой/событийный/полу-месячный/
 * open-ended.
 *
 * Правила (short):
 *   - YEARLY       → с 1 января по 31 декабря текущего года.
 *   - HALF_MONTHLY → 1-15 или 16-end-of-month по календарю.
 *                    Источник: скрины lk.haccp-online.ru.
 *   - MONTHLY      → с 1-го по последнее число месяца (daily и пр.).
 *   - SINGLE_DAY   → ровно сегодня (dateFrom = dateTo = today). Чек-
 *                    листы которые проводятся одним днём.
 *   - PERPETUAL    → один open-ended документ, dateFrom = сегодня,
 *                    dateTo = 2099-12-31 (фактически без конца). Внутрь
 *                    пишутся события за любые даты, документ не
 *                    ротируется.
 *
 * Если код шаблона неизвестен — дефолт MONTHLY, с логом для разработчика.
 */

import { ALL_DAILY_JOURNAL_CODES } from "@/lib/daily-journal-codes";

export type JournalPeriodKind =
  | "monthly"
  | "yearly"
  | "half-monthly"
  | "single-day"
  | "perpetual"
  /// Пользовательский режим: окна по N дней от начала месяца.
  /// N=10 → 1-10 / 11-20 / 21-end. N=15 эквивалентно half-monthly,
  /// но через универсальный механизм. N>=31 → fallback на monthly.
  | "days";

/** Per-org override настроек периодов. Shape: { templateCode: {kind, days?} }. */
export type JournalPeriodOverride = {
  kind: JournalPeriodKind;
  days?: number;
};
export type JournalPeriodOverrideMap = Record<string, JournalPeriodOverride>;

export function parseJournalPeriodsJson(
  raw: unknown
): JournalPeriodOverrideMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: JournalPeriodOverrideMap = {};
  for (const [code, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const v = value as Record<string, unknown>;
    const kind = v.kind;
    if (
      kind !== "monthly" &&
      kind !== "yearly" &&
      kind !== "half-monthly" &&
      kind !== "single-day" &&
      kind !== "perpetual" &&
      kind !== "days"
    )
      continue;
    const entry: JournalPeriodOverride = { kind };
    if (kind === "days") {
      const d = typeof v.days === "number" ? Math.floor(v.days) : NaN;
      if (Number.isFinite(d) && d >= 1 && d <= 31) {
        entry.days = d;
      } else {
        // Без валидного `days` режим бессмысленен → пропускаем.
        continue;
      }
    }
    out[code] = entry;
  }
  return out;
}

/**
 * Явно помеченные как yearly коды. Список основан на тех журналах,
 * где ручная кнопка «Создать» уже предлагает выбор года (см.
 * *-documents-client.tsx) или где сама сущность события по
 * бизнес-смыслу копится за год: аудиты, обучение, обслуживание,
 * калибровка, ежегодная санитарная книжка, сан-день, список
 * стеклянной посуды, учёт СИЗ, борьба с вредителями, аварии,
 * претензии, неисправности.
 */
export const YEARLY_JOURNAL_CODES = new Set<string>([
  "audit_plan",
  "audit_protocol",
  "audit_report",
  "training_plan",
  "staff_training",
  "equipment_calibration",
  "equipment_maintenance",
  "equipment_cleaning",
  "sanitation_day",
  "sanitary_day_checklist",
  "glass_items_list",
  "ppe_issuance",
  "pest_control",
  "breakdown_history",
  "accident_journal",
  "complaint_register",
  // Бой посуды — событийный учёт, как аварии и жалобы: один бланк на год.
  "tableware_breakage",
  // Отходы класса Б — тоже по событию (сбор и передача): бланк на год.
  "medical_waste_b",
  "med_books",
  // Скан скринов lk.haccp-online.ru: «График и учёт генеральных
  // уборок» отдельной колонкой «Год 2025» + «Дата документа
  // 01-01-2025» — однозначно годовой документ.
  "general_cleaning",
]);

/**
 * Журналы, у которых на официальном haccp-online.ru документ создаётся
 * на полмесяца — 1-15 или 16-end-of-month. Подтверждено скриншотами:
 *   • Гигиенический журнал — «Апрель с 1 по 15»
 *   • Журнал здоровья       — «Апрель с 1 по 15»
 *   • Контроль температурного режима холодильного оборудования —
 *     «Апрель с 1 по 15»
 *   • Журнал уборки — «Август с 1 по 15» (crawl-pass2 эталона).
 *     UI-кнопка «Создать документ» уже давала полумесяц
 *     (`getCleaningCreatePeriodBounds`), а auto-create/bulk-create
 *     делали месячный — расхождение убрано.
 *
 * Если день месяца ≤15 → период (1, 15). Если ≥16 → период (16, last).
 */
export const HALF_MONTHLY_JOURNAL_CODES = new Set<string>([
  "hygiene",
  "health_check",
  "cold_equipment_control",
  "cleaning",
]);

/**
 * Журналы которые проводятся одним днём — каждое нажатие «Создать
 * документ» это отдельное мероприятие на конкретную дату. Сейчас
 * этим kind никто не пользуется (sanitary_day_control пользователь
 * захотел сделать perpetual — один документ навсегда, а внутрь
 * вписывать любые даты). Оставляем kind на будущее.
 */
export const SINGLE_DAY_JOURNAL_CODES = new Set<string>([]);

/**
 * Open-ended журналы — создаются один раз, внутрь пишутся события
 * за любые даты, документ не ротируется. На офиц. сайте показана
 * только «Дата начала», без даты окончания. Реализуем как один
 * документ с dateTo = 2099-12-31. Бизнес-инвариант: bulk-create
 * найдёт существующий perpetual и НЕ создаст дубликат.
 */
export const PERPETUAL_JOURNAL_CODES = new Set<string>([
  "disinfectant_usage",
  "intensive_cooling",
  "glass_control",
  // Чек-лист санитарного дня — на хаккп-онлайн каждое мероприятие
  // = новый документ, но пользователь хочет иметь ОДИН журнал на
  // всё время и внутрь вписывать события (как у дезсредств). После
  // создания bulk-create больше его не пересоздаёт.
  "sanitary_day_control",
]);

const PERPETUAL_DATE_TO = new Date(Date.UTC(2099, 11, 31));

/** Год-маркер «бессрочного» документа. Всё, что >= него — perpetual. */
const PERPETUAL_YEAR_THRESHOLD = 2099;

/**
 * Документ бессрочный? Определяем по дате окончания, а не по коду
 * журнала: перечень PERPETUAL_JOURNAL_CODES мог меняться, а уже
 * созданные документы остались с `dateTo = 31.12.2099`.
 */
export function isPerpetualDateTo(dateTo: Date | string | null | undefined): boolean {
  if (!dateTo) return false;
  const year =
    typeof dateTo === "string"
      ? Number(dateTo.slice(0, 4))
      : dateTo.getUTCFullYear();
  return Number.isFinite(year) && year >= PERPETUAL_YEAR_THRESHOLD;
}

/**
 * Дата окончания «для показа и печати».
 *
 * У бессрочного документа `dateTo` — 31.12.2099, это технический
 * маркер «журнал не ротируется», а не реальный конец периода. Печатать
 * по нему сетку нельзя: бланк разрастался до 35 страниц дней, которых
 * ещё не было. Поэтому и экран, и PDF ограничиваются сегодняшним днём
 * (в зоне организации). У обычных документов ничего не меняется.
 */
export function resolveDisplayDateTo(
  dateTo: Date,
  todayKey: string
): Date {
  if (!isPerpetualDateTo(dateTo)) return dateTo;
  const today = new Date(`${todayKey}T00:00:00.000Z`);
  if (!Number.isFinite(today.getTime())) return dateTo;
  return today < dateTo ? today : dateTo;
}

export function resolveJournalPeriodKind(
  templateCode: string
): JournalPeriodKind {
  if (YEARLY_JOURNAL_CODES.has(templateCode)) return "yearly";
  if (HALF_MONTHLY_JOURNAL_CODES.has(templateCode)) return "half-monthly";
  if (SINGLE_DAY_JOURNAL_CODES.has(templateCode)) return "single-day";
  if (PERPETUAL_JOURNAL_CODES.has(templateCode)) return "perpetual";
  if (ALL_DAILY_JOURNAL_CODES.has(templateCode)) return "monthly";
  // Неизвестный код — трактуем как месячный. Это безопаснее: если
  // журнал на самом деле годовой, менеджер заметит "за 30 дней" и
  // заведёт вручную; обратное (месячный создан как годовой) — хуже,
  // т.к. документ будет расти и мешать отчётности.
  return "monthly";
}

function monthBounds(now: Date): { from: Date; to: Date } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return {
    from: new Date(Date.UTC(y, m, 1)),
    to: new Date(Date.UTC(y, m + 1, 0)),
  };
}

function halfMonthBounds(now: Date): { from: Date; to: Date } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const day = now.getUTCDate();
  if (day <= 15) {
    return {
      from: new Date(Date.UTC(y, m, 1)),
      to: new Date(Date.UTC(y, m, 15)),
    };
  }
  // Вторая половина: 16-е → последнее число месяца. (Date.UTC(y, m+1, 0)
  // даёт последний день текущего месяца; 28/29/30/31 в зависимости от
  // месяца и високосного года.)
  return {
    from: new Date(Date.UTC(y, m, 16)),
    to: new Date(Date.UTC(y, m + 1, 0)),
  };
}

function yearBounds(now: Date): { from: Date; to: Date } {
  const y = now.getUTCFullYear();
  return {
    from: new Date(Date.UTC(y, 0, 1)),
    to: new Date(Date.UTC(y, 11, 31)),
  };
}

/**
 * Окно по N дней от начала месяца. Если день 17 и N=10:
 *   chunkIndex = floor((17-1)/10) = 1
 *   from = 11, to = 20.
 * Если to уходит за пределы месяца (последняя «плитка» хвост) —
 * прижимаем к последнему дню месяца.
 */
function customDaysBounds(
  now: Date,
  days: number
): { from: Date; to: Date } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const day = now.getUTCDate();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const chunkIndex = Math.floor((day - 1) / days);
  const fromDay = chunkIndex * days + 1;
  const toDay = Math.min((chunkIndex + 1) * days, lastDay);
  return {
    from: new Date(Date.UTC(y, m, fromDay)),
    to: new Date(Date.UTC(y, m, toDay)),
  };
}

function customDaysLabel(now: Date, days: number): string {
  const b = customDaysBounds(now, days);
  const fromDay = b.from.getUTCDate();
  const toDay = b.to.getUTCDate();
  const monthName = RU_MONTHS_NOMINATIVE[now.getUTCMonth()];
  return `${monthName} ${now.getUTCFullYear()}, с ${fromDay} по ${toDay}`;
}

const RU_MONTHS_NOMINATIVE = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

function monthLabel(now: Date): string {
  return now.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
}
function yearLabel(now: Date): string {
  return `${now.getUTCFullYear()} г.`;
}
function halfMonthLabel(now: Date): string {
  // «Апрель 2026, с 1 по 15» / «Апрель 2026, с 16 по 30».
  // Год добавлен: без него «Май с 1 по 31» не отличить от прошлогоднего
  // документа, а в списке документов они стоят рядом.
  const day = now.getUTCDate();
  const monthName = RU_MONTHS_NOMINATIVE[now.getUTCMonth()];
  const year = now.getUTCFullYear();
  if (day <= 15) return `${monthName} ${year}, с 1 по 15`;
  const lastDay = new Date(
    Date.UTC(year, now.getUTCMonth() + 1, 0)
  ).getUTCDate();
  return `${monthName} ${year}, с 16 по ${lastDay}`;
}

function singleDayLabel(now: Date): string {
  return now.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function startOfUtcDay(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
}

/**
 * Период документа по дате, выбранной в окне создания, строками
 * `YYYY-MM-DD`.
 *
 * ПОЧЕМУ: два десятка журналов со своим окном создания слали
 * `dateTo = dateFrom` — однодневный документ независимо от вида периода.
 * У годовых журналов (дезинсекция, аварии, СИЗ, история поломок…) ночной
 * крон заводил документ 01.01–31.12, а ручное создание — однодневный,
 * который с ним пересекался: два бланка на один период, записи
 * разъезжаются, ни один не выглядит заполненным.
 *
 * Дату НАЧАЛА человек по-прежнему выбирает сам — сюда приходит она, а
 * возвращается период журнала, который эту дату содержит.
 */
export function resolveJournalPeriodForDate(
  templateCode: string,
  dateFrom: string | null | undefined,
  overrides?: JournalPeriodOverrideMap
): { dateFrom: string; dateTo: string } {
  const day = typeof dateFrom === "string" ? dateFrom.trim().slice(0, 10) : "";
  const at = /^\d{4}-\d{2}-\d{2}$/.test(day)
    ? new Date(`${day}T00:00:00.000Z`)
    : new Date();
  const period = resolveJournalPeriod(
    templateCode,
    Number.isFinite(at.getTime()) ? at : new Date(),
    overrides
  );
  return {
    dateFrom: period.dateFrom.toISOString().slice(0, 10),
    dateTo: period.dateTo.toISOString().slice(0, 10),
  };
}

export function resolveJournalPeriod(
  templateCode: string,
  now: Date = new Date(),
  overrides?: JournalPeriodOverrideMap
): { dateFrom: Date; dateTo: Date; kind: JournalPeriodKind; label: string } {
  // Per-org override побеждает дефолт. Если override-kind = "days",
  // используем кастомный механизм окон от начала месяца.
  const override = overrides?.[templateCode];
  if (override) {
    if (override.kind === "days" && override.days && override.days >= 1) {
      // N=15 даст эффект half-monthly при стандартных месяцах.
      // N>=31 — резать нечего, fallback на monthly.
      if (override.days >= 31) {
        const b = monthBounds(now);
        return {
          dateFrom: b.from,
          dateTo: b.to,
          kind: "monthly",
          label: monthLabel(now),
        };
      }
      const b = customDaysBounds(now, override.days);
      return {
        dateFrom: b.from,
        dateTo: b.to,
        kind: "days",
        label: customDaysLabel(now, override.days),
      };
    }
    if (override.kind === "yearly") {
      const b = yearBounds(now);
      return { dateFrom: b.from, dateTo: b.to, kind: "yearly", label: yearLabel(now) };
    }
    if (override.kind === "half-monthly") {
      const b = halfMonthBounds(now);
      return { dateFrom: b.from, dateTo: b.to, kind: "half-monthly", label: halfMonthLabel(now) };
    }
    if (override.kind === "single-day") {
      const day = startOfUtcDay(now);
      return { dateFrom: day, dateTo: day, kind: "single-day", label: singleDayLabel(now) };
    }
    if (override.kind === "perpetual") {
      const day = startOfUtcDay(now);
      return {
        dateFrom: day,
        dateTo: PERPETUAL_DATE_TO,
        kind: "perpetual",
        label: `с ${singleDayLabel(now)}`,
      };
    }
    if (override.kind === "monthly") {
      const b = monthBounds(now);
      return { dateFrom: b.from, dateTo: b.to, kind: "monthly", label: monthLabel(now) };
    }
  }
  const kind = resolveJournalPeriodKind(templateCode);
  if (kind === "yearly") {
    const b = yearBounds(now);
    return { dateFrom: b.from, dateTo: b.to, kind, label: yearLabel(now) };
  }
  if (kind === "half-monthly") {
    const b = halfMonthBounds(now);
    return { dateFrom: b.from, dateTo: b.to, kind, label: halfMonthLabel(now) };
  }
  if (kind === "single-day") {
    const day = startOfUtcDay(now);
    return { dateFrom: day, dateTo: day, kind, label: singleDayLabel(now) };
  }
  if (kind === "perpetual") {
    // Open-ended: один документ с сегодня до far future. Внутрь
    // пишутся события на любую дату; ротации не происходит.
    const day = startOfUtcDay(now);
    return {
      dateFrom: day,
      dateTo: PERPETUAL_DATE_TO,
      kind,
      label: `с ${singleDayLabel(now)}`,
    };
  }
  const b = monthBounds(now);
  return { dateFrom: b.from, dateTo: b.to, kind, label: monthLabel(now) };
}
