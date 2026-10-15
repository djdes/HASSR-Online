/** Immutable row operations shared by the employee and position access matrices. */
export type AccessMatrix = Map<string, Set<string>>;

export const POSITION_PRESET_KEYWORDS = {
  cleaning: ["уборщ", "клинер"],
  temperature: ["повар", "шеф", "кух"],
  health: [],
  receiving: ["товаровед", "кладов", "снабж"],
} as const;

export function positionPresetMatches(id: keyof typeof POSITION_PRESET_KEYWORDS, positionName: string): boolean {
  if (id === "health") return true;
  const normalized = positionName.toLocaleLowerCase("ru-RU");
  return POSITION_PRESET_KEYWORDS[id].some((keyword) => normalized.includes(keyword));
}

export function toggleMatrixGrant(matrix: AccessMatrix, rowId: string, templateCode: string): AccessMatrix {
  const next = new Map(matrix);
  const row = new Set(next.get(rowId) ?? []);
  if (row.has(templateCode)) row.delete(templateCode);
  else row.add(templateCode);
  next.set(rowId, row);
  return next;
}

export function setMatrixRow(matrix: AccessMatrix, rowId: string, codes: Iterable<string>, granted: boolean): AccessMatrix {
  const next = new Map(matrix);
  next.set(rowId, granted ? new Set(codes) : new Set());
  return next;
}

export function changedMatrixRows(base: AccessMatrix, current: AccessMatrix): Set<string> {
  const changed = new Set<string>();
  for (const [rowId, row] of current) {
    const original = base.get(rowId) ?? new Set<string>();
    if (row.size !== original.size || [...row].some((code) => !original.has(code))) changed.add(rowId);
  }
  return changed;
}

export function matrixRowCodes(matrix: AccessMatrix, rowId: string): string[] {
  return [...(matrix.get(rowId) ?? [])];
}
