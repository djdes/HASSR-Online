import { db } from "@/lib/db";
import { buildingWhere } from "@/lib/building-scope";
import { parseDisabledCodes } from "@/lib/disabled-journals";
import { NOT_AUTO_SEEDED } from "@/lib/journal-entry-filters";
import { sortJournalsByName } from "@/lib/journal-sort";

/**
 * Compliance heatmap: матрица «templates × дни», цветовое чтение
 * закономерностей («у нас завал по health_check каждый понедельник»,
 * «glass_control никто не ведёт уже 2 недели»).
 *
 * Дёшево по запросам: 2 запроса к БД (entries за период) + один
 * для шаблонов.
 *
 * Возвращает для каждого шаблона массив из `daysBack` дней, отсортированный
 * по возрастанию даты. Status:
 *   - "filled" — есть запись в этот день;
 *   - "missed" — день в прошлом, а записи нет;
 *   - "future" — день в будущем (на случай если кто-то расширит окно).
 */
export type CellStatus = "filled" | "missed" | "future";

export type HeatmapCell = {
  date: string; // YYYY-MM-DD UTC
  status: CellStatus;
  count: number;
};

export type HeatmapRow = {
  templateCode: string;
  templateName: string;
  cells: HeatmapCell[];
};

export async function getComplianceHeatmap(
  organizationId: string,
  daysBack: number = 30,
  refDate: Date = new Date(),
  options: { buildingId?: string | null } = {}
): Promise<{ rows: HeatmapRow[]; days: string[] }> {
  // Нормализуем периоды на UTC midnight.
  const todayStart = new Date(refDate);
  todayStart.setUTCHours(0, 0, 0, 0);
  const periodStart = new Date(todayStart);
  periodStart.setUTCDate(periodStart.getUTCDate() - (daysBack - 1));

  // Диапазон дней — массив YYYY-MM-DD в порядке возрастания.
  const days: string[] = [];
  for (let i = 0; i < daysBack; i++) {
    const d = new Date(periodStart);
    d.setUTCDate(d.getUTCDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }

  const [organization, templates, fieldEntries, docEntries] = await Promise.all(
    [
      db.organization.findUnique({
        where: { id: organizationId },
        select: { disabledJournalCodes: true },
      }),
      db.journalTemplate.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: "asc" },
        select: { id: true, code: true, name: true },
      }),
      db.journalEntry.findMany({
        where: {
          organizationId,
          createdAt: { gte: periodStart, lt: new Date(todayStart.getTime() + 24 * 60 * 60 * 1000) },
        },
        select: { templateId: true, createdAt: true },
      }),
      db.journalDocumentEntry.findMany({
        where: {
          document: { organizationId, ...buildingWhere(options.buildingId) },
          date: { gte: periodStart, lte: todayStart },
          ...NOT_AUTO_SEEDED,
        },
        select: {
          date: true,
          document: { select: { templateId: true } },
        },
      }),
    ]
  );

  const disabledSet = parseDisabledCodes(organization?.disabledJournalCodes);
  // Журналы по алфавиту: ниже строки ранжируются по пропускам (сортировка
  // устойчивая), и при равных пропусках идут по алфавиту.
  const activeTemplates = sortJournalsByName(
    templates.filter((t) => !disabledSet.has(t.code)),
    (t) => t.name
  );
  const templateById = new Map(activeTemplates.map((t) => [t.id, t]));

  // Bucket: templateId → date(YYYY-MM-DD) → count.
  const buckets = new Map<string, Map<string, number>>();
  function bump(templateId: string, dateStr: string) {
    if (!templateById.has(templateId)) return;
    let inner = buckets.get(templateId);
    if (!inner) {
      inner = new Map();
      buckets.set(templateId, inner);
    }
    inner.set(dateStr, (inner.get(dateStr) ?? 0) + 1);
  }
  for (const entry of fieldEntries) {
    const dateStr = entry.createdAt.toISOString().slice(0, 10);
    bump(entry.templateId, dateStr);
  }
  for (const entry of docEntries) {
    const dateStr = entry.date.toISOString().slice(0, 10);
    bump(entry.document.templateId, dateStr);
  }

  const rows: HeatmapRow[] = activeTemplates.map((tpl) => {
    const inner = buckets.get(tpl.id);
    const cells: HeatmapCell[] = days.map((dateStr) => {
      const count = inner?.get(dateStr) ?? 0;
      const isFuture =
        new Date(dateStr).getTime() > todayStart.getTime();
      const status: CellStatus = isFuture
        ? "future"
        : count > 0
          ? "filled"
          : "missed";
      return { date: dateStr, status, count };
    });
    return {
      templateCode: tpl.code,
      templateName: tpl.name,
      cells,
    };
  });

  // Сортируем: проблемные журналы (больше missed-дней) сверху —
  // менеджер сразу видит worst offenders.
  rows.sort((a, b) => {
    const am = a.cells.filter((c) => c.status === "missed").length;
    const bm = b.cells.filter((c) => c.status === "missed").length;
    return bm - am;
  });

  return { rows, days };
}

