import {
  buildDateKeys,
  coerceUtcDate,
  formatMonthLabel,
  isWeekend,
  toDateKey,
} from "@/lib/hygiene-document";

export const CLIMATE_DOCUMENT_TEMPLATE_CODE = "climate_control";
export const CLIMATE_DOCUMENT_TITLE =
  "Бланк контроля температуры и влажности на складах";

/**
 * Журнал ведётся ТОЛЬКО по складским помещениям, где хранятся продукты:
 * сухие склады, кладовые бакалеи, овощные склады и цеха. В обеденном
 * зале, гардеробе и коридорах он не нужен — требование СанПиН
 * 2.3/2.4.4282-26 касается мест хранения пищевых продуктов. Название с
 * уточнением «на складах» стоит именно затем, чтобы заведение не заносило
 * сюда все помещения подряд.
 */
export const CLIMATE_SCOPE_HINT =
  "Только складские помещения с продуктами: сухие склады, кладовые бакалеи, овощные склады и цеха. Обеденный зал, гардероб и коридоры сюда не вносят.";

/**
 * Периодичность по регламенту — раз в день, в первой половине дня.
 * Пропущенный день при проверке трактуется как невыполнение контроля.
 */
export const CLIMATE_FREQUENCY_HINT =
  "Раз в день, в первой половине дня. Пропуск дня — нарушение при проверке.";

export const DEFAULT_CLIMATE_CONTROL_TIMES = ["10:00"] as const;
export const DEFAULT_CLIMATE_ROOM_NAME = "Сухой склад";

export type ClimateMetricConfig = {
  enabled: boolean;
  min: number | null;
  max: number | null;
};

export type ClimateRoomConfig = {
  id: string;
  name: string;
  temperature: ClimateMetricConfig;
  humidity: ClimateMetricConfig;
  /**
   * 2026-09-04: связь со справочником помещений (Room.id,
   * /settings/buildings). Если задана и помещение живо — имя и нормы
   * берутся из Room (см. applyRoomDirectoryToClimateConfig); поля здесь
   * остаются снапшотом на случай удаления помещения. Ключи
   * `measurements[id]` при этом НЕ меняются.
   */
  roomId?: string;
};

/** Нормы климата помещения — хранятся в Room.climateNorms. */
export type ClimateRoomNorms = {
  temperature: ClimateMetricConfig;
  humidity: ClimateMetricConfig;
};

export const DEFAULT_CLIMATE_TEMPERATURE: ClimateMetricConfig = {
  enabled: true,
  min: 18,
  max: 25,
};
export const DEFAULT_CLIMATE_HUMIDITY: ClimateMetricConfig = {
  enabled: true,
  min: 15,
  max: 75,
};

/** Помещение из справочника (Room) — минимум для климата. */
export type ClimateDirectoryRoom = {
  id: string;
  name: string;
  climateNorms?: unknown;
};

export type ClimateDocumentConfig = {
  rooms: ClimateRoomConfig[];
  controlTimes: string[];
  skipWeekends: boolean;
};

export type ClimateMeasurement = {
  temperature: number | null;
  humidity: number | null;
};

export type ClimateEntryData = {
  responsibleTitle: string | null;
  measurements: Record<string, Record<string, ClimateMeasurement>>;
  /**
   * Комментарии к отклонениям: что сделали, когда показатель вышел за
   * норму. Ключ — `roomId:time:metric`, чтобы комментарий держался за
   * конкретный замер, а не за строку целиком: в одном дне может выйти
   * из нормы и температура утром, и влажность вечером.
   */
  corrections?: Record<string, string>;
};

export type ClimateMetricKind = "temperature" | "humidity";

/** Ключ комментария к отклонению. Один на замер. */
export function climateCorrectionKey(
  roomId: string,
  time: string,
  metric: ClimateMetricKind,
): string {
  return `${roomId}:${time}:${metric}`;
}

export type ClimateDeviation = {
  key: string;
  rowId: string;
  date: string;
  time: string;
  roomId: string;
  roomName: string;
  metric: ClimateMetricKind;
  value: number;
  min: number | null;
  max: number | null;
  comment: string;
};

/** Значение вне нормы. Пустое значение отклонением не считается — его просто ещё не внесли. */
export function isClimateValueOutOfRange(
  value: number | null | undefined,
  metric: ClimateMetricConfig,
): boolean {
  if (value === null || value === undefined) return false;
  if (!metric.enabled) return false;
  if (metric.min !== null && value < metric.min) return true;
  if (metric.max !== null && value > metric.max) return true;
  return false;
}

