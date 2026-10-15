import { brakerageRowKey, planMasterBrakerageRows, productionDateTimeFor, type MasterBrakeragePeople } from "@/lib/master-brakerage-plan";
import { normalizeFinishedProductDocumentConfig, type FinishedProductDocumentRow } from "@/lib/finished-product-document";
import type { MasterBrakerageHistoryInput } from "@/lib/master-brakerage-history";

export type MasterDelivery = {
  input: MasterBrakerageHistoryInput;
  rows: Array<{ sourceIndex: number; row: FinishedProductDocumentRow }>;
};

export class MasterCorrectionError extends Error {}

const fields = ["productName", "productionDateTime", "rejectionTime", "releasePermissionTime", "courierTransferTime", "portionWeight", "organoleptic", "releaseAllowed", "productTemp", "note"] as const;

function plannedRow(config: unknown, input: MasterBrakerageHistoryInput, index: number, people: MasterBrakeragePeople = { responsibleName: "", verifierName: "" }) {
  return planMasterBrakerageRows({ rawConfig: config, rows: [input.rows[index]], common: { ...input.common, date: input.date }, people }).rows[0];
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export function captureMasterDelivery(input: MasterBrakerageHistoryInput, inserted: FinishedProductDocumentRow[]): MasterDelivery {
  return { input: structuredClone(input), rows: inserted.map(row => ({
    sourceIndex: input.rows.findIndex(source => brakerageRowKey(source.name, productionDateTimeFor(source, { ...input.common, date: input.date })) === brakerageRowKey(row.productName, row.productionDateTime)),
    row: structuredClone(row),
  })) };
}

/** Old distributions predate row-ID tracking. Never guess between identical rows. */
export function recoverMasterDelivery(config: unknown, input: MasterBrakerageHistoryInput, skippedNames: string[] = []): MasterDelivery {
  const normalized = normalizeFinishedProductDocumentConfig(config);
  const rows = normalized.rows;
  const layout = { ...normalized, rows: [] };
  const recovered: MasterDelivery["rows"] = [];
  const seen = new Set<string>();
  input.rows.forEach((source, sourceIndex) => {
    const key = brakerageRowKey(source.name, productionDateTimeFor(source, { ...input.common, date: input.date }));
    if (seen.has(key)) return;
    seen.add(key);
    // Legacy results only contain skipped names, not their times: conservatively exclude them.
    if (skippedNames.includes(source.name)) return;
    const matches = rows.filter(row => brakerageRowKey(row.productName, row.productionDateTime) === key);
    if (matches.length !== 1) throw new MasterCorrectionError(`Не удалось однозначно найти прежнюю запись «${source.name}». Изменения не сохранены.`);
    const expected = plannedRow(layout, input, sourceIndex);
    recovered.push({ sourceIndex, row: { ...matches[0], ...Object.fromEntries(fields.map(field => [field, expected[field]])) } });
  });
  return { input: structuredClone(input), rows: recovered };
}

export function planMasterCorrection(params: {
  rawConfig: unknown;
  delivery: MasterDelivery;
  next: MasterBrakerageHistoryInput;
  protectedRowIds?: ReadonlySet<string>;
  people?: MasterBrakeragePeople;
}): { config: Record<string, unknown>; delivery: MasterDelivery; changedRowIds: string[] } {
  const { delivery, next } = params;
  const config = normalizeFinishedProductDocumentConfig(params.rawConfig);
  const layout = { ...config, rows: [] };
  const originals = new Map(delivery.rows.map(item => [item.sourceIndex, item.row]));
  if (originals.size !== delivery.rows.length || delivery.rows.some(item => item.sourceIndex < 0 || item.sourceIndex >= delivery.input.rows.length)) throw new MasterCorrectionError("Повреждена связь выгрузки со строками журнала.");
  let rows = [...config.rows];
  const updated: MasterDelivery["rows"] = [];
  const changedRowIds: string[] = [];
  const candidateRows = (params.rawConfig as { rows?: unknown } | null)?.rows;
  const rawRows = Array.isArray(candidateRows) ? candidateRows as Array<Record<string, unknown>> : [];
  const assertEditable = (row: FinishedProductDocumentRow) => {
    const raw = rawRows.find(item => item.id === row.id);
    if (row.signatures?.length || (Array.isArray(raw?.signatures) && raw.signatures.length) || params.protectedRowIds?.has(row.id) || raw?.verifiedAt || raw?.verificationDecidedAt || raw?.checked === true || ["approved", "rejected", "verified", "checked"].includes(String(raw?.verificationStatus ?? ""))) {
      throw new MasterCorrectionError(`Запись «${row.productName}» уже подписана или проверена. Её изменение пока недоступно.`);
    }
  };
  const sourceKey = (row: MasterBrakerageHistoryInput["rows"][number]) => JSON.stringify([row.name.replace(/\s+/g, " ").trim().toLowerCase(), row.yield.trim(), row.time.trim()]);
  const previousIndices = new Map<number, number>();
  const used = new Set<number>();
  // Match unchanged dishes first, so deleting/inserting before a signed dish never changes its identity.
  next.rows.forEach((row, nextIndex) => {
    const oldIndex = delivery.input.rows.findIndex((old, index) => !used.has(index) && sourceKey(old) === sourceKey(row));
    if (oldIndex >= 0) { previousIndices.set(nextIndex, oldIndex); used.add(oldIndex); }
  });
  next.rows.forEach((_, index) => {
    if (!previousIndices.has(index) && index < delivery.input.rows.length && !used.has(index)) { previousIndices.set(index, index); used.add(index); }
  });
  for (let index = 0; index < next.rows.length; index++) {
    const oldIndex = previousIndices.get(index);
    const baseline = oldIndex === undefined ? undefined : originals.get(oldIndex);
    if (oldIndex !== undefined && !baseline) {
      if (sourceKey(delivery.input.rows[oldIndex]) !== sourceKey(next.rows[index])) throw new MasterCorrectionError(`Позиция «${delivery.input.rows[oldIndex].name}» не была добавлена этой выгрузкой. Исправьте её в журнале отдельно.`);
      continue;
    }
    if (!baseline) {
      const added = plannedRow(layout, next, index, params.people);
      rows.push(added);
      updated.push({ sourceIndex: index, row: added });
      changedRowIds.push(added.id);
      continue;
    }
    const current = rows.find(row => row.id === baseline.id);
    if (!current) throw new MasterCorrectionError(`Запись «${baseline.productName}» удалена в пищеблоке. Изменения не сохранены.`);
    const oldExpected = plannedRow(layout, delivery.input, oldIndex!);
    const desired = plannedRow(layout, next, index);
    const changes = fields.filter(field => oldExpected[field] !== desired[field]);
    if (changes.length) {
      assertEditable(current);
      if (changes.some(field => current[field] !== baseline[field])) throw new MasterCorrectionError(`Запись «${current.productName}» изменена в пищеблоке. Изменения мастера не применены.`);
      const delta = Object.fromEntries(changes.map(field => [field, desired[field]]));
      rows = rows.map(row => row.id === current.id ? { ...row, ...delta } : row);
      updated.push({ sourceIndex: index, row: { ...baseline, ...delta } });
      changedRowIds.push(current.id);
    } else updated.push({ sourceIndex: index, row: baseline });
  }
  for (const [oldIndex, baseline] of originals) {
    if (used.has(oldIndex)) continue;
    const current = rows.find(row => row.id === baseline.id);
    if (!current) throw new MasterCorrectionError(`Запись «${baseline.productName}» удалена в пищеблоке. Изменения не сохранены.`);
    assertEditable(current);
    const raw = rawRows.find(row => row.id === current.id);
    if (canonical(current) !== canonical(baseline) || Object.keys(raw ?? {}).some(key => !(key in current) && !(key in baseline))) throw new MasterCorrectionError(`Запись «${current.productName}» изменена в пищеблоке. Обновите данные перед удалением.`);
    rows = rows.filter(row => row.id !== current.id);
    changedRowIds.push(current.id);
  }
  const keys = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.productName.trim()) continue;
    const key = brakerageRowKey(row.productName, row.productionDateTime);
    const same = [...(keys.get(key) ?? []), row.id];
    if (same.length > 1 && same.some(id => changedRowIds.includes(id))) throw new MasterCorrectionError(`В журнале уже есть «${row.productName}» с таким временем изготовления.`);
    keys.set(key, same);
  }
  // Keep organization-specific/custom metadata outside the normalized row model.
  const raw = params.rawConfig && typeof params.rawConfig === "object" ? params.rawConfig : {};
  return { config: { ...raw, rows: rows.map(row => {
    const original = rawRows.find(item => item.id === row.id);
    return original && !changedRowIds.includes(row.id) ? original : { ...original, ...row };
  }) }, delivery: { input: structuredClone(next), rows: updated }, changedRowIds };
}
