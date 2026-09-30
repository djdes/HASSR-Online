/**
 * Время в строке бракеража готовой продукции (все значения — местные
 * «ГГГГ-ММ-ДД ЧЧ:ММ»). Решение владельца: время снятия бракеража по
 * умолчанию = время изготовления + 5 минут, время разрешения к реализации =
 * время бракеража + 5 минут. Смещения настраиваются в журнале. Время подписи
 * бракеражной комиссии в журнале = время бракеража + 1 минута (2026-09-30).
 * Чистый модуль — сайт, QR и сервер считают одинаково.
 */
export type BrakerageTimeOffsets = {
  rejectionAfterProductionMinutes: number;
  releaseAfterRejectionMinutes: number;
};

export const BRAKERAGE_TIME_OFFSETS_DEFAULT: BrakerageTimeOffsets = {
  rejectionAfterProductionMinutes: 5,
  releaseAfterRejectionMinutes: 5,
};

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** «2026-09-22 23:58» + 5 → «2026-09-23 00:03»; непонятное значение — "". */
export function addMinutesToLocalDateTime(value: string, minutes: number): string {
  const match = LOCAL_RE.exec(value.trim());
  if (!match) return "";
  const [, y, mo, d, h, mi] = match.map(Number);
  // Считаем в UTC как в «часах без пояса»: сдвиг местного времени без DST.
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi) + minutes * 60_000);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