/**
 * Все отклонения документа — из тех же данных, что и таблица.
 *
 * Считается на лету, а не хранится: поэтому исправленное значение убирает
 * строку из корректирующих действий сразу, без перезагрузки страницы, а
 * заново вышедшее за норму — возвращает.
 */
/**
 * Сколько внесённых замеров пропадёт, если убрать помещение из документа.
 * Нужно для подтверждения удаления: раньше удаление молча вычищало
 * значения во всех днях периода.
 */
export function countClimateRoomValues(
  entries: Array<{ data: { measurements?: Record<string, Record<string, ClimateMeasurement>> } }>,
  roomId: string
): number {
  let total = 0;
  for (const entry of entries) {
    const byTime = entry.data?.measurements?.[roomId];
    if (!byTime) continue;
    for (const measurement of Object.values(byTime)) {
      if (typeof measurement?.temperature === "number") total += 1;
      if (typeof measurement?.humidity === "number") total += 1;
    }
  }
  return total;
}

/**
 * Сколько заполненных значений исчезнет, если убрать время контроля:
 * замеры хранятся по ключу времени, и удаление времени из настроек
 * выкидывает весь его столбец по всем помещениям и дням.
 */
export function countClimateTimeValues(
  entries: Array<{ data: { measurements?: Record<string, Record<string, ClimateMeasurement>> } }>,
  time: string
): number {
  let total = 0;
  for (const entry of entries) {
    const byRoom = entry.data?.measurements;
    if (!byRoom) continue;
    for (const byTime of Object.values(byRoom)) {
      const measurement = byTime?.[time];
      if (!measurement) continue;
      if (typeof measurement.temperature === "number") total += 1;
      if (typeof measurement.humidity === "number") total += 1;
    }
  }
  return total;
}

export function collectClimateDeviations(
  config: ClimateDocumentConfig,
  rows: Array<{ id: string; date: string; data: ClimateEntryData }>,
): ClimateDeviation[] {
  const result: ClimateDeviation[] = [];

  for (const row of rows) {
    for (const room of config.rooms) {
      for (const time of config.controlTimes) {
        const cell = row.data.measurements?.[room.id]?.[time];
        if (!cell) continue;

        const checks: Array<[ClimateMetricKind, ClimateMetricConfig, number | null]> = [
          ["temperature", room.temperature, cell.temperature],
          ["humidity", room.humidity, cell.humidity],
        ];

        for (const [metric, limits, value] of checks) {
          if (!isClimateValueOutOfRange(value, limits)) continue;
          const key = climateCorrectionKey(room.id, time, metric);
          result.push({
            key: `${row.id}:${key}`,
            rowId: row.id,
            date: row.date,
            time,
            roomId: room.id,
            roomName: room.name,
            metric,
            value: value as number,
            min: limits.min,
            max: limits.max,
            comment: row.data.corrections?.[key] ?? "",
          });
        }
      }
    }
  }

  return result;
}

function createId(prefix: string) {
  const randomPart =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  return `${prefix}-${randomPart}`;
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeMetric(value: unknown, fallback: ClimateMetricConfig): ClimateMetricConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }

  const record = value as Record<string, unknown>;

  return {
    enabled:
      typeof record.enabled === "boolean" ? record.enabled : fallback.enabled,
    min: normalizeNumber(record.min),
    max: normalizeNumber(record.max),
  };
}

export function createClimateRoomConfig(
  overrides: Partial<ClimateRoomConfig> = {}
): ClimateRoomConfig {
  const roomId =
    typeof overrides.roomId === "string" && overrides.roomId.trim() !== ""
      ? overrides.roomId
      : undefined;
  return {
    id: overrides.id || createId("room"),
    name: overrides.name?.trim() || DEFAULT_CLIMATE_ROOM_NAME,
    temperature: normalizeMetric(overrides.temperature, DEFAULT_CLIMATE_TEMPERATURE),
    humidity: normalizeMetric(overrides.humidity, DEFAULT_CLIMATE_HUMIDITY),
    ...(roomId ? { roomId } : {}),
  };
}

/**
 * Room.climateNorms → нормы. null, если в справочнике нормы не заданы
 * (документ климата тогда использует дефолт / свой снапшот).
 */
