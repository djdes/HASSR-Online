/**
 * «Распознать с фото» — общие константы и типы клиента и сервера.
 *
 * Поток: компонент `src/components/ai/recognize-from-photo.tsx` уменьшает
 * 1–3 снимка и шлёт их в `POST /api/ai/vision-extract`; сервер кладёт фото
 * во временную папку, отдаёт диспетчеру ProjectsFlow задание
 * `wesetup_vision_extract` со ссылками на них (подпись + срок 15 минут),
 * воркер `dispatcher/wesetup-worker.ps1` скачивает картинки и спрашивает
 * `claude -p`, ответ (JSON) сервер разбирает в строки и отдаёт компоненту.
 *
 * Модуль без Node-зависимостей: его импортирует и клиентский компонент.
 */

export const VISION_KINDS = ["menu", "raw", "generic"] as const;
export type VisionKind = (typeof VISION_KINDS)[number];

export function isVisionKind(value: unknown): value is VisionKind {
  return typeof value === "string" && (VISION_KINDS as readonly string[]).includes(value);
}

/** Сколько снимков за один запрос. */
export const VISION_MAX_PHOTOS = 3;
/** Предел одного снимка на сервере; клиент заранее ужимает до ~200–600 КБ. */
export const VISION_MAX_PHOTO_BYTES = 6 * 1024 * 1024;
/**
 * Длинная сторона после уменьшения на клиенте. Больше не нужно: модель всё
 * равно ужимает картинку примерно до 1568 px по длинной стороне.
 */
export const VISION_TARGET_PX = 1600;
export const VISION_JPEG_QUALITY = 0.85;
/** Больше строк из одного распознавания не отдаём. */
export const VISION_MAX_ITEMS = 200;

/** Меню: наименование, выход как на фото, время «ЧЧ:ММ» (или пусто). */
export type VisionMenuItem = { name: string; yield: string; time: string };

/**
 * Сырьё — фактический набор полей справочника сырья мастер-кабинета
 * (наименование, поставщик, изготовитель) и строки журнала скоропорта /
 * входного контроля (количество, дата выработки, конечный срок). Даты —
 * «ГГГГ-ММ-ДД» (как в полях type=date), нечитаемое — пустая строка.
 */
export type VisionRawItem = {
  name: string;
  manufacturer: string;
  supplier: string;
  quantity: string;
  productionDate: string;
  expiryDate: string;
};

export type VisionGenericItem = { name: string };

export type VisionItemByKind = {
  menu: VisionMenuItem;
  raw: VisionRawItem;
  generic: VisionGenericItem;
};

export type VisionFieldKey = "name" | "yield" | "time" | "manufacturer" | "supplier" | "quantity" | "productionDate" | "expiryDate";

/** Поля вида в порядке показа в таблице проверки. */
export const VISION_FIELDS: { [K in VisionKind]: Array<keyof VisionItemByKind[K] & VisionFieldKey> } = {
  menu: ["name", "yield", "time"],
  raw: ["name", "manufacturer", "supplier", "quantity", "productionDate", "expiryDate"],
  generic: ["name"],
};

/** Предельная длина поля: длиннее — обрезаем при разборе ответа. */
export const VISION_FIELD_MAX: Record<VisionFieldKey, number> = {
  name: 200,
  yield: 20,
  time: 5,
  manufacturer: 200,
  supplier: 200,
  quantity: 40,
  productionDate: 10,
  expiryDate: 10,
};

export const VISION_FIELD_LABELS: Record<VisionFieldKey, string> = {
  name: "Наименование",
  yield: "Выход",
  time: "Время",
  manufacturer: "Изготовитель",
  supplier: "Поставщик",
  quantity: "Количество",
  productionDate: "Дата выработки",
  expiryDate: "Годен до",
};

/** Ответ `POST /api/ai/vision-extract`. */
export type VisionExtractSuccess<K extends VisionKind = VisionKind> = {
  kind: K;
  items: Array<VisionItemByKind[K]>;
  /** Строк было больше 200 — показаны первые. */
  truncated: boolean;
  photos: number;
  durationMs: number;
};

export type VisionErrorCode =
  | "bad_request"
  | "too_large"
  | "bad_type"
  | "limit"
  | "not_configured"
  | "timeout"
  | "failed";

export type VisionExtractError = { error: string; code: VisionErrorCode };

/** Пустой элемент вида — для строк, добавленных руками в таблице проверки. */
export function emptyVisionItem<K extends VisionKind>(kind: K): VisionItemByKind[K] {
  const item: Record<string, string> = {};
  for (const field of VISION_FIELDS[kind]) item[field] = "";
  return item as VisionItemByKind[K];
}
