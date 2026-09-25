/**
 * «Добавить в журналы на дату» мастер-кабинета: чистая часть — какие строки
 * БЖГП лягут в документ пищеблока. Строки строятся так же, как их добавило
 * бы окно «Добавить изделия списком» этого пищеблока: общее время
 * изготовления (или своё у строки), бракераж и разрешение — цепочкой по
 * «Константам времени» документа, выход / T° / примечание — только если
 * колонка у пищеблока видна, ответственный и проверяющий — из документа.
 *
 * Повтор не дублирует: позиция с тем же временем изготовления (дата + время)
 * в документе уже есть — пропускаем.
 */
import { chainBrakerageTimes } from "@/lib/brakerage-times";
import { hasCommission } from "@/lib/brakerage-commission";
import { cleanYield, normalizeTypedTime } from "@/lib/finished-product-bulk";
import {
  createFinishedProductRow,
  getFinishedProductOrganolepticOptions,
  normalizeFinishedProductDocumentConfig,
  type FinishedProductDocumentRow,
} from "@/lib/finished-product-document";
import { resolveColumns } from "@/lib/journal-columns";

/** Больше строк за раз не принимаем: это меню одного дня, а не справочник. */
export const MASTER_BRAKERAGE_ROWS_MAX = 200;

export type MasterBrakerageRow = { name: string; yield: string; time: string };

export type MasterBrakerageCommon = {
  /** «YYYY-MM-DD» — дата изготовления, на неё ищется документ пищеблока. */
  date: string;
  /** «ЧЧ:ММ» — время изготовления строк без своего времени. */
  time: string;
  /** Пусто — первая оценка журнала пищеблока (у полуфабрикатов своя шкала). */
  organoleptic: string;
  releaseAllowed: "yes" | "no";
  /** Ложится, только если колонка T° у пищеблока видна. */
  productTemp: string;
  /** Ложится, только если колонка «Примечание» у пищеблока видна. */
  note: string;
};

export type MasterBrakeragePeople = {
  responsibleName: string;
  verifierName: string;
};

export type MasterBrakeragePlan = {
  rows: FinishedProductDocumentRow[];
  /** Наименования, которые уже есть в документе с тем же временем. */
  skipped: string[];
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidIsoDate(value: string): boolean {
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function nameKey(value: string): string {
  return collapse(value).toLowerCase();
}

/** Ключ «та же позиция в то же время изготовления». */
export function brakerageRowKey(productName: string, productionDateTime: string): string {
  return `${nameKey(productName)}|${collapse(productionDateTime)}`;
}

/**
 * Строки окна → нормализованные: только с наименованием, выход как
 * `cleanYield`, время — «ЧЧ:ММ» (набранное без двоеточия тоже), иначе пусто.
 */
export function normalizeMasterBrakerageRows(rows: readonly MasterBrakerageRow[]): MasterBrakerageRow[] {
  return rows
    .map((row) => ({
      name: collapse(String(row.name ?? "")).slice(0, 200),
      yield: cleanYield(String(row.yield ?? "")),
      time: normalizeTypedTime(row.time),
    }))
    .filter((row) => row.name !== "");
}

/** Время изготовления строки: своё время, иначе общее. Пусто — нельзя добавить. */
export function productionDateTimeFor(row: MasterBrakerageRow, common: Pick<MasterBrakerageCommon, "date" | "time">): string {
  const time = normalizeTypedTime(row.time) || normalizeTypedTime(common.time);
  if (!time || !isValidIsoDate(common.date)) return "";
  return `${common.date} ${time}`;
}

/**
 * Какие строки добавить в документ пищеблока (`rawConfig` — `config`
 * документа как в базе). Порядок — как в окне.
 */
export function planMasterBrakerageRows(params: {
  rawConfig: unknown;
  rows: readonly MasterBrakerageRow[];
  common: MasterBrakerageCommon;
  people: MasterBrakeragePeople;
}): MasterBrakeragePlan {
  const config = normalizeFinishedProductDocumentConfig(params.rawConfig);
  const visible = new Set(
    resolveColumns("finished_product", config)
      .filter((column) => !column.hidden)
      .map((column) => column.key)
  );
  const organoleptic =
    collapse(params.common.organoleptic) || getFinishedProductOrganolepticOptions(config)[0] || "";
  const withCommission = hasCommission(config);
  const seen = new Set(config.rows.map((row) => brakerageRowKey(row.productName, row.productionDateTime)));
  const out: FinishedProductDocumentRow[] = [];
  const skipped: string[] = [];
  for (const item of normalizeMasterBrakerageRows(params.rows)) {
    const productionDateTime = productionDateTimeFor(item, params.common);
    if (!productionDateTime) continue;
    const key = brakerageRowKey(item.name, productionDateTime);
    if (seen.has(key)) {
      skipped.push(item.name);
      continue;
    }
    seen.add(key);
    const releaseAllowed = params.common.releaseAllowed === "no" ? "no" : "yes";
    const times = chainBrakerageTimes({ productionDateTime, releaseAllowed, offsets: config.timeDefaults });
    out.push(
      createFinishedProductRow({
        productName: item.name,
        productionDateTime,
        rejectionTime: times.rejectionTime,
        releasePermissionTime: times.releasePermissionTime,
        // Окно пищеблока ставит «сейчас»; для строк на выбранную дату —
        // момент разрешения к реализации (колонка курьера обычно скрыта).
        courierTransferTime: times.releasePermissionTime || productionDateTime,
        organoleptic,
        releaseAllowed,
        portionWeight: visible.has("portion") ? item.yield : "",
        productTemp: visible.has("temp") ? collapse(params.common.productTemp).slice(0, 20) : "",
        note: visible.has("note") ? collapse(params.common.note).slice(0, 500) : "",
        responsiblePerson: params.people.responsibleName,
        // С комиссией подписи ставят её члены — ФИО проверяющего не подставляем.
        inspectorName: withCommission ? "" : params.people.verifierName,
      })
    );
  }
  return { rows: out, skipped };
}

/** Строка нового документа-заготовки без наименования — убрать перед добавлением. */
export function isBlankBrakerageRow(row: unknown): boolean {
  if (!row || typeof row !== "object" || Array.isArray(row)) return true;
  const record = row as Record<string, unknown>;
  const name = typeof record.productName === "string" ? record.productName.trim() : "";
  const signatures = Array.isArray(record.signatures) ? record.signatures.length : 0;
  return name === "" && signatures === 0;
}