export function normalizeClimateRoomNorms(raw: unknown): ClimateRoomNorms | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (!record.temperature && !record.humidity) return null;
  return {
    temperature: normalizeMetric(record.temperature, DEFAULT_CLIMATE_TEMPERATURE),
    humidity: normalizeMetric(record.humidity, DEFAULT_CLIMATE_HUMIDITY),
  };
}

/** Стабильный id строки документа для помещения справочника. */
export function climateRowIdForRoom(roomId: string): string {
  return `room-${roomId}`;
}

/** Строка документа климата из помещения справочника. */
export function climateRoomFromDirectory(room: ClimateDirectoryRoom): ClimateRoomConfig {
  const norms = normalizeClimateRoomNorms(room.climateNorms);
  return createClimateRoomConfig({
    id: climateRowIdForRoom(room.id),
    roomId: room.id,
    name: room.name,
    temperature: norms?.temperature,
    humidity: norms?.humidity,
  });
}

/**
 * Пре-заполняет конфиг климата помещениями справочника (Room).
 * Пусто — дефолтная одна комната.
 */
export function buildClimateConfigFromRooms(
  rooms: ClimateDirectoryRoom[]
): ClimateDocumentConfig {
  if (rooms.length === 0) return getDefaultClimateDocumentConfig();
  return {
    rooms: rooms.map((room) => climateRoomFromDirectory(room)),
    controlTimes: [...DEFAULT_CLIMATE_CONTROL_TIMES],
    skipWeekends: false,
  };
}

/**
 * Эффективный конфиг: для строк с `roomId` имя и нормы берутся из
 * справочника (Room wins), если помещение живо. Строки без связи или с
 * удалённым помещением остаются как есть. Ключи строк не меняются.
 * Результат — только для отображения/резолверов; в документ пишется
 * raw-конфиг (см. cleaning-room-responsibles — тот же принцип).
 */
export function applyRoomDirectoryToClimateConfig(
  config: ClimateDocumentConfig,
  rooms: ReadonlyArray<ClimateDirectoryRoom>
): ClimateDocumentConfig {
  const byId = new Map(rooms.map((r) => [r.id, r]));
  return {
    ...config,
    rooms: config.rooms.map((row) => {
      if (!row.roomId) return row;
      const dbRoom = byId.get(row.roomId);
      if (!dbRoom) return row;
      const norms = normalizeClimateRoomNorms(dbRoom.climateNorms);
      return {
        ...row,
        name: dbRoom.name.trim() || row.name,
        ...(norms ? { temperature: norms.temperature, humidity: norms.humidity } : {}),
      };
    }),
  };
}

/**
 * Помещения справочника, которых ещё нет в документе (для пикера
 * «Добавить помещение из справочника»).
 */
export function listClimateRoomsNotInDocument(
  config: Pick<ClimateDocumentConfig, "rooms">,
  rooms: ReadonlyArray<ClimateDirectoryRoom>
): ClimateDirectoryRoom[] {
  const linked = new Set(config.rooms.map((r) => r.roomId).filter(Boolean));
  return rooms.filter((r) => !linked.has(r.id));
}

/**
 * Ленивое сопоставление строки без `roomId` с помещением справочника по
 * имени (без регистра). Используется для подсказки «Связать» — без
 * автозаписи.
 */
export function suggestDirectoryRoomForClimateRow(
  row: Pick<ClimateRoomConfig, "name" | "roomId">,
  rooms: ReadonlyArray<ClimateDirectoryRoom>
): ClimateDirectoryRoom | null {
  if (row.roomId) return null;
  const needle = row.name.trim().toLowerCase();
  if (!needle) return null;
  return rooms.find((r) => r.name.trim().toLowerCase() === needle) ?? null;
}

export function getClimateDocumentTitle() {
  return CLIMATE_DOCUMENT_TITLE;
}

