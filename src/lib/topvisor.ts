/**
 * Клиент Topvisor API v2 — семантика и позиции проекта wesetup.ru.
 *
 * Спека: docs/superpowers/specs/2026-09-09-topvisor-integration-design.md
 *
 * Три особенности API, из-за которых наивный клиент молча ломается:
 *
 * 1. Topvisor отвечает **HTTP 200 даже на ошибку**. `res.ok` не значит
 *    ничего, единственный признак — непустой `errors[]`. Поэтому весь
 *    разбор идёт через `unwrap`, а не через статус.
 * 2. Методы записи в `keywords_2` принимают **только form-encoded**
 *    (`add/keywords_2/keywords` отвечает 2000 Invalid Content-Type на
 *    application/json). Читающие методы принимают JSON. Отсюда флаг
 *    `form` у `tvRequest`.
 * 3. Позиция приходит **строкой**, а «не в выдаче» — это `"--"`.
 *    Наивный Number() дал бы NaN в матрице.
 */

const API = "https://api.topvisor.com/v2/json/";

export class TopvisorError extends Error {
  constructor(
    readonly code: number,
    message: string
  ) {
    super(message);
    this.name = "TopvisorError";
  }
}

/** Конверт ответа Topvisor: result + errors, оба могут быть непустыми. */
type Envelope<T> = {
  result?: T | null;
  errors?: Array<{ code?: number; string?: string }> | null;
};

/**
 * Достаёт result из конверта, превращая errors[] в исключение.
 *
 * Вынесено отдельно от сети, чтобы поведение на ошибочном конверте
 * можно было проверить тестом без HTTP.
 */
export function unwrap<T>(body: unknown): T {
  const envelope = (body ?? {}) as Envelope<T>;
  const errors = envelope.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const first = errors[0] ?? {};
    const cleanMessage = (first.string || "Неизвестная ошибка Topvisor")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    throw new TopvisorError(
      typeof first.code === "number" ? first.code : 0,
      cleanMessage
    );
  }
  return (envelope.result ?? null) as T;
}

function config() {
  const key = (process.env.TOPVISOR_API_KEY ?? "").trim();
  const userId = (process.env.TOPVISOR_USER_ID ?? "").trim();
  const projectId = Number((process.env.TOPVISOR_PROJECT_ID ?? "").trim());
  if (!key || !userId || !Number.isFinite(projectId) || projectId <= 0) {
    throw new TopvisorError(
      0,
      "Topvisor не настроен: нужны TOPVISOR_API_KEY, TOPVISOR_USER_ID и TOPVISOR_PROJECT_ID"
    );
  }
  return { key, userId, projectId };
}

/** Идентификатор проекта из окружения — для роутов и скриптов. */
export function topvisorProjectId(): number {
  return config().projectId;
}

/** Настроена ли интеграция — чтобы UI показал понятную заглушку, а не падал. */
export function isTopvisorConfigured(): boolean {
  try {
    config();
    return true;
  } catch {
    return false;
  }
}

type RequestOptions = {
  /**
   * Слать form-encoded вместо JSON. Обязательно для
   * add/keywords_2/keywords — он отвергает application/json.
   */
  form?: boolean;
};

async function tvRequest<T>(
  method: string,
  payload: Record<string, unknown>,
  options: RequestOptions = {}
): Promise<T> {
  const { key, userId } = config();

  let body: string;
  let contentType: string;
  if (options.form) {
    const params = new URLSearchParams();
    for (const [name, value] of Object.entries(payload)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const item of value) params.append(`${name}[]`, String(item));
      } else {
        params.append(name, String(value));
      }
    }
    body = params.toString();
    contentType = "application/x-www-form-urlencoded";
  } else {
    body = JSON.stringify(payload);
    contentType = "application/json";
  }

  const response = await fetch(API + method, {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      "User-Id": userId,
      Authorization: `bearer ${key}`,
    },
    body,
    cache: "no-store",
  });

  // Сознательно НЕ проверяем response.ok: Topvisor кладёт ошибку в тело
  // с кодом 200. Транспортные сбои ловим отдельно ниже.
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TopvisorError(
      response.status,
      `Topvisor вернул не JSON (HTTP ${response.status})`
    );
  }
  return unwrap<T>(parsed);
}

