/**
 * Время в строке бракеража готовой продукции (все значения — местные
 * «ГГГГ-ММ-ДД ЧЧ:ММ»). Решение владельца: время снятия бракеража по
 * умолчанию = время изготовления + 5 минут, время разрешения к реализации =
 * время бракеража + 5 минут. Смещения настраиваются в журнале. Чистый модуль —
 * сайт, QR и сервер считают одинаково.
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