export function getClimateCreatePeriodBounds(referenceDate = new Date()) {
  const date = coerceUtcDate(referenceDate);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  return {
    dateFrom: `${year}-${String(month + 1).padStart(2, "0")}-01`,
    dateTo: `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function getDefaultClimateDocumentConfig(): ClimateDocumentConfig {
  return {
    // Детерминированный id `room-0` для default-комнаты — иначе при
    // каждом `normalizeClimateDocumentConfig` для документов с
    // пустым `config.rooms` создаётся комната с новым `randomUUID`,
    // и task-fill валится на «expected number, received undefined»
    // (см. b2c7730 + dump БД 2026-04-25).
    rooms: [createClimateRoomConfig({ id: "room-0" })],
    controlTimes: [...DEFAULT_CLIMATE_CONTROL_TIMES],
    skipWeekends: false,
  };
}

/**
 * Пре-заполняет конфиг climate-документа цехами организации.
 * Если у орги нет ни одного `Area` — fallback на дефолтную одну комнату.
 *
 * Каждая комната получает stable id формата `room-area-<slug>` (slug
 * нормализован из имени) — чтобы повторное создание документа не
 * создавало дубликаты row-id'ов в task-fill validator'е.
 */
export function buildClimateConfigFromAreas(
  areas: { id: string; name: string }[]
): ClimateDocumentConfig {
  if (areas.length === 0) return getDefaultClimateDocumentConfig();
  return {
    rooms: areas.map((area, index) =>
      createClimateRoomConfig({
        // Используем area.id чтобы id был стабилен между deploy'ями.
        id: `room-area-${area.id || `idx-${index}`}`,
        name: area.name,
      })
    ),
    controlTimes: [...DEFAULT_CLIMATE_CONTROL_TIMES],
    skipWeekends: false,
  };
}

export function normalizeClimateDocumentConfig(value: unknown): ClimateDocumentConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return getDefaultClimateDocumentConfig();
  }

  const record = value as Record<string, unknown>;
  const times = Array.isArray(record.controlTimes)
    ? record.controlTimes
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

  // Прод-баг: createId() ниже использует randomUUID — при normalize
  // config документа без stable room.id адаптер на каждом запросе
  // получает РАЗНЫЕ uuid, и `t_<roomId>` в форме (load) не совпадает
  // с тем что ожидает validator (submit), → «expected number,
  // received undefined» (см. d484f2d).
  //
  // Лекарство: при отсутствии id в БД назначаем детерминированный
  // `room-<index>` — такой же при любом следующем normalize одного
  // и того же raw config.
  const rooms = Array.isArray(record.rooms)
    ? record.rooms
        .map((room, index) => {
          if (!room || typeof room !== "object" || Array.isArray(room)) return null;
          const roomRecord = room as Record<string, unknown>;
          const rawId =
            typeof roomRecord.id === "string" && roomRecord.id.trim() !== ""
              ? roomRecord.id
              : `room-${index}`;

          return createClimateRoomConfig({
            id: rawId,
            name:
              typeof roomRecord.name === "string" ? roomRecord.name : undefined,
            temperature: normalizeMetric(roomRecord.temperature, DEFAULT_CLIMATE_TEMPERATURE),
            humidity: normalizeMetric(roomRecord.humidity, DEFAULT_CLIMATE_HUMIDITY),
            roomId:
              typeof roomRecord.roomId === "string" ? roomRecord.roomId : undefined,
          });
        })
        .filter((room): room is ClimateRoomConfig => room !== null)
    : [];

  return {
    rooms: rooms.length > 0 ? rooms : getDefaultClimateDocumentConfig().rooms,
    controlTimes: times.length > 0 ? times : [...DEFAULT_CLIMATE_CONTROL_TIMES],
    skipWeekends:
      typeof record.skipWeekends === "boolean" ? record.skipWeekends : false,
  };
}

export function createEmptyClimateEntryData(
  config: ClimateDocumentConfig,
  responsibleTitle: string | null = null
): ClimateEntryData {
  const measurements: Record<string, Record<string, ClimateMeasurement>> = {};

  config.rooms.forEach((room) => {
    measurements[room.id] = {};
    config.controlTimes.forEach((time) => {
      measurements[room.id][time] = {
        temperature: null,
        humidity: null,
      };
    });
  });

  return {
    responsibleTitle,
    measurements,
  };
}

export function normalizeClimateEntryData(value: unknown): ClimateEntryData {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      responsibleTitle: null,
      measurements: {},
    };
  }

  const record = value as Record<string, unknown>;
  const measurementsValue = record.measurements;
  const measurements: Record<string, Record<string, ClimateMeasurement>> = {};

  if (measurementsValue && typeof measurementsValue === "object" && !Array.isArray(measurementsValue)) {
    Object.entries(measurementsValue as Record<string, unknown>).forEach(([roomId, roomValue]) => {
      if (!roomValue || typeof roomValue !== "object" || Array.isArray(roomValue)) return;

      const roomMeasurements: Record<string, ClimateMeasurement> = {};
      Object.entries(roomValue as Record<string, unknown>).forEach(([time, metricValue]) => {
        if (!metricValue || typeof metricValue !== "object" || Array.isArray(metricValue)) {
          roomMeasurements[time] = {
            temperature: null,
            humidity: null,
          };
          return;
        }

        const metricRecord = metricValue as Record<string, unknown>;
        roomMeasurements[time] = {
          temperature: normalizeNumber(metricRecord.temperature),
          humidity: normalizeNumber(metricRecord.humidity),
        };
      });

      measurements[roomId] = roomMeasurements;
    });
  }

  const corrections = normalizeCorrections(record.corrections);

  return {
    responsibleTitle:
      typeof record.responsibleTitle === "string" ? record.responsibleTitle : null,
    measurements,
    ...(corrections ? { corrections } : {}),
  };
}

/**
 * Комментарии к отклонениям проходят через normalize/sync/merge без потерь:
 * иначе ночной автозаполнитель и перезагрузка страницы стирали бы то, что
 * человек написал в «Корректирующих действиях».
 */
function normalizeCorrections(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const corrections: Record<string, string> = {};
  for (const [key, text] of Object.entries(value as Record<string, unknown>)) {
    if (typeof text === "string" && text.trim()) corrections[key] = text;
  }
  return Object.keys(corrections).length ? corrections : undefined;
}

export function getClimatePeriodLabel(dateFrom: Date | string, dateTo: Date | string) {
  return formatMonthLabel(dateFrom, dateTo);
}

export function getClimatePeriodicityText(config: ClimateDocumentConfig) {
  const times = config.controlTimes.filter(Boolean);
  if (times.length === 0) return "Периодичность не настроена";
  if (times.length === 1) return `1 раз в смену: ${times[0]}`;
  return `${times.length} раза в смену: ${times.join(" и ")}`;
}

function hashToUnit(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return (hash % 1000) / 999;
}

function buildGeneratedMetric(
  min: number | null,
  max: number | null,
  seed: string
): number | null {
  if (min == null && max == null) return null;
  if (min != null && max == null) return min;
  if (min == null && max != null) return max;
  if (min === max) return min;

  const low = Math.min(min as number, max as number);
  const high = Math.max(min as number, max as number);
  const unit = hashToUnit(seed);
  return Math.round((low + (high - low) * unit) * 10) / 10;
}

export function buildClimateAutoFillEntryData(params: {
  config: ClimateDocumentConfig;
  dateKey: string;
  responsibleTitle: string | null;
}): ClimateEntryData {
  const { config, dateKey, responsibleTitle } = params;
  const data = createEmptyClimateEntryData(config, responsibleTitle);

  config.rooms.forEach((room) => {
    config.controlTimes.forEach((time) => {
      const seedBase = `${dateKey}:${room.id}:${time}`;
      data.measurements[room.id][time] = {
        temperature: room.temperature.enabled
          ? buildGeneratedMetric(room.temperature.min, room.temperature.max, `${seedBase}:temperature`)
          : null,
        humidity: room.humidity.enabled
          ? buildGeneratedMetric(room.humidity.min, room.humidity.max, `${seedBase}:humidity`)
          : null,
      };
    });
  });

  return data;
}

export function buildClimateAutoFillRows(params: {
  config: ClimateDocumentConfig;
  dateFrom: Date | string;
  dateTo: Date | string;
  responsibleTitle: string | null;
  responsibleUserId: string;
}) {
  const { config, dateFrom, dateTo, responsibleTitle, responsibleUserId } = params;

  return buildDateKeys(dateFrom, dateTo)
    .filter((dateKey) => !(config.skipWeekends && isWeekend(dateKey)))
    .map((dateKey) => ({
      employeeId: responsibleUserId,
      date: new Date(dateKey),
      data: buildClimateAutoFillEntryData({
        config,
        dateKey,
        responsibleTitle,
      }),
    }));
}

export function syncClimateEntryDataWithConfig(
  entryData: ClimateEntryData,
  config: ClimateDocumentConfig
): ClimateEntryData {
  const next = createEmptyClimateEntryData(config, entryData.responsibleTitle);

  config.rooms.forEach((room) => {
    config.controlTimes.forEach((time) => {
      const existing = entryData.measurements[room.id]?.[time];
      next.measurements[room.id][time] = {
        temperature: existing?.temperature ?? null,
        humidity: existing?.humidity ?? null,
      };
    });
  });
  if (entryData.corrections) next.corrections = entryData.corrections;

  return next;
}

/**
 * Перенос замеров при смене времени контроля (`mapping`: старое → новое).
 *
 * Время — структурный ключ `measurements[roomId][time]` и часть ключа
 * комментария `roomId:time:metric`. Раньше смена «10:00» → «09:30» в
 * настройках просто теряла всё, что было внесено под «10:00»: sync с новым
 * конфигом заводил пустой слот. Теперь замеры и комментарии переезжают под
 * новое время; слоты, которых в mapping нет, не трогаем.
 */
export function renameClimateControlTimes(
  entryData: ClimateEntryData,
  mapping: Record<string, string>
): ClimateEntryData {
  const pairs = Object.entries(mapping).filter(([from, to]) => from && to && from !== to);
  if (pairs.length === 0) return entryData;

  const measurements: ClimateEntryData["measurements"] = {};
  Object.entries(entryData.measurements).forEach(([roomId, byTime]) => {
    const nextByTime: Record<string, ClimateMeasurement> = {};
    // Сначала слоты, которых переименование не касается, потом
    // переехавшие — чтобы «10:00 → 14:00» при уже существующем пустом
    // «14:00» не затёрло реальные значения пустыми.
    Object.entries(byTime).forEach(([time, value]) => {
      if (!(time in mapping)) nextByTime[time] = value;
    });
    pairs.forEach(([from, to]) => {
      const moved = byTime[from];
      if (!moved) return;
      const existing = nextByTime[to];
      nextByTime[to] = {
        temperature: moved.temperature ?? existing?.temperature ?? null,
        humidity: moved.humidity ?? existing?.humidity ?? null,
      };
    });
    measurements[roomId] = nextByTime;
  });

  let corrections: Record<string, string> | undefined;
  if (entryData.corrections) {
    corrections = {};
    Object.entries(entryData.corrections).forEach(([key, text]) => {
      // Ключ `roomId:ЧЧ:ММ:metric` — время само содержит двоеточие,
      // поэтому режем по первому и последнему разделителю.
      const first = key.indexOf(":");
      const last = key.lastIndexOf(":");
      if (first < 0 || last <= first) {
        corrections![key] = text;
        return;
      }
      const roomId = key.slice(0, first);
      const time = key.slice(first + 1, last);
      const metric = key.slice(last + 1);
      const to = mapping[time];
      corrections![to ? climateCorrectionKey(roomId, to, metric as ClimateMetricKind) : key] = text;
    });
  }

  return {
    ...entryData,
    measurements,
    ...(corrections ? { corrections } : {}),
  };
}

/** Строка «ЧЧ:ММ» — время контроля; иначе null. */
export function normalizeClimateControlTime(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const match = raw.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function mergeClimateEntryData(
  currentData: ClimateEntryData,
  generatedData: ClimateEntryData
): ClimateEntryData {
  const next: ClimateEntryData = {
    responsibleTitle: currentData.responsibleTitle || generatedData.responsibleTitle,
    measurements: {},
  };

  Object.keys(generatedData.measurements).forEach((roomId) => {
    next.measurements[roomId] = {};

    Object.keys(generatedData.measurements[roomId] || {}).forEach((time) => {
      const currentMeasurement = currentData.measurements[roomId]?.[time];
      const generatedMeasurement = generatedData.measurements[roomId]?.[time] || {
        temperature: null,
        humidity: null,
      };

      next.measurements[roomId][time] = {
        temperature:
          currentMeasurement?.temperature ?? generatedMeasurement.temperature ?? null,
        humidity: currentMeasurement?.humidity ?? generatedMeasurement.humidity ?? null,
      };
    });
  });
  if (currentData.corrections) next.corrections = currentData.corrections;

  return next;
}

export function getClimateFilePrefix() {
  return "climate-journal";
}

/**
 * Дата в колонке «Дата» бланка микроклимата — ДД-ММ-ГГГГ.
 *
 * R5-16: здесь стояли ТОЧКИ, и на одном листе оказывались два разных
 * формата даты: шапка «Начат 01-08-2026» (`formatPaperHeaderDate`) и
 * колонка «01.08.2026». Серверный PDF (`document-pdf.ts` →
 * `formatPdfDate`) и печать бланка уже давно печатают дефисы, так что
 * экран был единственным местом с точками — приводим к общему виду.
 *
 * В ПОЛЯХ ВВОДА диалогов точки остаются допустимы (там это привычный
 * пользователю ввод), правило касается только бланка.
 */
export function getClimateDateLabel(date: Date | string) {
  const dateKey = toDateKey(date);
  const [year, month, day] = dateKey.split("-");
  return `${day}-${month}-${year}`;
}