/** Фильтр Topvisor — один формат на все методы записи. */
function idFilter(ids: number[]) {
  return [{ name: "id", operator: "EQUALS", values: ids }];
}

// Регионы живут в `topvisor-regions.ts` — этот модуль читает секреты и
// ходит в сеть, поэтому клиентским компонентам его импортировать нельзя.

type RawProjectRegion = {
  index?: number | string;
  key?: number | string;
  id?: number | string;
  name?: string;
  areaName?: string;
  enabled?: number | string | boolean;
};

type RawProjectSearcher = {
  key?: number | string;
  searcher?: number | string;
  searcher_key?: number | string;
  name?: string;
  enabled?: number | string | boolean;
  regions?: RawProjectRegion[] | null;
};

type RawProjectWithRegions = {
  id?: number | string;
  searchers?: RawProjectSearcher[] | null;
};

const LOGICAL_REGION_SLOTS: Record<
  number,
  { searcher: "yandex" | "google"; regionKey: number; namePattern: RegExp }
> = {
  1: { searcher: "yandex", regionKey: 213, namePattern: /москв|moscow/i },
  5: { searcher: "yandex", regionKey: 225, namePattern: /росси|russia/i },
  2: { searcher: "google", regionKey: 213, namePattern: /москв|moscow/i },
  7: { searcher: "google", regionKey: 225, namePattern: /росси|russia/i },
};

function detectSearcherKind(
  searcher: RawProjectSearcher
): "yandex" | "google" | null {
  const rawKey =
    searcher.key ?? searcher.searcher_key ?? searcher.searcher ?? null;
  const numKey = rawKey !== null && rawKey !== "" ? Number(rawKey) : NaN;
  if (numKey === 0) return "yandex";
  if (numKey === 1) return "google";
  const name = (searcher.name ?? "").trim();
  if (/yandex|яндекс/i.test(name)) return "yandex";
  if (/google/i.test(name)) return "google";
  return null;
}

/**
 * Сопоставляет логические слоты из `topvisor-regions.ts` (1, 5, 2, 7)
 * с реальными `region.index` проекта в Topvisor из `get/projects_2/projects`
 * (`show_searchers_and_regions: 2`). Если в проекте регионы были
 * пересозданы или идут в другом порядке, их внутренние `index`
 * отличаются от зашитых констант, из-за чего `checker/price` возвращает 0 ₽,
 * а `checker/go` падает с ошибкой «Укажите поисковые системы и регионы».
 */
export function mapLogicalRegionsToProject(
  requestedIndexes: number[],
  searchersRaw: unknown
): number[] {
  if (!Array.isArray(searchersRaw) || searchersRaw.length === 0) {
    return requestedIndexes;
  }

  const entries: Array<{
    index: number;
    searcherKind: "yandex" | "google" | null;
    regionKey: number | null;
    regionName: string;
    enabled: boolean;
  }> = [];

  for (const item of searchersRaw as RawProjectSearcher[]) {
    if (!item || typeof item !== "object") continue;
    const searcherKind = detectSearcherKind(item);
    const searcherEnabled =
      item.enabled === undefined ||
      item.enabled === 1 ||
      item.enabled === "1" ||
      item.enabled === true;

    for (const region of item.regions ?? []) {
      if (!region || typeof region !== "object") continue;
      const idx = Number(region.index);
      if (!Number.isFinite(idx) || idx <= 0) continue;
      const rawKey = region.key ?? region.id ?? null;
      const numKey = rawKey !== null && rawKey !== "" ? Number(rawKey) : NaN;
      const regionEnabled =
        searcherEnabled &&
        (region.enabled === undefined ||
          region.enabled === 1 ||
          region.enabled === "1" ||
          region.enabled === true);
      entries.push({
        index: idx,
        searcherKind,
        regionKey: Number.isFinite(numKey) ? numKey : null,
        regionName: `${region.name ?? ""} ${region.areaName ?? ""}`.trim(),
        enabled: regionEnabled,
      });
    }
  }

  if (entries.length === 0) return requestedIndexes;

  const resolved: number[] = [];
  for (const requested of requestedIndexes) {
    const slot = LOGICAL_REGION_SLOTS[requested];
    if (slot) {
      const match =
        entries.find(
          (e) =>
            e.enabled &&
            e.searcherKind === slot.searcher &&
            (e.regionKey === slot.regionKey ||
              slot.namePattern.test(e.regionName))
        ) ??
        entries.find(
          (e) =>
            e.searcherKind === slot.searcher &&
            (e.regionKey === slot.regionKey ||
              slot.namePattern.test(e.regionName))
        );
      if (match) {
        resolved.push(match.index);
        continue;
      }
    }

    const direct = entries.find((e) => e.index === requested);
    if (direct) {
      resolved.push(direct.index);
    }
  }

  if (resolved.length > 0) {
    return [...new Set(resolved)];
  }

  const enabledYandex = entries
    .filter((e) => e.enabled && e.searcherKind === "yandex")
    .map((e) => e.index);
  if (enabledYandex.length > 0) {
    return [...new Set(enabledYandex)];
  }

  const allEnabled = entries.filter((e) => e.enabled).map((e) => e.index);
  return allEnabled.length > 0 ? [...new Set(allEnabled)] : requestedIndexes;
}