/** «ЧЧ:ММ» + N минут по кругу суток: «23:59» + 1 → «00:00»; непонятное значение — "". */
function addMinutesToLocalTime(value: string, minutes: number): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return "";
  const hours = Number(match[1]);
  const mins = Number(match[2]);
  if (hours > 23 || mins > 59) return "";
  const total = (((hours * 60 + mins + minutes) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** Минуты от `from` до `to` (оба местные «ГГГГ-ММ-ДД ЧЧ:ММ»); непонятное — null. */
export function minutesBetweenLocalDateTimes(from: string, to: string): number | null {
  const at = (value: string) => {
    const match = LOCAL_RE.exec(value.trim());
    if (!match) return null;
    const [, y, mo, d, h, mi] = match.map(Number);
    return Date.UTC(y, mo - 1, d, h, mi) / 60_000;
  };
  const a = at(from);
  const b = at(to);
  return a === null || b === null ? null : b - a;
}

/**
 * Подпись бракеражной комиссии в журнале — через 1 минуту после времени
 * бракеража строки (решение владельца 2026-09-30): бракераж 12:30 → подпись 12:31.
 */
export const COMMISSION_SIGN_AFTER_REJECTION_MINUTES = 1;

/** Времена строки, от которых считается время подписи комиссии. */
export type BrakerageRowTimes = {
  rejectionTime?: string | null;
  productionDateTime?: string | null;
};

/**
 * Время бракеража строки как «ГГГГ-ММ-ДД ЧЧ:ММ». Бывает записано без даты
 * («ЧЧ:ММ» — так пишут «Повторить» и демо): ставим на дату изготовления, а
 * если так выходит раньше изготовления — на следующий день (бракераж после
 * полуночи). Без даты изготовления — «ЧЧ:ММ». Нет времени бракеража или оно
 * непонятное — "".
 */
export function rowRejectionDateTime(row: BrakerageRowTimes): string {
  const raw = (row.rejectionTime ?? "").trim();
  if (!raw) return "";
  if (LOCAL_RE.test(raw)) return addMinutesToLocalDateTime(raw, 0);
  const time = addMinutesToLocalTime(raw, 0);
  if (!time) return "";
  const production = addMinutesToLocalDateTime(row.productionDateTime ?? "", 0);
  if (!production) return time;
  const onProductionDay = `${production.slice(0, 10)} ${time}`;
  return onProductionDay < production ? addMinutesToLocalDateTime(onProductionDay, 24 * 60) : onProductionDay;
}

/**
 * Время подписи комиссии по умолчанию — время бракеража строки + 1 минута:
 * «2026-09-30 12:30» → «2026-09-30 12:31», «2026-09-30 23:59» → «2026-10-01 00:00».
 * Нет времени бракеража — "" (подпись встаёт настоящим временем, как раньше).
 */
export function commissionSignDefaultTime(row: BrakerageRowTimes): string {
  const rejection = rowRejectionDateTime(row);
  if (!rejection) return "";
  return LOCAL_RE.test(rejection)
    ? addMinutesToLocalDateTime(rejection, COMMISSION_SIGN_AFTER_REJECTION_MINUTES)
    : addMinutesToLocalTime(rejection, COMMISSION_SIGN_AFTER_REJECTION_MINUTES);
}

/** Поставить «ЧЧ:ММ» на дату строки; неверное время — null. */
export function withLocalTime(dateTime: string, time: string): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  const date = dateTime.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return `${date} ${pad(hours)}:${pad(minutes)}`;
}

/**
 * Пустые «время бракеража» и «время разрешения» — из времени изготовления.
 * Заполненные вручную не трогаем; «не разрешено» — без времени разрешения.
 */
export function deriveBrakerageTimes(params: {
  productionDateTime: string;
  rejectionTime?: string | null;
  releasePermissionTime?: string | null;
  releaseAllowed?: string | null;
  offsets?: Partial<BrakerageTimeOffsets> | null;
}): { rejectionTime: string; releasePermissionTime: string } {
  const offsets = { ...BRAKERAGE_TIME_OFFSETS_DEFAULT, ...(params.offsets ?? {}) };
  const rejectionTime =
    params.rejectionTime?.trim() || addMinutesToLocalDateTime(params.productionDateTime, offsets.rejectionAfterProductionMinutes);
  const releasePermissionTime =
    params.releaseAllowed === "no"
      ? params.releasePermissionTime?.trim() ?? ""
      : params.releasePermissionTime?.trim() || (rejectionTime ? addMinutesToLocalDateTime(rejectionTime, offsets.releaseAfterRejectionMinutes) : "");
  return { rejectionTime, releasePermissionTime };
}

/**
 * Новая строка (сайт «Добавить блюдо» / «Добавить списком», QR «Одно блюдо» /
 * «Несколько блюд»): вводится только изготовление, бракераж и разрешение
 * считаются заново цепочкой — прежние значения окна не держим.
 */
export function chainBrakerageTimes(params: {
  productionDateTime: string;
  rejectionTime?: string | null;
  releasePermissionTime?: string | null;
  releaseAllowed?: string | null;
  offsets?: Partial<BrakerageTimeOffsets> | null;
}): { rejectionTime: string; releasePermissionTime: string } {
  return deriveBrakerageTimes({
    productionDateTime: params.productionDateTime,
    releaseAllowed: params.releaseAllowed,
    offsets: params.offsets,
  });
}

/**
 * Коррекция времени изготовления по QR: у неподписанной строки бракераж и
 * разрешение сдвигаются цепочкой, у подписанной — остаются как подписаны.
 */
export function correctedBrakerageTimes(params: {
  row: { productionDateTime: string; rejectionTime: string; releasePermissionTime: string; releaseAllowed?: string | null };
  nextProductionDateTime: string;
  signed: boolean;
  offsets?: Partial<BrakerageTimeOffsets> | null;
}): { rejectionTime: string; releasePermissionTime: string } {
  const { row } = params;
  if (params.signed || params.nextProductionDateTime === row.productionDateTime) {
    return { rejectionTime: row.rejectionTime, releasePermissionTime: row.releasePermissionTime };
  }
  return chainBrakerageTimes({
    productionDateTime: params.nextProductionDateTime,
    releaseAllowed: row.releaseAllowed,
    offsets: params.offsets,
  });
}

/** Живая подпись в окне добавления: «Бракераж — 12:45, разрешение к реализации — 12:50 (…)». */
export function brakerageChainCaption(params: {
  productionDateTime: string;
  releaseAllowed?: string | null;
  offsets?: Partial<BrakerageTimeOffsets> | null;
}): string {
  const offsets = { ...BRAKERAGE_TIME_OFFSETS_DEFAULT, ...(params.offsets ?? {}) };
  const times = chainBrakerageTimes(params);
  const hhmm = (value: string) => value.slice(11, 16);
  if (!times.rejectionTime) return "Укажите время изготовления — бракераж и разрешение посчитаются сами";
  const settings = "меняется в настройках журнала";
  if (params.releaseAllowed === "no") {
    return `Бракераж — ${hhmm(times.rejectionTime)}, без разрешения к реализации (через ${offsets.rejectionAfterProductionMinutes} мин, ${settings})`;
  }
  return `Бракераж — ${hhmm(times.rejectionTime)}, разрешение к реализации — ${hhmm(times.releasePermissionTime)} (через ${offsets.rejectionAfterProductionMinutes} и ${offsets.releaseAfterRejectionMinutes} мин, ${settings})`;
}