/**
 * Агрегат: для каждого шаблона — заполняемость по дням недели за
 * последние 8 недель. Помогает увидеть «у нас завал по health_check
 * каждый понедельник» одним взглядом.
 *
 * Строки = шаблоны (отсортированы по проблемности — больше пропусков сверху).
 * Колонки = дни недели (Пн..Вс).
 * Ячейка = % дней-этого-дня-недели когда был хоть один entry.
 */
export type WeekdayHeatmapRow = {
  templateCode: string;
  templateName: string;
  cells: Array<{ weekday: number; pct: number; sampleSize: number }>;
};

const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const;

export async function getWeekdayHeatmap(
  organizationId: string,
  weeksBack: number = 8,
  refDate: Date = new Date(),
  options: { buildingId?: string | null } = {}
): Promise<{ rows: WeekdayHeatmapRow[]; weekdayLabels: typeof WEEKDAY_LABELS }> {
  const todayStart = new Date(refDate);
  todayStart.setUTCHours(0, 0, 0, 0);
  const periodStart = new Date(todayStart);
  periodStart.setUTCDate(periodStart.getUTCDate() - weeksBack * 7);

  const [organization, templates, fieldEntries, docEntries] = await Promise.all(
    [
      db.organization.findUnique({
        where: { id: organizationId },
        select: { disabledJournalCodes: true },
      }),
      db.journalTemplate.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: "asc" },
        select: { id: true, code: true, name: true },
      }),
      db.journalEntry.findMany({
        where: {
          organizationId,
          createdAt: { gte: periodStart, lte: todayStart },
        },
        select: { templateId: true, createdAt: true },
      }),
      db.journalDocumentEntry.findMany({
        where: {
          document: { organizationId, ...buildingWhere(options.buildingId) },
          date: { gte: periodStart, lte: todayStart },
          ...NOT_AUTO_SEEDED,
        },
        select: {
          date: true,
          document: { select: { templateId: true } },
        },
      }),
    ]
  );

  const disabledSet = parseDisabledCodes(organization?.disabledJournalCodes);
  // Журналы по алфавиту: ниже строки ранжируются по пропускам (сортировка
  // устойчивая), и при равных пропусках идут по алфавиту.
  const activeTemplates = sortJournalsByName(
    templates.filter((t) => !disabledSet.has(t.code)),
    (t) => t.name
  );

  // [templateId][weekday(0=Пн..6=Вс)] → Set<dateKey>
  const filledByTemplate = new Map<string, Map<number, Set<string>>>();
  function bump(templateId: string, dt: Date) {
    if (!activeTemplates.find((t) => t.id === templateId)) return;
    const dateStr = dt.toISOString().slice(0, 10);
    const jsDay = dt.getUTCDay(); // 0=Sun..6=Sat
    const weekday = (jsDay + 6) % 7; // 0=Mon..6=Sun
    let perTpl = filledByTemplate.get(templateId);
    if (!perTpl) {
      perTpl = new Map();
      filledByTemplate.set(templateId, perTpl);
    }
    let dates = perTpl.get(weekday);
    if (!dates) {
      dates = new Set();
      perTpl.set(weekday, dates);
    }
    dates.add(dateStr);
  }
  for (const e of fieldEntries) bump(e.templateId, e.createdAt);
  for (const e of docEntries) bump(e.document.templateId, e.date);

  // Sample size — сколько раз каждый день недели прошёл за период.
  // weeksBack полных недель + остатки на текущей.
  const sampleByWeekday = new Map<number, number>();
  for (let i = 0; i < weeksBack * 7; i++) {
    const d = new Date(periodStart);
    d.setUTCDate(d.getUTCDate() + i);
    if (d > todayStart) break;
    const jsDay = d.getUTCDay();
    const weekday = (jsDay + 6) % 7;
    sampleByWeekday.set(weekday, (sampleByWeekday.get(weekday) ?? 0) + 1);
  }

  const rows: WeekdayHeatmapRow[] = activeTemplates.map((tpl) => {
    const perTpl = filledByTemplate.get(tpl.id);
    const cells = WEEKDAY_LABELS.map((_, weekday) => {
      const sampleSize = sampleByWeekday.get(weekday) ?? 0;
      const filled = perTpl?.get(weekday)?.size ?? 0;
      const pct = sampleSize === 0 ? 0 : Math.round((filled / sampleSize) * 100);
      return { weekday, pct, sampleSize };
    });
    return {
      templateCode: tpl.code,
      templateName: tpl.name,
      cells,
    };
  });

  // Sort: сначала шаблоны с самым низким средним пропуском.
  rows.sort((a, b) => {
    const avgA = a.cells.reduce((s, c) => s + c.pct, 0) / a.cells.length;
    const avgB = b.cells.reduce((s, c) => s + c.pct, 0) / b.cells.length;
    return avgA - avgB;
  });

  return { rows, weekdayLabels: WEEKDAY_LABELS };
}