let cachedSearchers: {
  projectId: number;
  expiresAt: number;
  data: unknown;
} | null = null;

async function resolveProjectRegionIndexes(
  requestedIndexes: number[]
): Promise<number[]> {
  const { projectId } = config();
  const now = Date.now();
  if (
    !cachedSearchers ||
    cachedSearchers.projectId !== projectId ||
    cachedSearchers.expiresAt < now
  ) {
    try {
      const projects = await tvRequest<RawProjectWithRegions[]>(
        "get/projects_2/projects",
        {
          filters: idFilter([projectId]),
          show_searchers_and_regions: 2,
        }
      );
      const project = Array.isArray(projects)
        ? (projects.find((p) => Number(p?.id) === projectId) ?? projects[0])
        : null;
      cachedSearchers = {
        projectId,
        expiresAt: now + 60_000,
        data: project?.searchers ?? null,
      };
    } catch {
      return requestedIndexes;
    }
  }
  return mapLogicalRegionsToProject(requestedIndexes, cachedSearchers.data);
}

// ─────────────────────────── семантика ───────────────────────────

export type TopvisorGroup = { id: number; name: string };

export type TopvisorKeyword = {
  id: number;
  name: string;
  target: string;
  group_id: number;
};

export async function listGroups(): Promise<TopvisorGroup[]> {
  const { projectId } = config();
  return (
    (await tvRequest<TopvisorGroup[]>("get/keywords_2/groups", {
      project_id: projectId,
    })) ?? []
  );
}

export async function listKeywords(): Promise<TopvisorKeyword[]> {
  const { projectId } = config();
  return (
    (await tvRequest<TopvisorKeyword[]>("get/keywords_2/keywords", {
      project_id: projectId,
      fields: ["id", "name", "target", "group_id"],
    })) ?? []
  );
}

/**
 * Добавляет одну фразу. Массового импорта нет: документированный
 * add/keywords_2/keywords/import трактует `keywords` как список имён по
 * строкам, а не как CSV, и превращает заголовок и запятые в имена фраз.
 */
export async function addKeyword(input: {
  name: string;
  groupId: number;
  target?: string;
}): Promise<{ id: number; name: string }> {
  const { projectId } = config();
  return await tvRequest<{ id: number; name: string }>(
    "add/keywords_2/keywords",
    {
      project_id: projectId,
      to_id: input.groupId,
      name: input.name,
      target: input.target ?? "",
    },
    { form: true }
  );
}

export async function deleteKeywords(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { projectId } = config();
  const deleted = await tvRequest<number>("del/keywords_2/keywords", {
    project_id: projectId,
    filters: idFilter(ids),
  });
  return typeof deleted === "number" ? deleted : 0;
}

// ─────────────────────────── позиции ───────────────────────────

/** Сырой ответ get/positions_2/history — только те поля, что мы читаем. */
type RawHistory = {
  headers?: { dates?: string[] } | null;
  keywords?: Array<{
    name?: string;
    positionsData?: Record<
      string,
      { position?: string; relevant_url?: string } | undefined
    > | null;
  }> | null;
  existsDates?: string[] | null;
};

export type PositionCell = {
  /** Позиция в выдаче; null — фразы нет в ТОП глубины съёма. */
  position: number | null;
  /** Страница, которой поисковик ответил на запрос. */
  url: string | null;
};

export type PositionRow = {
  phrase: string;
  /** Последняя известная страница — для связки с блогом. */
  latestUrl: string | null;
  /** Позиция на самую свежую дату, где она вообще есть. */
  latest: number | null;
  /** Изменение относительно самой ранней даты окна: + это рост. */
  delta: number | null;
  byDate: Record<string, PositionCell>;
};

export type PositionMatrix = {
  /** Даты по убыванию — свежая первая, как их отдаёт Topvisor. */
  dates: string[];
  rows: PositionRow[];
  existsDates: string[];
};

/**
 * Разбирает позицию: Topvisor отдаёт её строкой, а «не в выдаче» — как
 * `"--"`. Всё нечисловое считаем отсутствием позиции, а не нулём.
 */
export function parsePosition(raw: string | undefined | null): number | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "--") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Разбирает составной ключ positionsData: `<дата>:<project_id>:<region>`.
 * Порядок вставки в объект не гарантирован, поэтому дату берём из ключа,
 * а не из позиции в списке.
 */
export function parsePositionKey(key: string): {
  date: string;
  projectId: number;
  regionIndex: number;
} | null {
  const parts = key.split(":");
  if (parts.length !== 3) return null;
  const [date, projectId, regionIndex] = parts;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const project = Number(projectId);
  const region = Number(regionIndex);
  if (!Number.isFinite(project) || !Number.isFinite(region)) return null;
  return { date, projectId: project, regionIndex: region };
}

/**
 * Превращает сырой ответ истории в матрицу «фраза × дата».
 *
 * Даты берём из headers, но подстраховываемся ключами positionsData:
 * при `show_headers: 0` headers приходит null, и без подстраховки
 * матрица оказалась бы пустой при живых данных.
 */
export function buildMatrix(raw: unknown): PositionMatrix {
  const history = (raw ?? {}) as RawHistory;
  const fromHeaders = Array.isArray(history.headers?.dates)
    ? history.headers!.dates!.slice()
    : [];

  const seenDates = new Set<string>(fromHeaders);
  const rows: PositionRow[] = [];

  for (const keyword of history.keywords ?? []) {
    const phrase = (keyword?.name ?? "").trim();
    if (!phrase) continue;

    const byDate: Record<string, PositionCell> = {};
    for (const [key, cell] of Object.entries(keyword.positionsData ?? {})) {
      const parsed = parsePositionKey(key);
      if (!parsed) continue;
      seenDates.add(parsed.date);
      byDate[parsed.date] = {
        position: parsePosition(cell?.position),
        url: (cell?.relevant_url ?? "").trim() || null,
      };
    }
    rows.push({ phrase, latestUrl: null, latest: null, delta: null, byDate });
  }

  // По убыванию: свежая дата первой — так же, как отдаёт Topvisor.
  const dates = [...seenDates].sort().reverse();

  for (const row of rows) {
    const withData = dates.filter((d) => row.byDate[d]?.position != null);
    const newest = withData[0];
    const oldest = withData[withData.length - 1];
    row.latest = newest ? row.byDate[newest].position : null;
    row.latestUrl = newest ? row.byDate[newest].url : null;
    // Рост позиции — это уменьшение числа, поэтому знак переворачиваем:
    // из 17-го в 8-е это delta +9, а не −9.
    row.delta =
      newest && oldest && newest !== oldest
        ? (row.byDate[oldest].position ?? 0) - (row.byDate[newest].position ?? 0)
        : null;
  }

  return {
    dates,
    rows,
    existsDates: Array.isArray(history.existsDates) ? history.existsDates : [],
  };
}

export type PositionSummary = {
  top3: number;
  top10: number;
  top50: number;
  outside: number;
  tracked: number;
};

/**
 * Сводка ТОП-3/10/50 на дату. Считаем сами: Topvisor отдаёт `tops: null`
 * даже с show_tops, а отдельный запрос ради этого не нужен.
 */
export function summarize(
  matrix: PositionMatrix,
  date?: string
): PositionSummary {
  const target = date ?? matrix.dates[0];
  const summary: PositionSummary = {
    top3: 0,
    top10: 0,
    top50: 0,
    outside: 0,
    tracked: matrix.rows.length,
  };
  if (!target) return summary;

  for (const row of matrix.rows) {
    const position = row.byDate[target]?.position ?? null;
    if (position == null) {
      summary.outside += 1;
      continue;
    }
    if (position <= 3) summary.top3 += 1;
    if (position <= 10) summary.top10 += 1;
    if (position <= 50) summary.top50 += 1;
    else if (position > 50) summary.outside += 1;
  }
  return summary;
}

export async function getPositionsHistory(input: {
  regionIndex: number;
  dateFrom: string;
  dateTo: string;
}): Promise<PositionMatrix> {
  const { projectId } = config();
  const resolved = await resolveProjectRegionIndexes([input.regionIndex]);
  const targetRegion = resolved[0] ?? input.regionIndex;
  const raw = await tvRequest<unknown>("get/positions_2/history", {
    project_id: projectId,
    regions_indexes: [targetRegion],
    date1: input.dateFrom,
    date2: input.dateTo,
    positions_fields: ["position", "relevant_url"],
    show_headers: 1,
    show_exists_dates: 1,
  });
  return buildMatrix(raw);
}

// ─────────────────────────── съём позиций ───────────────────────────

function extractCheckerPrice(
  result: { pricesByUsers?: Record<string, { price?: number }> | null } | null,
  userId: string
): number {
  const byUser = result?.pricesByUsers?.[userId]?.price;
  if (typeof byUser === "number" && byUser > 0) return byUser;
  for (const entry of Object.values(result?.pricesByUsers ?? {})) {
    if (typeof entry?.price === "number" && entry.price > 0) {
      return entry.price;
    }
  }
  return typeof byUser === "number" ? byUser : 0;
}

/**
 * Цена съёма до его запуска — чтобы кнопка показывала сумму, а не
 * списывала деньги молча. 0,09 ₽ за пару «фраза × регион».
 */
export async function getCheckerPrice(regionIndexes: number[]): Promise<number> {
  const { projectId, userId } = config();
  const resolved = await resolveProjectRegionIndexes(regionIndexes);
  const result = await tvRequest<{
    pricesByUsers?: Record<string, { price?: number }>;
  }>("get/positions_2/checker/price", {
    filters: idFilter([projectId]),
    regions_indexes: resolved,
  });
  const price = extractCheckerPrice(result, userId);
  if (price > 0) return price;

  // Подстраховка: если фильтр по regions_indexes дал 0 ₽ при включённых
  // регионах в проекте, спрашиваем цену по всем активным регионам проекта.
  const fallback = await tvRequest<{
    pricesByUsers?: Record<string, { price?: number }>;
  }>("get/positions_2/checker/price", {
    filters: idFilter([projectId]),
  });
  return extractCheckerPrice(fallback, userId);
}

function hasQueuedProjects(
  result: { projectsIds?: unknown; projectIds?: unknown } | null
): boolean {
  const list = result?.projectsIds ?? result?.projectIds;
  return Array.isArray(list) && list.length > 0;
}

/** Ставит проверку позиций в очередь. Тратит деньги — вызывать только явно. */
export async function runChecker(regionIndexes: number[]): Promise<boolean> {
  const { projectId } = config();
  const resolved = await resolveProjectRegionIndexes(regionIndexes);
  try {
    const result = await tvRequest<{
      projectsIds?: number[];
      projectIds?: number[];
    }>("edit/positions_2/checker/go", {
      filters: idFilter([projectId]),
      regions_indexes: resolved,
    });
    if (hasQueuedProjects(result)) return true;
  } catch (error) {
    // Если конкретные region_index не совпали с активными регионами проекта,
    // запускаем проверку по всем включённым в проекте регионам без фильтра.
    if (!(error instanceof TopvisorError)) throw error;
  }

  const fallback = await tvRequest<{
    projectsIds?: number[];
    projectIds?: number[];
  }>("edit/positions_2/checker/go", {
    filters: idFilter([projectId]),
  });
  return hasQueuedProjects(fallback);
}
